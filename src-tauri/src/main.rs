// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use error::Result;
use model::{
    Account, AccountInfo, AppConfig, Assignment, CalendarEvent, CanvasVideo, Colors, Course,
    DiscussionTopic, File, Folder, FullDiscussion, QRCodeScanResult, RelationshipTopo, Subject,
    Submission, User, UserSubmissions, VideoCourse, VideoInfo, VideoPlayInfo,
};

use tauri::{Runtime, Window};

use crate::app::App;
mod app;
mod client;
mod error;
mod model;
mod utils;

#[macro_use]
extern crate lazy_static;

lazy_static! {
    static ref APP: App = App::new();
}

#[tauri::command]
async fn collect_relationship() -> Result<RelationshipTopo> {
    APP.collect_relationship().await
}

#[tauri::command]
fn create_account(account: Account) -> Result<()> {
    App::create_account(&account)
}

#[tauri::command]
fn read_account_info() -> Result<AccountInfo> {
    App::read_account_info()
}

#[tauri::command]
async fn switch_account(account: Account) -> Result<()> {
    APP.switch_account(&account).await
}

#[tauri::command]
async fn delete_account(account: Account) -> Result<()> {
    APP.delete_account(&account).await
}

#[tauri::command]
fn list_accounts() -> Result<Vec<Account>> {
    App::list_accounts()
}

#[tauri::command]
async fn list_courses() -> Result<Vec<Course>> {
    APP.list_courses().await
}

#[tauri::command]
async fn list_user_submissions(
    course_id: i64,
    student_ids: Vec<i64>,
) -> Result<Vec<UserSubmissions>> {
    APP.list_user_submissions(course_id, &student_ids).await
}

#[tauri::command]
async fn list_course_assignment_submissions(
    course_id: i64,
    assignment_id: i64,
) -> Result<Vec<Submission>> {
    APP.list_course_assignment_submissions(course_id, assignment_id)
        .await
}

#[tauri::command]
async fn get_single_course_assignment_submission(
    course_id: i64,
    assignment_id: i64,
    student_id: i64,
) -> Result<Submission> {
    APP.get_single_course_assignment_submission(course_id, assignment_id, student_id)
        .await
}

#[tauri::command]
async fn list_discussion_topics(course_id: i64) -> Result<Vec<DiscussionTopic>> {
    APP.list_discussion_topics(course_id).await
}

#[tauri::command]
async fn get_full_discussion(course_id: i64, topic_id: i64) -> Result<FullDiscussion> {
    APP.get_full_discussion(course_id, topic_id).await
}

#[tauri::command]
async fn sync_course_files(course: Course) -> Result<Vec<File>> {
    APP.sync_course_files(&course).await
}

#[tauri::command]
async fn list_course_files(course_id: i64) -> Result<Vec<File>> {
    APP.list_course_files(course_id).await
}

#[tauri::command]
async fn list_course_images(course_id: i64) -> Result<Vec<File>> {
    APP.list_course_images(course_id).await
}

#[tauri::command]
async fn list_course_users(course_id: i64) -> Result<Vec<User>> {
    APP.list_course_users(course_id).await
}

#[tauri::command]
async fn list_course_students(course_id: i64) -> Result<Vec<User>> {
    APP.list_course_students(course_id).await
}

#[tauri::command]
async fn list_course_assignments(course_id: i64) -> Result<Vec<Assignment>> {
    APP.list_course_assignments(course_id).await
}

#[tauri::command]
async fn filter_course_qrcode_images(course_id: i64) -> Result<Vec<QRCodeScanResult>> {
    APP.filter_course_qrcode_images(course_id).await
}

#[tauri::command]
async fn list_folder_files(folder_id: i64) -> Result<Vec<File>> {
    APP.list_folder_files(folder_id).await
}

#[tauri::command]
async fn list_course_folders(course_id: i64) -> Result<Vec<Folder>> {
    APP.list_course_folders(course_id).await
}

#[tauri::command]
async fn list_my_folders() -> Result<Vec<Folder>> {
    APP.list_my_folders().await
}

#[tauri::command]
async fn list_folder_folders(folder_id: i64) -> Result<Vec<Folder>> {
    APP.list_folder_folders(folder_id).await
}

#[tauri::command]
async fn test_token(token: String) -> Result<User> {
    APP.test_token(&token).await
}

#[tauri::command]
async fn get_me() -> Result<User> {
    APP.get_me().await
}

#[tauri::command]
async fn get_config() -> AppConfig {
    APP.get_config().await
}

#[tauri::command]
async fn get_raw_config() -> Result<String> {
    APP.get_raw_config().await
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
async fn open_file(name: String) -> Result<()> {
    APP.open_file(&name).await
}

#[tauri::command]
async fn open_course_file(name: String, course: Course, folder_path: String) -> Result<()> {
    APP.open_course_file(&name, &course, &folder_path).await
}

#[tauri::command]
async fn open_my_file(name: String, folder_path: String) -> Result<()> {
    APP.open_my_file(&name, &folder_path).await
}

#[tauri::command]
async fn open_save_dir() -> Result<()> {
    APP.open_save_dir().await
}

#[tauri::command]
async fn open_config_dir() -> Result<()> {
    APP.open_config_dir().await
}

#[tauri::command]
async fn delete_file(file: File) -> Result<()> {
    APP.delete_file(&file).await
}

#[tauri::command]
async fn delete_course_file(file: File, course: Course, folder_path: String) -> Result<()> {
    APP.delete_course_file(&file, &course, &folder_path).await
}

#[tauri::command]
async fn delete_my_file(file: File, folder_path: String) -> Result<()> {
    APP.delete_my_file(&file, &folder_path).await
}

#[tauri::command]
async fn delete_file_with_name(name: String) -> Result<()> {
    APP.delete_file_with_name(&name).await
}

#[tauri::command]
async fn export_excel(
    data: Vec<Vec<String>>,
    file_name: String,
    folder_path: String,
) -> Result<()> {
    APP.export_excel(&data, &file_name, &folder_path).await
}

#[tauri::command]
async fn download_file<R: Runtime>(window: Window<R>, file: File) -> Result<()> {
    APP.download_file(&file, &|progress| {
        let _ = window.emit("download://progress", progress);
    })
    .await
}

#[tauri::command]
async fn download_course_file<R: Runtime>(
    window: Window<R>,
    file: File,
    course: Course,
    folder_path: String,
) -> Result<()> {
    APP.download_course_file(&file, &course, &folder_path, &|progress| {
        let _ = window.emit("download://progress", progress);
    })
    .await
}

#[tauri::command]
async fn download_my_file<R: Runtime>(
    window: Window<R>,
    file: File,
    folder_path: String,
) -> Result<()> {
    APP.download_my_file(&file, &folder_path, &|progress| {
        let _ = window.emit("download://progress", progress);
    })
    .await
}

#[tauri::command]
async fn save_file_content(content: Vec<u8>, file_name: String) -> Result<()> {
    APP.save_file_content(&content, &file_name).await
}

#[tauri::command]
async fn convert_pptx_to_pdf(mut file: File) -> Result<Vec<u8>> {
    let content = APP.convert_pptx_to_pdf(&mut file).await?;
    Ok(content)
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
async fn get_folder_by_id(folder_id: i64) -> Result<Folder> {
    APP.get_folder_by_id(folder_id).await
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
async fn upload_submission_file(
    course_id: i64,
    assignment_id: i64,
    file_path: String,
    file_name: String,
) -> Result<File> {
    APP.upload_submission_file(course_id, assignment_id, &file_path, &file_name)
        .await
}

#[tauri::command]
async fn submit_assignment(
    course_id: i64,
    assignment_id: i64,
    file_paths: Vec<String>,
    comment: Option<String>,
) -> Result<()> {
    APP.submit_assignment(course_id, assignment_id, &file_paths, comment.as_deref())
        .await
}

#[tauri::command]
async fn get_my_single_submission(course_id: i64, assignment_id: i64) -> Result<Submission> {
    APP.get_my_single_submission(course_id, assignment_id).await
}

#[tauri::command]
async fn update_grade(
    course_id: i64,
    assignment_id: i64,
    student_id: i64,
    grade: String,
    comment: Option<String>,
) -> Result<()> {
    APP.update_grade(
        course_id,
        assignment_id,
        student_id,
        &grade,
        comment.as_deref(),
    )
    .await
}

#[tauri::command]
async fn delete_submission_comment(
    course_id: i64,
    assignment_id: i64,
    student_id: i64,
    comment_id: i64,
) -> Result<()> {
    APP.delete_submission_comment(
        course_id,
        assignment_id,
        &student_id.to_string(),
        comment_id,
    )
    .await
}

#[tauri::command]
async fn delete_my_submission_comment(
    course_id: i64,
    assignment_id: i64,
    comment_id: i64,
) -> Result<()> {
    APP.delete_submission_comment(course_id, assignment_id, "self", comment_id)
        .await
}

#[tauri::command]
async fn modify_assignment_ddl(
    course_id: i64,
    assignment_id: i64,
    due_at: Option<String>,
    lock_at: Option<String>,
) -> Result<()> {
    APP.modify_assignment_ddl(
        course_id,
        assignment_id,
        due_at.as_deref(),
        lock_at.as_deref(),
    )
    .await
}

#[tauri::command]
async fn modify_assignment_ddl_override(
    course_id: i64,
    assignment_id: i64,
    override_id: i64,
    due_at: Option<String>,
    lock_at: Option<String>,
) -> Result<()> {
    APP.modify_assignment_ddl_override(
        course_id,
        assignment_id,
        override_id,
        due_at.as_deref(),
        lock_at.as_deref(),
    )
    .await
}

#[tauri::command]
async fn delete_assignment_ddl_override(
    course_id: i64,
    assignment_id: i64,
    override_id: i64,
) -> Result<()> {
    APP.delete_assignment_ddl_override(course_id, assignment_id, override_id)
        .await
}

#[tauri::command]
async fn add_assignment_ddl_override(
    course_id: i64,
    assignment_id: i64,
    student_id: i64,
    title: String,
    due_at: Option<String>,
    lock_at: Option<String>,
) -> Result<()> {
    APP.add_assignment_ddl_override(
        course_id,
        assignment_id,
        student_id,
        &title,
        due_at.as_deref(),
        lock_at.as_deref(),
    )
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
async fn get_canvas_videos(course_id: i64) -> Result<Vec<CanvasVideo>> {
    APP.get_canvas_videos(course_id).await
}

#[tauri::command]
async fn login_canvas_website() -> Result<()> {
    APP.login_canvas_website().await
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
async fn get_canvas_video_info(video_id: String) -> Result<VideoInfo> {
    APP.get_canvas_video_info(&video_id).await
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

// Apis for jbox
#[tauri::command]
async fn login_jbox() -> Result<()> {
    APP.login_jbox().await
}

#[tauri::command]
async fn upload_file<R: Runtime>(window: Window<R>, file: File, save_dir: String) -> Result<()> {
    APP.upload_file(&file, &save_dir, |progress| {
        let _ = window.emit("file_upload://progress", progress);
    })
    .await
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    APP.init().await?;
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            collect_relationship,
            switch_account,
            create_account,
            delete_account,
            read_account_info,
            list_accounts,
            list_courses,
            list_user_submissions,
            get_full_discussion,
            list_discussion_topics,
            sync_course_files,
            list_course_files,
            list_course_images,
            list_course_users,
            list_course_students,
            list_course_assignments,
            list_course_assignment_submissions,
            filter_course_qrcode_images,
            get_single_course_assignment_submission,
            export_excel,
            list_folder_files,
            list_course_folders,
            list_my_folders,
            list_folder_folders,
            list_calendar_events,
            test_token,
            upload_submission_file,
            submit_assignment,
            get_me,
            get_folder_by_id,
            get_colors,
            get_config,
            get_raw_config,
            save_config,
            save_file_content,
            open_course_file,
            open_my_file,
            open_file,
            open_save_dir,
            open_config_dir,
            delete_file,
            delete_file_with_name,
            delete_course_file,
            delete_my_file,
            download_file,
            download_course_file,
            download_my_file,
            check_path,
            export_users,
            update_grade,
            delete_submission_comment,
            delete_my_submission_comment,
            modify_assignment_ddl,
            modify_assignment_ddl_override,
            add_assignment_ddl_override,
            delete_assignment_ddl_override,
            get_my_single_submission,
            // Utils
            convert_pptx_to_pdf,
            // Apis for course video
            get_uuid,
            express_login,
            get_subjects,
            get_canvas_videos,
            login_canvas_website,
            get_video_course,
            get_video_info,
            get_canvas_video_info,
            download_video,
            login_video_website,
            prepare_proxy,
            stop_proxy,
            // Apis for jbox
            login_jbox,
            upload_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    Ok(())
}
