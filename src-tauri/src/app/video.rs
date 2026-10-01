use std::{fs, path::Path};

use super::App;
use crate::{
    error::{AppError, Result},
    model::{
        CanvasVideo, Course, ProgressPayload, VideoCourse, VideoInfo, VideoPlayInfo, VideoSource,
    },
};
// Apis for course video
impl App {
    pub async fn get_uuid(&self) -> Result<Option<String>> {
        self.client.get_uuid().await
    }

    pub async fn express_login(&self, uuid: &str) -> Result<Option<String>> {
        self.client.express_login(uuid).await
    }

    pub async fn get_cookie(&self) -> String {
        format!("JAAuthCookie={}", self.config.read().await.ja_auth_cookie)
    }

    pub async fn login_video_website(&self) -> Result<()> {
        let cookie = self.get_cookie().await;
        if let Some(cookies) = self.client.login_video_website(&cookie).await? {
            let mut config = self.get_config().await;
            config.video_cookies = cookies;
            if let Ok(Some(consumer_key)) = self.client.get_oauth_consumer_key().await {
                config.oauth_consumer_key = consumer_key;
            }
            self.save_config(config).await?;
            Ok(())
        } else {
            Err(AppError::LoginError)
        }
    }

    pub async fn login_canvas_website(&self) -> Result<()> {
        let cookie = self.get_cookie().await;
        self.client.login_canvas_website(&cookie).await
    }

    pub async fn check_extra_login_status(&self) -> Result<bool> {
        let cookie = self.get_cookie().await;
        if !self.client.check_extra_login_status(&cookie).await? {
            return Ok(false);
        }

        match self.client.login_canvas_website(&cookie).await {
            Ok(()) => Ok(true),
            Err(AppError::LoginError) => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub async fn list_video_space_courses(&self) -> Result<Vec<Course>> {
        self.client.list_video_space_courses().await
    }

    pub async fn get_video_space_videos(&self, teaching_class_id: i64) -> Result<Vec<CanvasVideo>> {
        self.client.get_video_space_videos(teaching_class_id).await
    }

    pub async fn get_legacy_videos(
        &self,
        course_id: i64,
        course_name: &str,
        term_name: &str,
        teacher_names: &[String],
    ) -> Result<Vec<CanvasVideo>> {
        self.client
            .get_legacy_videos(course_id, course_name, term_name, teacher_names)
            .await
    }

    pub async fn get_video_info(&self, video_id: i64) -> Result<VideoInfo> {
        let mut consumer_key = self.config.read().await.oauth_consumer_key.clone();
        if consumer_key.is_empty() {
            consumer_key = self.client.get_oauth_consumer_key().await?.ok_or_else(|| {
                AppError::VideoDownloadError(
                    "Legacy video authorization key is unavailable".to_string(),
                )
            })?;
            let mut config = self.get_config().await;
            config.oauth_consumer_key = consumer_key.clone();
            self.save_config(config).await?;
        }
        self.client.get_video_info(video_id, &consumer_key).await
    }

    pub async fn get_canvas_video_info(&self, video_id: &str) -> Result<VideoInfo> {
        self.client.get_canvas_video_info(video_id).await
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
            VideoSource::Legacy => self.client.get_legacy_video_info(video_id).await,
        }
    }

    pub async fn get_canvas_videos(&self, course_id: i64) -> Result<Vec<CanvasVideo>> {
        self.client.get_canvas_videos(course_id).await
    }

    pub async fn download_video<F: Fn(ProgressPayload) + Send + 'static>(
        &self,
        video: &VideoPlayInfo,
        save_name: &str,
        progress_handler: F,
    ) -> Result<()> {
        let save_dir = self.config.read().await.save_path.clone();
        let save_path = Path::new(&save_dir).join(save_name);
        self.client
            .clone()
            .download_video(video, save_path.to_str().unwrap(), progress_handler)
            .await
    }

    pub async fn get_video_course(
        &self,
        subject_id: i64,
        tecl_id: i64,
    ) -> Result<Option<VideoCourse>> {
        self.client.get_video_course(subject_id, tecl_id).await
    }

    pub async fn download_subtitle(&self, canvas_course_id: i64, save_path: &str) -> Result<()> {
        let res = self.client.get_subtitle(canvas_course_id).await?;
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
        let res = self.client.get_ppt(canvas_course_id).await?;
        let enabled = self.config.read().await.experimental_ppt_cleanup;
        let (res, notes) = super::ppt::clean_up_slides(res, enabled);
        if res.is_empty() {
            return Err(AppError::VideoDownloadError("没有可导出的 PPT 页面，可关闭“导出 PPT 时去除无用页面”后重试".into()));
        }
        for note in &notes { tracing::info!("{note}"); }
        self.client
            .clone()
            .download_ppt_pdf(&res, save_path, progress_handler)
            .await?;
        Ok(notes)
    }
}
