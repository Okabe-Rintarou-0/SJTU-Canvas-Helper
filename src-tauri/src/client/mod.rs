use std::{fs, io::Write};

use reqwest::Response;

use crate::{
    error::Result,
    model::{Course, File},
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

    pub async fn download_file(&self, url: &str, out_path: &str, token: &str) -> Result<()> {
        let response = self
            .get_request(url, None, token)
            .await?
            .error_for_status()?;
        let body = response.bytes().await?;
        let mut file = fs::File::create(out_path)?;
        file.write_all(&body)?;
        tracing::info!("File downloaded successfully at: {}", out_path);
        Ok(())
    }

    pub async fn list_files(&self, course_id: i32, token: &str) -> Result<Vec<File>> {
        let url = format!("{}/api/v1/courses/{}/files", BASE_URL, course_id);
        let res = self.get_request(&url, None, token).await?;

        let files = serde_json::from_slice(&res.bytes().await?)?;
        Ok(files)
    }
}
