//! A session is owned by one configuration generation, never by an account name.
//! Old tasks retain their old Arc (including its Jar and JWT). Replacing this
//! single-slot cache cannot make a late HTTP response mutate a newer session.
use std::{future::Future, sync::Arc};
use tokio::sync::Mutex;
use super::App;
use crate::{client::{authentication, Client}, error::{AppError, Result}};

pub(super) struct CanvasSession {
    pub owner: String,
    pub client: Arc<Client>,
    cookie: String,
    ready: Mutex<bool>,
}

impl CanvasSession {
    // This mutex is session-local, not an account/configuration/cache lock.
    // Cancellation and failure leave ready=false, so the next call can retry.
    async fn prepare_with(&self, login: impl Future<Output = Result<()>>) -> Result<()> {
        authentication(async {
            let mut ready = self.ready.lock().await;
            if !*ready {
                login.await?;
                *ready = true;
            }
            Ok(())
        }).await
    }

    pub async fn prepare(&self) -> Result<()> {
        self.prepare_with(self.client.login_canvas_website(&self.cookie)).await
    }

    // An explicit user login must refresh an expired same-owner session; lazy
    // media preparation alone may reuse a previously successful login.
    pub async fn refresh(&self) -> Result<()> {
        authentication(async {
            let mut ready = self.ready.lock().await;
            *ready = false;
            self.client.login_canvas_website(&self.cookie).await?;
            *ready = true;
            Ok(())
        }).await
    }

    pub async fn check(&self) -> Result<bool> {
        authentication(async {
            let mut ready = self.ready.lock().await;
            *ready = false;
            if !self.client.check_extra_login_status(&self.cookie).await? { return Ok(false); }
            match self.client.login_canvas_website(&self.cookie).await {
                Ok(()) => { *ready = true; Ok(true) },
                Err(AppError::LoginError) => Ok(false),
                Err(error) => Err(error),
            }
        }).await
    }
}

pub(super) struct LoginAttempt {
    owner: String,
    id: String,
    uuid: Option<String>,
    client: Arc<Client>,
}

impl App {
    pub(super) async fn canvas_session(&self) -> Result<Arc<CanvasSession>> {
        // Lock ordering is owner -> config -> session. No HTTP awaits here;
        // account switches never wait for a session's authentication mutex.
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        let owner = owner.as_ref().ok_or(AppError::StaleConfigOwner)?;
        let config = self.config.read().await;
        let mut slot = self.canvas_session.lock().await;
        if let Some(session) = slot.as_ref().filter(|session| session.owner == *owner) {
            return Ok(Arc::clone(session));
        }
        let session = Arc::new(CanvasSession {
            owner: owner.clone(),
            client: Arc::new(self.client.canvas_read_snapshot(Self::get_base_url(&config.account_type))),
            cookie: format!("JAAuthCookie={}", config.ja_auth_cookie),
            ready: Mutex::new(false),
        });
        *slot = Some(Arc::clone(&session));
        Ok(session)
    }

    pub(super) async fn authenticated_canvas_session(&self) -> Result<Arc<CanvasSession>> {
        let session = self.canvas_session().await?;
        let result = session.prepare().await;
        self.ensure_config_owner(&session.owner).await?;
        result?;
        Ok(session)
    }

    pub(super) async fn finish_session<T>(&self, session: &CanvasSession, result: Result<T>) -> Result<T> {
        self.ensure_config_owner(&session.owner).await?;
        result
    }

    pub(super) async fn begin_login_attempt(&self) -> Result<(String, String, Arc<Client>)> {
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        let owner = owner.as_ref().ok_or(AppError::StaleConfigOwner)?.clone();
        let config = self.config.read().await;
        let client = Arc::new(self.client.canvas_read_snapshot(Self::get_base_url(&config.account_type)));
        let id = uuid::Uuid::new_v4().to_string();
        *self.login_attempt.lock().await = Some(LoginAttempt {
            owner: owner.clone(), id: id.clone(), uuid: None, client: Arc::clone(&client),
        });
        Ok((owner, id, client))
    }

    pub(super) async fn finish_login_uuid(&self, expected_owner: &str, id: &str, result: Result<Option<String>>) -> Result<Option<String>> {
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() != Some(expected_owner) { return Err(AppError::StaleConfigOwner); }
        let mut slot = self.login_attempt.lock().await;
        let attempt = slot.as_mut().filter(|attempt| attempt.id == id && attempt.owner == expected_owner)
            .ok_or(AppError::StaleConfigOwner)?;
        let uuid = result?;
        attempt.uuid = uuid.clone();
        Ok(uuid)
    }

    pub(super) async fn express_login_attempt(&self, uuid: &str) -> Result<Option<String>> {
        let (expected_owner, id, client) = {
            let owner = self.config_owner.lock().await;
            self.store_ready()?;
            let slot = self.login_attempt.lock().await;
            let attempt = slot.as_ref().filter(|attempt| Some(attempt.owner.as_str()) == owner.as_deref()
                && attempt.uuid.as_deref() == Some(uuid)).ok_or(AppError::StaleConfigOwner)?;
            (attempt.owner.clone(), attempt.id.clone(), Arc::clone(&attempt.client))
        };
        let result = authentication(client.express_login(uuid)).await;
        self.finish_login_attempt(&expected_owner, &id, result).await
    }

    pub(super) async fn finish_login_attempt(&self, expected_owner: &str, id: &str, result: Result<Option<String>>) -> Result<Option<String>> {
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        let slot = self.login_attempt.lock().await;
        if owner.as_deref() != Some(expected_owner)
            || !slot.as_ref().is_some_and(|attempt| attempt.id == id) {
            return Err(AppError::StaleConfigOwner);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use crate::model::{Account, AccountInfo, AppConfig};
    use tokio::{io::{AsyncReadExt, AsyncWriteExt}, sync::{oneshot, RwLock}};

    fn offline_app() -> (tempfile::TempDir, Arc<App>) {
        let directory = tempfile::tempdir().unwrap();
        let store = super::super::config_store::ConfigStore::open(directory.path()).unwrap();
        let config = AppConfig::default();
        std::fs::write(directory.path().join("account.json"), serde_json::to_vec(&AccountInfo::default()).unwrap()).unwrap();
        std::fs::write(directory.path().join("sjtu_canvas_helper_config.json"), serde_json::to_vec(&config).unwrap()).unwrap();
        let app = Arc::new(App {
            config_store: Some(store),
            client: Arc::new(Client::new_without_proxy("http://127.0.0.1", "", "", "", None)),
            canvas_session: Default::default(), login_attempt: Default::default(),
            current_account: RwLock::new(Account::Default), config: RwLock::new(config),
            config_owner: Mutex::new(Some(uuid::Uuid::new_v4().to_string())),
            handle: Default::default(), mcp_handle: Default::default(), cache: Default::default(),
        });
        (directory, app)
    }

    // Response is released by the test, not a timing-dependent sleep. Cookies
    // and JWT are delivered only after a real configuration/account transition.
    async fn blocked_response() -> (String, oneshot::Receiver<()>, oneshot::Sender<()>, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/auth", listener.local_addr().unwrap());
        let (started_tx, started_rx) = oneshot::channel();
        let (release_tx, release_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 4096];
            assert!(socket.read(&mut buffer).await.unwrap() > 0);
            started_tx.send(()).unwrap();
            release_rx.await.unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nSet-Cookie: synthetic_session=old-a; Path=/\r\nContent-Length: 9\r\nConnection: close\r\n\r\nold-a-jwt").await.unwrap();
        });
        (url, started_rx, release_tx, server)
    }

    #[tokio::test]
    async fn session_reuses_ordinary_settings_but_isolates_credential_revisions() {
        let (_directory, app) = offline_app();
        let first = app.canvas_session().await.unwrap();
        assert!(Arc::ptr_eq(&first, &app.canvas_session().await.unwrap()));
        let mut config = app.get_config_snapshot().await.unwrap().config;
        config.debug_mode = !config.debug_mode;
        let owner = app.save_config(config, &first.owner).await.unwrap();
        assert_eq!(owner, first.owner);
        assert!(Arc::ptr_eq(&first, &app.canvas_session().await.unwrap()));
        for field in ["token", "ja", "video", "key"] {
            let prior = app.canvas_session().await.unwrap();
            let mut config = app.get_config_snapshot().await.unwrap().config;
            match field {
                "token" => config.token = "synthetic-bearer".into(),
                "ja" => config.ja_auth_cookie = "synthetic-ja".into(),
                "video" => config.video_cookies = "synthetic-video".into(),
                _ => config.oauth_consumer_key = "synthetic-key".into(),
            }
            let owner = app.save_config(config, &prior.owner).await.unwrap();
            let next = app.canvas_session().await.unwrap();
            assert_ne!(owner, prior.owner);
            assert!(!Arc::ptr_eq(&prior.client, &next.client));
            assert_eq!(next.client.session_test_state("http://127.0.0.1/").await, (None, String::new()));
        }
    }

    #[tokio::test]
    async fn late_cookie_and_jwt_cannot_cross_switch_or_aba_or_commit_config() {
        let (_directory, app) = offline_app();
        let a = app.canvas_session().await.unwrap();
        let b_account = Account::Custom("synthetic-b".into());
        app.create_account(&b_account).await.unwrap();
        let (url, started, release, server) = blocked_response().await;
        let old_app = Arc::clone(&app);
        let old_a = Arc::clone(&a);
        let request_url = url.clone();
        let request = tokio::spawn(async move {
            let result = old_a.prepare_with(old_a.client.session_test_auth_response(&request_url)).await;
            old_app.finish_session(&old_a, result).await
        });
        tokio::time::timeout(Duration::from_secs(2), started).await.unwrap().unwrap();
        // The old session's auth mutex is held during HTTP, but not owner/cache.
        tokio::time::timeout(Duration::from_secs(2), app.switch_account(&b_account)).await.unwrap().unwrap();
        let b = app.canvas_session().await.unwrap();
        assert!(!Arc::ptr_eq(&a.client, &b.client));
        app.switch_account(&Account::Default).await.unwrap();
        let a_again = app.canvas_session().await.unwrap();
        assert_ne!(a.owner, a_again.owner);
        assert!(!Arc::ptr_eq(&a.client, &a_again.client));
        release.send(()).unwrap();
        assert!(matches!(request.await.unwrap(), Err(AppError::StaleConfigOwner)));
        server.await.unwrap();
        assert_eq!(a.client.session_test_state(&url).await, (Some("synthetic_session=old-a".into()), "old-a-jwt".into()));
        assert_eq!(b.client.session_test_state(&url).await, (None, String::new()));
        assert_eq!(a_again.client.session_test_state(&url).await, (None, String::new()));
        assert!(matches!(app.commit_video_consumer_key(&a.owner, "late-key".into()).await, Err(AppError::StaleConfigOwner)));
        assert_ne!(app.get_config().await.oauth_consumer_key, "late-key");
    }

    #[tokio::test]
    async fn cold_session_login_failure_retries_and_success_is_single_flight() {
        let (_directory, app) = offline_app();
        let session = app.canvas_session().await.unwrap();
        assert!(!*session.ready.lock().await);
        assert!(session.prepare_with(async { Err(AppError::LoginError) }).await.is_err());
        assert!(!*session.ready.lock().await);
        // Cancellation also releases the session-local lock without marking
        // authentication ready, so it cannot wedge all later retries.
        assert!(tokio::time::timeout(Duration::from_millis(10),
            session.prepare_with(std::future::pending::<Result<()>>())).await.is_err());
        assert!(!*session.ready.lock().await);
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let login = || async { calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst); Ok(()) };
        let (first, second) = tokio::join!(session.prepare_with(login()), session.prepare_with(login()));
        first.unwrap(); second.unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn first_login_attempt_is_private_retryable_and_rejects_old_uuid() {
        let (_directory, app) = offline_app();
        // Empty configuration credentials do not block first-time QR login.
        assert!(app.get_config().await.ja_auth_cookie.is_empty());
        let (owner, id, first) = app.begin_login_attempt().await.unwrap();
        assert!(app.finish_login_uuid(&owner, &id, Err(AppError::LoginError)).await.is_err());
        let (owner, retry_id, retry) = app.begin_login_attempt().await.unwrap();
        assert!(!Arc::ptr_eq(&first, &retry));
        assert!(matches!(app.finish_login_uuid(&owner, &id, Ok(Some("old-uuid".into()))).await, Err(AppError::StaleConfigOwner)));
        assert_eq!(app.finish_login_uuid(&owner, &retry_id, Ok(Some("new-uuid".into()))).await.unwrap().as_deref(), Some("new-uuid"));
        assert!(matches!(app.express_login_attempt("old-uuid").await, Err(AppError::StaleConfigOwner)));
        // Polling completion may repeat for this same attempt, without changing it.
        for _ in 0..2 {
            assert_eq!(app.finish_login_attempt(&owner, &retry_id, Ok(Some("synthetic-ja".into()))).await.unwrap().as_deref(), Some("synthetic-ja"));
        }
        app.begin_login_attempt().await.unwrap();
        assert!(matches!(app.finish_login_attempt(&owner, &retry_id, Ok(Some("late-ja".into()))).await, Err(AppError::StaleConfigOwner)));
        let (owner, latest_id, _) = app.begin_login_attempt().await.unwrap();
        let mut config = app.get_config().await;
        config.ja_auth_cookie = "credential-replaced".into();
        app.save_config(config, &owner).await.unwrap();
        assert!(matches!(app.finish_login_attempt(&owner, &latest_id, Ok(Some("old-owner-ja".into()))).await, Err(AppError::StaleConfigOwner)));
    }

    #[tokio::test]
    async fn late_attempt_cookie_is_not_in_the_new_attempt_or_account_session() {
        let (_directory, app) = offline_app();
        let (owner, id, client) = app.begin_login_attempt().await.unwrap();
        let (url, started, release, server) = blocked_response().await;
        let old = Arc::clone(&client);
        let old_app = Arc::clone(&app);
        let request_url = url.clone();
        let request = tokio::spawn(async move {
            old.session_test_auth_response(&request_url).await.unwrap();
            old_app.finish_login_attempt(&owner, &id, Ok(Some("late-ja".into()))).await
        });
        tokio::time::timeout(Duration::from_secs(2), started).await.unwrap().unwrap();
        let (_, _, next) = app.begin_login_attempt().await.unwrap();
        let session = app.canvas_session().await.unwrap();
        release.send(()).unwrap();
        assert!(matches!(request.await.unwrap(), Err(AppError::StaleConfigOwner)));
        server.await.unwrap();
        assert!(client.session_test_state(&url).await.0.is_some());
        assert_eq!(next.session_test_state(&url).await, (None, String::new()));
        assert_eq!(session.client.session_test_state(&url).await, (None, String::new()));
    }
}
