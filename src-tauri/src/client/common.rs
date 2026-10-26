use reqwest::{
    cookie::{CookieStore, Jar},
    header::{HeaderValue, ACCEPT, CONTENT_TYPE, COOKIE, LOCATION, SET_COOKIE},
    Body, Method, Response, Url,
};
use serde::{de::DeserializeOwned, Serialize};

use super::{debug::RequestLogId, Client};
use crate::{error::{AppError, Result}, utils};
use std::{io, sync::Arc};

// Keep the existing proxy selection and user agent in every request channel.
// Only Canvas requests share credentials; download redirects are checked per hop.
pub(super) fn build_http_client(
    no_proxy: bool,
    jar: Option<Arc<Jar>>,
    redirect: reqwest::redirect::Policy,
) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
        .redirect(redirect);
    if no_proxy {
        builder = builder.no_proxy();
    }
    if let Some(jar) = jar {
        builder = builder.cookie_provider(jar);
    }
    builder.build().unwrap()
}

pub(super) fn canvas_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let target = attempt.url();
        if !target.username().is_empty() || target.password().is_some()
            || attempt.previous().first()
                .map(|source| source.origin() != target.origin()).unwrap_or(true)
        {
            return attempt.error("Canvas redirect must stay on its original origin without URL credentials");
        }
        if attempt.previous().len() >= 10 {
            return attempt.error("Too many Canvas redirects");
        }
        attempt.follow()
    })
}

fn request_boundary_error(message: &'static str) -> AppError {
    io::Error::new(io::ErrorKind::InvalidInput, message).into()
}

fn parse_http_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| request_boundary_error("Invalid request URL"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
    {
        return Err(request_boundary_error("Request URL must be absolute HTTP(S) without embedded credentials"));
    }
    Ok(url)
}

impl Client {
    pub(super) async fn canvas_request(
        &self,
        method: Method,
        url: &str,
        token: &str,
    ) -> Result<reqwest::RequestBuilder> {
        let target = parse_http_url(url)?;
        let base = parse_http_url(&self.base_url.read().await)?;
        if target.origin() != base.origin() {
            return Err(request_boundary_error("Canvas token request must target the configured Canvas origin"));
        }
        Ok(self.canvas_cli.request(method, target).bearer_auth(token))
    }

    pub(super) async fn execute_canvas_request(&self, request: reqwest::Request) -> Result<Response> {
        let base = parse_http_url(&self.base_url.read().await)?;
        if request.url().origin() != base.origin() {
            return Err(request_boundary_error("Canvas origin changed before request execution"));
        }
        let response = self.debug_store.send(&self.canvas_cli, request).await
            .map_err(reqwest::Error::without_url)?;
        if response.status().is_redirection() {
            return Err(request_boundary_error("Canvas request returned an unresolved redirect"));
        }
        Ok(response)
    }

    // A foreign download never receives the account jar or Canvas bearer token,
    // even if it later redirects back to Canvas. Its own cookies are ephemeral.
    pub(super) async fn download_response(&self, url: &str, token: &str) -> Result<Response> {
        let base = parse_http_url(&self.base_url.read().await)?;
        let mut target = parse_http_url(url)?;
        let mut trusted = target.origin() == base.origin();
        let anonymous_jar = Jar::default();
        let mut redirects = 0;
        loop {
            let jar = if trusted { self.jar.as_ref() } else { &anonymous_jar };
            let mut request = self.download_cli.get(target.clone());
            if trusted {
                request = request.bearer_auth(token);
            }
            if let Some(cookies) = jar.cookies(&target) {
                request = request.header(COOKIE, cookies);
            }
            let response = self.debug_store.send(&self.download_cli, request.build()?).await
                .map_err(reqwest::Error::without_url)?;
            jar.set_cookies(&mut response.headers().get_all(SET_COOKIE).iter(), &target);
            if !response.status().is_redirection() {
                return Ok(response);
            }
            if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                return Err(request_boundary_error("Unsupported download redirect status"));
            }
            redirects += 1;
            if redirects >= 10 {
                return Err(request_boundary_error("Too many download redirects"));
            }
            let location = response.headers().get(LOCATION).and_then(|value| std::str::from_utf8(value.as_bytes()).ok())
                .ok_or_else(|| request_boundary_error("Download redirect has no valid Location"))?;
            let next = target.join(location)
                .map_err(|_| request_boundary_error("Invalid download redirect URL"))?;
            let next = parse_http_url(next.as_str())?;
            if target.scheme() == "https" && next.scheme() != "https" {
                return Err(request_boundary_error("HTTPS download redirect cannot downgrade to HTTP"));
            }
            trusted = trusted && next.origin() == base.origin();
            target = next;
        }
    }

    pub async fn execute_request(
        &self,
        request: reqwest::Request,
    ) -> std::result::Result<Response, reqwest::Error> {
        self.debug_store.send(&self.cli, request).await
    }

    pub(super) async fn parse_response_json<D: DeserializeOwned>(
        &self,
        response: Response,
    ) -> Result<D> {
        // The response carries the ID assigned before dispatch, so concurrent reads stay paired.
        let request_id = response.extensions().get::<RequestLogId>().cloned();
        let response = response.error_for_status()?;
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => {
                if let Some(request_id) = &request_id {
                    self.debug_store
                        .capture_response_failure(request_id, "response_body_read_failed")
                        .await;
                }
                return Err(error.into());
            }
        };
        if let Some(request_id) = &request_id {
            self.debug_store
                .capture_response_body(request_id, bytes.len())
                .await;
        }
        match utils::json::parse_json(&bytes) {
            Ok(json) => Ok(json),
            Err(error) => {
                if let Some(request_id) = &request_id {
                    self.debug_store
                        .capture_response_failure(request_id, "response_json_decode_failed")
                        .await;
                }
                Err(error)
            }
        }
    }

    pub async fn get_request_with_token<T: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<Response> {
        let mut req = self.canvas_request(Method::GET, url, token).await?;

        if let Some(query) = query {
            req = req.query(query)
        }

        let req = req.build()?;
        let res = self.execute_canvas_request(req).await?;
        Ok(res)
    }

    pub async fn get_json_with_token<T: Serialize + ?Sized, D: DeserializeOwned>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<D> {
        let response = self.get_request_with_token(url, query, token).await?;
        self.parse_response_json(response).await
    }

    pub async fn post_form_with_token<T: Serialize + ?Sized, Q: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&Q>,
        form: &T,
        token: &str,
    ) -> Result<Response> {
        let mut request = self.canvas_request(Method::POST, url, token).await?.form(form);
        if let Some(query) = query {
            request = request.query(query);
        }
        let request = request.build()?;
        let response = self.execute_canvas_request(request).await?;
        Ok(response)
    }

    pub async fn put_form_with_token<T: Serialize + ?Sized, Q: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&Q>,
        form: &T,
        token: &str,
    ) -> Result<Response> {
        let mut request = self.canvas_request(Method::PUT, url, token).await?.form(form);
        if let Some(query) = query {
            request = request.query(query);
        }
        let request = request.build()?;
        let response = self.execute_canvas_request(request).await?;
        Ok(response)
    }

    pub async fn post_request<D: DeserializeOwned, B: Into<Body>>(
        &self,
        url: &str,
        body: B,
    ) -> Result<D> {
        let req = self
            .cli
            .post(url)
            .body(body)
            .header(CONTENT_TYPE, "application/json");
        let req = req.build()?;
        let response = self.execute_request(req).await?;
        self.parse_response_json(response).await
    }

    pub async fn get_request<T: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&T>,
    ) -> Result<Response> {
        let mut req = self.cli.get(url);

        if let Some(query) = query {
            req = req.query(query);
        }

        let req = req.build()?;
        let res = self.execute_request(req).await?;
        Ok(res)
    }

    pub async fn get_json_with_cookie<T: Serialize + ?Sized, D: DeserializeOwned>(
        &self,
        url: &str,
        query: Option<&T>,
    ) -> Result<D> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let mut req = self.cli.get(url).headers(headers);

        if let Some(query) = query {
            req = req.query(query);
        }

        let req = req.build()?;
        let response = self.execute_request(req).await?;
        self.parse_response_json(response).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::{Method::GET, MockServer};

    #[tokio::test]
    async fn json_processing_failures_update_only_their_request_without_recording_bodies() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/good");
            then.status(200).body("123");
        });
        server.mock(|when, then| {
            when.method(GET).path("/bad");
            then.status(200).body(r#"{"private":"response-secret"}"#);
        });
        let client = Client::new_without_proxy(
            server.base_url(),
            String::new(),
            String::new(),
            String::new(),
            None,
        );
        client.set_debug_mode(true);
        let good_url = server.url("/good");
        let bad_url = server.url("/bad");
        let (good, bad) = tokio::join!(
            client.get_json_with_token::<str, u64>(&good_url, None, "request-secret"),
            client.get_json_with_token::<str, u64>(&bad_url, None, "request-secret")
        );
        assert_eq!(good.unwrap(), 123);
        assert!(bad.is_err());
        let logs = client.list_network_logs().await;
        assert_eq!(logs.len(), 2);
        assert_eq!(logs.iter().filter(|log| log.ok == Some(true)).count(), 1);
        let failed = logs.iter().find(|log| log.ok == Some(false)).unwrap();
        assert_eq!(failed.status, Some(200));
        assert_eq!(failed.error.as_deref(), Some("response_json_decode_failed"));
        assert!(logs.iter().all(|log| log
            .response_body
            .as_deref()
            .unwrap()
            .starts_with("<body omitted:")));
        let captured = format!("{logs:?}");
        assert!(!captured.contains("request-secret"));
        assert!(!captured.contains("response-secret"));
    }
}
