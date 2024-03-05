use std::{fs, io::Write, path::Path};

use reqwest::Response;
use serde::{de::DeserializeOwned, Serialize};

use crate::{
    error::Result,
    model::{
        Assignment, CalendarEvent, Colors, Course, File, Folder, ProgressPayload, Submission, User,
    },
};
const BASE_URL: &str = "https://oc.sjtu.edu.cn";
const CHUNK_SIZE: u64 = 512 * 1024;

pub struct Client {
    cli: reqwest::Client,
}

impl Client {
    pub fn new() -> Self {
        Self {
            cli: reqwest::Client::new(),
        }
    }

    async fn get_request<T: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<Response> {
        let mut req = self
            .cli
            .get(url)
            .header("Authorization".to_owned(), format!("Bearer {}", token));

        if let Some(query) = query {
            req = req.query(query)
        }

        let res = req.send().await?;
        Ok(res)
    }

    async fn get_json<T: Serialize + ?Sized, D: DeserializeOwned>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<D> {
        let response = self
            .get_request(url, query, token)
            .await?
            .error_for_status()?;
        let json = serde_json::from_slice(&response.bytes().await?)?;
        Ok(json)
    }

    pub async fn post_form<T: Serialize + ?Sized, Q: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&Q>,
        form: &T,
        token: &str,
    ) -> Result<Response> {
        let mut request = self
            .cli
            .post(url)
            .header("Authorization".to_owned(), format!("Bearer {}", token))
            .form(form);
        if let Some(query) = query {
            request = request.query(query);
        }
        let response = request.send().await?;
        Ok(response)
    }

    pub async fn update_grade(
        &self,
        course_id: i32,
        assignment_id: i32,
        student_id: i32,
        grade: &str,
        token: &str,
    ) -> Result<()> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions/update_grades",
            BASE_URL, course_id, assignment_id
        );
        self.post_form(
            &url,
            None::<&str>,
            &[(format!("grade_data[{}][posted_grade]", student_id), grade)],
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
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let mut response = self
            .get_request(&file.url, None::<&str>, token)
            .await?
            .error_for_status()?;

        let mut payload = ProgressPayload {
            uuid: file.uuid.clone(),
            downloaded: 0,
            total: file.size,
        };
        let path = Path::new(save_path).join(&file.display_name);
        let total = file.size;
        let mut file = fs::File::create(path.to_str().unwrap())?;
        let mut last_chunk_no = 0;
        while let Some(chunk) = response.chunk().await? {
            payload.downloaded += chunk.len() as u64;
            let chunk_no = payload.downloaded / CHUNK_SIZE;
            if chunk_no != last_chunk_no || payload.downloaded == total {
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
            .get_json(
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

    pub async fn list_course_files(&self, course_id: i32, token: &str) -> Result<Vec<File>> {
        let url = format!("{}/api/v1/courses/{}/files", BASE_URL, course_id);
        self.list_items(&url, token).await
    }

    pub async fn list_folder_files(&self, folder_id: i32, token: &str) -> Result<Vec<File>> {
        let url = format!("{}/api/v1/folders/{}/files", BASE_URL, folder_id);
        self.list_items(&url, token).await
    }

    pub async fn list_folders(&self, course_id: i32, token: &str) -> Result<Vec<Folder>> {
        let url = format!("{}/api/v1/courses/{}/folders", BASE_URL, course_id);
        self.list_items(&url, token).await
    }

    pub async fn get_colors(&self, token: &str) -> Result<Colors> {
        let url = format!("{}/api/v1/users/self/colors", BASE_URL);
        let colors = self.get_json(&url, None::<&str>, token).await?;
        Ok(colors)
    }

    pub async fn list_calendar_events(
        &self,
        token: &str,
        context_codes: &[String],
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<CalendarEvent>> {
        let context_codes = context_codes
            .into_iter()
            .map(|context_code| format!("context_codes[]={}", context_code))
            .reduce(|c1, c2| format!("{}&{}", c1, c2))
            .unwrap_or_default();
        let url = format!(
            "{}/api/v1/calendar_events?type=assignment&{}&start_date={}&end_date={}",
            BASE_URL, context_codes, start_date, end_date
        );
        self.list_items(&url, token).await
    }

    pub async fn list_course_users(&self, course_id: i32, token: &str) -> Result<Vec<User>> {
        let url = format!("{}/api/v1/courses/{}/users", BASE_URL, course_id);
        self.list_items(&url, token).await
    }

    pub async fn list_course_assignment_submissions(
        &self,
        course_id: i32,
        assignment_id: i32,
        token: &str,
    ) -> Result<Vec<Submission>> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments/{}/submissions",
            BASE_URL, course_id, assignment_id
        );
        self.list_items(&url, token).await
    }

    pub async fn list_course_students(&self, course_id: i32, token: &str) -> Result<Vec<User>> {
        let url = format!("{}/api/v1/courses/{}/students", BASE_URL, course_id);
        self.list_items_with_page(&url, token, 0).await
    }

    pub async fn list_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!("{}/api/v1/courses", BASE_URL);
        let all_courses = self.list_items(&url, token).await?;
        let filtered_courses: Vec<Course> = all_courses
            .into_iter()
            .filter(|course: &Course| !course.is_access_restricted())
            .collect();

        Ok(filtered_courses)
    }

    pub async fn list_ta_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!("{}/api/v1/courses?enrollment_type=ta", BASE_URL);
        self.list_items(&url, token).await
    }

    pub async fn list_course_assignments(
        &self,
        course_id: i32,
        token: &str,
    ) -> Result<Vec<Assignment>> {
        let url = format!(
            "{}/api/v1/courses/{}/assignments?include[]=submission",
            BASE_URL, course_id
        );
        self.list_items(&url, token).await
    }
}
