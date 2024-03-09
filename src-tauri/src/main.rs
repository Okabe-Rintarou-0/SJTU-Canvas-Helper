// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use client::Client;
use error::{ClientError, Result};
use model::{
    AppConfig, Assignment, CalendarEvent, Colors, Course, File, Folder, ProgressPayload, Subject,
    Submission, User, VideoCourse, VideoInfo, VideoPlayInfo,
};
use std::{fs, io::Write, path::Path, sync::Arc, time::Duration};
use tauri::{api::path::download_dir, Runtime, Window};
use tokio::{sync::RwLock, task::JoinHandle};
use warp::{hyper::Response, Filter};
use warp_reverse_proxy::reverse_proxy_filter;
use xlsxwriter::Workbook;
mod client;
mod error;
mod model;

#[macro_use]
extern crate lazy_static;

lazy_static! {
    static ref APP: App = App::new();
}

struct App {
    client: Arc<Client>,
    config_path: String,
    config: RwLock<AppConfig>,
    handle: RwLock<Option<JoinHandle<()>>>,
}

impl App {
    fn new() -> Self {
        let config_dir = download_dir().unwrap();
        let config_path = format!(
            "{}/{}",
            config_dir.to_str().unwrap(),
            "sjtu_canvas_helper_config.json"
        );

        let config = match App::read_config_from_file(&config_path) {
            Ok(config) => config,
            Err(_) => Default::default(),
        };

        Self {
            config_path,
            client: Arc::new(Client::new()),
            config: RwLock::new(config),
            handle: Default::default(),
        }
    }

    pub async fn init(&self) -> Result<()> {
        let mut config = self.get_config().await;
        let cookies = &config.video_cookies;
        if !cookies.is_empty() {
            tracing::info!("Detected saved cookies: {}", cookies);
            self.client.init_cookie(cookies);
            if let Ok(Some(consumer_key)) = self.client.get_oauth_consumer_key().await {
                config.oauth_consumer_key = consumer_key;
                self.save_config(config).await?;
            }
        }
        Ok(())
    }

    async fn wait_proxy_ready(&self, proxy_port: u16) -> Result<bool> {
        let url = format!("http://localhost:{}/ready", proxy_port);
        let timeout_cnt = 10;
        let mut cnt = 0;
        loop {
            let response = reqwest::get(&url).await?;
            if response.status() == 200 {
                break Ok(true);
            }
            cnt += 1;
            if cnt >= timeout_cnt {
                break Ok(false);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    async fn prepare_proxy(&self) -> Result<bool> {
        if self.handle.read().await.is_some() {
            return Ok(true);
        }
        let proxy_port = self.config.read().await.proxy_port;
        let proxy = warp::get()
            .and(warp::path!("vod" / ..))
            .and(reverse_proxy_filter(
                "".to_string(),
                "https://live.sjtu.edu.cn/".to_string(),
            ));

        let ready_check = warp::path!("ready").map(|| Response::builder().body(""));

        let handle =
            tokio::spawn(warp::serve(proxy.or(ready_check)).run(([127, 0, 0, 1], proxy_port)));
        *self.handle.write().await = Some(handle);

        self.wait_proxy_ready(proxy_port).await
    }

    async fn stop_proxy(&self) {
        let mut handle = self.handle.write().await;
        if let Some(handle) = handle.as_ref() {
            tracing::info!("stop proxy");
            handle.abort();
        }
        *handle = None;
    }

    fn read_config_from_file(config_path: &str) -> Result<AppConfig> {
        let content = fs::read(config_path)?;
        let config = serde_json::from_slice(&content)?;
        Ok(config)
    }

    async fn get_config(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    async fn list_courses(&self) -> Result<Vec<Course>> {
        self.client
            .list_courses(&self.config.read().await.token)
            .await
    }

    async fn list_course_assignment_submissions(
        &self,
        course_id: i32,
        assignment_id: i32,
    ) -> Result<Vec<Submission>> {
        self.client
            .list_course_assignment_submissions(
                course_id,
                assignment_id,
                &self.config.read().await.token,
            )
            .await
    }

    async fn update_grade(
        &self,
        course_id: i32,
        assignment_id: i32,
        student_id: i32,
        grade: &str,
    ) -> Result<()> {
        self.client
            .update_grade(
                course_id,
                assignment_id,
                student_id,
                grade,
                &self.config.read().await.token,
            )
            .await
    }

    async fn list_ta_courses(&self) -> Result<Vec<Course>> {
        self.client
            .list_ta_courses(&self.config.read().await.token)
            .await
    }

    async fn list_course_files(&self, course_id: i32) -> Result<Vec<File>> {
        self.client
            .list_course_files(course_id, &self.config.read().await.token)
            .await
    }

    async fn list_course_users(&self, course_id: i32) -> Result<Vec<User>> {
        self.client
            .list_course_users(course_id, &self.config.read().await.token)
            .await
    }

    async fn list_course_students(&self, course_id: i32) -> Result<Vec<User>> {
        self.client
            .list_course_students(course_id, &self.config.read().await.token)
            .await
    }

    async fn list_course_assignments(&self, course_id: i32) -> Result<Vec<Assignment>> {
        self.client
            .list_course_assignments(course_id, &self.config.read().await.token)
            .await
    }

    async fn list_folder_files(&self, folder_id: i32) -> Result<Vec<File>> {
        self.client
            .list_folder_files(folder_id, &self.config.read().await.token)
            .await
    }

    async fn list_folders(&self, course_id: i32) -> Result<Vec<Folder>> {
        self.client
            .list_folders(course_id, &self.config.read().await.token)
            .await
    }

    async fn save_file_content(&self, content: &[u8], file_name: &str) -> Result<()> {
        let save_dir = self.config.read().await.save_path.clone();
        let path = Path::new(&save_dir).join(file_name);
        let mut file = fs::File::create(path.to_str().unwrap())?;
        file.write_all(content)?;
        Ok(())
    }

    async fn download_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        progress_handler: F,
    ) -> Result<()> {
        let guard = self.config.read().await;
        let token = &guard.token.clone();
        let save_path = &guard.save_path.clone();
        self.client
            .download_file(file, token, save_path, progress_handler)
            .await?;
        Ok(())
    }

    async fn delete_file(&self, file: &File) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path).join(&file.display_name);
        fs::remove_file(path)?;
        Ok(())
    }

    async fn delete_file_with_name(&self, name: &str) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path).join(name);
        fs::remove_file(path)?;
        Ok(())
    }

    async fn get_colors(&self) -> Result<Colors> {
        self.client
            .get_colors(&self.config.read().await.token)
            .await
    }

    async fn list_calendar_events(
        &self,
        context_codes: &[String],
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<CalendarEvent>> {
        self.client
            .list_calendar_events(
                &self.config.read().await.token,
                context_codes,
                start_date,
                end_date,
            )
            .await
    }

    async fn save_config(&self, config: AppConfig) -> Result<()> {
        fs::write(&APP.config_path, serde_json::to_vec(&config).unwrap())?;
        *self.config.write().await = config;
        Ok(())
    }

    fn check_path(path: &str) -> bool {
        let path = Path::new(path);
        if path.exists() {
            if let Ok(metadata) = fs::metadata(path) {
                return metadata.is_dir();
            }
        }
        false
    }

    async fn export_users(&self, users: &[User], save_name: &str) -> Result<()> {
        let save_path = self.config.read().await.save_path.clone();
        let path = Path::new(&save_path).join(save_name);

        let workbook = Workbook::new(path.to_str().unwrap())?;
        let mut sheet = workbook.add_worksheet(None)?;

        // setup headers
        sheet.write_string(0, 0, "id", None)?;
        sheet.write_string(0, 1, "name", None)?;
        sheet.write_string(0, 2, "email", None)?;
        sheet.write_string(0, 3, "created_at", None)?;
        sheet.write_string(0, 4, "sortable_name", None)?;
        sheet.write_string(0, 5, "short_name", None)?;
        sheet.write_string(0, 6, "login_id", None)?;

        for (row, user) in users.iter().enumerate() {
            let row = row as u32 + 1;
            sheet.write_string(row, 0, &user.id.to_string(), None)?;
            sheet.write_string(row, 1, &user.name, None)?;
            sheet.write_string(row, 2, &user.email, None)?;
            sheet.write_string(row, 3, &user.created_at, None)?;
            sheet.write_string(row, 4, &user.sortable_name, None)?;
            sheet.write_string(row, 5, &user.short_name, None)?;
            sheet.write_string(row, 6, &user.login_id, None)?;
        }
        workbook.close()?;
        Ok(())
    }
}

// Apis for course video
impl App {
    async fn get_uuid(&self) -> Result<Option<String>> {
        self.client.get_uuid().await
    }

    async fn express_login(&self, uuid: &str) -> Result<Option<String>> {
        self.client.express_login(uuid).await
    }

    async fn get_cookie(&self) -> String {
        format!("JAAuthCookie={}", self.config.read().await.ja_auth_cookie)
    }

    async fn login_video_website(&self) -> Result<()> {
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
            Err(ClientError::LoginError)
        }
    }

    async fn get_subjects(&self) -> Result<Vec<Subject>> {
        self.client.get_subjects().await
    }

    async fn get_video_info(&self, video_id: i64) -> Result<VideoInfo> {
        let consumer_key = &self.config.read().await.oauth_consumer_key;
        self.client.get_video_info(video_id, consumer_key).await
    }

    async fn download_video<F: Fn(ProgressPayload) + Send>(
        &self,
        video: &VideoPlayInfo,
        save_name: &str,
        progress_handler: F,
    ) -> Result<()> {
        let save_dir = self.config.read().await.save_path.clone();
        let save_path = Path::new(&save_dir).join(save_name);
        self.client
            .download_video(video, save_path.to_str().unwrap(), progress_handler)
            .await
    }

    async fn get_video_course(&self, subject_id: i64, tecl_id: i64) -> Result<Option<VideoCourse>> {
        self.client.get_video_course(subject_id, tecl_id).await
    }
}

#[tauri::command]
async fn list_courses() -> Result<Vec<Course>> {
    APP.list_courses().await
}

#[tauri::command]
async fn list_course_assignment_submissions(
    course_id: i32,
    assignment_id: i32,
) -> Result<Vec<Submission>> {
    APP.list_course_assignment_submissions(course_id, assignment_id)
        .await
}

#[tauri::command]
async fn list_ta_courses() -> Result<Vec<Course>> {
    APP.list_ta_courses().await
}

#[tauri::command]
async fn list_course_files(course_id: i32) -> Result<Vec<File>> {
    APP.list_course_files(course_id).await
}

#[tauri::command]
async fn list_course_users(course_id: i32) -> Result<Vec<User>> {
    APP.list_course_users(course_id).await
}

#[tauri::command]
async fn list_course_students(course_id: i32) -> Result<Vec<User>> {
    APP.list_course_students(course_id).await
}

#[tauri::command]
async fn list_course_assignments(course_id: i32) -> Result<Vec<Assignment>> {
    APP.list_course_assignments(course_id).await
}

#[tauri::command]
async fn list_folder_files(folder_id: i32) -> Result<Vec<File>> {
    APP.list_folder_files(folder_id).await
}

#[tauri::command]
async fn list_folders(course_id: i32) -> Result<Vec<Folder>> {
    APP.list_folders(course_id).await
}

#[tauri::command]
async fn get_config() -> AppConfig {
    APP.get_config().await
}

#[tauri::command]
fn check_path(path: String) -> bool {
    App::check_path(&path)
}

#[tauri::command]
async fn export_users(users: Vec<User>, save_name: String) -> Result<()> {
    APP.export_users(&users, &save_name).await
}

#[tauri::command]
async fn delete_file(file: File) -> Result<()> {
    APP.delete_file(&file).await
}

#[tauri::command]
async fn delete_file_with_name(name: String) -> Result<()> {
    APP.delete_file_with_name(&name).await
}

#[tauri::command]
async fn download_file<R: Runtime>(window: Window<R>, file: File) -> Result<()> {
    APP.download_file(&file, &|progress| {
        let _ = window.emit("download://progress", progress);
    })
    .await
}

#[tauri::command]
async fn save_file_content(content: Vec<u8>, file_name: String) -> Result<()> {
    APP.save_file_content(&content, &file_name).await
}

#[tauri::command]
async fn list_calendar_events(
    context_codes: Vec<String>,
    start_date: String,
    end_date: String,
) -> Result<Vec<CalendarEvent>> {
    APP.list_calendar_events(&context_codes, &start_date, &end_date)
        .await
}

#[tauri::command]
async fn get_colors() -> Result<Colors> {
    APP.get_colors().await
}

#[tauri::command]
async fn save_config(config: AppConfig) -> Result<()> {
    tracing::info!("Receive config: {:?}", config);
    APP.save_config(config).await
}

#[tauri::command]
async fn update_grade(
    course_id: i32,
    assignment_id: i32,
    student_id: i32,
    grade: String,
) -> Result<()> {
    APP.update_grade(course_id, assignment_id, student_id, &grade)
        .await
}

// Apis for course video
#[tauri::command]
async fn get_uuid() -> Result<Option<String>> {
    APP.get_uuid().await
}

#[tauri::command]
async fn express_login(uuid: String) -> Result<Option<String>> {
    APP.express_login(&uuid).await
}

#[tauri::command]
async fn login_video_website() -> Result<()> {
    APP.login_video_website().await
}

#[tauri::command]
async fn get_subjects() -> Result<Vec<Subject>> {
    APP.get_subjects().await
}

#[tauri::command]
async fn get_video_course(subject_id: i64, tecl_id: i64) -> Result<Option<VideoCourse>> {
    APP.get_video_course(subject_id, tecl_id).await
}

#[tauri::command]
async fn get_video_info(video_id: i64) -> Result<VideoInfo> {
    APP.get_video_info(video_id).await
}

#[tauri::command]
async fn prepare_proxy() -> Result<bool> {
    APP.prepare_proxy().await
}

#[tauri::command]
async fn stop_proxy() {
    APP.stop_proxy().await
}

#[tauri::command]
async fn download_video<R: Runtime>(
    window: Window<R>,
    video: VideoPlayInfo,
    save_name: String,
) -> Result<()> {
    APP.download_video(&video, &save_name, |progress| {
        let _ = window.emit("video_download://progress", progress);
    })
    .await
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    APP.init().await?;
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_courses,
            list_ta_courses,
            list_course_files,
            list_course_users,
            list_course_students,
            list_course_assignments,
            list_course_assignment_submissions,
            list_folder_files,
            list_folders,
            list_calendar_events,
            get_colors,
            get_config,
            save_config,
            save_file_content,
            delete_file,
            delete_file_with_name,
            download_file,
            check_path,
            export_users,
            update_grade,
            // Apis for course video
            get_uuid,
            express_login,
            get_subjects,
            get_video_course,
            get_video_info,
            download_video,
            login_video_website,
            prepare_proxy,
            stop_proxy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    Ok(())
}

#[cfg(test)]
mod test {
    use crate::{error::Result, App};

    #[tokio::test]
    async fn test_get_calendar_events() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();
        let colors = app.get_colors().await?;
        tracing::info!("{:?}", colors);
        let mut context_codes = vec![];
        for (course_code, _) in colors.custom_colors {
            context_codes.push(course_code);
        }
        let start_date = "2024-02-25T16:00:00.000Z";
        let end_date = "2024-03-31T16:00:00.000Z";
        let events = app
            .list_calendar_events(&context_codes, start_date, end_date)
            .await?;
        tracing::info!("{:?}", events);
        Ok(())
    }

    #[tokio::test]
    async fn test_video_apis() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();
        app.init().await?;
        app.login_video_website().await?;
        let subjects = app.get_subjects().await?;
        tracing::info!("{:?}", subjects);
        let subject = &subjects[0];
        let course = app
            .get_video_course(subject.subject_id, subject.tecl_id)
            .await?
            .unwrap();
        tracing::info!("{:?}", course);
        let video = app.get_video_info(course.response_vo_list[0].id).await?;
        tracing::info!("video = {:?}", video);

        app.download_video(
            &video.video_play_response_vo_list[0],
            "download.mp4",
            |_| {},
        )
        .await?;
        Ok(())
    }
}
