use std::{fs, io::Write};

use reqwest::Response;

use crate::{
    error::Result,
    model::{Course, File, ProgressPayload},
};
const BASE_URL: &'static str = "https://oc.sjtu.edu.cn";

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

    pub async fn list_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!("{}/api/v1/courses", BASE_URL);
        let res = self.get_request(&url, None, token).await?;

        let courses = serde_json::from_slice(&res.bytes().await?)?;
        Ok(courses)
    }

    pub async fn download_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        token: &str,
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
        let mut file = fs::File::create(format!("../{}", &file.display_name))?;
        while let Some(chunk) = response.chunk().await? {
            payload.downloaded += chunk.len() as u64;
            progress_handler(payload.clone());
            file.write_all(&chunk)?;
        }

        tracing::info!("File downloaded successfully!");
        Ok(())
    }

    pub async fn list_files(&self, course_id: i32, token: &str) -> Result<Vec<File>> {
        let url = format!("{}/api/v1/courses/{}/files", BASE_URL, course_id);
        let res = self.get_request(&url, None, token).await?;

        let files = serde_json::from_slice(&res.bytes().await?)?;
        Ok(files)
    }
}
