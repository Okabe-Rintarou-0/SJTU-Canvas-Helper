use std::{sync::Arc, time::Duration};

use reqwest::{cookie::Jar, header::LOCATION, redirect::Policy};
use serde::Deserialize;
use tauri::Url;

use crate::error::{AppError, Result};

#[derive(Deserialize)]
struct WebSessionTicket {
    session_url: String,
}

fn canvas_destination(origin: &Url, destination: Url) -> Result<Url> {
    if destination.origin() != origin.origin()
        || !destination.username().is_empty()
        || destination.password().is_some()
    {
        return Err(AppError::LoginError);
    }
    Ok(destination)
}

/// Establish a Canvas web session before launching any external tool.
/// Protocol: Canvas OAuth2 Endpoints, GET /login/session_token:
/// https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints
pub(super) async fn connect(origin: &Url, access_token: &str) -> Result<reqwest::Client> {
    tokio::time::timeout(Duration::from_secs(20), async {
        let home = origin.join("/").map_err(|_| AppError::LoginError)?;
        let endpoint = home
            .join("login/session_token")
            .map_err(|_| AppError::LoginError)?;

        // This client never follows redirects or participates in the LTI flow.
        let exchange = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(Policy::none())
            .build()?;
        let response = exchange
            .get(endpoint)
            .bearer_auth(access_token)
            .header(reqwest::header::ACCEPT, "application/json")
            .query(&[("return_to", home.as_str())])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(AppError::LoginError);
        }
        let ticket: WebSessionTicket = response.json().await?;
        let mut destination = canvas_destination(
            &home,
            Url::parse(&ticket.session_url).map_err(|_| AppError::LoginError)?,
        )?;

        // The ticket is short lived. Consume it immediately in a fresh cookie jar;
        // neither the API token nor jAccount cookies enter this browser session.
        let browser = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(Policy::none())
            .cookie_provider(Arc::new(Jar::default()))
            .build()?;
        for _ in 0..8 {
            let response = browser.get(destination.clone()).send().await?;
            if response.status().is_success() {
                return Ok(browser);
            }
            if !response.status().is_redirection() {
                return Err(AppError::LoginError);
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|header| header.to_str().ok())
                .ok_or(AppError::LoginError)?;
            destination = canvas_destination(
                &home,
                destination
                    .join(location)
                    .map_err(|_| AppError::LoginError)?,
            )?;
        }
        Err(AppError::LoginError)
    })
    .await
    // Ticket URLs and HTTP errors can contain credentials. Expose neither.
    .map_err(|_| AppError::LoginError)?
    .map_err(|_| AppError::LoginError)
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    #[tokio::test]
    async fn ticket_and_redirects_stay_on_canvas_without_bearer() {
        let canvas = MockServer::start();
        let other = MockServer::start();
        let exchange = canvas.mock(|when, then| {
            when.method(GET)
                .path("/login/session_token")
                .header("authorization", "Bearer api-secret")
                .query_param("return_to", canvas.url("/"));
            then.json_body(serde_json::json!({"session_url":canvas.url("/ticket")}));
        });
        let mut ticket = canvas.mock(|when, then| {
            when.path("/ticket").matches(|request| {
                request.headers.as_ref().is_none_or(|headers| {
                    !headers
                        .iter()
                        .any(|(name, _)| name.eq_ignore_ascii_case("authorization"))
                })
            });
            then.status(302)
                .header("Set-Cookie", "canvas=ready; Path=/")
                .header("Location", "/");
        });
        let home = canvas.mock(|when, then| {
            when.path("/")
                .header("cookie", "canvas=ready")
                .matches(|request| {
                    request.headers.as_ref().is_none_or(|headers| {
                        !headers
                            .iter()
                            .any(|(name, _)| name.eq_ignore_ascii_case("authorization"))
                    })
                });
            then.status(200);
        });
        let origin = Url::parse(&canvas.base_url()).unwrap();
        connect(&origin, "api-secret").await.unwrap();
        exchange.assert();
        ticket.assert();
        home.assert();

        ticket.delete();
        let redirect = canvas.mock(|when, then| {
            when.path("/ticket");
            then.status(302).header("Location", other.url("/private"));
        });
        let outside = other.mock(|when, then| {
            when.any_request();
            then.status(200);
        });
        assert!(connect(&origin, "api-secret").await.is_err());
        redirect.assert();
        outside.assert_hits(0);
    }

    #[test]
    fn rejects_untrusted_ticket_destinations() {
        let origin = Url::parse("https://oc.sjtu.edu.cn/").unwrap();
        for destination in [
            "https://example.org/ticket",
            "http://oc.sjtu.edu.cn/ticket",
            "https://user:password@oc.sjtu.edu.cn/ticket",
        ] {
            assert!(canvas_destination(&origin, Url::parse(destination).unwrap()).is_err());
        }
    }
}
