use super::{constants::BASE_URL, Client};
use ::bytes::Bytes;
use reqwest::{cookie, multipart};
use serde::de::DeserializeOwned;
use std::{cmp::min, fs, io::Write, ops::Deref, path::Path, sync::Arc};

use crate::{
    client::constants::CHUNK_SIZE,
    error::{AppError, Result},
    model::{
        Assignment, CalendarEvent, Colors, Course, File, Folder, ProgressPayload, Submission,
        SubmissionUploadResult, SubmissionUploadSuccessResponse, User,
    },
};

// Apis here are for canvas
impl Client {
    pub fn new() -> Self {
        let jar = Arc::new(cookie::Jar::default());
        let cli = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .build()
            .unwrap();
        Self { cli, jar }
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
            BASE_URL, course_id, assignment_id, student_id, comment_id
        );
        self.cli
            .delete(url)
            .header("Authorization", format!("Bearer {}", token))
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
            BASE_URL, course_id, assignment_id
        );
        let form = match comment {
            Some(comment) => vec![
                (format!("grade_data[{}][posted_grade]", student_id), grade),
                (format!("grade_data[{}][text_comment]", student_id), comment),
            ],
            None => vec![(format!("grade_data[{}][posted_grade]", student_id), grade)],
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
            BASE_URL, course_id, assignment_id
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
            BASE_URL, course_id, assignment_id, override_id
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
            BASE_URL, course_id, assignment_id, override_id
        );
        self.cli
            .delete(url)
            .header("Authorization", format!("Bearer {}", token))
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
            BASE_URL, course_id, assignment_id
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

        tracing::info!("File downloaded successfully!");
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

    pub async fn list_course_files(&self, course_id: i64, token: &str) -> Result<Vec<File>> {
        let url = format!("{}/api/v1/courses/{}/files", BASE_URL, course_id);
        self.list_items(&url, token).await
    }

    pub async fn list_course_images(&self, course_id: i64, token: &str) -> Result<Vec<File>> {
        let url = format!(
            "{}/api/v1/courses/{}/files?content_types[]=image",
            BASE_URL, course_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_folder_files(&self, folder_id: i64, token: &str) -> Result<Vec<File>> {
        let url = format!("{}/api/v1/folders/{}/files", BASE_URL, folder_id);
        self.list_items(&url, token).await
    }

    // TODO: 将接口改为list_course_folders
    pub async fn list_folders(&self, course_id: i64, token: &str) -> Result<Vec<Folder>> {
        let url = format!("{}/api/v1/courses/{}/folders", BASE_URL, course_id);
        self.list_items(&url, token).await
    }

    pub async fn list_folder_folders(&self, folder_id: i64, token: &str) -> Result<Vec<Folder>> {
        let url = format!("{}/api/v1/folders/{}/folders", BASE_URL, folder_id);
        self.list_items(&url, token).await
    }

    pub async fn get_folder_by_id(&self, folder_id: i64, token: &str) -> Result<Folder> {
        let url = format!("{}/api/v1/folders/{}", BASE_URL, folder_id);
        let folder = self.get_json_with_token(&url, None::<&str>, token).await?;
        Ok(folder)
    }

    pub async fn get_colors(&self, token: &str) -> Result<Colors> {
        let url = format!("{}/api/v1/users/self/colors", BASE_URL);
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
            .map(|context_code| format!("context_codes[]={}", context_code))
            .reduce(|c1, c2| format!("{}&{}", c1, c2))
            .unwrap_or_default();
        let url = format!(
            "{}/api/v1/calendar_events?type=assignment&{}&start_date={}&end_date={}",
            BASE_URL, context_codes, start_date, end_date
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
        let n_batches = if n_codes % BATCH_SIZE == 0 {
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
        let url = format!("{}/api/v1/courses/{}/users", BASE_URL, course_id);
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
            BASE_URL, course_id, assignment_id, student_id,
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
            BASE_URL, course_id, assignment_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_course_students(&self, course_id: i64, token: &str) -> Result<Vec<User>> {
        let url = format!("{}/api/v1/courses/{}/students", BASE_URL, course_id);
        self.list_items_with_page(&url, token, 0).await
    }

    pub async fn list_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!(
            "{}/api/v1/courses?include[]=teachers&include[]=term",
            BASE_URL
        );
        let all_courses = self.list_items(&url, token).await?;
        let filtered_courses: Vec<Course> = all_courses
            .into_iter()
            .filter(|course: &Course| !course.is_access_restricted())
            .collect();
        Ok(filtered_courses)
    }

    pub async fn get_me(&self, token: &str) -> Result<User> {
        let url = format!("{}/api/v1/users/self", BASE_URL);
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
        let file = serde_json::from_slice(&bytes)?;
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
            BASE_URL, course_id, assignment_id,
        );
        let metadata = fs::metadata(file_path)?;
        if !metadata.is_file() {
            let error_message = format!("{} is not a valid file!", file_path);
            return Err(AppError::SubmissionUpload(error_message));
        }

        let form = [("name", file_name), ("size", &metadata.len().to_string())];
        let resp = self
            .post_form_with_token(&url, None::<&str>, &form, token)
            .await?;
        let bytes = resp.bytes().await?;
        let result = match serde_json::from_slice::<SubmissionUploadResult>(&bytes)? {
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
            let file_name = file_path.split('/').last().unwrap();
            let file = self
                .upload_submission_file(course_id, assignment_id, file_path, file_name, token)
                .await?;
            file_ids.push(file.id);
        }

        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions",
            BASE_URL, course_id, assignment_id,
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

    pub async fn list_ta_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!(
            "{}/api/v1/courses?include[]=teachers&include[]=term&enrollment_type=ta",
            BASE_URL
        );
        self.list_items(&url, token).await
    }

    pub async fn get_my_single_submission(
        &self,
        course_id: i64,
        assignment_id: i64,
        token: &str,
    ) -> Result<Submission> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/self?include[]=submission_comments",
            BASE_URL, course_id, assignment_id,
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
            "{}/api/v1/courses/{}/assignments?include[]=submission&include[]=overrides&include[]=all_dates",
            BASE_URL, course_id
        );
        self.list_items(&url, token).await
    }
}
