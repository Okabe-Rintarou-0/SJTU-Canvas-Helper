use super::{
    common::{build_http_client, canvas_redirect_policy},
    constants::BASE_URL, file_parser, llm, Client,
};
use futures::{stream::FuturesUnordered, StreamExt};
use reqwest::{cookie, multipart};
use serde::de::DeserializeOwned;
use std::{cmp::min, collections::HashSet, fs, io::Write, ops::Deref, path::Path, sync::Arc};
use tokio::{sync::RwLock, task::JoinSet};

use crate::{
    client::constants::CHUNK_SIZE,
    error::{AppError, Result},
    model::{
        Assignment, CalendarEvent, Colors, Course, DiscussionTopic, File, Folder,
        FoldersAndFiles, FullDiscussion, Module, ModuleItem, ProgressPayload, RelationshipEdge,
        RelationshipNode, RelationshipNodeType, RelationshipTopo, Submission, SubmissionUploadResult,
        SubmissionUploadSuccessResponse, User, UserSubmissions,
    },
    utils::{self, file::{checked_download_path, get_file_name}},
};

// Apis here are for canvas
impl Client {
    #[allow(dead_code)]
    pub fn default() -> Self {
        Self::new(BASE_URL, "", "", "", None)
    }

    #[allow(dead_code)]
    pub fn new_without_proxy<S: Into<String>>(
        base_url: S,
        llm_api_key: S,
        llm_base_url: S,
        llm_model: S,
        llm_temperature: Option<f32>,
    ) -> Self {
        let jar = Arc::new(cookie::Jar::default());
        let cli = build_http_client(true, Some(jar.clone()), reqwest::redirect::Policy::default());
        let canvas_cli = build_http_client(true, Some(jar.clone()), canvas_redirect_policy());
        let download_cli = build_http_client(true, None, reqwest::redirect::Policy::none());
        let base_url = RwLock::new(base_url.into());
        let token = RwLock::new("".to_owned());
        let llm_cli = llm::chat::LlmRuntime::new(llm::chat::EffectiveLlmConfig::from_parts(
            llm_api_key.into(),
            llm_base_url.into(),
            llm_model.into(),
            llm_temperature,
        ))
        .unwrap();
        let file_parser = file_parser::new_generic_file_reader();
        Self {
            cli,
            canvas_cli,
            download_cli,
            jar,
            base_url,
            token,
            llm_cli,
            file_parser,
            debug_store: Arc::new(super::debug::NetworkDebugStore::new(false)),
        }
    }

    pub fn new<S: Into<String>>(
        base_url: S,
        llm_api_key: S,
        llm_base_url: S,
        llm_model: S,
        llm_temperature: Option<f32>,
    ) -> Self {
        Self::new_with_llm_config(
            base_url,
            llm::chat::EffectiveLlmConfig::from_parts(
                llm_api_key.into(),
                llm_base_url.into(),
                llm_model.into(),
                llm_temperature,
            ),
        )
    }

    pub fn new_with_llm_config<S: Into<String>>(
        base_url: S,
        llm_config: llm::chat::EffectiveLlmConfig,
    ) -> Self {
        let jar = Arc::new(cookie::Jar::default());
        let cli = build_http_client(false, Some(jar.clone()), reqwest::redirect::Policy::default());
        let canvas_cli = build_http_client(false, Some(jar.clone()), canvas_redirect_policy());
        let download_cli = build_http_client(false, None, reqwest::redirect::Policy::none());
        let base_url = RwLock::new(base_url.into());
        let token = RwLock::new("".to_owned());
        let llm_cli = llm::chat::LlmRuntime::new(llm_config).unwrap();
        let file_parser = file_parser::new_generic_file_reader();
        Self {
            cli,
            canvas_cli,
            download_cli,
            jar,
            base_url,
            token,
            llm_cli,
            file_parser,
            debug_store: Arc::new(super::debug::NetworkDebugStore::new(false)),
        }
    }

    /// Pin Canvas identity while sharing only the diagnostic sink.
    /// No live cookie Jar, video JWT or mutable origin is copied.
    pub(crate) fn canvas_read_snapshot(&self, base_url: &str) -> Self {
        let mut snapshot = Self::new_with_llm_config(
            base_url,
            crate::client::EffectiveLlmConfig::from_app_config(&crate::model::AppConfig::default()),
        );
        snapshot.debug_store = Arc::clone(&self.debug_store);
        snapshot
    }

    pub(crate) fn video_read_snapshot(&self, base_url: &str, cookies: &str) -> Result<Self> {
        let mut snapshot = self.canvas_read_snapshot(base_url);
        let scope = reqwest::Url::parse(super::constants::VIDEO_BASE_URL)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid fixed video origin"))?;
        snapshot.cli = super::media_auth::client_for_cookie_scope(cookies, scope)?;
        Ok(snapshot)
    }

    pub async fn reconfigure_llm(&self, config: llm::chat::EffectiveLlmConfig) -> Result<()> {
        self.llm_cli.reconfigure(config).await
    }

    pub async fn llm_snapshot(&self) -> Result<llm::chat::LlmSnapshot> {
        self.llm_cli.snapshot().await
    }

    pub async fn llm_state_snapshot(&self) -> Option<llm::chat::LlmSnapshot> {
        self.llm_cli.snapshot_state().await
    }

    pub async fn restore_llm_snapshot(&self, snapshot: Option<llm::chat::LlmSnapshot>) {
        self.llm_cli.restore_snapshot(snapshot).await;
    }

    pub fn set_debug_mode(&self, enabled: bool) {
        self.debug_store.set_enabled(enabled);
    }

    pub async fn list_network_logs(&self) -> Vec<crate::model::NetworkRequestLog> {
        self.debug_store.list_logs().await
    }

    pub async fn clear_network_logs(&self) {
        self.debug_store.clear_logs().await;
    }

    pub async fn set_base_url<S: Into<String>>(&self, base_url: S) -> bool {
        let base_url = base_url.into();
        tracing::info!("set_base_url: {:?}", &base_url);
        if *self.base_url.read().await != base_url {
            *self.base_url.write().await = base_url;
            return true;
        }
        false
    }

    pub async fn delete_submission_comment(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: &str,
        comment_id: i64,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/{}/comments/{}",
            self.base_url.read().await,
            course_id,
            assignment_id,
            student_id,
            comment_id
        );
        let request = self
            .canvas_request(reqwest::Method::DELETE, &url, token)
            .await?
            .build()?;
        self.execute_canvas_request(request).await?.error_for_status()?;
        Ok(())
    }

    pub async fn update_grade(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        grade: Option<&str>,
        comment: Option<&str>,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/{}",
            self.base_url.read().await,
            course_id,
            assignment_id,
            student_id,
        );
        let mut form: Vec<(String, String)> = Vec::new();
        if let Some(grade) = grade {
            form.push(("submission[posted_grade]".to_owned(), grade.to_owned()));
        }
        if let Some(comment) = comment {
            form.push(("comment[text_comment]".to_owned(), comment.to_owned()));
        }
        self.put_form_with_token(&url, None::<&str>, &form, token)
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn modify_assignment_ddl(
        &self,
        course_id: i64,
        assignment_id: i64,
        due_at: Option<&str>,
        lock_at: Option<&str>,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}",
            self.base_url.read().await,
            course_id,
            assignment_id
        );
        self.put_form_with_token(
            &url,
            None::<&str>,
            &[
                ("assignment[due_at]", due_at.unwrap_or_default()),
                ("assignment[lock_at]", lock_at.unwrap_or_default()),
            ],
            token,
        )
        .await?
        .error_for_status()?;
        Ok(())
    }

    pub async fn list_modules(&self, course_id: i64, token: &str) -> Result<Vec<Module>> {
        let url = format!(
            "{}/api/v1/courses/{course_id}/modules",
            self.base_url.read().await
        );
        self.list_items(&url, token).await
    }

    pub async fn list_module_items(
        &self,
        course_id: i64,
        module_id: i64,
        token: &str,
    ) -> Result<Vec<ModuleItem>> {
        let url = format!(
            "{}/api/v1/courses/{course_id}/modules/{module_id}/items",
            self.base_url.read().await
        );
        self.list_items(&url, token).await
    }

    pub async fn modify_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        override_id: i64,
        due_at: Option<&str>,
        lock_at: Option<&str>,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/overrides/{}",
            self.base_url.read().await,
            course_id,
            assignment_id,
            override_id
        );
        self.put_form_with_token(
            &url,
            None::<&str>,
            &[
                ("assignment_override[due_at]", due_at.unwrap_or_default()),
                ("assignment_override[lock_at]", lock_at.unwrap_or_default()),
            ],
            token,
        )
        .await?
        .error_for_status()?;
        Ok(())
    }

    pub async fn delete_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        override_id: i64,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/overrides/{}",
            self.base_url.read().await,
            course_id,
            assignment_id,
            override_id
        );
        let request = self
            .canvas_request(reqwest::Method::DELETE, &url, token)
            .await?
            .build()?;
        self.execute_canvas_request(request).await?.error_for_status()?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn add_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        title: &str,
        due_at: Option<&str>,
        lock_at: Option<&str>,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/overrides",
            self.base_url.read().await,
            course_id,
            assignment_id
        );
        self.post_form_with_token(
            &url,
            None::<&str>,
            &[
                (
                    "assignment_override[student_ids][]",
                    student_id.to_string().deref(),
                ),
                ("assignment_override[title]", title),
                ("assignment_override[due_at]", due_at.unwrap_or_default()),
                ("assignment_override[lock_at]", lock_at.unwrap_or_default()),
            ],
            token,
        )
        .await?
        .error_for_status()?;
        Ok(())
    }

    pub async fn download_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        token: &str,
        save_path: impl AsRef<Path> + Send,
        progress_handler: F,
    ) -> Result<()> {
        let save_path = save_path.as_ref();
        let path = checked_download_path(save_path, None, "", &file.display_name)?;
        let mut response = self.download_response(&file.url, token).await?.error_for_status()?;
        let expected_size = file.expected_download_size();
        let total = expected_size.or_else(|| response.content_length()).unwrap_or(0);
        let mut payload = ProgressPayload { uuid: file.uuid.clone(), processed: 0, total };
        // Same-directory exclusive temporary creation preserves any previous file
        // on network/write failure or when this future is dropped.
        let mut temporary = tempfile::NamedTempFile::new_in(save_path)?;
        let mut last_chunk_no = 0;
        while let Some(chunk) = response.chunk().await? {
            let processed = payload.processed.checked_add(chunk.len() as u64).ok_or_else(||
                std::io::Error::new(std::io::ErrorKind::InvalidData, "Download size overflow"))?;
            if expected_size.is_some_and(|size| processed > size) {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Downloaded file exceeds expected size").into());
            }
            temporary.write_all(&chunk)?;
            payload.processed = processed;
            let chunk_no = processed / CHUNK_SIZE;
            if chunk_no != last_chunk_no && (total == 0 || processed < total) {
                last_chunk_no = chunk_no;
                progress_handler(payload.clone());
            }
        }
        if expected_size.is_some_and(|size| payload.processed != size) {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Downloaded file size does not match expected size").into());
        }
        temporary.as_file().sync_all()?;
        temporary.persist(&path).map_err(|error| error.error)?;
        payload.total = payload.processed;
        progress_handler(payload);
        tracing::info!("File download completed");
        Ok(())
    }

    pub async fn list_items_with_page<T: DeserializeOwned>(
        &self,
        url: &str,
        token: &str,
        page: u64,
    ) -> Result<Vec<T>> {
        let items = self
            .get_json_with_token(
                url,
                Some(&vec![
                    ("page", page.to_string()),
                    ("per_page", "100".to_owned()),
                ]),
                token,
            )
            .await?;
        Ok(items)
    }

    pub async fn list_items<T: DeserializeOwned>(&self, url: &str, token: &str) -> Result<Vec<T>> {
        let mut all_items = vec![];
        let mut page = 1;

        loop {
            let items = self.list_items_with_page(url, token, page).await?;
            if items.is_empty() {
                break;
            }
            page += 1;
            all_items.extend(items);
        }
        Ok(all_items)
    }

    pub async fn list_discussion_topics(
        &self,
        course_id: i64,
        token: &str,
    ) -> Result<Vec<DiscussionTopic>> {
        let url = format!(
            "{}/api/v1/courses/{}/discussion_topics",
            self.base_url.read().await,
            course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn get_full_discussion(
        &self,
        course_id: i64,
        topic_id: i64,
        token: &str,
    ) -> Result<FullDiscussion> {
        let url = format!(
            "{}/api/v1/courses/{}/discussion_topics/{}/view",
            self.base_url.read().await,
            course_id,
            topic_id
        );
        self.get_json_with_token(&url, None::<&str>, token).await
    }

    pub async fn list_course_files(&self, course_id: i64, token: &str) -> Result<Vec<File>> {
        let url = format!(
            "{}/api/v1/courses/{}/files",
            self.base_url.read().await,
            course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn get_file_preview_session_url(&self, file_id: i64, token: &str) -> Result<String> {
        #[derive(serde::Deserialize)]
        struct WebSessionResponse {
            session_url: String,
        }

        let base_url = self.base_url.read().await.trim_end_matches('/').to_owned();
        let file_url = format!("{base_url}/api/v1/files/{file_id}");
        let file: File = self
            .get_json_with_token(
                &file_url,
                Some(&[("include[]", "enhanced_preview_url")]),
                token,
            )
            .await?;
        let preview_url = file.preview_url.ok_or_else(|| {
            AppError::FilePreview("Canvas did not provide an enhanced preview URL".to_owned())
        })?;
        let absolute_preview_url = reqwest::Url::parse(&base_url)
            .and_then(|base| base.join(&preview_url))
            .map_err(|error| AppError::FilePreview(error.to_string()))?;

        let session_url = format!("{base_url}/login/session_token");
        let session: WebSessionResponse = self
            .get_json_with_token(
                &session_url,
                Some(&[("return_to", absolute_preview_url.as_str())]),
                token,
            )
            .await?;
        Ok(session.session_url)
    }

    pub async fn list_course_images(&self, course_id: i64, token: &str) -> Result<Vec<File>> {
        let url = format!(
            "{}/api/v1/courses/{}/files?content_types[]=image",
            self.base_url.read().await,
            course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_folder_files(&self, folder_id: i64, token: &str) -> Result<Vec<File>> {
        let url = format!(
            "{}/api/v1/folders/{}/files",
            self.base_url.read().await,
            folder_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_course_folders(&self, course_id: i64, token: &str) -> Result<Vec<Folder>> {
        let url = format!(
            "{}/api/v1/courses/{}/folders",
            self.base_url.read().await,
            course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_my_folders(&self, token: &str) -> Result<Vec<Folder>> {
        let url = format!("{}/api/v1/users/self/folders", self.base_url.read().await);
        self.list_items(&url, token).await
    }

    pub async fn list_folder_folders(&self, folder_id: i64, token: &str) -> Result<Vec<Folder>> {
        let url = format!(
            "{}/api/v1/folders/{}/folders",
            self.base_url.read().await,
            folder_id
        );
        self.list_items(&url, token).await
    }

    pub async fn get_folder_by_id(&self, folder_id: i64, token: &str) -> Result<Folder> {
        let url = format!(
            "{}/api/v1/folders/{}",
            self.base_url.read().await,
            folder_id
        );
        let folder = self.get_json_with_token(&url, None::<&str>, token).await?;
        Ok(folder)
    }

    async fn get_folders_and_files(&self, course_id: i64, token: &str) -> Result<FoldersAndFiles> {
        let folders = self.list_course_folders(course_id, token).await?;
        let files = self.list_course_files(course_id, token).await?;
        Ok(FoldersAndFiles::new(folders, files))
    }

    pub fn get_course_identifier(&self, course: &Course) -> String {
        match course.teachers.first() {
            Some(teacher) => format!("{}({} {})", course.name, course.term.name, teacher.display_name),
            None => format!("{}({} course-{})", course.name, course.term.name, course.id),
        }
    }

    pub async fn sync_course_files(
        &self,
        course: &Course,
        save_dir: &str,
        token: &str,
    ) -> Result<Vec<File>> {
        let folders_and_files = self.get_folders_and_files(course.id, token).await?;
        let folders_map = &folders_and_files.folders_map;
        tracing::info!(folder_count = folders_map.len(), "Prepared folder map");
        let course_identifier = self.get_course_identifier(course);
        let mut pending = Vec::new();
        for file in folders_and_files.files {
            let folder = folders_map.get(&file.folder_id);
            let folder_path = match folder {
                Some(folder) if folder.full_name == "course files" => "",
                Some(folder) => match folder.full_name.strip_prefix("course files/") {
                    Some(path) => path,
                    None => { pending.push(file); continue; }
                },
                None => "",
            };
            let path = match checked_download_path(Path::new(save_dir), Some(&course_identifier), folder_path, &file.display_name) {
                Ok(path) => path,
                // Keep per-file failures in the queue; the download entry rejects
                // the invalid path without blocking unrelated course files.
                Err(_) => { pending.push(file); continue; }
            };
            if folder.is_none() {
                pending.push(file);
                continue;
            }
            let complete = match fs::metadata(path) {
                Ok(metadata) => metadata.is_file() && file.expected_download_size().is_some_and(|size| metadata.len() == size),
                Err(_) => false,
            };
            if !complete { pending.push(file); }
        }
        Ok(pending)
    }

    pub async fn get_colors(&self, token: &str) -> Result<Colors> {
        let url = format!("{}/api/v1/users/self/colors", self.base_url.read().await);
        let colors = self.get_json_with_token(&url, None::<&str>, token).await?;
        Ok(colors)
    }

    pub async fn list_calendar_events_inner(
        &self,
        token: &str,
        context_codes: &[String],
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<CalendarEvent>> {
        let context_codes = context_codes
            .iter()
            .map(|context_code| format!("context_codes[]={context_code}"))
            .reduce(|c1, c2| format!("{c1}&{c2}"))
            .unwrap_or_default();
        let url = format!(
            "{}/api/v1/calendar_events?type=assignment&{}&start_date={}&end_date={}",
            self.base_url.read().await,
            context_codes,
            start_date,
            end_date
        );
        self.list_items(&url, token).await
    }

    pub async fn list_calendar_events(
        &self,
        token: &str,
        context_codes: &[String],
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<CalendarEvent>> {
        const BATCH_SIZE: usize = 10;
        let n_codes = context_codes.len();
        let n_batches = if n_codes.is_multiple_of(BATCH_SIZE) {
            n_codes / BATCH_SIZE
        } else {
            n_codes / BATCH_SIZE + 1
        };

        let mut start;
        let mut end;
        let mut all_events = vec![];
        for batch_idx in 0..n_batches {
            start = batch_idx * BATCH_SIZE;
            end = min(start + BATCH_SIZE, n_codes);
            let context_codes_batch = &context_codes[start..end];
            let events = self
                .list_calendar_events_inner(token, context_codes_batch, start_date, end_date)
                .await?;
            all_events.extend(events);
        }
        Ok(all_events)
    }

    pub async fn list_course_users(&self, course_id: i64, token: &str) -> Result<Vec<User>> {
        let url = format!(
            "{}/api/v1/courses/{}/users",
            self.base_url.read().await,
            course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn get_single_course_assignment_submission(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        token: &str,
    ) -> Result<Submission> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/{}?include[]=submission_comments",
            self.base_url.read().await,
            course_id,
            assignment_id,
            student_id,
        );
        let submission = self.get_json_with_token(&url, None::<&str>, token).await?;
        Ok(submission)
    }

    pub async fn list_course_assignment_submissions(
        &self,
        course_id: i64,
        assignment_id: i64,
        token: &str,
    ) -> Result<Vec<Submission>> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions?include[]=submission_comments",
            self.base_url.read().await,
            course_id,
            assignment_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_course_students(&self, course_id: i64, token: &str) -> Result<Vec<User>> {
        let url = format!(
            "{}/api/v1/courses/{}/users?enrollment_type[]=student",
            self.base_url.read().await,
            course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!(
            "{}/api/v1/courses?include[]=teachers&include[]=term",
            self.base_url.read().await,
        );
        let all_courses = self.list_items(&url, token).await?;
        let filtered_courses: Vec<Course> = all_courses
            .into_iter()
            .filter(|course: &Course| !course.is_access_restricted())
            .collect();
        Ok(filtered_courses)
    }

    pub async fn get_course_syllabus(&self, course_id: i64, token: &str) -> Result<Course> {
        let url = format!(
            "{}/api/v1/courses/{}?include[]=syllabus_body",
            self.base_url.read().await,
            course_id,
        );
        self.get_json_with_token(&url, None::<&str>, token).await
    }

    async fn get_user_submissions_url(&self, course_id: i64, student_ids: &[i64]) -> String {
        let mut url = format!(
            "{}/api/v1/courses/{}/students/submissions?grouped=true&per_page=50",
            self.base_url.read().await,
            course_id
        );
        for student_id in student_ids {
            url += &format!("&student_ids[]={student_id}");
        }
        url
    }

    async fn list_user_submissions_inner(
        &self,
        course_id: i64,
        partition_id: usize,
        student_ids: &[i64],
        token: &str,
    ) -> Result<(usize, Vec<UserSubmissions>)> {
        let url = self.get_user_submissions_url(course_id, student_ids).await;
        let user_submissions = self.get_json_with_token(&url, None::<&str>, token).await?;
        Ok((partition_id, user_submissions))
    }

    pub async fn list_user_submissions(
        self: Arc<Self>,
        course_id: i64,
        student_ids: &[i64],
        token: &str,
    ) -> Result<Vec<UserSubmissions>> {
        const STUDENT_PER_PARITION: usize = 50;
        let num_students = student_ids.len();
        let num_partitions = if num_students.is_multiple_of(STUDENT_PER_PARITION) {
            num_students / STUDENT_PER_PARITION
        } else {
            num_students / STUDENT_PER_PARITION + 1
        };

        let mut tasks = FuturesUnordered::new();
        let mut results = Vec::with_capacity(num_partitions);
        for i in 0..num_partitions {
            results.push(vec![]);
            let start = i * STUDENT_PER_PARITION;
            let end = if i == num_partitions - 1 {
                num_students
            } else {
                (i + 1) * STUDENT_PER_PARITION
            };

            let sub_student_ids = student_ids[start..end].to_vec();
            let cloned_token = token.to_owned();
            let cloned_self = self.clone();
            tasks.push(async move {
                cloned_self
                    .list_user_submissions_inner(course_id, i, &sub_student_ids, &cloned_token)
                    .await
            });
        }

        while let Some(res) = tasks.next().await {
            let res = res?;
            let partition_id = res.0;
            let partitioned_user_submissions = res.1;
            results[partition_id] = partitioned_user_submissions;
        }

        let mut user_submissions = vec![];
        for partitioned_user_submissions in results {
            user_submissions.extend(partitioned_user_submissions);
        }

        Ok(user_submissions)
    }

    pub async fn get_me(&self, token: &str) -> Result<User> {
        let url = format!("{}/api/v1/users/self", self.base_url.read().await);
        let me = self.get_json_with_token(&url, None::<&str>, token).await?;
        Ok(me)
    }

    pub async fn test_credential(&self, token: &str) -> Result<User> {
        // Use the same URL for dispatch and diagnostics if settings change during the request.
        let url = format!("{}/api/v1/users/self", self.base_url.read().await);
        let result = self.get_json_with_token(&url, None::<&str>, token).await;
        tracing::info!(
            operation = "credential_test",
            endpoint = %crate::diagnostics::sanitize_url(&url),
            success = result.is_ok(),
            "Credential test completed"
        );
        result
    }

    async fn upload_submission_file_with(
        &self,
        params: &SubmissionUploadSuccessResponse,
        file_path: &str,
    ) -> Result<File> {
        let upload_params = &params.upload_params;
        let file_fs = fs::read(file_path)?;
        let file = multipart::Part::bytes(file_fs).file_name("filename.filetype");
        let form = reqwest::multipart::Form::new()
            .text("x-amz-credential", upload_params.x_amz_credential.clone())
            .text("x-amz-algorithm", upload_params.x_amz_algorithm.clone())
            .text("x-amz-date", upload_params.x_amz_date.clone())
            .text("x-amz-signature", upload_params.x_amz_signature.clone())
            .text("Filename", upload_params.filename.clone())
            .text("key", upload_params.key.clone())
            .text("acl", upload_params.acl.clone())
            .text("Policy", upload_params.policy.clone())
            .text(
                "success_action_redirect",
                upload_params.success_action_redirect.clone(),
            )
            .text("content-type", upload_params.content_type.clone())
            .part("file", file);

        let resp = self
            .cli
            .post(&params.upload_url)
            .multipart(form)
            .send()
            .await?
            .error_for_status()?;

        let bytes = resp.bytes().await?;
        let file = utils::json::parse_json(&bytes)?;
        Ok(file)
    }

    async fn prepare_upload_submission_file(
        &self,
        course_id: i64,
        assignment_id: i64,
        file_path: &str,
        file_name: &str,
        token: &str,
    ) -> Result<SubmissionUploadSuccessResponse> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/self/files",
            self.base_url.read().await,
            course_id,
            assignment_id,
        );
        let metadata = fs::metadata(file_path)?;
        if !metadata.is_file() {
            let error_message = format!("{file_path} is not a valid file!");
            return Err(AppError::SubmissionUpload(error_message));
        }

        let form = [("name", file_name), ("size", &metadata.len().to_string())];
        let resp = self
            .post_form_with_token(&url, None::<&str>, &form, token)
            .await?;
        let bytes = resp.bytes().await?;
        let result = match utils::json::parse_json::<SubmissionUploadResult>(&bytes)? {
            SubmissionUploadResult::Success(success_response) => success_response,
            SubmissionUploadResult::Error(error_response) => {
                return Err(AppError::SubmissionUpload(error_response.message))
            }
        };
        Ok(result)
    }

    pub async fn submit_assignment(
        &self,
        course_id: i64,
        assignment_id: i64,
        file_paths: &[String],
        comment: Option<&str>,
        token: &str,
    ) -> Result<()> {
        let mut file_ids = vec![];
        for file_path in file_paths {
            let file_name = &get_file_name(file_path);
            let file = self
                .upload_submission_file(course_id, assignment_id, file_path, file_name, token)
                .await?;
            file_ids.push(file.id);
        }

        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions",
            self.base_url.read().await,
            course_id,
            assignment_id,
        );
        let mut form = vec![("submission[submission_type]", "online_upload".to_owned())];
        for file_id in file_ids {
            form.push(("submission[file_ids][]", file_id.to_string()));
        }
        if let Some(comment) = comment {
            form.push(("comment[text_comment]", comment.to_owned()));
        }
        self.post_form_with_token(&url, None::<&str>, &form, token)
            .await?;
        Ok(())
    }

    // Reference: https://canvas.instructure.com/doc/api/file.file_uploads.html
    pub async fn upload_submission_file(
        &self,
        course_id: i64,
        assignment_id: i64,
        file_path: &str,
        file_name: &str,
        token: &str,
    ) -> Result<File> {
        // Step 1: Telling Canvas about the file upload and getting a token
        let params = self
            .prepare_upload_submission_file(course_id, assignment_id, file_path, file_name, token)
            .await?;
        // Step 2: Upload the file data to the URL given in the previous response
        let file = self.upload_submission_file_with(&params, file_path).await?;
        Ok(file)
    }

    #[allow(dead_code)]
    pub async fn list_ta_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!(
            "{}/api/v1/courses?include[]=teachers&include[]=term&enrollment_type=ta",
            self.base_url.read().await,
        );
        self.list_items(&url, token).await
    }

    #[allow(dead_code)]
    pub async fn list_teacher_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!(
            "{}/api/v1/courses?include[]=teachers&include[]=term&enrollment_type=teacher",
            self.base_url.read().await,
        );
        self.list_items(&url, token).await
    }

    pub async fn get_my_single_submission(
        &self,
        course_id: i64,
        assignment_id: i64,
        token: &str,
    ) -> Result<Submission> {
        let url =
            format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/self?include[]=submission_comments",
            self.base_url.read().await, course_id, assignment_id,
        );
        let submission = self.get_json_with_token(&url, None::<&str>, token).await?;
        Ok(submission)
    }

    pub async fn list_course_assignments(
        &self,
        course_id: i64,
        token: &str,
    ) -> Result<Vec<Assignment>> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments?include[]=submission&include[]=overrides&include[]=all_dates&include[]=score_statistics",
            self.base_url.read().await, course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_current_term_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!(
            "{}/api/v1/courses?include[]=teachers&include[]=term&enrollment_state=active",
            self.base_url.read().await
        );
        self.list_items(&url, token).await
    }

    pub async fn collect_relationship(self: Arc<Self>, token: &str) -> Result<RelationshipTopo> {
        let courses = self.list_current_term_courses(token).await?;
        let mut user_set = HashSet::new();
        let mut nodes = vec![];
        let mut edges = vec![];
        let me = self.get_me(token).await?;
        let mut tasks = JoinSet::new();
        for course in courses.into_iter() {
            let self_cloned = self.clone();
            let token_cloned = token.to_string();
            tasks.spawn(async move {
                let course_users = self_cloned
                    .list_course_users(course.id, &token_cloned)
                    .await;
                (course, course_users)
            });
        }
        while let Some(res) = tasks.join_next().await {
            let res = res?;
            let course = res.0;
            let course_users = res.1?;
            nodes.push(RelationshipNode {
                id: course.id.to_string(),
                label: course.name,
                node_type: RelationshipNodeType::Course,
            });
            for user in course_users {
                let node_type = if user.id == me.id {
                    RelationshipNodeType::Me
                } else {
                    RelationshipNodeType::Default
                };
                if !user_set.contains(&user.id) {
                    user_set.insert(user.id);
                    nodes.push(RelationshipNode {
                        id: user.id.to_string(),
                        label: user.name,
                        node_type,
                    });
                }
                edges.push(RelationshipEdge {
                    source: course.id.to_string(),
                    target: user.id.to_string(),
                });
            }
        }
        let topo = RelationshipTopo { nodes, edges };
        Ok(topo)
    }
}

#[cfg(test)]
mod mock_tests {
    use super::super::Client;
    use httpmock::prelude::*;
    use serde_json::json;

    fn create_test_client(mock_server_url: &str) -> Client {
        Client::new_without_proxy(mock_server_url, "", "", "", None)
    }

    #[tokio::test]
    async fn test_credential_uses_current_endpoint_and_preserves_http_errors() {
        let first = MockServer::start();
        let second = MockServer::start();
        let user = crate::model::User {
            id: 7,
            ..Default::default()
        };
        let accepted = first.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/users/self")
                .header("Authorization", "Bearer supplied-credential");
            then.status(200)
                .json_body(serde_json::to_value(&user).unwrap());
        });
        let rejected = second.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/users/self")
                .header("Authorization", "Bearer supplied-credential");
            then.status(401);
        });
        let client = create_test_client(&first.base_url());
        assert_eq!(
            client.test_credential("supplied-credential").await.unwrap().id,
            7
        );
        client.set_base_url(second.base_url()).await;
        let error = client
            .test_credential("supplied-credential")
            .await
            .unwrap_err();
        assert!(matches!(error, crate::error::AppError::Network(error)
            if error.status() == Some(reqwest::StatusCode::UNAUTHORIZED)));
        accepted.assert();
        rejected.assert();
    }

    #[tokio::test]
    async fn test_get_file_preview_session_url_creates_web_session() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let file_id = 42i64;
        let preview_path = "/courses/7/files/42/file_preview?annotate&verifier=test-verifier";
        let return_to = format!("{}{}", server.base_url(), preview_path);
        let expected_session_url = format!("{}/opaque-preview-session", server.base_url());

        let file_mock = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/files/{file_id}"))
                .query_param("include[]", "enhanced_preview_url")
                .header("Authorization", format!("Bearer {token}"));
            then.status(200)
                .header("Content-Type", "application/json")
                .json_body(json!({
                    "id": file_id,
                    "uuid": "file-uuid",
                    "folder_id": 9,
                    "display_name": "slides.pptx",
                    "filename": "slides.pptx",
                    "url": format!("{}/files/{file_id}/download", server.base_url()),
                    "size": 1234,
                    "locked": false,
                    "mime_class": "ppt",
                    "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    "preview_url": preview_path
                }));
        });
        let session_mock = server.mock(|when, then| {
            when.method(GET)
                .path("/login/session_token")
                .query_param("return_to", return_to.as_str())
                .header("Authorization", format!("Bearer {token}"));
            then.status(200)
                .header("Content-Type", "application/json")
                .json_body(json!({ "session_url": expected_session_url }));
        });
        let client = create_test_client(&server.base_url());
        let session_url = client
            .get_file_preview_session_url(file_id, token)
            .await
            .unwrap();

        assert_eq!(session_url, expected_session_url);
        file_mock.assert();
        session_mock.assert();
    }

    #[tokio::test]
    async fn test_get_file_preview_session_url_requires_enhanced_preview() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let file_id = 42i64;

        let file_mock = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/files/{file_id}"))
                .query_param("include[]", "enhanced_preview_url");
            then.status(200)
                .header("Content-Type", "application/json")
                .json_body(json!({
                    "id": file_id,
                    "uuid": "file-uuid",
                    "folder_id": 9,
                    "display_name": "slides.pptx",
                    "filename": "slides.pptx",
                    "url": format!("{}/files/{file_id}/download", server.base_url()),
                    "size": 1234,
                    "locked": false,
                    "mime_class": "ppt",
                    "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                }));
        });

        let client = create_test_client(&server.base_url());
        let error = client
            .get_file_preview_session_url(file_id, token)
            .await
            .unwrap_err();

        assert!(error.to_string().contains("enhanced preview URL"));
        file_mock.assert();
    }

    #[tokio::test]
    async fn test_list_courses() {
        let server = MockServer::start();
        let token = "test_token_12345";

        let page1_mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/courses")
                .query_param("include[]", "teachers")
                .query_param("include[]", "term")
                .query_param("page", "1")
                .query_param("per_page", "100");
            then.status(200)
                .header("Content-Type", "application/json")
                .json_body(json!([
                    {
                        "id": 1,
                        "uuid": "course-uuid-1",
                        "name": "Mathematics 101",
                        "course_code": "MATH101",
                        "enrollments": [],
                        "teachers": [
                            {
                                "id": 10,
                                "anonymous_id": "anon-teacher-1",
                                "display_name": "Prof. Smith",
                                "avatar_image_url": "",
                                "html_url": ""
                            }
                        ],
                        "term": {
                            "id": 2024,
                            "name": "Fall 2024",
                            "start_at": "2024-09-01T00:00:00Z",
                            "end_at": null,
                            "created_at": "2024-06-01T00:00:00Z",
                            "workflow_state": "active"
                        },
                        "syllabus_body": ""
                    },
                    {
                        "id": 2,
                        "uuid": "course-uuid-2",
                        "name": "Restricted Course",
                        "course_code": "RESTRCT",
                        "enrollments": [],
                        "teachers": [
                            {
                                "id": 20,
                                "anonymous_id": "anon-teacher-2",
                                "display_name": "Prof. Jones",
                                "avatar_image_url": "",
                                "html_url": ""
                            }
                        ],
                        "term": {
                            "id": 2024,
                            "name": "Fall 2024",
                            "start_at": "2024-09-01T00:00:00Z",
                            "end_at": null,
                            "created_at": "2024-06-01T00:00:00Z",
                            "workflow_state": "active"
                        },
                        "syllabus_body": "",
                        "access_restricted_by_date": true
                    }
                ]));
        });

        let page2_mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/courses")
                .query_param("include[]", "teachers")
                .query_param("include[]", "term")
                .query_param("page", "2")
                .query_param("per_page", "100");
            then.status(200)
                .header("Content-Type", "application/json")
                .json_body(json!([]));
        });

        let client = create_test_client(&server.base_url());
        let courses = client.list_courses(token).await.unwrap();

        assert_eq!(courses.len(), 1);
        assert_eq!(courses[0].id, 1);
        assert_eq!(courses[0].name, "Mathematics 101");
        assert_eq!(courses[0].teachers[0].display_name, "Prof. Smith");

        page1_mock.assert();
        page2_mock.assert();
    }

    #[tokio::test]
    async fn test_get_course_syllabus() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let course_id = 42i64;

        let mock = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/courses/{course_id}"))
                .query_param("include[]", "syllabus_body");
            then.status(200)
                .header("Content-Type", "application/json")
                .json_body(json!({
                    "id": course_id,
                    "uuid": "course-uuid-syllabus",
                    "name": "Physics 201",
                    "course_code": "PHYS201",
                    "enrollments": [],
                    "teachers": [
                        {
                            "id": 30,
                            "anonymous_id": "anon-physics",
                            "display_name": "Dr. Einstein",
                            "avatar_image_url": "",
                            "html_url": ""
                        }
                    ],
                    "term": {
                        "id": 2024,
                        "name": "Fall 2024",
                        "start_at": "2024-09-01T00:00:00Z",
                        "end_at": null,
                        "created_at": "2024-06-01T00:00:00Z",
                        "workflow_state": "active"
                    },
                    "syllabus_body": "<p>Welcome to Physics 201! This course covers...</p>"
                }));
        });

        let client = create_test_client(&server.base_url());
        let course = client.get_course_syllabus(course_id, token).await.unwrap();

        assert_eq!(course.id, course_id);
        assert_eq!(course.name, "Physics 201");
        assert_eq!(course.syllabus_body, "<p>Welcome to Physics 201! This course covers...</p>");
        assert_eq!(course.teachers[0].display_name, "Dr. Einstein");

        mock.assert();
    }

    #[tokio::test]
    async fn test_get_course_syllabus_without_published_body() {
        for body in [
            json!({"id": 42, "syllabus_body": null}),
            json!({"id": 42}),
            json!({"id": 42, "syllabus_body": ""}),
        ] {
            let server = MockServer::start();
            let mock = server.mock(|when, then| {
                when.method(GET)
                    .path("/api/v1/courses/42")
                    .query_param("include[]", "syllabus_body");
                then.status(200).json_body(body.clone());
            });
            let course = create_test_client(&server.base_url())
                .get_course_syllabus(42, "test-token")
                .await
                .unwrap();
            assert_eq!(course.id, 42);
            assert!(course.syllabus_body.is_empty());
            mock.assert();
        }
    }

    #[tokio::test]
    async fn test_list_submissions_paginates_without_live_canvas() {
        let server = MockServer::start();
        let mut pages = Vec::new();
        for page in 1..=3 {
            pages.push(server.mock(|when, then| {
                when.method(GET)
                    .path("/api/v1/courses/7/assignments/8/submissions")
                    .header("Authorization", "Bearer test-token")
                    .query_param("include[]", "submission_comments")
                    .query_param("per_page", "100")
                    .query_param("page", page.to_string());
                let body = if page < 3 {
                    json!([{"id": page, "assignment_id": 8, "user_id": 10,
                        "late": false, "workflow_state": "submitted"}])
                } else { json!([]) };
                then.status(200).json_body(body);
            }));
        }
        let submissions = create_test_client(&server.base_url())
            .list_course_assignment_submissions(7, 8, "test-token").await.unwrap();
        assert_eq!(submissions.iter().map(|item| item.id).collect::<Vec<_>>(), vec![1, 2]);
        assert!(submissions.iter().all(|item| item.assignment_id == 8));
        for page in pages { page.assert_hits(1); }
    }

    #[tokio::test]
    async fn test_list_submissions_propagates_http_failure_without_live_canvas() {
        let server = MockServer::start();
        let denied = server.mock(|when, then| {
            when.method(GET).path("/api/v1/courses/7/assignments/8/submissions");
            then.status(401);
        });
        assert!(create_test_client(&server.base_url())
            .list_course_assignment_submissions(7, 8, "test-token").await.is_err());
        denied.assert_hits(1);
    }


    #[tokio::test]
    async fn test_update_grade_with_grade_and_comment() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let course_id = 1i64;
        let assignment_id = 10i64;
        let student_id = 100i64;

        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path(format!(
                    "/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions/{student_id}"
                ))
                .body_contains("submission%5Bposted_grade%5D=95")
                .body_contains("comment%5Btext_comment%5D=Good+job");
            then.status(200);
        });

        let client = create_test_client(&server.base_url());
        client
            .update_grade(course_id, assignment_id, student_id, Some("95"), Some("Good job"), token)
            .await
            .unwrap();

        mock.assert();
    }

    #[tokio::test]
    async fn test_update_grade_with_grade_only() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let course_id = 1i64;
        let assignment_id = 10i64;
        let student_id = 100i64;

        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path(format!(
                    "/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions/{student_id}"
                ))
                .body("submission%5Bposted_grade%5D=88.5");
            then.status(200);
        });

        let client = create_test_client(&server.base_url());
        client
            .update_grade(course_id, assignment_id, student_id, Some("88.5"), None, token)
            .await
            .unwrap();

        mock.assert();
    }

    #[tokio::test]
    async fn test_update_grade_with_comment_only() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let course_id = 1i64;
        let assignment_id = 10i64;
        let student_id = 100i64;

        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path(format!(
                    "/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions/{student_id}"
                ))
                .body("comment%5Btext_comment%5D=Great+work");
            then.status(200);
        });

        let client = create_test_client(&server.base_url());
        client
            .update_grade(course_id, assignment_id, student_id, None, Some("Great work"), token)
            .await
            .unwrap();

        mock.assert();
    }

    #[tokio::test]
    async fn test_update_grade_api_error() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let course_id = 1i64;
        let assignment_id = 10i64;
        let student_id = 100i64;

        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path(format!(
                    "/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions/{student_id}"
                ))
                .body_contains("submission%5Bposted_grade%5D=90");
            then.status(400)
                .json_body(json!({"errors": [{"message": "invalid args"}]}));
        });

        let client = create_test_client(&server.base_url());
        let result = client
            .update_grade(course_id, assignment_id, student_id, Some("90"), None, token)
            .await;

        assert!(result.is_err());
        mock.assert();
    }

    #[tokio::test]
    async fn test_update_grade_empty_body() {
        let server = MockServer::start();
        let token = "test_token_12345";
        let course_id = 1i64;
        let assignment_id = 10i64;
        let student_id = 100i64;

        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path(format!(
                    "/api/v1/courses/{course_id}/assignments/{assignment_id}/submissions/{student_id}"
                ))
                .body("")
                .header("Authorization", format!("Bearer {token}"));
            then.status(200);
        });

        let client = create_test_client(&server.base_url());
        client
            .update_grade(course_id, assignment_id, student_id, None, None, token)
            .await
            .unwrap();

        mock.assert();
    }
}

#[cfg(test)]
mod test {
    use crate::{
        client::Client,
        error::Result,
        model::{Course, EnrollmentRole},
    };
    use std::collections::HashMap;

    fn os_env_hashmap() -> HashMap<String, String> {
        let mut map = HashMap::new();
        use std::env;
        for (key, val) in env::vars_os() {
            // Use pattern bindings instead of testing .is_some() followed by .unwrap()
            if let (Ok(k), Ok(v)) = (key.into_string(), val.into_string()) {
                map.insert(k, v);
            }
        }
        map
    }

    fn get_token_from_env() -> String {
        let env_vars = os_env_hashmap();
        env_vars.get("CANVAS_TOKEN").cloned().unwrap_or_default()
    }

    fn check_rfc3339_time_format(time: &Option<String>) -> bool {
        if let Some(time) = time {
            chrono::DateTime::parse_from_rfc3339(time).is_ok()
        } else {
            true
        }
    }

    fn is_ta(course: &Course) -> bool {
        let filtered: Vec<_> = course
            .enrollments
            .iter()
            .filter(|enrollment| enrollment.role == EnrollmentRole::TaEnrollment)
            .collect();
        !filtered.is_empty()
    }

    #[ignore = "Live service: requires explicit credentials/network opt-in"]
    #[tokio::test]
    async fn test_get_me() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::default();
        let me = cli.get_me(&token).await?;
        assert!(me.id > 0);
        assert!(!me.name.is_empty());
        Ok(())
    }

    #[ignore = "Live service: requires explicit credentials/network opt-in"]
    #[tokio::test]
    async fn test_list_courses() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::default();

        let courses = cli.list_courses(&token).await?;
        assert!(!courses.is_empty());
        for course in courses {
            assert!(course.id > 0);
            assert!(course.term.id > 0);
            assert!(!course.teachers.is_empty());
            assert!(!course.uuid.is_empty());
            assert!(!course.enrollments.is_empty());
            assert!(check_rfc3339_time_format(&course.term.created_at));
            assert!(check_rfc3339_time_format(&course.term.start_at));
            assert!(check_rfc3339_time_format(&course.term.end_at));
        }
        Ok(())
    }

    #[ignore = "Live service: requires explicit credentials/network opt-in"]
    #[tokio::test]
    async fn test_list_assignments() -> Result<()> {
        tracing_subscriber::fmt::init();
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::default();
        let courses = cli.list_courses(&token).await?;
        for course in courses {
            let assignments = cli.list_course_assignments(course.id, &token).await?;
            for assignment in assignments {
                assert_eq!(assignment.course_id, course.id);
                assert!(assignment.id > 0);
                assert!(check_rfc3339_time_format(&assignment.due_at));
                assert!(check_rfc3339_time_format(&assignment.lock_at));
                for assignment_override in assignment.overrides {
                    assert!(check_rfc3339_time_format(&assignment_override.unlock_at));
                    assert!(check_rfc3339_time_format(&assignment_override.lock_at));
                    assert!(check_rfc3339_time_format(&assignment_override.due_at));
                    assert!(!assignment_override.student_ids.is_empty());
                }
            }
        }
        Ok(())
    }

    #[ignore = "Live service: requires explicit credentials/network opt-in"]
    #[tokio::test]
    async fn test_list_users() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::default();
        let courses = cli.list_courses(&token).await?;
        for course in courses {
            let term = &course.term;
            let Some(end_at) = &term.end_at else {
                continue;
            };
            let is_ta = is_ta(&course);
            let end_at = chrono::DateTime::parse_from_rfc3339(end_at);
            assert!(end_at.is_ok());
            let end_at = end_at.unwrap().naive_local();
            let now = chrono::offset::Local::now().naive_local();

            if now > end_at && !is_ta {
                assert!(cli.list_course_users(course.id, &token).await.is_err());
                continue;
            }
            let users = cli.list_course_users(course.id, &token).await?;

            assert!(!users.is_empty());

            for user in users {
                assert!(user.id > 0);
                assert!(!user.name.is_empty());
            }
        }
        Ok(())
    }

    #[ignore = "Live service: requires explicit credentials/network opt-in"]
    #[tokio::test]
    async fn test_list_submissions() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::default();
        let courses = cli.list_courses(&token).await?;
        for course in courses {
            let is_ta = is_ta(&course);
            if !is_ta {
                continue;
            }

            let assignments = cli.list_course_assignments(course.id, &token).await?;
            for assignment in assignments {
                let submissions = cli
                    .list_course_assignment_submissions(course.id, assignment.id, &token)
                    .await?;
                for submission in submissions {
                    assert_eq!(submission.assignment_id, assignment.id);
                    assert!(submission.id > 0);
                    assert!(check_rfc3339_time_format(&submission.submitted_at));
                }
            }
        }
        Ok(())
    }

    #[ignore = "Live service: requires explicit credentials/network opt-in"]
    #[tokio::test]
    async fn test_list_colors() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::default();
        cli.get_colors(&token).await?;
        Ok(())
    }
}

// Offline regression helpers use the real reqwest Jar and JWT lock, but only
// accept the loopback test endpoint supplied by app::session tests.
#[cfg(test)]
impl Client {
    pub(crate) async fn session_test_auth_response(&self, url: &str) -> Result<()> {
        let url = reqwest::Url::parse(url).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        // Do not let the test runner's proxy environment turn a loopback
        // fixture into an external request. The real session Jar is retained.
        let client = reqwest::Client::builder().no_proxy().cookie_provider(Arc::clone(&self.jar)).build()?;
        let token = client.get(url).send().await?.error_for_status()?.text().await?;
        *self.token.write().await = token;
        Ok(())
    }

    pub(crate) async fn session_test_state(&self, url: &str) -> (Option<String>, String) {
        use reqwest::cookie::CookieStore;
        let cookie = self.jar.cookies(&reqwest::Url::parse(url).unwrap())
            .map(|value| value.to_str().unwrap().to_owned());
        (cookie, self.token.read().await.clone())
    }
}
