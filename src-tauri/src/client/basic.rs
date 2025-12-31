use super::{constants::BASE_URL, file_parser, llm, Client};
use ::bytes::Bytes;
use reqwest::{cookie, multipart};
use serde::de::DeserializeOwned;
use std::{cmp::min, collections::HashSet, fs, io::Write, ops::Deref, path::Path, sync::Arc};
use tokio::{sync::RwLock, task::JoinSet};

use crate::{
    client::constants::CHUNK_SIZE,
    error::{AppError, Result},
    model::{
        Assignment, CalendarEvent, Colors, Course, DiscussionTopic, File, Folder, FoldersAndFiles,
        FullDiscussion, Module, ModuleItem, ProgressPayload, RelationshipEdge, RelationshipNode,
        RelationshipNodeType, RelationshipTopo, Submission, SubmissionUploadResult,
        SubmissionUploadSuccessResponse, User, UserSubmissions,
    },
    utils::{self, get_file_name},
};

// Apis here are for canvas
impl Client {
    #[allow(dead_code)]
    pub fn default() -> Self {
        Self::new(BASE_URL, "")
    }

    pub fn new<S: Into<String>>(base_url: S, llm_api_key: S) -> Self {
        let jar = Arc::new(cookie::Jar::default());
        let cli = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .build()
            .unwrap();
        let base_url = RwLock::new(base_url.into());
        let token = RwLock::new("".to_owned());
        let llm_cli = llm::chat::new_llm_client(llm_api_key.into()).unwrap();
        let file_parser = file_parser::new_generic_file_reader();
        Self {
            cli,
            jar,
            base_url,
            token,
            llm_cli,
            file_parser,
        }
    }

    pub async fn set_llm_api_key<S: Into<String>>(&self, api_key: S) {
        self.llm_cli.set_api_key(api_key.into()).await;
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
        self.cli
            .delete(url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn update_grade(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        grade: &str,
        comment: Option<&str>,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/update_grades",
            self.base_url.read().await,
            course_id,
            assignment_id
        );
        let form = match comment {
            Some(comment) => vec![
                (format!("grade_data[{student_id}][posted_grade]"), grade),
                (format!("grade_data[{student_id}][text_comment]"), comment),
            ],
            None => vec![(format!("grade_data[{student_id}][posted_grade]"), grade)],
        };
        self.post_form_with_token(&url, None::<&str>, &form, token)
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
        self.cli
            .delete(url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await?
            .error_for_status()?;
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

    pub async fn get_file_content(file: &File) -> Result<Bytes> {
        let response = reqwest::Client::new()
            .get(&file.url)
            .send()
            .await?
            .error_for_status()?;
        let bytes = response.bytes().await?;
        Ok(bytes)
    }

    pub async fn download_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        token: &str,
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let mut response = self
            .get_request_with_token(&file.url, None::<&str>, token)
            .await?
            .error_for_status()?;

        let mut payload = ProgressPayload {
            uuid: file.uuid.clone(),
            processed: 0,
            total: file.size,
        };
        let path = Path::new(save_path).join(&file.display_name);
        let total = file.size;
        let mut file = fs::File::create(path.to_str().unwrap())?;
        let mut last_chunk_no = 0;
        while let Some(chunk) = response.chunk().await? {
            payload.processed += chunk.len() as u64;
            let chunk_no = payload.processed / CHUNK_SIZE;
            if chunk_no != last_chunk_no || payload.processed == total {
                last_chunk_no = chunk_no;
                progress_handler(payload.clone());
            }
            file.write_all(&chunk)?;
        }

        tracing::info!("File {:?} downloaded successfully!", path);
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
        format!(
            "{}({} {})",
            course.name, course.term.name, course.teachers[0].display_name
        )
    }

    pub async fn sync_course_files(
        &self,
        course: &Course,
        save_dir: &str,
        token: &str,
    ) -> Result<Vec<File>> {
        let folders_and_files = self.get_folders_and_files(course.id, token).await?;
        let folders_map = &folders_and_files.folders_map;
        tracing::info!("folders_map: {:?}", folders_map);
        let files = folders_and_files
            .files
            .into_iter()
            .filter(|file| {
                let folder = folders_map.get(&file.folder_id);
                match folder {
                    Some(folder) => {
                        let folder_name = &folder.full_name;
                        if folder_name.len() < 12 {
                            return false;
                        }

                        let mut path = Path::new(save_dir).join(self.get_course_identifier(course));
                        if folder_name != "course files" {
                            path = path.join(&folder_name[13..]);
                        }
                        path = path.join(&file.display_name);
                        fs::metadata(&path).is_err()
                    }
                    None => true,
                }
            })
            .collect();
        Ok(files)
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

        let mut tasks = JoinSet::new();
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
            tasks.spawn(async move {
                cloned_self
                    .list_user_submissions_inner(course_id, i, &sub_student_ids, &cloned_token)
                    .await
            });
        }

        while let Some(res) = tasks.join_next().await {
            let res = res??;
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
        let file = utils::parse_json(&bytes)?;
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
        let result = match utils::parse_json::<SubmissionUploadResult>(&bytes)? {
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
                    .await
                    .unwrap_or_default();
                (course, course_users)
            });
        }
        while let Some(res) = tasks.join_next().await {
            let res = res?;
            let course = res.0;
            let course_users = res.1;
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
mod test {
    use injectorpp::interface::injector::InjectorPP;

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

    #[tokio::test]
    async fn test_list_items() -> Result<()> {
        let cli = Client::default();
        let mut injector = InjectorPP::new();
        struct TestItem {
            id: int,
        };
        injector
            .when_called(injectorpp::func!(Client::list_items::<TestItem>))
            .will_execute(injectorpp::fake!(
                func_type: fn(f: &Foo, value: i32, item: &str) -> String,
                when: f.value > 0 && item == "test",
                returns: "Fake result".to_string(),
                times: 1
            ));
        Ok(())
    }

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

    #[tokio::test]
    async fn test_list_colors() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::default();
        cli.get_colors(&token).await?;
        Ok(())
    }
}
