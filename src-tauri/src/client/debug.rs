use std::{
    collections::VecDeque,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

use chrono::Utc;
use reqwest::{header::HeaderMap, Request, Response};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::model::{DebugHttpHeader, NetworkRequestLog};

const MAX_NETWORK_LOGS: usize = 1000;
const MAX_BODY_PREVIEW_BYTES: usize = 1024 * 1024;

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

    pub async fn capture_response_body(&self, body: &[u8]) {
        let mut logs = self.logs.write().await;
        // Update the most recent log entry without a response body
        if let Some(log) = logs.iter_mut().rev().find(|l| l.response_body.is_none()) {
            let truncated = body.len() > MAX_BODY_PREVIEW_BYTES;
            let end = body.len().min(MAX_BODY_PREVIEW_BYTES);
            log.response_body = Some(String::from_utf8_lossy(&body[..end]).to_string());
            log.response_body_truncated = truncated;
        }
    }

    pub async fn send(
        &self,
        client: &reqwest::Client,
        request: Request,
    ) -> std::result::Result<Response, reqwest::Error> {
        let log = self.capture_request(&request);
        let started = Instant::now();
        let result = client.execute(request).await;

        let mut network_log = NetworkRequestLog {
            id: log.id,
            timestamp: log.timestamp,
            source: log.source,
            method: log.method,
            url: log.url,
            status: None,
            ok: None,
            duration_ms: Some(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64),
            request_headers: log.request_headers,
            response_headers: vec![],
            request_body: log.request_body,
            request_body_truncated: log.request_body_truncated,
            response_body: None,
            response_body_truncated: false,
            error: None,
        };

        match &result {
            Ok(response) => {
                network_log.status = Some(response.status().as_u16());
                network_log.ok = Some(response.status().is_success());
                network_log.response_headers = headers_to_debug(response.headers());
            }
            Err(error) => {
                network_log.status = error.status().map(|status| status.as_u16());
                network_log.ok = Some(false);
                network_log.error = Some(error.to_string());
            }
        }

        self.push_log(network_log).await;

        result
    }

    async fn push_log(&self, log: NetworkRequestLog) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }

        let mut logs = self.logs.write().await;
        if logs.len() >= MAX_NETWORK_LOGS {
            logs.pop_front();
        }
        logs.push_back(log);
    }

    fn capture_request(&self, request: &Request) -> PendingNetworkLog {
        let (request_body, request_body_truncated) = body_preview(request);

        PendingNetworkLog {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            source: request.url().host_str().unwrap_or("unknown").to_owned(),
            method: request.method().as_str().to_owned(),
            url: request.url().to_string(),
            request_headers: headers_to_debug(request.headers()),
            request_body,
            request_body_truncated,
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
    request_body_truncated: bool,
}

fn body_preview(request: &Request) -> (Option<String>, bool) {
    let Some(body) = request.body() else {
        return (None, false);
    };
    let Some(bytes) = body.as_bytes() else {
        return (Some("<streaming body omitted>".to_owned()), false);
    };
    if bytes.is_empty() {
        return (None, false);
    }

    let truncated = bytes.len() > MAX_BODY_PREVIEW_BYTES;
    let end = bytes.len().min(MAX_BODY_PREVIEW_BYTES);
    (
        Some(String::from_utf8_lossy(&bytes[..end]).to_string()),
        truncated,
    )
}

fn headers_to_debug(headers: &HeaderMap) -> Vec<DebugHttpHeader> {
    headers
        .iter()
        .map(|(name, value)| {
            let raw_value = value.to_str().unwrap_or("<non-utf8>");
            DebugHttpHeader {
                name: name.as_str().to_owned(),
                value: sanitize_header_value(name.as_str(), raw_value),
            }
        })
        .collect()
}

fn sanitize_header_value(_name: &str, value: &str) -> String {
    value.to_owned()
}
