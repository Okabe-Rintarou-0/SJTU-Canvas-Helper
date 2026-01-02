#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process;

use dirs::config_dir;
use error::{AppError, Result};
use futures::StreamExt;
use reqwest::StatusCode;
use rust_xlsxwriter::Workbook;
use std::convert::Infallible;
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tauri::{Emitter, Runtime, Window};
use tokio::{io::AsyncReadExt, process::Command as TokioCommand};
use tokio::{sync::RwLock, task::JoinSet};
use uuid::Uuid;
use warp::filters::query::raw as query_raw;
use warp::{hyper::Response, Filter};

use crate::{
    client::{
        constants::{BASE_URL, JI_BASE_URL},
        Client,
    },
    error,
    model::*,
    utils::{self, file::TempFile},
};

use super::{
    constants::{COURSES_CACHE_KEY, RELATIONSHIP_CACHE_KEY},
    App,
};

const MY_CANVAS_FILES_FOLDER_NAME: &str = "我的Canvas文件";

impl App {
    fn ensure_directory(dir: &str) {
        let metadata = fs::metadata(dir);
        tracing::info!("dir: {:?}", dir);
        if metadata.is_err() {
            _ = fs::create_dir_all(dir);
        }
    }

    fn portable() -> bool {
        let exe_dir = std::env::current_exe()
            .map(|path| path.parent().unwrap().to_owned())
            .ok();

        if let Some(dir) = exe_dir {
            let portable_file = dir.join(".config/PORTABLE");
            portable_file.exists()
        } else {
            false
        }
    }

    pub fn config_dir() -> Result<String> {
        if App::portable() {
            let exe_dir = std::env::current_exe()
                .map(|path| path.parent().unwrap().to_owned())
                .ok()
                .unwrap();
            let config_dir = exe_dir.join(".config");
            Ok(config_dir.to_str().unwrap().to_owned())
        } else {
            let config_dir = config_dir().unwrap().join("SJTU-Canvas-Helper");
            Ok(config_dir.to_str().unwrap().to_owned())
        }
    }

    fn save_account_info(account: &AccountInfo) -> Result<()> {
        let config_dir = App::config_dir()?;
        let account_path = format!("{}/{}", config_dir, "account.json");
        let content = serde_json::to_vec(account)?;
        fs::write(account_path, content)?;
        Ok(())
    }

    pub fn read_account_info() -> Result<AccountInfo> {
        let config_dir = App::config_dir()?;
        let account_path = format!("{}/{}", config_dir, "account.json");
        fs::metadata(&account_path)?;
        let content = fs::read(&account_path)?;
        utils::json::parse_json(&content)
    }

    pub fn account_exists(account: &Account) -> Result<bool> {
        let config_path = App::get_config_path(account);
        let exists = fs::metadata(config_path).is_ok();
        Ok(exists)
    }

    pub fn create_account(account: &Account) -> Result<()> {
        if *account == Account::Default {
            return Err(AppError::NotAllowedToCreateDefaultAccount);
        }
        if App::account_exists(account)? {
            return Err(AppError::AccountAlreadyExists);
        }
        let config = AppConfig::default();
        let config_path = App::get_config_path(account);
        let content = serde_json::to_vec(&config)?;
        fs::write(config_path, content)?;

        let mut account_info = App::read_account_info()?;
        account_info.all_accounts.push(account.clone());
        App::save_account_info(&account_info)?;
        Ok(())
    }

    pub fn list_accounts() -> Result<Vec<Account>> {
        let account_info = App::read_account_info()?;
        Ok(account_info.all_accounts)
    }

    pub async fn delete_account(&self, account: &Account) -> Result<()> {
        if *account == Account::Default {
            return Err(AppError::NotAllowedToDeleteDefaultAccount);
        }
        if !App::account_exists(account)? {
            return Err(AppError::AccountNotExists);
        }

        let config_path = App::get_config_path(account);
        fs::remove_file(&config_path)?;

        let current_account = self.current_account.read().await.clone();
        // if delete current account, then switch to default
        if *account == current_account {
            self.switch_account(&Default::default()).await?;
        }
        let mut account_info = App::read_account_info()?;
        for i in 0..account_info.all_accounts.len() {
            if account_info.all_accounts[i] == *account {
                account_info.all_accounts.remove(i);
                break;
            }
        }
        App::save_account_info(&account_info)?;
        Ok(())
    }

    fn invalidate_cache(&self) -> Result<()> {
        self.cache.clear()?;
        Ok(())
    }

    pub async fn switch_account(&self, account: &Account) -> Result<()> {
        if !App::account_exists(account)? {
            return Err(AppError::AccountNotExists);
        }
        let config_path = App::get_config_path(account);
        let config = App::read_config_from_file(&config_path)?;
        let base_url = Self::get_base_url(&config.account_type);
        self.client.set_base_url(base_url).await;
        *self.config.write().await = config;

        let mut account_info = App::read_account_info()?;
        account_info.current_account = account.clone();
        App::save_account_info(&account_info)?;
        *self.current_account.write().await = account.clone();
        self.invalidate_cache()?;
        Ok(())
    }

    fn get_base_url(tp: &AccountType) -> &'static str {
        if *tp == AccountType::JI {
            JI_BASE_URL
        } else {
            BASE_URL
        }
    }

    pub fn new() -> Self {
        let config_dir = App::config_dir().unwrap();
        App::ensure_directory(&config_dir);
        let account_info = match App::read_account_info() {
            Ok(account) => account,
            Err(_) => {
                let account = Default::default();
                App::save_account_info(&account).unwrap();
                account
            }
        };
        tracing::info!("Read current account: {:?}", account_info);
        let config_path = App::get_config_path(&account_info.current_account);
        tracing::info!("Read config path: {}", config_path);
        let config = App::read_config_from_file(&config_path).unwrap_or_default();

        let base_url = Self::get_base_url(&config.account_type);
        let client = Client::new(base_url, &config.llm_api_key);

        Self {
            client: Arc::new(client),
            current_account: RwLock::new(account_info.current_account),
            config: RwLock::new(config),
            handle: Default::default(),
            cache: Default::default(),
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
        let url = format!("http://localhost:{proxy_port}/ready");
        let timeout_cnt = 10;
        let mut cnt = 0;
        loop {
            let response = reqwest::get(&url).await?;
            if response.status() == 200 {
                tracing::info!("Proxy ready check success");
                break Ok(true);
            }
            cnt += 1;
            if cnt >= timeout_cnt {
                tracing::info!("Proxy ready check timeout");
                break Ok(false);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    pub async fn prepare_proxy(&self) -> Result<bool> {
        if self.handle.read().await.is_some() {
            return Ok(true);
        }
        let proxy_port = self.config.read().await.proxy_port;

        // Proxy Endpoint: /vod/*
        let proxy = warp::get()
            .and(warp::path("vod").and(warp::path::tail()))
            .and(query_raw().or(warp::any().map(|| "".to_string())).unify())
            .and(warp::header::headers_cloned())
            .and_then(
                |tail: warp::path::Tail, query: String, headers: warp::http::HeaderMap| async move {
                    let range_value = headers
                        .get("Range")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_string();

                    let mut url = format!("https://live.sjtu.edu.cn/vod/{}", tail.as_str());
                    if !query.is_empty() {
                        url.push('?');
                        url.push_str(&query);
                    }

                    let client = reqwest::Client::new();
                    let mut req = client
                        .get(&url)
                        .header("Referer", "https://courses.sjtu.edu.cn"); // 你原本的Referer
                    if !range_value.is_empty() {
                        req = req.header("Range", range_value.clone());
                    }
                    tracing::info!("req: {:?}", req);
                    let resp = req.send().await;

                    match resp {
                        Ok(resp) => {
                            tracing::info!("resp: {:?}", resp);
                            let status = resp.status();
                            let mut builder = Response::builder().status(status);
                            for (k, v) in resp.headers() {
                                builder = builder.header(k, v);
                            }
                            let stream = resp
                                .bytes_stream()
                                .map(|chunk| chunk.map_err(std::io::Error::other));
                            let body = warp::hyper::Body::wrap_stream(stream);
                            Ok::<warp::http::Response<warp::hyper::Body>, Infallible>(
                                builder.body(body).unwrap(),
                            )
                        }
                        Err(e) => Ok(Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .body(format!("Error downloading video: {e}").into())
                            .unwrap()),
                    }
                },
            );
        // Ready Check Endpoint: /ready
        let ready_check = warp::path!("ready").map(|| Response::builder().body(""));

        let handle =
            tokio::spawn(warp::serve(proxy.or(ready_check)).run(([127, 0, 0, 1], proxy_port)));
        *self.handle.write().await = Some(handle);

        self.wait_proxy_ready(proxy_port).await
    }

    pub async fn stop_proxy(&self) {
        let mut handle = self.handle.write().await;
        if let Some(handle) = handle.as_ref() {
            tracing::info!("stop proxy");
            handle.abort();
        }
        *handle = None;
    }

    fn read_config_from_file(config_path: &str) -> Result<AppConfig> {
        let content = fs::read(config_path)?;
        let config = utils::json::parse_json(&content)?;
        Ok(config)
    }

    fn get_config_path(account: &Account) -> String {
        let config_dir = App::config_dir().unwrap();
        let mut config_file_name = "sjtu_canvas_helper_config".to_owned();
        if let Account::Custom(name) = account {
            config_file_name += &format!("_{name}");
        }
        let config_path = format!("{config_dir}/{config_file_name}.json");
        config_path
    }

    pub async fn get_config(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    pub async fn get_raw_config(&self) -> Result<String> {
        let account = self.current_account.read().await.clone();
        let config_path = App::get_config_path(&account);
        let content = fs::read_to_string(config_path)?;
        Ok(content)
    }

    pub async fn list_courses(&self) -> Result<Vec<Course>> {
        if let Some(cached_courses) = self.cache.get(COURSES_CACHE_KEY)? {
            return Ok(cached_courses);
        }
        let courses = self
            .client
            .list_courses(&self.config.read().await.token)
            .await?;
        self.cache.set(COURSES_CACHE_KEY, courses.clone())?;
        Ok(courses)
    }

    pub async fn list_user_submissions(
        &self,
        course_id: i64,
        student_ids: &[i64],
    ) -> Result<Vec<UserSubmissions>> {
        let token = self.config.read().await.token.clone();
        let user_submissions = self
            .client
            .clone()
            .list_user_submissions(course_id, student_ids, &token)
            .await?;
        Ok(user_submissions)
    }

    pub async fn get_single_course_assignment_submission(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
    ) -> Result<Submission> {
        self.client
            .get_single_course_assignment_submission(
                course_id,
                assignment_id,
                student_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn list_course_assignment_submissions(
        &self,
        course_id: i64,
        assignment_id: i64,
    ) -> Result<Vec<Submission>> {
        self.client
            .list_course_assignment_submissions(
                course_id,
                assignment_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn list_external_module_items(&self, course_id: i64) -> Result<Vec<ModuleItem>> {
        let token = self.config.read().await.token.clone();
        let modules = self.client.list_modules(course_id, &token).await?;
        let mut ret = vec![];
        for module in modules {
            let items = self
                .client
                .list_module_items(course_id, module.id, &token)
                .await?;
            for item in items {
                if item.type_ == ModuleItemType::ExternalUrl {
                    ret.push(item);
                }
            }
        }
        Ok(ret)
    }

    pub async fn update_grade(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        grade: &str,
        comment: Option<&str>,
    ) -> Result<()> {
        self.client
            .update_grade(
                course_id,
                assignment_id,
                student_id,
                grade,
                comment,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn delete_submission_comment(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: &str,
        comment_id: i64,
    ) -> Result<()> {
        self.client
            .delete_submission_comment(
                course_id,
                assignment_id,
                student_id,
                comment_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn modify_assignment_ddl(
        &self,
        course_id: i64,
        assignment_id: i64,
        due_at: Option<&str>,
        lock_at: Option<&str>,
    ) -> Result<()> {
        self.client
            .modify_assignment_ddl(
                course_id,
                assignment_id,
                due_at,
                lock_at,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn modify_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        override_id: i64,
        due_at: Option<&str>,
        lock_at: Option<&str>,
    ) -> Result<()> {
        self.client
            .modify_assignment_ddl_override(
                course_id,
                assignment_id,
                override_id,
                due_at,
                lock_at,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn delete_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        override_id: i64,
    ) -> Result<()> {
        self.client
            .delete_assignment_ddl_override(
                course_id,
                assignment_id,
                override_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn add_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        title: &str,
        due_at: Option<&str>,
        lock_at: Option<&str>,
    ) -> Result<()> {
        self.client
            .add_assignment_ddl_override(
                course_id,
                assignment_id,
                student_id,
                title,
                due_at,
                lock_at,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn test_token(&self, token: &str) -> Result<User> {
        self.client.get_me(token).await
    }

    pub async fn get_me(&self) -> Result<User> {
        self.client.get_me(&self.config.read().await.token).await
    }

    pub async fn list_discussion_topics(&self, course_id: i64) -> Result<Vec<DiscussionTopic>> {
        let token = self.config.read().await.token.clone();
        self.client.list_discussion_topics(course_id, &token).await
    }

    pub async fn get_full_discussion(
        &self,
        course_id: i64,
        topic_id: i64,
    ) -> Result<FullDiscussion> {
        let token = self.config.read().await.token.clone();
        self.client
            .get_full_discussion(course_id, topic_id, &token)
            .await
    }

    pub async fn list_course_files(&self, course_id: i64) -> Result<Vec<File>> {
        let token = self.config.read().await.token.clone();
        self.client.list_course_files(course_id, &token).await
    }

    pub async fn list_course_images(&self, course_id: i64) -> Result<Vec<File>> {
        let token = self.config.read().await.token.clone();
        self.client.list_course_images(course_id, &token).await
    }

    async fn filter_course_qrcode_images_inner(
        file: File,
        save_dir: String,
    ) -> Result<QRCodeScanResult> {
        let mut scan_result = QRCodeScanResult {
            file: file.clone(),
            contents: vec![],
        };
        let supported_formats = ["jpg", "jpeg", "png"];
        let ext = file.display_name.split('.').next_back().unwrap_or_default();
        if !supported_formats.contains(&ext) {
            return Ok(scan_result);
        }
        let content = Client::get_file_content(&file).await?;
        let mut tmp_file = TempFile::with_extension(&save_dir, ext)?;
        tmp_file.write_all(&content)?;

        let tmp_path = tmp_file.path();
        let img = image::open(tmp_path)?;
        let decoder = bardecoder::default_decoder();

        let results = decoder.decode(&img);
        for content in results.into_iter().flatten() {
            scan_result.contents.push(content);
        }
        Ok(scan_result)
    }

    pub async fn filter_course_qrcode_images(
        &self,
        course_id: i64,
    ) -> Result<Vec<QRCodeScanResult>> {
        let images = self.list_course_images(course_id).await?;
        let mut tasks = JoinSet::new();
        let mut results = vec![];
        let save_dir = self.config.read().await.save_path.clone();
        for image in images.into_iter() {
            tasks.spawn(Self::filter_course_qrcode_images_inner(
                image,
                save_dir.clone(),
            ));
        }
        while let Some(res) = tasks.join_next().await {
            let result = res?;
            match result {
                Ok(scan_result) => {
                    if !scan_result.contents.is_empty() {
                        results.push(scan_result);
                    }
                }
                Err(err) => tracing::error!("{:?}", err),
            }
        }
        Ok(results)
    }

    pub async fn list_course_users(&self, course_id: i64) -> Result<Vec<User>> {
        self.client
            .list_course_users(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_course_students(&self, course_id: i64) -> Result<Vec<User>> {
        self.client
            .list_course_students(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_course_assignments(&self, course_id: i64) -> Result<Vec<Assignment>> {
        self.client
            .list_course_assignments(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn get_my_single_submission(
        &self,
        course_id: i64,
        assignment_id: i64,
    ) -> Result<Submission> {
        self.client
            .get_my_single_submission(course_id, assignment_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_folder_files(&self, folder_id: i64) -> Result<Vec<File>> {
        self.client
            .list_folder_files(folder_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_course_folders(&self, course_id: i64) -> Result<Vec<Folder>> {
        self.client
            .list_course_folders(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_my_folders(&self) -> Result<Vec<Folder>> {
        self.client
            .list_my_folders(&self.config.read().await.token)
            .await
    }

    pub async fn list_folder_folders(&self, folder_id: i64) -> Result<Vec<Folder>> {
        self.client
            .list_folder_folders(folder_id, &self.config.read().await.token)
            .await
    }

    pub async fn save_file_content(&self, content: &[u8], file_name: &str) -> Result<()> {
        let save_dir = self.config.read().await.save_path.clone();
        let path = Path::new(&save_dir).join(file_name);
        // create file if path not exists, else open it in append mode
        let mut file = match fs::metadata(&path) {
            Ok(_) => fs::OpenOptions::new().append(true).open(&path)?,
            Err(_) => fs::File::create(&path)?,
        };
        file.write_all(content)?;
        Ok(())
    }

    pub async fn download_file<F: Fn(ProgressPayload) + Send>(
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

    pub async fn download_course_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        course: &Course,
        folder_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let guard = self.config.read().await;
        let token = &guard.token.clone();
        let course_identifier = self.get_course_identifier(course);
        let save_path = Path::new(&guard.save_path)
            .join(course_identifier)
            .join(folder_path);
        let save_path = save_path.to_str().unwrap_or_default();
        App::ensure_directory(save_path);
        tracing::info!("Download file at path: {:?}", save_path);
        self.client
            .download_file(file, token, save_path, progress_handler)
            .await?;
        Ok(())
    }

    pub async fn download_my_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        folder_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let guard = self.config.read().await;
        let token = &guard.token.clone();
        let save_path = Path::new(&guard.save_path)
            .join(MY_CANVAS_FILES_FOLDER_NAME)
            .join(folder_path);
        let save_path = save_path.to_str().unwrap_or_default();
        App::ensure_directory(save_path);
        tracing::info!("Download file at path: {:?}", save_path);
        self.client
            .download_file(file, token, save_path, progress_handler)
            .await?;
        Ok(())
    }

    fn get_course_identifier(&self, course: &Course) -> String {
        self.client.get_course_identifier(course)
    }

    pub async fn sync_course_files(&self, course: &Course) -> Result<Vec<File>> {
        let guard = self.config.read().await;
        let save_dir = guard.save_path.clone();
        let token = guard.token.clone();
        self.client
            .sync_course_files(course, &save_dir, &token)
            .await
    }

    pub async fn open_file(&self, name: &str) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path).join(name);
        self.open_path(path.to_str().unwrap_or_default())
    }

    pub async fn open_course_file(
        &self,
        name: &str,
        course: &Course,
        folder_path: &str,
    ) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path)
            .join(self.get_course_identifier(course))
            .join(folder_path)
            .join(name);
        self.open_path(path.to_str().unwrap_or_default())
    }

    pub async fn open_my_file(&self, name: &str, folder_path: &str) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path)
            .join(MY_CANVAS_FILES_FOLDER_NAME)
            .join(folder_path)
            .join(name);
        self.open_path(path.to_str().unwrap_or_default())
    }

    fn open_path(&self, path: &str) -> Result<()> {
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg(path).output()?;

        #[cfg(target_os = "linux")]
        let _ = std::process::Command::new("xdg-open").arg(path).output()?;

        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("explorer").arg(path).output()?;

        Ok(())
    }

    pub async fn open_save_dir(&self) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        self.open_path(save_path)
    }

    pub async fn open_config_dir(&self) -> Result<()> {
        let config_dir = App::config_dir()?;
        self.open_path(&config_dir)
    }

    pub async fn delete_file(&self, file: &File) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path).join(&file.display_name);
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn delete_course_file(
        &self,
        file: &File,
        course: &Course,
        folder_path: &str,
    ) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path)
            .join(self.get_course_identifier(course))
            .join(folder_path)
            .join(&file.display_name);
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn delete_my_file(&self, file: &File, folder_path: &str) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path)
            .join(MY_CANVAS_FILES_FOLDER_NAME)
            .join(folder_path)
            .join(&file.display_name);
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn delete_file_with_name(&self, name: &str) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = Path::new(save_path).join(name);
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn get_folder_by_id(&self, folder_id: i64) -> Result<Folder> {
        self.client
            .get_folder_by_id(folder_id, &self.config.read().await.token)
            .await
    }

    pub async fn get_colors(&self) -> Result<Colors> {
        self.client
            .get_colors(&self.config.read().await.token)
            .await
    }

    pub async fn list_calendar_events(
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

    pub async fn save_config(&self, config: AppConfig) -> Result<()> {
        let account = self.current_account.read().await.clone();
        let config_path = App::get_config_path(&account);
        fs::write(&config_path, serde_json::to_vec(&config).unwrap())?;
        let base_url = Self::get_base_url(&config.account_type);
        if self.client.set_base_url(base_url).await {
            self.invalidate_cache()?;
        }
        self.client.set_llm_api_key(&config.llm_api_key).await;
        *self.config.write().await = config;
        Ok(())
    }

    pub async fn chat<S: Into<String>>(&self, prompt: S) -> Result<String> {
        self.client.chat(prompt).await
    }

    pub async fn explain_file(&self, file: &File) -> Result<String> {
        self.client.explain_file(file).await
    }
    
    pub async fn summarize_subtitle(&self, canvas_course_id: i64) -> Result<String> {
        self.client.summarize_subtitle(canvas_course_id).await
    }

    pub fn check_path(path: &str) -> bool {
        let path = Path::new(path);
        if path.exists() {
            if let Ok(metadata) = fs::metadata(path) {
                return metadata.is_dir();
            }
        }
        false
    }

    pub async fn submit_assignment(
        &self,
        course_id: i64,
        assignment_id: i64,
        file_paths: &[String],
        comment: Option<&str>,
    ) -> Result<()> {
        let token = self.config.read().await.token.clone();
        self.client
            .submit_assignment(course_id, assignment_id, file_paths, comment, &token)
            .await?;
        Ok(())
    }

    pub async fn upload_submission_file(
        &self,
        course_id: i64,
        assignment_id: i64,
        file_path: &str,
        file_name: &str,
    ) -> Result<File> {
        let token = self.config.read().await.token.clone();
        let file = self
            .client
            .upload_submission_file(course_id, assignment_id, file_path, file_name, &token)
            .await?;
        Ok(file)
    }

    pub async fn collect_relationship(&self) -> Result<RelationshipTopo> {
        let topo = self.cache.get(RELATIONSHIP_CACHE_KEY)?;
        if let Some(topo) = topo {
            return Ok(topo);
        }
        let token = self.config.read().await.token.clone();
        let topo = self.client.clone().collect_relationship(&token).await?;
        self.cache.set(RELATIONSHIP_CACHE_KEY, topo.clone())?;
        Ok(topo)
    }

    pub async fn export_excel(
        &self,
        data: &[Vec<String>],
        file_name: &str,
        folder_path: &str,
    ) -> Result<()> {
        let path = Path::new(folder_path).join(file_name);
        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        for (row, row_data) in data.iter().enumerate() {
            for (col, col_data) in row_data.iter().enumerate() {
                sheet.write_string(row as u32, col as u16, col_data)?;
            }
        }
        workbook.save(path)?;
        Ok(())
    }

    pub async fn export_users(&self, users: &[User], save_name: &str) -> Result<()> {
        let save_path = self.config.read().await.save_path.clone();
        let path = Path::new(&save_path).join(save_name);

        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();

        // setup headers
        sheet.write_string(0, 0, "id")?;
        sheet.write_string(0, 1, "name")?;
        sheet.write_string(0, 2, "email")?;
        sheet.write_string(0, 3, "created_at")?;
        sheet.write_string(0, 4, "sortable_name")?;
        sheet.write_string(0, 5, "short_name")?;
        sheet.write_string(0, 6, "login_id")?;

        for (row, user) in users.iter().enumerate() {
            let row = row as u32 + 1;
            sheet.write_string(row, 0, user.id.to_string())?;
            sheet.write_string(row, 1, &user.name)?;
            sheet.write_string(row, 2, user.email.clone().unwrap_or_default())?;
            sheet.write_string(row, 3, &user.created_at)?;
            sheet.write_string(row, 4, &user.sortable_name)?;
            sheet.write_string(row, 5, &user.short_name)?;
            sheet.write_string(row, 6, &user.login_id)?;
        }
        workbook.save(path)?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn convert_pptx_to_pdf_inner(&self, pptx_path: &Path, pdf_path: &Path) -> Result<()> {
        // Reference https://github.com/jeongwhanchoi/convert-ppt-to-pdf
        process::Command::new("osascript")
            .arg("-e")
            .arg(
                r#"on run {input, output}
            tell application "Microsoft PowerPoint" -- work on version 15.15 or newer
                launch
                set t to input as string
                set pptx to input as POSIX file
                if t ends with ".ppt" or t ends with ".pptx" then
                    set pdfPath to output as POSIX file as string
                    open pptx
                    save active presentation in pdfPath as save as PDF -- save in same folder
                end if
            end tell
            tell application "Microsoft PowerPoint" -- work on version 15.15 or newer
                quit
            end tell
        end run"#,
            )
            .arg(pptx_path)
            .arg(pdf_path)
            .output()?;

        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn convert_docx_to_pdf_inner(&self, docx_path: &Path, pdf_path: &Path) -> Result<()> {
        process::Command::new("osascript")
            .arg("-e")
            .arg(
                r#"on run {input, output}
                    tell application "Microsoft Word"
                        launch
                        set t to input as string
                        set docx to input as POSIX file
                        if t ends with ".doc" or t ends with ".docx" then
                            set pdfPath to output as POSIX file as string
                            open docx
                            set activeDoc to active document
                            save as activeDoc file name pdfPath file format format PDF
                        end if
                    end tell
                    tell application "Microsoft Word"
                        quit
                    end tell
                end run"#,
            )
            .arg(docx_path.as_os_str().to_str().unwrap())
            .arg(pdf_path.as_os_str().to_str().unwrap())
            .output()?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn convert_docx_to_pdf_inner(&self, docx_path: &Path, pdf_path: &Path) -> Result<()> {
        match process::Command::new("powershell.exe")
            .arg("-Command")
            .arg(format!(r#"$word_app = New-Object -ComObject Word.Application; $document = $word_app.Documents.Open('{}'); $pdf_filename = '{}'; $opt= [Microsoft.Office.Interop.Word.WdSaveFormat]::wdFormatPDF; $document.SaveAs($pdf_filename, $opt); $document.Close(); $word_app.Quit();"#,
        docx_path.to_str().unwrap(), pdf_path.to_str().unwrap()))
            .output() {
            Ok(output) => {
                if !output.status.success() {
                    let error_msg = String::from_utf8_lossy(&output.stderr);
                    tracing::error!("docx to pdf conversion failed with status: {:?}, stderr: {}", output.status, error_msg);
                    return Err(AppError::FunctionUnsupported);
                }
            },
            Err(err) => {
                tracing::error!("Failed to execute powershell command for docx to pdf conversion: {:?}", err);
                return Err(err.into());
            }
        };
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn convert_docx_to_pdf_inner(&self, _: &Path, _: &Path) -> Result<()> {
        Err(AppError::FunctionUnsupported)
    }

    #[cfg(target_os = "windows")]
    fn convert_pptx_to_pdf_inner(&self, pptx_path: &Path, pdf_path: &Path) -> Result<()> {
        match process::Command::new("powershell.exe")
            .arg("-Command")
            .arg(format!(r#"$ppt_app = New-Object -ComObject PowerPoint.Application; $document = $ppt_app.Presentations.Open('{}'); $pdf_filename = '{}'; $opt= [Microsoft.Office.Interop.PowerPoint.PpSaveAsFileType]::ppSaveAsPDF; $document.SaveAs($pdf_filename, $opt); $document.Close(); $ppt_app.Quit();"#,
        pptx_path.to_str().unwrap(), pdf_path.to_str().unwrap()))
            .output() {
            Ok(output) => {
                if !output.status.success() {
                    let error_msg = String::from_utf8_lossy(&output.stderr);
                    tracing::error!("pptx to pdf conversion failed with status: {:?}, stderr: {}", output.status, error_msg);
                    return Err(AppError::FunctionUnsupported);
                }
            },
            Err(err) => {
                tracing::error!("Failed to execute powershell command for pptx to pdf conversion: {:?}", err);
                return Err(err.into());
            }
        };
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn convert_pptx_to_pdf_inner(&self, _: &Path, _: &Path) -> Result<()> {
        Err(AppError::FunctionUnsupported)
    }

    pub async fn convert_pptx_to_pdf(&self, file: &mut File) -> Result<Vec<u8>> {
        let config = self.config.read().await;
        let token = &config.token.clone();
        let save_dir = &config.save_path.clone();
        let out_file_name = file.display_name.replace("pptx", "pdf");
        let tmp_file_name = format!("tmp_{}.pptx", Uuid::new_v4());
        let pptx_path = Path::new(save_dir).join(&tmp_file_name);
        let pdf_path = Path::new(save_dir).join(&out_file_name);
        file.display_name = tmp_file_name;
        self.client
            .download_file(file, token, save_dir, |_| {})
            .await?;
        self.convert_pptx_to_pdf_inner(&pptx_path, &pdf_path)?;
        fs::remove_file(&pptx_path)?;
        let pdf_content = fs::read(&pdf_path)?;
        fs::remove_file(&pdf_path)?;
        Ok(pdf_content)
    }

    pub async fn convert_docx_to_pdf(&self, file: &mut File) -> Result<Vec<u8>> {
        let config = self.config.read().await;
        let token = &config.token.clone();
        let save_dir = &config.save_path.clone();
        let out_file_name = file.display_name.replace("docx", "pdf");
        let tmp_file_name = format!("tmp_{}.docx", Uuid::new_v4());
        let docx_path = Path::new(save_dir).join(&tmp_file_name);
        let pdf_path = Path::new(save_dir).join(&out_file_name);
        file.display_name = tmp_file_name;
        self.client
            .download_file(file, token, save_dir, |_| {})
            .await?;
        self.convert_docx_to_pdf_inner(&docx_path, &pdf_path)?;
        fs::remove_file(&docx_path)?;
        let pdf_content = fs::read(&pdf_path)?;
        fs::remove_file(&pdf_path)?;
        Ok(pdf_content)
    }

    pub fn is_ffmpeg_installed() -> bool {
        let output = Command::new("ffmpeg").arg("-version").output();
        match output {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }

    // return execute command, whether succeeded and exit code
    pub async fn run_video_aggregate<R: Runtime>(
        window: Window<R>,
        params: &VideoAggregateParams,
    ) -> Result<i32> {
        let scale_percentage = params.sub_video_size_percentage as f64 / 100.0;
        let scale_width = format!("iw*{scale_percentage}");
        let scale_height = format!("ih*{scale_percentage}");

        let alpha_value = params.sub_video_alpha as f64 / 100.0;
        let output_path = format!("{}/{}", params.output_dir, params.output_name);

        let mut command = TokioCommand::new("ffmpeg")
            .args([
                "-i",
                &params.main_video_path,
                "-i",
                &params.sub_video_path,
                "-filter_complex",
                &format!(
                    "[1:v]scale={scale_width}:{scale_height}[overlay];[0:v][overlay]overlay=W-w:H-h:format=auto:alpha={alpha_value}"
                ),
                "-c:a",
                "copy",
                &output_path,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // catch stdout
        let mut stdout = command.stdout.take().ok_or(AppError::OpenStdoutError)?;
        let mut stderr = command.stderr.take().ok_or(AppError::OpenStderrError)?;

        let command_str = format!(
            "ffmpeg -i \"{}\" -i \"{}\" -filter_complex \"[1:v]scale={}:{}[overlay];[0:v][overlay]overlay=W-w:H-h:format=auto:alpha={}\" -c:a copy \"{}\"",
            params.main_video_path,
            params.sub_video_path,
            scale_width,
            scale_height,
            alpha_value,
            output_path
        );
        let _ = window.emit("ffmpeg://output", command_str + "\n");
        let window_cloned = window.clone();

        tokio::spawn(async move {
            let mut buffer = [0; 128];
            while let Ok(bytes_read) = stdout.read(&mut buffer).await {
                if bytes_read == 0 {
                    break; // EOF
                }
                let output = String::from_utf8_lossy(&buffer[..bytes_read]);
                let _ = window.emit("ffmpeg://output", output.to_string());
            }
        });

        tokio::spawn(async move {
            let mut buffer = [0; 128];
            while let Ok(bytes_read) = stderr.read(&mut buffer).await {
                if bytes_read == 0 {
                    break; // EOF
                }
                let output = String::from_utf8_lossy(&buffer[..bytes_read]);
                let _ = window_cloned.emit("ffmpeg://output", output.to_string());
            }
        });

        let status = command.wait().await?;
        Ok(status.code().unwrap_or_default())
    }

    pub fn read_log_content() -> Result<String> {
        let log_file_path = App::config_dir()?;
        let path = Path::new(&log_file_path).join("app.log");
        let content = fs::read_to_string(path)?;
        Ok(content)
    }
}
