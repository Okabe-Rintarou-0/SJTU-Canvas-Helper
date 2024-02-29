use std::{fs, io::Write, path::Path};

use reqwest::Response;
use serde::de::DeserializeOwned;

use crate::{
    error::Result,
    model::{Assignment, Course, File, Folder, ProgressPayload, Submission, User},
};
const BASE_URL: &str = "https://oc.sjtu.edu.cn";

pub struct Client {
    cli: reqwest::Client,
}

impl Client {
    pub fn new() -> Self {
        Self {
            cli: reqwest::Client::new(),
        }
    }

    async fn get_request(
        &self,
        url: &str,
        query: Option<&Vec<(String, String)>>,
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

    pub async fn download_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        token: &str,
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let mut response = self
            .get_request(&file.url, None, token)
            .await?
            .error_for_status()?;

        let mut payload = ProgressPayload {
            uuid: file.uuid.clone(),
            downloaded: 0,
            total: file.size,
        };
        let path = Path::new(save_path).join(&file.display_name);
        let mut file = fs::File::create(path.to_str().unwrap())?;
        while let Some(chunk) = response.chunk().await? {
            payload.downloaded += chunk.len() as u64;
            progress_handler(payload.clone());
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
        let res = self
            .get_request(
                url,
                Some(&vec![("page".to_owned(), page.to_string())]),
                token,
            )
            .await?
            .error_for_status()?;

        let files = serde_json::from_slice::<Vec<T>>(&res.bytes().await?)?;
        Ok(files)
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
        self.list_items(&url, token).await
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
