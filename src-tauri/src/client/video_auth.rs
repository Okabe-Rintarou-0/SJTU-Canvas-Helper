use std::{collections::HashMap, future::Future, sync::Arc, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{cookie::Jar, redirect::Policy, StatusCode};
use tauri::Url;
use tokio::sync::{Mutex, RwLock};

use super::{
    constants::{AUTH_URL, CANVAS_LOGIN_URL, MY_SJTU_URL, VIDEO_APP_PATH},
    Client,
};
use crate::error::{AppError, Result};

const VIDEO_TOKEN_EXPIRY_MARGIN_SECONDS: i64 = 60;

// Keep Canvas browser cookies separate from jAccount and the legacy video client.
// Replacing credentials drops this jar, including any previous account's session.
#[derive(Default)]
pub(super) struct VideoAuth {
    browser: Mutex<VideoBrowserSession>,
    launches: RwLock<VideoLaunchCache>,
}

#[derive(Default)]
struct VideoBrowserSession {
    canvas_token: String,
    ja_auth_cookie: String,
    session: Option<reqwest::Client>,
    method: Option<VideoAuthMethod>,
    // Refreshing the old site session must not block or replace the Canvas session.
    legacy_session: Arc<Mutex<Option<reqwest::Client>>>,
}

#[derive(Default)]
struct VideoLaunchCache {
    generation: u64,
    entries: HashMap<String, VideoLaunchToken>,
}

impl VideoLaunchCache {
    fn get(&self, launch_url: &str) -> Option<VideoLaunchToken> {
        self.entries
            .get(launch_url)
            .filter(|token| token.reusable(chrono::Utc::now().timestamp()))
            .cloned()
    }
}

#[derive(Clone)]
struct VideoLaunchToken {
    value: Arc<str>,
    generation: u64,
    expires_at: Option<i64>,
}

impl VideoLaunchToken {
    fn reusable(&self, now: i64) -> bool {
        self.expires_at
            .is_some_and(|expiry| expiry > now + VIDEO_TOKEN_EXPIRY_MARGIN_SECONDS)
    }
}

fn video_token_expiry(token: &str) -> Option<i64> {
    let payload = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    claims.get("exp")?.as_i64()
}

pub(super) fn video_token_rejected(error: &AppError) -> bool {
    matches!(error, AppError::VideoAuthorizationError(_)) || video_auth_rejected(error)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum VideoAuthMethod {
    CanvasToken,
    ExtraLogin,
}

fn login_error() -> AppError {
    AppError::VideoDownloadError(
        "Canvas Token 登录课堂视频失败，额外登录态也不可用。请检查 Token，或前往设置扫码登录后刷新重试。".into(),
    )
}

fn legacy_login_error() -> AppError {
    AppError::VideoDownloadError(
        "旧版课堂视频登录态不可用，请前往设置扫码登录后刷新重试。".into(),
    )
}

pub(super) fn video_auth_rejected(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Network(error)
            if matches!(error.status(), Some(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN))
    )
}

fn legacy_session_rejected(error: &AppError) -> bool {
    matches!(error, AppError::LoginError) || video_auth_rejected(error)
}

impl Client {
    pub async fn configure_video_auth(&self, token: &str, cookie: &str, reset: bool) {
        self.transcription.configure(cookie, reset).await;
        let mut auth = self.video_auth.browser.lock().await;
        if reset || auth.canvas_token != token || auth.ja_auth_cookie != cookie {
            self.subtitle_proofread.clear().await;
            let mut launches = self.video_auth.launches.write().await;
            let mut last_token = self.token.write().await;
            *auth = VideoBrowserSession {
                canvas_token: token.into(),
                ja_auth_cookie: cookie.into(),
                ..Default::default()
            };
            launches.generation += 1;
            launches.entries.clear();
            last_token.clear();
        }
    }

    pub(super) async fn with_video_launch<T, F>(
        &self,
        launch_url: &str,
        request: impl Fn(Arc<str>) -> F + Send,
    ) -> Result<T>
    where
        T: Send,
        F: Future<Output = Result<T>> + Send,
    {
        let mut token = self
            .video_launch_token(launch_url, CANVAS_LOGIN_URL, None)
            .await?;
        self.remember_video_launch(&token).await?;
        let result = request(token.value.clone()).await;
        if !matches!(&result, Err(error) if video_token_rejected(error)) {
            return result;
        }

        self.discard_video_launch(launch_url, &token).await;
        token = self
            .video_launch_token(launch_url, CANVAS_LOGIN_URL, Some(token.generation))
            .await?;
        self.remember_video_launch(&token).await?;
        let result = request(token.value.clone()).await;
        if matches!(&result, Err(error) if video_token_rejected(error)) {
            self.discard_video_launch(launch_url, &token).await;
        }
        result
    }

    // Playback can explicitly require a fresh launch after a successful but empty response.
    pub(super) async fn fresh_video_launch(
        &self,
        launch_url: &str,
        generation: u64,
    ) -> Result<String> {
        {
            let mut launches = self.video_auth.launches.write().await;
            if generation != launches.generation {
                return Err(AppError::LoginError);
            }
            launches.entries.remove(launch_url);
        }
        let token = self
            .video_launch_token(launch_url, CANVAS_LOGIN_URL, Some(generation))
            .await?;
        self.remember_video_launch(&token).await?;
        Ok(token.value.to_string())
    }

    pub(super) async fn current_video_launch(&self) -> (u64, String) {
        let launches = self.video_auth.launches.read().await;
        (launches.generation, self.token.read().await.clone())
    }

    async fn remember_video_launch(&self, token: &VideoLaunchToken) -> Result<()> {
        let launches = self.video_auth.launches.read().await;
        if launches.generation != token.generation {
            return Err(AppError::LoginError);
        }
        *self.token.write().await = token.value.to_string();
        Ok(())
    }

    async fn discard_video_launch(&self, launch_url: &str, rejected: &VideoLaunchToken) {
        let mut launches = self.video_auth.launches.write().await;
        // A concurrent rejection may arrive after another request already refreshed the ticket.
        if launches
            .entries
            .get(launch_url)
            .is_some_and(|token| Arc::ptr_eq(&token.value, &rejected.value))
        {
            launches.entries.remove(launch_url);
        }
    }

    async fn video_launch_token(
        &self,
        launch_url: &str,
        sso_url: &str,
        expected_generation: Option<u64>,
    ) -> Result<VideoLaunchToken> {
        let generation = {
            let launches = self.video_auth.launches.read().await;
            if expected_generation.is_some_and(|generation| generation != launches.generation) {
                return Err(AppError::LoginError);
            }
            if let Some(token) = launches.get(launch_url) {
                return Ok(token);
            }
            launches.generation
        };

        // Only cache misses need the browser lock. Check again after waiting so
        // concurrent launches for the same URL can use the first issued JWT.
        let mut auth = self.video_auth.browser.lock().await;
        {
            let launches = self.video_auth.launches.read().await;
            if launches.generation != generation {
                return Err(AppError::LoginError);
            }
            if let Some(token) = launches.get(launch_url) {
                return Ok(token);
            }
        }
        let value = self
            .issue_video_launch(&mut auth, launch_url, sso_url)
            .await?;
        let token = VideoLaunchToken {
            expires_at: video_token_expiry(&value),
            value: Arc::from(value),
            generation,
        };
        let now = chrono::Utc::now().timestamp();
        if token.reusable(now) {
            let mut launches = self.video_auth.launches.write().await;
            launches.entries.retain(|_, token| token.reusable(now));
            launches
                .entries
                .insert(launch_url.to_owned(), token.clone());
        }
        Ok(token)
    }

    async fn issue_video_launch(
        &self,
        auth: &mut VideoBrowserSession,
        launch_url: &str,
        sso_url: &str,
    ) -> Result<String> {
        let base =
            Url::parse(self.base_url.read().await.as_str()).map_err(|_| AppError::LoginError)?;
        // Existing video entry points belong to SJTU Canvas even for a JI account.
        // A token for a different Canvas host cannot bootstrap that session, but
        // the original jAccount fallback can still authenticate SJTU Canvas.
        let launch = Url::parse(launch_url).map_err(|_| AppError::LoginError)?;
        let login_base = Url::parse(super::constants::BASE_URL).unwrap();
        if launch.origin() != base.origin() && launch.origin() != login_base.origin() {
            return Err(AppError::LoginError);
        }
        if let Some(client) = &auth.session {
            if let Ok(token) = self.follow_video_launch(client, launch.as_str()).await {
                return Ok(token);
            }
            auth.session = None;
            auth.method = None;
        }

        for method in [VideoAuthMethod::CanvasToken, VideoAuthMethod::ExtraLogin] {
            if (method == VideoAuthMethod::CanvasToken
                && (auth.canvas_token.trim().is_empty() || launch.origin() != base.origin()))
                || (method == VideoAuthMethod::ExtraLogin && auth.ja_auth_cookie.trim().is_empty())
            {
                continue;
            }
            let result = match method {
                VideoAuthMethod::CanvasToken => {
                    match super::canvas_session::connect(&base, &auth.canvas_token).await {
                        Ok(browser) => self
                            .follow_video_launch(&browser, launch.as_str())
                            .await
                            .map(|token| (browser, token)),
                        Err(error) => Err(error),
                    }
                }
                VideoAuthMethod::ExtraLogin => {
                    let jar = Arc::new(Jar::default());
                    for host in [AUTH_URL, MY_SJTU_URL] {
                        jar.add_cookie_str(
                            &format!("JAAuthCookie={}", auth.ja_auth_cookie),
                            &Url::parse(host).unwrap(),
                        );
                    }
                    let browser = reqwest::Client::builder()
                        .timeout(Duration::from_secs(15))
                        .redirect(Policy::none())
                        .cookie_provider(jar.clone())
                        .build()?;
                    let sso = reqwest::Client::builder()
                        .timeout(Duration::from_secs(15))
                        .redirect(Policy::limited(16))
                        .cookie_provider(jar)
                        .build()?;
                    match sso.get(sso_url).send().await {
                        Ok(response)
                            if response.status().is_success()
                                && response.url().origin() == launch.origin() =>
                        {
                            self.follow_video_launch(&browser, launch.as_str())
                                .await
                                .map(|token| (browser, token))
                        }
                        _ => Err(AppError::LoginError),
                    }
                }
            };
            match result {
                Ok((client, token)) => {
                    tracing::info!(?method, "Classroom video authentication completed");
                    auth.session = Some(client);
                    auth.method = Some(method);
                    return Ok(token);
                }
                Err(_) => tracing::info!(
                    ?method,
                    "Classroom video authentication failed; trying fallback"
                ),
            }
        }
        Err(login_error())
    }

    pub(super) async fn video_browser_client(&self) -> reqwest::Client {
        self.video_auth
            .browser
            .lock()
            .await
            .session
            .clone()
            .unwrap_or_else(|| self.cli.clone())
    }

    pub(super) async fn with_legacy_video_session<T, F>(
        &self,
        saved_cookies: &str,
        request: impl Fn(reqwest::Client) -> F + Send,
    ) -> Result<T>
    where
        F: Future<Output = Result<T>> + Send,
    {
        let (session, ja_cookie) = {
            let auth = self.video_auth.browser.lock().await;
            (auth.legacy_session.clone(), auth.ja_auth_cookie.clone())
        };
        let mut session = session.lock().await;
        if session.is_some() || !saved_cookies.is_empty() || ja_cookie.trim().is_empty() {
            let initial = match session.as_ref() {
                Some(client) => client.clone(),
                None => {
                    let jar = Arc::new(Jar::default());
                    let url = self.legacy_video_url(VIDEO_APP_PATH);
                    for cookie in saved_cookies
                        .split(';')
                        .map(str::trim)
                        .filter(|cookie| !cookie.is_empty())
                    {
                        jar.add_cookie_str(cookie, &url);
                    }
                    reqwest::Client::builder()
                        .timeout(Duration::from_secs(15))
                        .cookie_provider(jar)
                        .build()?
                }
            };
            match request(initial).await {
                Err(error) if legacy_session_rejected(&error) => (),
                result => return result,
            }
            *session = None;
        }

        if ja_cookie.trim().is_empty() {
            return Err(legacy_login_error());
        }
        let (client, _) = self.open_legacy_video_session(&format!("JAAuthCookie={ja_cookie}"))
            .await
            .map_err(|error| {
                if legacy_session_rejected(&error) {
                    legacy_login_error()
                } else {
                    error
                }
            })?;
        match request(client.clone()).await {
            Err(error) if legacy_session_rejected(&error) => Err(legacy_login_error()),
            result => {
                *session = Some(client);
                result
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    fn jwt(expires_at: i64, signature: &str) -> String {
        let payload = URL_SAFE_NO_PAD.encode(format!(r#"{{"exp":{expires_at}}}"#));
        format!("test.{payload}.{signature}")
    }

    #[tokio::test]
    async fn token_exchange_session_and_lti_errors_fall_back_to_extra_login() {
        for failure in ["exchange", "session", "lti"] {
            let server = MockServer::start();
            let exchange = server.mock(|when, then| {
                when.path("/login/session_token")
                    .header("authorization", "Bearer rejected-token");
                then.status(if failure == "exchange" { 401 } else { 200 })
                    .json_body(serde_json::json!({"session_url": server.url("/broken-lti")}));
            });
            let broken = server.mock(|when, then| {
                when.path("/broken-lti");
                then.status(if failure == "lti" { 200 } else { 500 });
            });
            let extra = server.mock(|when, then| {
                when.path("/sso");
                then.header("Set-Cookie", "extra=ready; Path=/");
            });
            let launch = server.mock(|when, then| {
                when.path("/launch").header("cookie", "extra=ready");
                then.status(302)
                    .header("Location", "/ui/#/?jwt_token=fallback-jwt");
            });
            let failed_launch = server.mock(|when, then| {
                when.path("/launch");
                then.status(500);
            });
            let client = Client::new_without_proxy(server.base_url().as_str(), "", "", "", None);
            client
                .configure_video_auth("rejected-token", "extra-cookie", false)
                .await;
            assert_eq!(
                client
                    .video_launch_token(&server.url("/launch"), &server.url("/sso"), None,)
                    .await
                    .unwrap()
                    .value
                    .as_ref(),
                "fallback-jwt"
            );
            assert_eq!(
                client.video_auth.browser.lock().await.method,
                Some(VideoAuthMethod::ExtraLogin)
            );
            exchange.assert_hits(1);
            extra.assert_hits(1);
            launch.assert_hits(1);
            broken.assert_hits(usize::from(failure != "exchange"));
            failed_launch.assert_hits(usize::from(failure == "lti"));
        }
    }

    #[tokio::test]
    async fn both_login_methods_failing_return_actionable_error_without_secrets() {
        let server = MockServer::start();
        let exchange = server.mock(|when, then| {
            when.path("/login/session_token");
            then.json_body(serde_json::json!({"session_url": server.url("/secret-ticket")}));
        });
        let ticket = server.mock(|when, then| {
            when.path("/secret-ticket");
            then.status(500);
        });
        let extra = server.mock(|when, then| {
            when.path("/sso");
            then.status(401);
        });
        let client = Client::new_without_proxy(server.base_url().as_str(), "", "", "", None);
        client
            .configure_video_auth("secret-token", "secret-cookie", false)
            .await;
        let error = client
            .video_launch_token(&server.url("/launch"), &server.url("/sso"), None)
            .await
            .err()
            .expect("login must fail")
            .to_string();
        assert!(error.contains("前往设置扫码登录"));
        for secret in ["secret-ticket", "secret-token", "secret-cookie"] {
            assert!(!error.contains(secret));
        }
        exchange.assert();
        ticket.assert();
        extra.assert();
        assert!(client.video_auth.browser.lock().await.session.is_none());
    }

    // Reads existing credentials without modifying the account or printing identifiers.
    // Run explicitly with SJTU_CANVAS_ACCEPTANCE_CONFIG and optionally
    // SJTU_VIDEO_ACCEPTANCE_AUTH=fallback to reject the token deliberately.
    #[tokio::test]
    #[ignore = "requires an existing SJTU account and network access"]
    async fn live_classroom_authentication() {
        let path = std::env::var("SJTU_CANVAS_ACCEPTANCE_CONFIG")
            .expect("set SJTU_CANVAS_ACCEPTANCE_CONFIG");
        let config: crate::model::AppConfig =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let fallback = std::env::var("SJTU_VIDEO_ACCEPTANCE_AUTH").as_deref() == Ok("fallback");
        let client = Client::new_without_proxy("https://oc.sjtu.edu.cn", "", "", "", None);
        let (token, cookie, expected) = if fallback {
            (
                "intentionally-invalid-acceptance-token",
                config.ja_auth_cookie.as_str(),
                VideoAuthMethod::ExtraLogin,
            )
        } else {
            (config.token.as_str(), "", VideoAuthMethod::CanvasToken)
        };
        client.configure_video_auth(token, cookie, false).await;
        client
            .login_classroom_video()
            .await
            .expect("classroom authentication failed");
        assert_eq!(
            client.video_auth.browser.lock().await.method,
            Some(expected)
        );
        let courses = client
            .list_video_space_courses()
            .await
            .expect("video course listing failed");
        assert!(
            !courses.is_empty(),
            "account has no video courses to accept"
        );
        let mut accepted = false;
        for course in courses.iter().take(20) {
            let recordings = client
                .get_video_space_videos(course.id)
                .await
                .expect("recording list failed");
            let Some(recording) = recordings
                .iter()
                .find(|video| video.playable && video.ai_available == Some(true))
                .or_else(|| recordings.iter().find(|video| video.playable))
            else {
                continue;
            };
            let info = client
                .get_canvas_video_info(&recording.video_id)
                .await
                .expect("playback info failed");
            let stream = info
                .video_play_response_vo_list
                .first()
                .expect("no video tracks");
            let mut media = client
                .cli
                .get(&stream.rtmp_url_hdv)
                .header("Range", "bytes=0-1023")
                .header("Referer", "https://v.sjtu.edu.cn/")
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap();
            assert!(!media.chunk().await.unwrap().unwrap().is_empty());
            let live = client
                .get_video_live_sessions(None, Some(course.id))
                .await
                .expect("live session list failed");
            let canvas_courses = client
                .list_courses(&config.token)
                .await
                .expect("Canvas courses failed");
            let mut canvas_verified = false;
            for canvas_course in canvas_courses.iter().filter(|candidate| {
                candidate.name.contains(&course.name) || course.name.contains(&candidate.name)
            }) {
                if client
                    .get_canvas_videos(canvas_course.id)
                    .await
                    .is_ok_and(|videos| !videos.is_empty())
                {
                    canvas_verified = true;
                    break;
                }
            }
            assert!(
                canvas_verified,
                "matching Canvas course launch did not return recordings"
            );
            let id = recording.video_id.parse().unwrap();
            let subtitle_segments = match client.get_subtitle(id).await {
                Ok(subtitles) => {
                    subtitles.before_assembly_list.len() + subtitles.after_assembly_list.len()
                }
                Err(AppError::VideoDownloadError(message)) if message == "Subtitle unavailable" => {
                    0
                }
                Err(_) => panic!("subtitle request failed"),
            };
            let ppt_slides = match client.get_ppt(id).await {
                Ok(slides) => slides.len(),
                Err(AppError::VideoDownloadError(message))
                    if message == "No PPT found" || message == "Video service returned no data" =>
                {
                    0
                }
                Err(_) => panic!("PPT request failed"),
            };
            println!("REAL_ACCOUNT_PASS auth={expected:?} extra_cookie_supplied={fallback} courses={} recordings={} media_read=true live_list_read=true canvas_course_launch=true subtitle_segments={subtitle_segments} ppt_slides={ppt_slides}", courses.len(), recordings.len());
            let _ = live;
            accepted = true;
            break;
        }
        assert!(
            accepted,
            "no playable recordings found for media acceptance"
        );
    }

    #[tokio::test]
    async fn token_login_consumes_session_and_lti_without_forwarding_bearer() {
        let canvas = MockServer::start();
        let video = MockServer::start();
        let exchange = canvas.mock(|when, then| {
            when.method(GET)
                .path("/login/session_token")
                .header("authorization", "Bearer canvas-secret")
                .query_param("return_to", canvas.url("/"));
            then.json_body(serde_json::json!({"session_url": canvas.url("/session/one-time")}));
        });
        let consume = canvas.mock(|when, then| {
            when.method(GET).path("/session/one-time");
            then.status(302)
                .header("Set-Cookie", "canvas_session=valid; Path=/")
                .header("Location", "/");
        });
        let home = canvas.mock(|when, then| {
            when.path("/").header("cookie", "canvas_session=valid");
            then.status(200);
        });
        let launch = canvas.mock(|when, then| {
            when.method(GET)
                .path("/launch")
                .header("cookie", "canvas_session=valid");
            then.body(format!(
                r#"<form action="{}/lti"><input name="signed" value="yes"></form>"#,
                video.base_url()
            ));
        });
        let token = jwt(chrono::Utc::now().timestamp() + 3600, "video");
        let lti = video.mock(|when, then| {
            when.method(POST)
                .path("/lti")
                .body("signed=yes")
                .matches(|request| {
                    request.headers.as_ref().is_none_or(|headers| {
                        !headers
                            .iter()
                            .any(|(name, _)| name.eq_ignore_ascii_case("authorization"))
                    })
                });
            then.status(302)
                .header("Location", format!("/ui/#/?jwt_token={token}"));
        });
        let client = Client::new_without_proxy(canvas.base_url().as_str(), "", "", "", None);
        client
            .configure_video_auth("canvas-secret", "", false)
            .await;
        let url = canvas.url("/launch");
        let read_token = |value: Arc<str>| async move { Ok(value.to_string()) };
        let (first, second) = tokio::join!(
            client.with_video_launch(&url, read_token),
            client.with_video_launch(&url, read_token)
        );
        assert_eq!(first.unwrap(), token);
        assert_eq!(second.unwrap(), token);
        exchange.assert_hits(1);
        consume.assert_hits(1);
        home.assert_hits(1);
        launch.assert_hits(1);
        lti.assert_hits(1);
        let browser = client.video_auth.browser.lock().await;
        assert_eq!(browser.method, Some(VideoAuthMethod::CanvasToken));
        let cached = tokio::time::timeout(
            Duration::from_secs(1),
            client.with_video_launch(&url, read_token),
        )
        .await;
        assert_eq!(
            cached
                .expect("cache hit must bypass the browser lock")
                .unwrap(),
            token
        );
        drop(browser);

        client
            .with_video_launch(&format!("{url}?another-course"), read_token)
            .await
            .unwrap();
        launch.assert_hits(2);
        lti.assert_hits(2);
        client
            .video_auth
            .launches
            .write()
            .await
            .entries
            .get_mut(&url)
            .unwrap()
            .expires_at = Some(chrono::Utc::now().timestamp());
        client.with_video_launch(&url, read_token).await.unwrap();
        launch.assert_hits(3);
        client.configure_video_auth("canvas-secret", "", true).await;
        assert!(client.video_auth.browser.lock().await.session.is_none());
        assert!(client.token.read().await.is_empty());
        client.with_video_launch(&url, read_token).await.unwrap();
        exchange.assert_hits(2);
        launch.assert_hits(4);
    }

    #[tokio::test]
    async fn concurrent_video_token_rejections_share_a_refresh() {
        let server = MockServer::start();
        let url = server.url("/launch");
        let expiry = chrono::Utc::now().timestamp() + 3600;
        let old_token = jwt(expiry, "old");
        let new_token = jwt(expiry, "new");
        let mut first_launch = server.mock(|when, then| {
            when.path("/launch");
            then.status(302)
                .header("Location", format!("/ui/#/?jwt_token={old_token}"));
        });
        let client = Client::new_without_proxy(server.base_url().as_str(), "", "", "", None);
        client.video_auth.browser.lock().await.session = Some(
            reqwest::Client::builder()
                .no_proxy()
                .redirect(Policy::none())
                .build()
                .unwrap(),
        );
        client
            .with_video_launch(&url, |_| async { Ok(()) })
            .await
            .unwrap();
        first_launch.assert_hits(1);
        first_launch.delete();
        let refresh = server.mock(|when, then| {
            when.path("/launch");
            then.status(302)
                .header("Location", format!("/ui/#/?jwt_token={new_token}"));
        });
        let both_started = tokio::sync::Barrier::new(2);
        let request = |token: Arc<str>| {
            let (old_token, both_started) = (&old_token, &both_started);
            async move {
                if token.as_ref() == old_token {
                    both_started.wait().await;
                    return Err(AppError::VideoAuthorizationError("expired".into()));
                }
                Ok(token.to_string())
            }
        };
        let (first, second) = tokio::join!(
            client.with_video_launch(&url, &request),
            client.with_video_launch(&url, &request)
        );
        assert_eq!(first.unwrap(), new_token);
        assert_eq!(second.unwrap(), new_token);
        refresh.assert_hits(1);

        // A request that finishes during an account switch cannot retry under the new account.
        let result = client
            .with_video_launch(&url, |_| async {
                client.configure_video_auth("new-account", "", true).await;
                Err::<(), _>(AppError::VideoAuthorizationError("expired".into()))
            })
            .await;
        assert!(matches!(result, Err(AppError::LoginError)));
        refresh.assert_hits(1);
    }
}
