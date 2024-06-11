#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process;

use error::{AppError, Result};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::api::path::config_dir;
use tokio::{sync::RwLock, task::JoinSet};
use uuid::Uuid;
use warp::{hyper::Response, Filter};
use warp_reverse_proxy::reverse_proxy_filter;
use xlsxwriter::Workbook;

use crate::{
    client::{
        constants::{BASE_URL, JI_BASE_URL},
        Client,
    },
    error,
    model::*,
    utils::TempFile,
};

use super::App;

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

    fn config_dir() -> Result<String> {
        if App::portable() {
            let exe_dir = std::env::current_exe()
                .map(|path| path.parent().unwrap().to_owned())
                .ok()
                .unwrap();
            let config_dir = exe_dir.join(".config");
            return Ok(config_dir.to_str().unwrap().to_owned());
        } else {
            let config_dir = config_dir().unwrap().join("SJTU-Canvas-Helper");
            return Ok(config_dir.to_str().unwrap().to_owned());
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
        Ok(serde_json::from_slice(&content)?)
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

    async fn invalidate_cache(&self) {
        *self.cached_courses.write().await = None;
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
        self.invalidate_cache().await;
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
        let config = match App::read_config_from_file(&config_path) {
            Ok(config) => config,
            Err(_) => Default::default(),
        };

        let base_url = Self::get_base_url(&config.account_type);
        let client = Client::with_base_url(base_url);

        Self {
            client: Arc::new(client),
            current_account: RwLock::new(account_info.current_account),
            config: RwLock::new(config),
            handle: Default::default(),
            cached_courses: Default::default(),
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

    pub async fn prepare_proxy(&self) -> Result<bool> {
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
        let config = serde_json::from_slice(&content)?;
        Ok(config)
    }

    fn get_config_path(account: &Account) -> String {
        let config_dir = App::config_dir().unwrap();
        let mut config_file_name = "sjtu_canvas_helper_config".to_owned();
        if let Account::Custom(name) = account {
            config_file_name += &format!("_{}", name);
        }
        let config_path = format!("{}/{}.json", config_dir, config_file_name);
        config_path
    }

    pub async fn get_config(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    pub async fn list_courses(&self) -> Result<Vec<Course>> {
        if let Some(cached_courses) = self.cached_courses.read().await.clone() {
            return Ok(cached_courses);
        }
        let courses = self
            .client
            .list_courses(&self.config.read().await.token)
            .await?;
        *self.cached_courses.write().await = Some(courses.clone());
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
        let ext = file.display_name.split('.').last().unwrap_or_default();
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
        *self.config.write().await = config;
        Ok(())
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

    pub async fn export_excel(
        &self,
        data: &[Vec<String>],
        file_name: &str,
        folder_path: &str,
    ) -> Result<()> {
        let path = Path::new(folder_path).join(file_name);
        let workbook = Workbook::new(path.to_str().unwrap())?;
        let mut sheet = workbook.add_worksheet(None)?;
        for (row, row_data) in data.iter().enumerate() {
            for (col, col_data) in row_data.iter().enumerate() {
                sheet.write_string(row as u32, col as u16, col_data, None)?;
            }
        }
        workbook.close()?;
        Ok(())
    }

    pub async fn export_users(&self, users: &[User], save_name: &str) -> Result<()> {
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

    #[cfg(target_os = "macos")]
    fn convert_pptx_to_pdf_inner(&self, pptx_path: &PathBuf, pdf_path: &PathBuf) -> Result<()> {
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

    #[cfg(target_os = "windows")]
    fn convert_pptx_to_pdf_inner(&self, pptx_path: &PathBuf, pdf_path: &PathBuf) -> Result<()> {
        process::Command::new("powershell.exe")
            .arg("-Command")
            .arg(format!(r#"$ppt_app = New-Object -ComObject PowerPoint.Application; $document = $ppt_app.Presentations.Open("{}"); $pdf_filename = "{}"; $opt= [Microsoft.Office.Interop.PowerPoint.PpSaveAsFileType]::ppSaveAsPDF; $document.SaveAs($pdf_filename, $opt); $document.Close(); $ppt_app.Quit();"#,
        pptx_path.to_str().unwrap(), pdf_path.to_str().unwrap()))
            .output()?;
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn convert_pptx_to_pdf_inner(&self, pptx_path: &PathBuf, pdf_path: &PathBuf) -> Result<()> {
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
}
