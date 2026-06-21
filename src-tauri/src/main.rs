// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use error::{AppError, Result};
use model::{
    Account, AccountInfo, AnnualReport, AppConfig, Assignment, CalendarEvent, CanvasVideo, Colors,
    Course, DiscussionTopic, File, FileChatStreamChunkPayload, FileChatStreamDonePayload,
    FileChatStreamErrorPayload, Folder, FullDiscussion, LLMChatMessage, LogLevel, ModuleItem,
    NetworkRequestLog, QRCodeScanResult, RelationshipTopo, Subject, Submission, User,
    UserSubmissions,
    VideoAggregateParams, VideoCourse, VideoInfo, VideoPlayInfo,
};

use dirs::config_dir;

use tauri::{Emitter, Runtime, Window};
use tracing::Level;
use tracing_subscriber::{
    fmt::{self, writer::MakeWriterExt},
    layer::SubscriberExt,
};

use crate::app::App;
mod app;
mod canvas_agent;
mod client;
mod error;
mod mcp;
mod model;
mod utils;

#[macro_use]
extern crate lazy_static;

lazy_static! {
    static ref APP: App = App::new();
}

#[tauri::command]
async fn generate_annual_report(year: i32) -> Result<AnnualReport> {
    APP.generate_annual_report(year).await
}

#[tauri::command]
fn read_log_content() -> Result<String> {
    App::read_log_content()
}

#[tauri::command]
async fn is_ffmpeg_installed() -> bool {
    App::is_ffmpeg_installed()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserBalance {
    pub available_balance: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voucher_balance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cash_balance: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekBalanceInfo {
    #[serde(default)]
    total_balance: String,
}

#[derive(Debug, Deserialize)]
struct DeepSeekBalanceResponse {
    #[serde(default)]
    balance_infos: Vec<DeepSeekBalanceInfo>,
    #[serde(default, rename = "is_available")]
    _is_available: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct MoonshotBalanceData {
    available_balance: f64,
    #[serde(default)]
    voucher_balance: Option<f64>,
    #[serde(default)]
    cash_balance: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct MoonshotBalanceResponse {
    data: MoonshotBalanceData,
}

#[derive(Debug, Deserialize)]
struct ZhipuBalanceData {
    #[serde(alias = "availableBalance")]
    available_balance: f64,
    #[serde(alias = "voucherBalance", default)]
    voucher_balance: Option<f64>,
    #[serde(alias = "cashBalance", default)]
    cash_balance: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ZhipuBalanceResponse {
data: ZhipuBalanceData,
}

#[derive(Debug, Default, Deserialize)]
struct MiniMaxBalanceData {
    #[serde(default)]
    #[serde(alias = "remain_count", alias = "remaining", alias = "available_balance")]
    available_balance: f64,
}

#[derive(Debug, Deserialize)]
struct MiniMaxBalanceResponse {
    #[serde(default)]
    data: Option<MiniMaxBalanceData>,
}

async fn check_deepseek_balance(cli: &reqwest::Client, base: &str, auth: &str) -> Result<UserBalance> {
    let resp = cli
        .get(format!("{}/user/balance", base))
        .header("Authorization", auth)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::LLMError("DeepSeek 余额查询失败，请检查 API Key。".into()));
    }
    let body: DeepSeekBalanceResponse = serde_json::from_str(&resp.text().await?)?;
    let available: f64 = body.balance_infos
        .iter()
        .filter_map(|i| i.total_balance.parse::<f64>().ok())
        .sum();
    Ok(UserBalance {
        available_balance: available,
        voucher_balance: None,
        cash_balance: None,
    })
}

async fn check_moonshot_balance(cli: &reqwest::Client, base: &str, auth: &str) -> Result<UserBalance> {
    let resp = cli
        .get(format!("{}/users/me/balance", base))
        .header("Authorization", auth)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::LLMError("Kimi 余额查询失败，请检查 API Key。".into()));
    }
    let body: MoonshotBalanceResponse = serde_json::from_str(&resp.text().await?)?;
    Ok(UserBalance {
        available_balance: body.data.available_balance,
        voucher_balance: body.data.voucher_balance,
        cash_balance: body.data.cash_balance,
    })
}

async fn check_zhipu_balance(cli: &reqwest::Client, api_key: &str) -> Result<UserBalance> {
    let resp = cli
        .get("https://www.bigmodel.cn/api/biz/account/query-customer-account-report")
        .header("Authorization", api_key)
        .header("Content-Type", "application/json")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(AppError::LLMError("智谱余额查询失败，请检查 API Key。".into()));
    }
    let text = resp.text().await?;
    tracing::info!("Zhipu balance response: {}", text);
    let body: ZhipuBalanceResponse = serde_json::from_str(&text)?;
    Ok(UserBalance {
        available_balance: body.data.available_balance,
        voucher_balance: body.data.voucher_balance,
        cash_balance: body.data.cash_balance,
    })
}

async fn check_minimax_balance(cli: &reqwest::Client, auth: &str) -> Result<UserBalance> {
    let resp = cli
        .get("https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains")
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .send()
        .await?;
            if !resp.status().is_success() {
                return Err(AppError::LLMError("MiniMax 余额查询失败，请检查 API Key。".into()));
            }
            let text = resp.text().await?;
            tracing::info!("MiniMax balance response: {}", text);
            let body: MiniMaxBalanceResponse = serde_json::from_str(&text)?;
            let d = body.data.unwrap_or_default();
            Ok(UserBalance {
                available_balance: d.available_balance,
                voucher_balance: None,
                cash_balance: None,
            })
        }

#[tauri::command]
async fn run_video_aggregate<R: Runtime>(
    window: Window<R>,
    params: VideoAggregateParams,
) -> Result<i32> {
    App::run_video_aggregate(window, &params).await
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
async fn get_course_syllabus(course_id: i64) -> Result<Course> {
    APP.get_course_syllabus(course_id).await
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
async fn list_network_logs() -> Vec<NetworkRequestLog> {
    APP.list_network_logs().await
}

#[tauri::command]
async fn clear_network_logs() {
    APP.clear_network_logs().await
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
async fn chat(prompt: String) -> Result<String> {
    APP.chat(prompt).await
}

#[tauri::command]
async fn canvas_agent_chat(
    messages: Vec<LLMChatMessage>,
    options: Option<canvas_agent::CanvasAgentOptions>,
) -> Result<String> {
    canvas_agent::chat(&messages, options).await
}

#[tauri::command]
async fn check_balance(base_url: String, api_key: String, provider: String) -> Result<UserBalance> {
    let cli = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let base = base_url.trim_end_matches('/');
    let auth = format!("Bearer {}", api_key);

    match provider.as_str() {
        "deepseek" => check_deepseek_balance(&cli, base, &auth).await,
        "moonshot" => check_moonshot_balance(&cli, base, &auth).await,
        "zhipu" => check_zhipu_balance(&cli, &api_key).await,
        "minimax" => check_minimax_balance(&cli, &auth).await,
        _ => Err(AppError::LLMError(format!(
            "Provider '{}' does not support balance query yet.",
            provider
        ))),
    }
}

#[tauri::command]
async fn explain_file(file: File) -> Result<String> {
    APP.explain_file(&file).await
}

#[tauri::command]
async fn chat_with_file(file: File, messages: Vec<LLMChatMessage>) -> Result<String> {
    APP.chat_with_file(&file, &messages).await
}

#[tauri::command]
async fn start_file_chat_stream(
    window: Window,
    request_id: String,
    file: File,
    messages: Vec<LLMChatMessage>,
) -> Result<()> {
    tauri::async_runtime::spawn(async move {
        let chunk_window = window.clone();
        let request_id_for_chunk = request_id.clone();
        let mut emit_chunk = move |chunk: String| {
            let _ = chunk_window.emit(
                "file_ai_chat://chunk",
                FileChatStreamChunkPayload {
                    request_id: request_id_for_chunk.clone(),
                    chunk,
                },
            );
        };

        let result = APP
            .chat_with_file_stream(&file, &messages, &mut emit_chunk)
            .await;

        match result {
            Ok(content) => {
                let _ = window.emit(
                    "file_ai_chat://done",
                    FileChatStreamDonePayload {
                        request_id,
                        content,
                    },
                );
            }
            Err(error) => {
                let _ = window.emit(
                    "file_ai_chat://error",
                    FileChatStreamErrorPayload {
                        request_id,
                        error: error.to_string(),
                    },
                );
            }
        }
    });
    Ok(())
}

#[tauri::command]
async fn start_subtitle_chat_stream(
    window: Window,
    request_id: String,
    canvas_course_id: i64,
    messages: Vec<LLMChatMessage>,
) -> Result<()> {
    tauri::async_runtime::spawn(async move {
        let chunk_window = window.clone();
        let request_id_for_chunk = request_id.clone();
        let mut emit_chunk = move |chunk: String| {
            let _ = chunk_window.emit(
                "video_ai_chat://chunk",
                FileChatStreamChunkPayload {
                    request_id: request_id_for_chunk.clone(),
                    chunk,
                },
            );
        };

        let result = APP
            .chat_with_subtitle_stream(canvas_course_id, &messages, &mut emit_chunk)
            .await;

        match result {
            Ok(content) => {
                let _ = window.emit(
                    "video_ai_chat://done",
                    FileChatStreamDonePayload {
                        request_id,
                        content,
                    },
                );
            }
            Err(error) => {
                let _ = window.emit(
                    "video_ai_chat://error",
                    FileChatStreamErrorPayload {
                        request_id,
                        error: error.to_string(),
                    },
                );
            }
        }
    });
    Ok(())
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
async fn delete_path_file(path: String) -> Result<()> {
    std::fs::remove_file(path)?;
    Ok(())
}

#[tauri::command]
async fn save_path_file(path: String, content: Vec<u8>) -> Result<()> {
    std::fs::write(path, content)?;
    Ok(())
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
async fn convert_docx_to_pdf(mut file: File) -> Result<Vec<u8>> {
    let content = APP.convert_docx_to_pdf(&mut file).await?;
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
async fn check_extra_login_status() -> Result<bool> {
    APP.check_extra_login_status().await
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
    let window = Arc::new(window);
    APP.download_video(&video, &save_name, move |progress| {
        let _ = window.clone().emit("video_download://progress", progress);
    })
    .await
}

#[tauri::command]
async fn download_subtitle(canvas_course_id: i64, save_path: String) -> Result<()> {
    APP.download_subtitle(canvas_course_id, &save_path).await
}

#[tauri::command]
async fn summarize_subtitle(canvas_course_id: i64) -> Result<String> {
    APP.summarize_subtitle(canvas_course_id).await
}

#[tauri::command]
async fn download_ppt<R: Runtime>(
    window: Window<R>,
    course_id: i64,
    save_path: String,
) -> Result<()> {
    let window = Arc::new(window);
    APP.download_ppt(course_id, &save_path, move |progress| {
        let _ = window.clone().emit("ppt_download://progress", progress);
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

#[tauri::command]
fn console_log(log_level: i32, message: String, context: String) {
    match log_level.into() {
        LogLevel::Debug => {
            tracing::debug!(
                target: "frontend_console",
                context = context,
                message = message
            )
        }
        LogLevel::Info => {
            tracing::info!(
                target: "frontend_console",
                context = context,
                message = message
            )
        }
        LogLevel::Warn => {
            tracing::warn!(
                target: "frontend_console",
                context = context,
                message = message
            )
        }
        LogLevel::Error => {
            tracing::error!(
                target: "frontend_console",
                context = context,
                message = message
            )
        }
    };
}

#[tauri::command]
async fn list_external_module_items(course_id: i64) -> Result<Vec<ModuleItem>> {
    APP.list_external_module_items(course_id).await
}

#[tauri::command]
async fn start_mcp_server() -> Result<bool> {
    APP.start_mcp().await
}

#[tauri::command]
async fn stop_mcp_server() {
    APP.stop_mcp().await
}

#[tokio::main]
async fn main() -> Result<()> {
    // set up logger
    let appender = tracing_appender::rolling::never(App::config_dir()?, "app.log");
    let subscriber = tracing_subscriber::registry()
        .with(
            fmt::Layer::new()
                .with_writer(std::io::stdout.with_max_level(Level::INFO))
                .pretty(),
        )
        .with(fmt::Layer::new().with_writer(
            appender.with_max_level(Level::INFO),
        ));
    tracing::subscriber::set_global_default(subscriber)
        .expect("Unable to set a tracing subscriber");
    tracing::info!("log setup, path: {:?}", config_dir());

    APP.init().await?;
    if APP.get_config().await.mcp_enabled {
        APP.start_mcp().await?;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            read_log_content,
            console_log,
            is_ffmpeg_installed,
            run_video_aggregate,
            collect_relationship,
            switch_account,
            create_account,
            delete_account,
            read_account_info,
            list_accounts,
            list_courses,
            get_course_syllabus,
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
            list_network_logs,
            clear_network_logs,
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
            delete_path_file,
            save_path_file,
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
            convert_docx_to_pdf,
            // Apis for course video
            get_uuid,
            express_login,
            get_subjects,
            get_canvas_videos,
            login_canvas_website,
            check_extra_login_status,
            get_video_course,
            get_video_info,
            get_canvas_video_info,
            download_video,
            login_video_website,
            prepare_proxy,
            stop_proxy,
            download_subtitle,
            download_ppt,
            list_external_module_items,
            // Apis for jbox
            login_jbox,
            upload_file,
            // Annual Report
            generate_annual_report,
            // LLM
            chat,
            canvas_agent_chat,
            check_balance,
            explain_file,
            chat_with_file,
            start_file_chat_stream,
            start_subtitle_chat_stream,
            summarize_subtitle,
            // MCP server
            start_mcp_server,
            stop_mcp_server
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                tracing::info!("App exiting, cleaning up MCP server");
                let handle = std::thread::spawn(|| {
                    let rt = tokio::runtime::Runtime::new().unwrap();
                    rt.block_on(async {
                        APP.stop_mcp().await;
                        APP.stop_proxy().await;
                    });
                });
                let _ = handle.join();
            }
        });
    Ok(())
}
