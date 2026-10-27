use reqwest::{
    header::{HeaderValue, ACCEPT, CONTENT_TYPE},
    Body, Response,
};
use serde::{de::DeserializeOwned, Serialize};

use super::{debug::RequestLogId, Client};
use crate::{error::Result, utils};

impl Client {
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
        let mut req = self
            .cli
            .get(url)
            .header("Authorization", format!("Bearer {token}"));

        if let Some(query) = query {
            req = req.query(query)
        }

        let req = req.build()?;
        let res = self.execute_request(req).await?;
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
        let mut request = self
            .cli
            .post(url)
            .header("Authorization".to_owned(), format!("Bearer {token}"))
            .form(form);
        if let Some(query) = query {
            request = request.query(query);
        }
        let request = request.build()?;
        let response = self.execute_request(request).await?;
        Ok(response)
    }

    pub async fn put_form_with_token<T: Serialize + ?Sized, Q: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&Q>,
        form: &T,
        token: &str,
    ) -> Result<Response> {
        let mut request = self
            .cli
            .put(url)
            .header("Authorization".to_owned(), format!("Bearer {token}"))
            .form(form);
        if let Some(query) = query {
            request = request.query(query);
        }
        let request = request.build()?;
        let response = self.execute_request(request).await?;
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
