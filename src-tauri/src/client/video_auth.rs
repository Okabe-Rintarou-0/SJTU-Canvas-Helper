use std::{sync::Arc, time::Duration};

use reqwest::{cookie::Jar, redirect::Policy};
use serde::Deserialize;
use tauri::Url;

use super::{
    constants::{AUTH_URL, CANVAS_LOGIN_URL, MY_SJTU_URL},
    Client,
};
use crate::error::{AppError, Result};

// Keep Canvas browser cookies separate from jAccount and the legacy video client.
// Replacing credentials drops this jar, including any previous account's session.
#[derive(Default)]
pub(super) struct VideoAuth {
    canvas_token: String,
    ja_auth_cookie: String,
    session: Option<reqwest::Client>,
    pub(super) method: Option<VideoAuthMethod>,
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

fn session_url(base: &Url, value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| AppError::LoginError)?;
    if url.origin() != base.origin() || !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::LoginError);
    }
    Ok(url)
}

impl Client {
    pub async fn configure_video_auth(&self, token: &str, cookie: &str, reset: bool) {
        let mut auth = self.video_auth.lock().await;
        if reset || auth.canvas_token != token || auth.ja_auth_cookie != cookie {
            *auth = VideoAuth {
                canvas_token: token.into(),
                ja_auth_cookie: cookie.into(),
                ..Default::default()
            };
            self.token.write().await.clear();
        }
    }

    // One lock covers the whole login chain so concurrent course/live requests
    // share the authenticated browser session instead of consuming the same ticket.
    pub(super) async fn authenticated_video_launch(&self, launch_url: &str) -> Result<String> {
        self.authenticated_video_launch_with_sso(launch_url, CANVAS_LOGIN_URL)
            .await
    }

    async fn authenticated_video_launch_with_sso(
        &self,
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
        let mut auth = self.video_auth.lock().await;
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
            let jar = Arc::new(Jar::default());
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(Policy::none())
                .cookie_provider(jar.clone())
                .build()?;
            let result = match method {
                VideoAuthMethod::CanvasToken => {
                    self.canvas_token_video_launch(&client, &base, &launch, &auth.canvas_token)
                        .await
                }
                VideoAuthMethod::ExtraLogin => {
                    for host in [AUTH_URL, MY_SJTU_URL] {
                        jar.add_cookie_str(
                            &format!("JAAuthCookie={}", auth.ja_auth_cookie),
                            &Url::parse(host).unwrap(),
                        );
                    }
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
                            self.follow_video_launch(&client, launch.as_str()).await
                        }
                        _ => Err(AppError::LoginError),
                    }
                }
            };
            match result {
                Ok(token) => {
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

    async fn canvas_token_video_launch(
        &self,
        client: &reqwest::Client,
        base: &Url,
        launch: &Url,
        token: &str,
    ) -> Result<String> {
        #[derive(Deserialize)]
        struct Session {
            session_url: String,
        }
        // Send the long-lived token only to Canvas, never along the LTI redirects.
        let endpoint = base
            .join("/login/session_token")
            .map_err(|_| AppError::LoginError)?;
        let response = client
            .get(endpoint)
            .bearer_auth(token)
            .query(&[("return_to", launch.as_str())])
            .send()
            .await
            .map_err(|_| AppError::LoginError)?
            .error_for_status()
            .map_err(|_| AppError::LoginError)?;
        let session: Session = response.json().await.map_err(|_| AppError::LoginError)?;
        let url = session_url(base, &session.session_url)?;
        // The URL contains a one-time credential; never log it or propagate raw errors.
        self.follow_video_launch(client, url.as_str())
            .await
            .map_err(|_| AppError::LoginError)
    }

    pub(super) async fn video_browser_client(&self) -> reqwest::Client {
        self.video_auth
            .lock()
            .await
            .session
            .clone()
            .unwrap_or_else(|| self.cli.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    #[tokio::test]
    async fn token_exchange_and_lti_errors_fall_back_to_extra_login() {
        for exchange_status in [401, 200] {
            let server = MockServer::start();
            let exchange = server.mock(|when, then| {
                when.path("/login/session_token")
                    .header("authorization", "Bearer rejected-token");
                then.status(exchange_status)
                    .json_body(serde_json::json!({"session_url": server.url("/broken-lti")}));
            });
            let broken = server.mock(|when, then| {
                when.path("/broken-lti");
                then.status(500);
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
            let client = Client::new_without_proxy(server.base_url().as_str(), "", "", "", None);
            client
                .configure_video_auth("rejected-token", "extra-cookie", false)
                .await;
            assert_eq!(
                client
                    .authenticated_video_launch_with_sso(
                        &server.url("/launch"),
                        &server.url("/sso")
                    )
                    .await
                    .unwrap(),
                "fallback-jwt"
            );
            assert_eq!(
                client.video_auth.lock().await.method,
                Some(VideoAuthMethod::ExtraLogin)
            );
            exchange.assert_hits(1);
            extra.assert_hits(1);
            launch.assert_hits(1);
            broken.assert_hits(usize::from(exchange_status == 200));
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
            .authenticated_video_launch_with_sso(&server.url("/launch"), &server.url("/sso"))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("前往设置扫码登录"));
        for secret in ["secret-ticket", "secret-token", "secret-cookie"] {
            assert!(!error.contains(secret));
        }
        exchange.assert();
        ticket.assert();
        extra.assert();
        assert!(client.video_auth.lock().await.session.is_none());
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
        assert_eq!(client.video_auth.lock().await.method, Some(expected));
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
                .query_param("return_to", canvas.url("/launch"));
            then.json_body(serde_json::json!({"session_url": canvas.url("/session/one-time")}));
        });
        let consume = canvas.mock(|when, then| {
            when.method(GET).path("/session/one-time");
            then.status(302)
                .header("Set-Cookie", "canvas_session=valid; Path=/")
                .header("Location", "/launch");
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
        let lti = video.mock(|when, then| {
            when.method(POST).path("/lti").body("signed=yes");
            then.status(302)
                .header("Location", "/ui/#/?jwt_token=video%2Bjwt");
        });
        let leaked = video.mock(|when, then| {
            when.header_exists("authorization");
            then.status(400);
        });
        let client = Client::new_without_proxy(canvas.base_url().as_str(), "", "", "", None);
        client
            .configure_video_auth("canvas-secret", "", false)
            .await;
        assert_eq!(
            client
                .authenticated_video_launch(&canvas.url("/launch"))
                .await
                .unwrap(),
            "video+jwt"
        );
        assert_eq!(
            client
                .authenticated_video_launch(&canvas.url("/launch"))
                .await
                .unwrap(),
            "video+jwt"
        );
        exchange.assert_hits(1);
        consume.assert_hits(1);
        launch.assert_hits(2);
        lti.assert_hits(2);
        leaked.assert_hits(0);
        assert_eq!(
            client.video_auth.lock().await.method,
            Some(VideoAuthMethod::CanvasToken)
        );
        client
            .configure_video_auth("another-account", "", false)
            .await;
        assert!(client.video_auth.lock().await.session.is_none());
        assert!(client.token.read().await.is_empty());
    }

    #[test]
    fn rejects_session_urls_outside_canvas_origin() {
        let base = Url::parse("https://oc.sjtu.edu.cn").unwrap();
        for value in [
            "https://evil.example/session",
            "http://oc.sjtu.edu.cn/session",
            "https://user:secret@oc.sjtu.edu.cn/session",
        ] {
            assert!(session_url(&base, value).is_err());
        }
    }
}
