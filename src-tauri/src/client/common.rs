use reqwest::{
    cookie::{CookieStore, Jar},
    header::{HeaderValue, ACCEPT, CONTENT_TYPE, COOKIE, LOCATION, SET_COOKIE},
    Body, Method, Response, Url,
};
use serde::{de::DeserializeOwned, Serialize};

use super::{debug::RequestLogId, Client};
use crate::{error::{AppError, Result}, utils};
use std::{io, sync::Arc};

// One budget for an entire authentication chain, including redirects, response
// bodies and form exchanges. Never apply this helper to media downloads/data.
const AUTH_BUDGET: std::time::Duration = std::time::Duration::from_secs(30);

pub(crate) async fn authentication<T>(future: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    authentication_with_budget(AUTH_BUDGET, future).await
}

async fn authentication_with_budget<T>(
    budget: std::time::Duration,
    future: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::time::timeout(budget, future).await.map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::TimedOut, "Authentication timed out")
    })?
}

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

#[cfg(test)]
mod authentication_budget_tests {
    use super::*;
    use std::{future::pending, sync::atomic::{AtomicBool, Ordering}, time::Duration};
    use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::{oneshot, Mutex}};

    struct Dropped(Arc<AtomicBool>);
    impl Drop for Dropped {
        fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); }
    }

    #[tokio::test]
    async fn authentication_budget_preserves_success_and_original_error() {
        let result = authentication_with_budget(Duration::from_millis(50), async {
            Ok((42, "synthetic-token".to_string()))
        }).await.unwrap();
        assert_eq!(result, (42, "synthetic-token".to_string()));
        let result = authentication_with_budget(Duration::from_millis(50), async {
            Err::<(), _>(AppError::LoginError)
        }).await;
        assert!(matches!(result, Err(AppError::LoginError)));
    }

    #[tokio::test]
    async fn pending_authentication_times_out_and_drops_held_resources() {
        let lock = Mutex::new(());
        let dropped = Arc::new(AtomicBool::new(false));
        let result = authentication_with_budget(Duration::from_millis(10), async {
            let _lock = lock.lock().await;
            let _drop = Dropped(Arc::clone(&dropped));
            pending::<Result<()>>().await
        }).await;
        assert!(matches!(result, Err(AppError::IO(error)) if error.kind() == io::ErrorKind::TimedOut));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(lock.try_lock().is_ok(), "timeout must drop rather than detach the auth future");
        authentication_with_budget(Duration::from_millis(50), async {
            let _retry = lock.lock().await;
            Ok(())
        }).await.unwrap();
    }

    #[tokio::test]
    async fn caller_cancellation_drops_authentication_before_its_own_budget() {
        let lock = Mutex::new(());
        let dropped = Arc::new(AtomicBool::new(false));
        let cancelled = tokio::time::timeout(Duration::from_millis(10),
            authentication_with_budget(Duration::from_secs(60), async {
                let _lock = lock.lock().await;
                let _drop = Dropped(Arc::clone(&dropped));
                pending::<Result<()>>().await
            })).await;
        assert!(cancelled.is_err());
        assert!(dropped.load(Ordering::SeqCst));
        assert!(lock.try_lock().is_ok());
    }

    #[tokio::test]
    async fn authentication_budget_includes_pending_loopback_response_body() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/synthetic-auth", listener.local_addr().unwrap());
        let (release, wait) = oneshot::channel::<()>();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            assert!(socket.read(&mut request).await.unwrap() > 0);
            // Headers complete successfully, but the authentication body never
            // arrives until after the client budget expires. No sleep race.
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n").await.unwrap();
            wait.await.unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = tokio::time::timeout(Duration::from_secs(2), client.get(url).send()).await.unwrap().unwrap();
        let result = authentication_with_budget(Duration::from_millis(10), async {
            Ok(response.text().await?)
        }).await;
        assert!(matches!(result, Err(AppError::IO(error)) if error.kind() == io::ErrorKind::TimedOut));
        release.send(()).unwrap();
        server.await.unwrap();
    }
}
