use std::path::Path;

use super::App;
use crate::{
    error::{AppError, Result},
    model::{CanvasVideo, ProgressPayload, Subject, VideoCourse, VideoInfo, VideoPlayInfo},
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

    pub async fn get_subjects(&self) -> Result<Vec<Subject>> {
        self.client.get_subjects().await
    }

    pub async fn get_video_info(&self, video_id: i64) -> Result<VideoInfo> {
        let consumer_key = &self.config.read().await.oauth_consumer_key;
        self.client.get_video_info(video_id, consumer_key).await
    }

    pub async fn get_canvas_video_info(&self, video_id: &str) -> Result<VideoInfo> {
        self.client.get_canvas_video_info(video_id).await
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

    pub async fn get_subtitle(
        &self,
        canvas_course_id: i64,
    )-> Result<String>{
        let res = self.client.get_subtitle(canvas_course_id).await?;
        return self.client.convert_to_srt(&res.before_assembly_list);
    }
}
