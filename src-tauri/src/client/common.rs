use reqwest::{
    header::{HeaderValue, ACCEPT, CONTENT_TYPE},
    Body, Response,
};
use serde::{de::DeserializeOwned, Serialize};

use super::Client;
use crate::{error::Result, utils};

impl Client {
    pub async fn get_request_with_token<T: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<Response> {
        let mut req = self
            .cli
            .get(url)
            .header("Authorization", format!("Bearer {}", token));

        if let Some(query) = query {
            req = req.query(query)
        }

        let res = req.send().await?;
        Ok(res)
    }

    pub async fn get_json_with_token<T: Serialize + ?Sized, D: DeserializeOwned>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<D> {
        let response = self
            .get_request_with_token(url, query, token)
            .await?
            .error_for_status()?;
        let json = utils::parse_json(&response.bytes().await?)?;
        Ok(json)
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
            .header("Authorization".to_owned(), format!("Bearer {}", token))
            .form(form);
        if let Some(query) = query {
            request = request.query(query);
        }
        let response = request.send().await?;
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
            .header("Authorization".to_owned(), format!("Bearer {}", token))
            .form(form);
        if let Some(query) = query {
            request = request.query(query);
        }
        let response = request.send().await?;
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
        let resp = req.send().await?.error_for_status()?;
        let bytes = resp.bytes().await?;

        // tracing::info!("resp: {:?}", String::from_utf8_lossy(&bytes.to_vec()));
        let result = utils::parse_json(&bytes)?;
        Ok(result)
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

        let res = req.send().await?;
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

        let response = req.send().await?.error_for_status()?;
        let json = utils::parse_json(&response.bytes().await?)?;
        Ok(json)
    }
}
