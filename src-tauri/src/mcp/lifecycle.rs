//! Own the listener and the application handler lifetime independently of rmcp's
//! detached session tasks. Stopping does not revoke already-sent remote work.
use std::{io, net::SocketAddr, sync::Arc, time::Duration};

use axum::{response::Json, Router};
use rmcp::{
    model::{ClientNotification, ClientRequest, ServerInfo, ServerResult},
    service::{NotificationContext, RequestContext},
    transport::streamable_http_server::{
        session::{local::LocalSessionManager, SessionManager},
        StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, RoleServer, Service,
};
use tokio::{sync::RwLock, task::JoinHandle, time::timeout};
use tokio_util::sync::CancellationToken;

use super::McpServer;

const STOP_TIMEOUT: Duration = Duration::from_secs(5);

struct CancellableServer {
    inner: McpServer,
    cancellation: CancellationToken,
    handlers: Arc<RwLock<()>>,
}

fn stopped() -> ErrorData {
    ErrorData::internal_error("MCP server is stopping", None)
}

impl Service<RoleServer> for CancellableServer {
    async fn handle_request(
        &self,
        request: ClientRequest,
        context: RequestContext<RoleServer>,
    ) -> Result<ServerResult, ErrorData> {
        let _guard = tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => return Err(stopped()),
            guard = self.handlers.read() => guard,
        };
        // The delegated future is dropped before the outer read guard. Do not
        // move application work into another untracked spawned task here.
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(stopped()),
            result = async { <McpServer as Service<RoleServer>>::handle_request(&self.inner, request, context).await } => result,
        }
    }

    async fn handle_notification(
        &self,
        notification: ClientNotification,
        context: NotificationContext<RoleServer>,
    ) -> Result<(), ErrorData> {
        let _guard = tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => return Err(stopped()),
            guard = self.handlers.read() => guard,
        };
        tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => Err(stopped()),
            result = async { <McpServer as Service<RoleServer>>::handle_notification(&self.inner, notification, context).await } => result,
        }
    }

    fn get_info(&self) -> ServerInfo {
        <McpServer as Service<RoleServer>>::get_info(&self.inner)
    }
}

pub(crate) struct McpRuntime {
    cancellation: CancellationToken,
    handlers: Arc<RwLock<()>>,
    sessions: Arc<LocalSessionManager>,
    root: Option<JoinHandle<io::Result<()>>>,
}

impl McpRuntime {
    pub(crate) fn is_running(&self) -> bool {
        !self.cancellation.is_cancelled() && self.root.as_ref().is_some_and(|root| !root.is_finished())
    }

    pub(crate) async fn stop(&mut self) -> io::Result<()> {
        self.cancellation.cancel();
        // A timeout must retain this stopping runtime in its managed slot. A
        // finished listener alone does not authorize a new account generation.
        let idle = timeout(STOP_TIMEOUT, self.handlers.write()).await.map_err(|_| {
            io::Error::new(io::ErrorKind::TimedOut, "MCP application handlers did not stop; configuration unchanged")
        })?;
        drop(idle);

        // close_session only enqueues a close event, not a worker join. Bound
        // this best-effort cleanup separately from application quiescence.
        if timeout(STOP_TIMEOUT, async {
            let ids: Vec<_> = self.sessions.sessions.read().await.keys().cloned().collect();
            for id in ids {
                if let Err(error) = self.sessions.close_session(&id).await {
                    tracing::warn!(%error, "MCP session close request failed");
                }
            }
        }).await.is_err() {
            tracing::warn!("MCP session close requests exceeded their deadline");
        }

        let Some(root) = self.root.as_mut() else { return Ok(()); };
        let result = match timeout(STOP_TIMEOUT, &mut *root).await {
            Ok(result) => result,
            Err(_) => {
                root.abort();
                timeout(STOP_TIMEOUT, &mut *root).await.map_err(|_| {
                    io::Error::new(io::ErrorKind::TimedOut, "MCP listener termination is unconfirmed; configuration unchanged")
                })?
            }
        };
        self.root = None;
        match result {
            Ok(Err(error)) => tracing::warn!(%error, "MCP listener exited with an error"),
            Err(error) if !error.is_cancelled() => tracing::warn!(%error, "MCP listener task failed"),
            _ => {}
        }
        Ok(())
    }
}

impl Drop for McpRuntime {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Some(root) = &self.root { root.abort(); }
    }
}

pub(crate) async fn start_mcp_server(port: u16) -> io::Result<McpRuntime> {
    // Bind before publishing a running instance; bind errors are synchronous
    // results, not panics hidden inside an already-stored JoinHandle.
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await?;
    let cancellation = CancellationToken::new();
    let handlers = Arc::new(RwLock::new(()));
    let sessions = Arc::new(LocalSessionManager::default());
    let factory_token = cancellation.clone();
    let factory_handlers = handlers.clone();
    let service = StreamableHttpService::new(
        move || {
            if factory_token.is_cancelled() {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "MCP server is stopping"));
            }
            Ok(CancellableServer {
                inner: McpServer,
                cancellation: factory_token.clone(),
                handlers: factory_handlers.clone(),
            })
        },
        sessions.clone(),
        StreamableHttpServerConfig::default()
            .with_sse_keep_alive(Some(Duration::from_secs(15)))
            .with_stateful_mode(true)
            .with_cancellation_token(cancellation.child_token()),
    );
    let router = Router::new()
        .route("/health", axum::routing::get(|| async { Json(serde_json::json!({"status": "ok"})) }))
        .fallback_service(service);
    let shutdown = cancellation.clone();
    // Capture the guard before spawning, including abort-before-first-poll.
    let guard = cancellation.clone().drop_guard();
    let root = tokio::spawn(async move {
        let _guard = guard;
        axum::serve(listener, router)
            .with_graceful_shutdown(async move { shutdown.cancelled().await })
            .await
    });
    Ok(McpRuntime { cancellation, handlers, sessions, root: Some(root) })
}
