use std::{fs, path::Path};

use super::App;
use crate::{
    error::{AppError, Result},
    model::{
        CanvasVideo, CanvasLiveList, CanvasLiveInfo, Course, ProgressPayload, VideoCourse, VideoInfo, VideoPlayInfo, VideoSource,
    },
};
// Apis for course video
impl App {
    pub async fn get_uuid(&self) -> Result<Option<String>> {
        let (owner, id, client) = self.begin_login_attempt().await?;
        let result = super::session::authentication(client.get_uuid()).await;
        self.finish_login_uuid(&owner, &id, result).await
    }

    pub async fn express_login(&self, uuid: &str) -> Result<Option<String>> {
        self.express_login_attempt(uuid).await
    }

    pub async fn login_video_website(&self) -> Result<()> {
        let snapshot = self.get_config_snapshot().await?;
        let cookie = format!("JAAuthCookie={}", snapshot.config.ja_auth_cookie);
        let login_result = super::session::authentication(self.client.login_video_website(&cookie)).await;
        self.ensure_config_owner(&snapshot.owner).await?;
        let cookies = login_result?.ok_or(AppError::LoginError)?;
        if cookies.trim().is_empty() { return Err(AppError::LoginError); }
        let key_result = super::session::authentication(self.client.get_oauth_consumer_key_for_cookies(&cookies)).await;
        self.ensure_config_owner(&snapshot.owner).await?;
        let consumer_key = key_result?.ok_or(AppError::LoginError)?;
        self.commit_video_login_result(&snapshot.owner, cookies, consumer_key).await
    }

    async fn commit_video_login_result(
        &self, expected_owner: &str, cookies: String, consumer_key: String,
    ) -> Result<()> {
        validate_video_login_pair(&cookies, &consumer_key)?;
        let mut owner = self.config_owner.lock().await;
        if owner.as_deref() != Some(expected_owner) {
            return Err(crate::error::AppError::StaleConfigOwner);
        }
        // Merge only derived login fields into the latest same-owner config.
        // Ordinary settings saved while authentication was in flight survive.
        let mut config = self.config.read().await.clone();
        config.video_cookies = cookies;
        config.oauth_consumer_key = consumer_key;
        self.save_config_locked(config, expected_owner, &mut owner).await?;
        Ok(())
    }

    pub(super) async fn commit_video_consumer_key(&self, expected_owner: &str, consumer_key: String) -> Result<String> {
        if consumer_key.trim().is_empty() { return Err(AppError::LoginError); }
        let mut owner = self.config_owner.lock().await;
        if owner.as_deref() != Some(expected_owner) { return Err(AppError::StaleConfigOwner); }
        // Preserve ordinary settings saved while the key lookup was in flight.
        let mut config = self.config.read().await.clone();
        config.oauth_consumer_key = consumer_key;
        self.save_config_locked(config, expected_owner, &mut owner).await
    }

    pub async fn login_canvas_website(&self) -> Result<()> {
        let session = self.canvas_session().await?;
        let result = session.refresh().await;
        self.finish_session(&session, result).await
    }

    pub async fn check_extra_login_status(&self) -> Result<bool> {
        let session = self.canvas_session().await?;
        let result = session.check().await;
        self.finish_session(&session, result).await
    }

    pub async fn list_video_space_courses(&self) -> Result<Vec<Course>> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.list_video_space_courses().await;
        self.finish_session(&session, result).await
    }

    pub async fn get_video_live_sessions(&self, canvas_course_id: Option<i64>, teaching_class_id: Option<i64>) -> Result<CanvasLiveList> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_video_live_sessions(canvas_course_id, teaching_class_id).await;
        self.finish_session(&session, result).await
    }

    pub async fn get_video_live_info(&self, course_id: &str, canvas_course_id: Option<i64>, teaching_class_id: Option<i64>) -> Result<CanvasLiveInfo> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_video_live_info(course_id, canvas_course_id, teaching_class_id).await;
        self.finish_session(&session, result).await
    }

    pub async fn get_video_space_videos(&self, teaching_class_id: i64) -> Result<Vec<CanvasVideo>> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_video_space_videos(teaching_class_id).await;
        self.finish_session(&session, result).await
    }

    pub async fn get_legacy_videos(
        &self,
        course_id: i64,
        course_name: &str,
        term_name: &str,
        teacher_names: &[String],
    ) -> Result<Vec<CanvasVideo>> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_legacy_videos(course_id, course_name, term_name, teacher_names).await;
        self.finish_session(&session, result).await
    }

    pub async fn get_video_info(&self, video_id: i64) -> Result<VideoInfo> {
        let snapshot = self.get_config_snapshot().await?;
        let client = crate::client::Client::video_client_for_cookies(&snapshot.config.video_cookies)?;
        let mut owner = snapshot.owner;
        let mut consumer_key = snapshot.config.oauth_consumer_key.clone();
        if consumer_key.is_empty() {
            let key_result = super::session::authentication(self.client.get_oauth_consumer_key_with_client(&client)).await;
            self.ensure_config_owner(&owner).await?;
            consumer_key = key_result?.ok_or_else(|| {
                AppError::VideoDownloadError("Legacy video authorization key is unavailable".to_string())
            })?;
            owner = self.commit_video_consumer_key(&owner, consumer_key.clone()).await?;
        }
        self.ensure_config_owner(&owner).await?;
        let result = self.client.get_video_info_with_client(video_id, &consumer_key, &client).await;
        self.ensure_config_owner(&owner).await?;
        result
    }

    pub async fn get_canvas_video_info(&self, video_id: &str) -> Result<VideoInfo> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_canvas_video_info(video_id).await;
        self.finish_session(&session, result).await
    }

    pub async fn get_video_play_info(
        &self,
        source: VideoSource,
        video_id: &str,
    ) -> Result<VideoInfo> {
        match source {
            VideoSource::Canvas | VideoSource::VideoSpace => {
                self.get_canvas_video_info(video_id).await
            }
            VideoSource::Legacy => {
                let session = self.authenticated_canvas_session().await?;
                let result = session.client.get_legacy_video_info(video_id).await;
                self.finish_session(&session, result).await
            },
        }
    }

    pub async fn get_canvas_videos(&self, course_id: i64) -> Result<Vec<CanvasVideo>> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_canvas_videos(course_id).await;
        self.finish_session(&session, result).await
    }

    pub async fn download_video<F: Fn(ProgressPayload) + Send + 'static>(
        &self, video: &VideoPlayInfo, save_name: &str,
        expected_owner: &str, expected_save_path: &str, progress_handler: F,
    ) -> Result<()> {
        let snapshot = self.get_config_snapshot().await?;
        if snapshot.owner != expected_owner {
            return Err(crate::error::AppError::StaleConfigOwner);
        }
        if snapshot.config.save_path != expected_save_path {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput,
                "Download destination changed; recreate the video task").into());
        }
        let save_path = crate::utils::file::checked_download_path(
            Path::new(&snapshot.config.save_path), None, "", save_name)?;
        let save_path = save_path.to_str().ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput, "Download path is not valid UTF-8"))?;
        let client = std::sync::Arc::new(self.client.video_read_snapshot(
            Self::get_base_url(&snapshot.config.account_type), &snapshot.config.video_cookies)?);
        client.download_video(video, save_path, progress_handler).await
    }

    pub async fn get_video_course(
        &self,
        subject_id: i64,
        tecl_id: i64,
    ) -> Result<Option<VideoCourse>> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_video_course(subject_id, tecl_id).await;
        self.finish_session(&session, result).await
    }

    pub async fn download_subtitle(&self, canvas_course_id: i64, save_path: &str) -> Result<()> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_subtitle(canvas_course_id).await;
        let res = self.finish_session(&session, result).await?;
        let sub_title = self.client.convert_to_srt(&res.before_assembly_list)?;
        fs::write(save_path, sub_title)?;
        Ok(())
    }

    pub async fn download_ppt<F: Fn(ProgressPayload) + Send + 'static>(
        &self,
        canvas_course_id: i64,
        save_path: &str,
        progress_handler: F,
    ) -> Result<Vec<String>> {
        let session = self.authenticated_canvas_session().await?;
        let result = session.client.get_ppt(canvas_course_id).await;
        let res = self.finish_session(&session, result).await?;
        let enabled = self.config.read().await.experimental_ppt_cleanup;
        let (res, notes) = super::ppt::clean_up_slides(res, enabled);
        if res.is_empty() {
            return Err(AppError::VideoDownloadError("没有可导出的 PPT 页面，可关闭“导出 PPT 时去除无用页面”后重试".into()));
        }
        for note in &notes { tracing::info!("{note}"); }
        session.client
            .clone()
            .download_ppt_pdf(&res, save_path, progress_handler)
            .await?;
        self.ensure_config_owner(&session.owner).await?;
        Ok(notes)
    }
}

// A login cannot commit new cookies while retaining an unrelated old key.
fn validate_video_login_pair(cookies: &str, consumer_key: &str) -> Result<()> {
    if cookies.trim().is_empty() || consumer_key.trim().is_empty() {
        return Err(AppError::LoginError);
    }
    Ok(())
}

#[cfg(test)]
mod login_pair_tests {
    use super::*;

    #[test]
    fn accepts_a_complete_pair() {
        assert!(validate_video_login_pair("session=synthetic", "synthetic-key").is_ok());
    }

    #[test]
    fn rejects_empty_or_whitespace_cookies() {
        for cookies in ["", " \t\n"] {
            assert!(matches!(validate_video_login_pair(cookies, "synthetic-key"), Err(AppError::LoginError)));
        }
    }

    #[test]
    fn rejects_empty_or_whitespace_keys() {
        for key in ["", " \t\n"] {
            assert!(matches!(validate_video_login_pair("session=synthetic", key), Err(AppError::LoginError)));
        }
    }
}
