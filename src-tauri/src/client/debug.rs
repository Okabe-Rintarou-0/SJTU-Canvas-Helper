use std::{
    collections::VecDeque,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

use chrono::Utc;
use reqwest::{header::HeaderMap, Request, Response};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    diagnostics::{sanitize_text, sanitize_url},
    model::{DebugHttpHeader, NetworkRequestLog},
};

const MAX_NETWORK_LOGS: usize = 200;
const MAX_FIELD_BYTES: usize = 512;
const MAX_HEADERS: usize = 8;

/// Carried by the response so concurrent body reads cannot update another request.
#[derive(Clone, Debug)]
pub(super) struct RequestLogId(String);

#[derive(Debug)]
pub struct NetworkDebugStore {
    enabled: AtomicBool,
    logs: RwLock<VecDeque<NetworkRequestLog>>,
}

impl NetworkDebugStore {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: AtomicBool::new(enabled),
            logs: RwLock::new(VecDeque::with_capacity(MAX_NETWORK_LOGS)),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    pub async fn list_logs(&self) -> Vec<NetworkRequestLog> {
        self.logs.read().await.iter().rev().cloned().collect()
    }

    pub async fn clear_logs(&self) {
        self.logs.write().await.clear();
    }

    pub(super) async fn capture_response_body(&self, request_id: &RequestLogId, byte_count: usize) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let mut logs = self.logs.write().await;
        // Diagnostic mode may have been disabled while this capture awaited the lock.
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        if let Some(log) = logs.iter_mut().find(|log| log.id == request_id.0) {
            // Never accept the body itself: diagnostic mode only records its size.
            log.response_body = Some(body_omitted(byte_count));
            log.response_body_truncated = false;
        }
    }

    pub(super) async fn capture_response_failure(
        &self,
        request_id: &RequestLogId,
        stage: &'static str,
    ) {
        let mut logs = self.logs.write().await;
        if let Some(log) = logs.iter_mut().find(|log| log.id == request_id.0) {
            log.ok = Some(false);
            log.error = Some(bounded(stage));
            log_network_failure(log, &log.url);
        } else {
            // Clearing/evicting a UI entry must not suppress a later read/parse failure.
            tracing::warn!(
                target: "sjtu_canvas_helper::network",
                event = "network_request_failed",
                request_id = %request_id.0,
                error = stage,
                "Network response processing failed"
            );
        }
    }

    pub async fn send(
        &self,
        client: &reqwest::Client,
        request: Request,
    ) -> std::result::Result<Response, reqwest::Error> {
        let detailed = self.enabled.load(Ordering::Relaxed);
        let log = self.capture_request(&request, detailed);
        let started = Instant::now();
        let mut result = client.execute(request).await;

        let mut network_log = NetworkRequestLog {
            id: log.id,
            timestamp: log.timestamp,
            source: log.source,
            method: log.method,
            url: log.url,
            status: None,
            ok: None,
            // This measures until response headers arrive, not the body download time.
            duration_ms: Some(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64),
            request_headers: log.request_headers,
            response_headers: vec![],
            request_body: log.request_body,
            request_body_truncated: false,
            response_body: None,
            response_body_truncated: false,
            error: None,
        };

        match &mut result {
            Ok(response) => {
                network_log.status = Some(response.status().as_u16());
                network_log.ok = Some(response.status().is_success());
                if detailed {
                    network_log.response_headers = headers_to_debug(response.headers());
                }
                response
                    .extensions_mut()
                    .insert(RequestLogId(network_log.id.clone()));
                if !response.status().is_success() {
                    network_log.error = Some(format!("HTTP {}", response.status().as_u16()));
                    let final_url = bounded(&sanitize_url(response.url().as_str()));
                    log_network_failure(&network_log, &final_url);
                }
            }
            Err(error) => {
                network_log.status = error.status().map(|status| status.as_u16());
                network_log.ok = Some(false);
                // reqwest's Display includes URLs. Categories avoid logging signed URLs or secrets.
                network_log.error = Some(network_error_kind(error).to_owned());
                log_network_failure(&network_log, &network_log.url);
            }
        }

        self.push_log(network_log).await;
        result
    }

    async fn push_log(&self, log: NetworkRequestLog) {
        // Keep safe metadata even without diagnostic mode: body reads/JSON parsing can still fail.
        let mut logs = self.logs.write().await;
        if logs.len() >= MAX_NETWORK_LOGS {
            logs.pop_front();
        }
        logs.push_back(log);
    }

    fn capture_request(&self, request: &Request, detailed: bool) -> PendingNetworkLog {
        PendingNetworkLog {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            source: bounded(&sanitize_text(
                request.url().host_str().unwrap_or("unknown"),
            )),
            method: match request.method().as_str() {
                "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" | "CONNECT"
                | "TRACE" => request.method().as_str().to_owned(),
                _ => "<custom method>".to_owned(),
            },
            url: bounded(&sanitize_url(request.url().as_str())),
            request_headers: if detailed {
                headers_to_debug(request.headers())
            } else {
                vec![]
            },
            request_body: if detailed {
                body_preview(request)
            } else {
                None
            },
        }
    }
}

#[derive(Debug)]
struct PendingNetworkLog {
    id: String,
    timestamp: String,
    source: String,
    method: String,
    url: String,
    request_headers: Vec<DebugHttpHeader>,
    request_body: Option<String>,
}

fn log_network_failure(log: &NetworkRequestLog, final_url: &str) {
    tracing::warn!(
        target: "sjtu_canvas_helper::network",
        event = "network_request_failed",
        request_id = %log.id,
        method = %log.method,
        url = %log.url,
        final_url = final_url,
        status = ?log.status,
        duration_ms = ?log.duration_ms,
        error = log.error.as_deref().unwrap_or("unknown"),
        "Network request failed"
    );
}

fn network_error_kind(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "request_timeout"
    } else if error.is_connect() {
        "connection_failed"
    } else if error.is_redirect() {
        "redirect_failed"
    } else if error.is_body() {
        "body_read_failed"
    } else if error.is_decode() {
        "response_decode_failed"
    } else if error.is_builder() {
        "request_build_failed"
    } else {
        "network_failed"
    }
}

fn body_preview(request: &Request) -> Option<String> {
    request.body().map(|body| match body.as_bytes() {
        Some(bytes) => body_omitted(bytes.len()),
        None => "<streaming body omitted>".to_owned(),
    })
}

fn body_omitted(byte_count: usize) -> String {
    format!("<body omitted: {byte_count} bytes>")
}

fn headers_to_debug(headers: &HeaderMap) -> Vec<DebugHttpHeader> {
    // Only fixed categories and numeric values, never authentication or identifying headers.
    headers
        .iter()
        .filter_map(|(name, value)| {
            let value = value.to_str().ok()?;
            let safe_value = match name.as_str() {
                "content-type" => match value
                    .split(';')
                    .next()?
                    .trim()
                    .to_ascii_lowercase()
                    .as_str()
                {
                    "application/json" => "application/json".to_owned(),
                    "application/octet-stream" => "application/octet-stream".to_owned(),
                    "application/pdf" => "application/pdf".to_owned(),
                    "application/x-www-form-urlencoded" => {
                        "application/x-www-form-urlencoded".to_owned()
                    }
                    "multipart/form-data" => "multipart/form-data".to_owned(),
                    "text/plain" => "text/plain".to_owned(),
                    "text/html" => "text/html".to_owned(),
                    "text/event-stream" => "text/event-stream".to_owned(),
                    _ => "<other content type>".to_owned(),
                },
                "content-length" | "retry-after" => value
                    .parse::<u64>()
                    .map(|number| number.to_string())
                    .unwrap_or_else(|_| "<omitted>".to_owned()),
                "accept-ranges" => match value {
                    "bytes" | "none" => value.to_owned(),
                    _ => "<omitted>".to_owned(),
                },
                _ => return None,
            };
            Some(DebugHttpHeader {
                name: name.as_str().to_owned(),
                value: bounded(&safe_value),
            })
        })
        .take(MAX_HEADERS)
        .collect()
}

fn bounded(value: &str) -> String {
    let mut end = value.len().min(MAX_FIELD_BYTES);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::{Method::GET, MockServer};
    use reqwest::header::HeaderValue;

    #[test]
    fn diagnostic_request_excludes_credentials_body_and_url_secrets() {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let request = client
            .post(
                "https://user:password@example.com/api/files/123?token=url-secret#fragment-secret",
            )
            .header("authorization", "Bearer token-secret")
            .header("cookie", "session=cookie-secret")
            .header("x-api-key", "api-key-secret")
            .header("content-type", "application/json; boundary=boundary-secret")
            .body(r#"{"student_name":"中文姓名","password":"body-secret"}"#)
            .build()
            .unwrap();
        let store = NetworkDebugStore::new(true);
        let log = store.capture_request(&request, true);
        let debug = format!("{log:?}");
        for secret in [
            "password",
            "url-secret",
            "fragment-secret",
            "token-secret",
            "cookie-secret",
            "api-key-secret",
            "boundary-secret",
            "body-secret",
            "中文姓名",
        ] {
            assert!(!debug.contains(secret), "leaked {secret}: {debug}");
        }
        assert!(log.request_body.unwrap().starts_with("<body omitted:"));
        assert_eq!(log.request_headers.len(), 1);
        assert_eq!(log.request_headers[0].value, "application/json");
    }

    #[test]
    fn response_headers_are_whitelisted_and_bounded() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "set-cookie",
            HeaderValue::from_static("session=response-secret"),
        );
        headers.insert(
            "location",
            HeaderValue::from_static("https://example.com?token=location-secret"),
        );
        headers.insert("x-custom-secret", HeaderValue::from_static("custom-secret"));
        headers.insert(
            "content-type",
            HeaderValue::from_static("application/secret-type"),
        );
        headers.insert("content-length", HeaderValue::from_static("1234"));
        headers.insert("retry-after", HeaderValue::from_static("retry-secret"));
        let captured = headers_to_debug(&headers);
        let debug = format!("{captured:?}");
        for secret in [
            "response-secret",
            "location-secret",
            "custom-secret",
            "secret-type",
            "retry-secret",
        ] {
            assert!(!debug.contains(secret));
        }
        assert!(captured
            .iter()
            .any(|header| header.name == "content-length" && header.value == "1234"));
        assert!(captured.len() <= MAX_HEADERS);
        assert!(captured
            .iter()
            .all(|header| header.value.len() <= MAX_FIELD_BYTES));
        let chinese = "中".repeat(MAX_FIELD_BYTES);
        assert!(bounded(&chinese).len() <= MAX_FIELD_BYTES);
        assert!(bounded(&chinese).chars().all(|character| character == '中'));
    }

    #[tokio::test]
    async fn concurrent_response_updates_use_their_own_request_id() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/first");
            then.status(200).body("first-body-secret");
        });
        server.mock(|when, then| {
            when.method(GET).path("/second");
            then.status(200).body("second-body-secret-is-longer");
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let store = NetworkDebugStore::new(true);
        let (first, second) = tokio::join!(
            store.send(&client, client.get(server.url("/first")).build().unwrap()),
            store.send(&client, client.get(server.url("/second")).build().unwrap())
        );
        let first = first.unwrap();
        let second = second.unwrap();
        let first_id = first.extensions().get::<RequestLogId>().unwrap().clone();
        let second_id = second.extensions().get::<RequestLogId>().unwrap().clone();
        // Complete the older record first. The old "latest unfilled entry" lookup would
        // always swap these bodies, regardless of which concurrent response arrived first.
        let older_id = store.list_logs().await.last().unwrap().id.clone();
        let second_bytes = second.bytes().await.unwrap();
        let first_bytes = first.bytes().await.unwrap();
        let updates = if older_id == first_id.0 {
            [
                (&first_id, first_bytes.len()),
                (&second_id, second_bytes.len()),
            ]
        } else {
            [
                (&second_id, second_bytes.len()),
                (&first_id, first_bytes.len()),
            ]
        };
        for (request_id, byte_count) in updates {
            store.capture_response_body(request_id, byte_count).await;
        }
        store
            .capture_response_failure(&first_id, "response_json_decode_failed")
            .await;
        let logs = store.list_logs().await;
        let first_log = logs.iter().find(|log| log.id == first_id.0).unwrap();
        let second_log = logs.iter().find(|log| log.id == second_id.0).unwrap();
        assert_eq!(
            first_log.response_body.as_deref(),
            Some(body_omitted(first_bytes.len()).as_str())
        );
        assert_eq!(
            second_log.response_body.as_deref(),
            Some(body_omitted(second_bytes.len()).as_str())
        );
        assert_eq!(first_log.ok, Some(false));
        assert_eq!(second_log.ok, Some(true));
        assert!(!format!("{logs:?}").contains("body-secret"));
        // A late read after clearing must not modify a different/new entry.
        store.clear_logs().await;
        let third = store
            .send(&client, client.get(server.url("/second")).build().unwrap())
            .await
            .unwrap();
        let third_id = third.extensions().get::<RequestLogId>().unwrap().clone();
        store.capture_response_body(&first_id, 999).await;
        let logs = store.list_logs().await;
        assert_eq!(logs[0].id, third_id.0);
        assert_eq!(logs[0].response_body, None);
    }

    #[tokio::test]
    async fn failures_are_available_without_diagnostic_mode_and_history_is_bounded() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/denied");
            then.status(401)
                .header("set-cookie", "session=secret")
                .body("private error body");
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let store = NetworkDebugStore::new(false);
        let response = store
            .send(
                &client,
                client
                    .get(server.url("/denied?token=secret"))
                    .build()
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 401);
        let logs = store.list_logs().await;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].ok, Some(false));
        assert_eq!(logs[0].error.as_deref(), Some("HTTP 401"));
        assert!(logs[0].request_headers.is_empty() && logs[0].response_headers.is_empty());
        assert!(!format!("{logs:?}").contains("secret"));
        for index in 0..MAX_NETWORK_LOGS + 5 {
            let mut log = logs[0].clone();
            log.id = index.to_string();
            store.push_log(log).await;
        }
        let logs = store.list_logs().await;
        assert_eq!(logs.len(), MAX_NETWORK_LOGS);
        assert_eq!(logs.first().unwrap().id, (MAX_NETWORK_LOGS + 4).to_string());
        assert_eq!(logs.last().unwrap().id, "5");
    }
    fn response_log_fixture() -> NetworkRequestLog {
        NetworkRequestLog {
            id: "capture-lock-test".to_owned(),
            timestamp: String::new(),
            source: "test".to_owned(),
            method: "GET".to_owned(),
            url: "https://example.com/".to_owned(),
            status: Some(200),
            ok: Some(true),
            duration_ms: Some(0),
            request_headers: vec![],
            response_headers: vec![],
            request_body: None,
            request_body_truncated: false,
            response_body: None,
            response_body_truncated: false,
            error: None,
        }
    }

    #[tokio::test]
    async fn body_capture_stops_if_diagnostics_disabled_while_waiting_for_lock() {
        use std::{future::Future, task::Poll};

        let store = NetworkDebugStore::new(true);
        let log = response_log_fixture();
        let request_id = RequestLogId(log.id.clone());
        let mut guard = store.logs.write().await;
        guard.push_back(log);
        let mut capture = Box::pin(store.capture_response_body(&request_id, 42));
        // Poll once while holding the write lock: the initial enabled check passes,
        // and capture must suspend before it can update the record.
        std::future::poll_fn(|cx| {
            assert!(capture.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        store.set_enabled(false);
        drop(guard);
        capture.await;
        let logs = store.list_logs().await;
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].response_body, None);
        assert!(!logs[0].response_body_truncated);
        assert_eq!(logs[0].ok, Some(true));
    }

    #[tokio::test]
    async fn body_capture_still_records_size_when_diagnostics_remain_enabled() {
        let store = NetworkDebugStore::new(true);
        let log = response_log_fixture();
        let request_id = RequestLogId(log.id.clone());
        store.push_log(log).await;
        store.capture_response_body(&request_id, 42).await;
        let logs = store.list_logs().await;
        assert_eq!(logs[0].response_body, Some(body_omitted(42)));
        assert!(!logs[0].response_body_truncated);
    }

}
