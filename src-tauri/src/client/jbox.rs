use super::{
    constants::{
        AUTH_URL, JBOX_BASE_URL, JBOX_LOGIN_URL, JBOX_LOGIN_URL2, JBOX_UPLOAD_CHUNK_SIZE,
        JBOX_USER_SPACE_URL,
    },
    Client,
};
use regex::Regex;
use reqwest::header::{ACCEPT, ACCEPT_ENCODING, ACCEPT_LANGUAGE};
use serde_json::json;
use std::{cmp::min, path::Path};
use tauri::Url;

use crate::{
    error::{AppError, Result},
    model::{
        ConfirmChunkUploadResult, File, JBoxErrorMessage, JBoxLoginInfo, JboxLoginResult,
        PersonalSpaceInfo, ProgressPayload, StartChunkUploadContext,
    },
    utils,
};

// Apis here are for jbox
// Check https://pan.sjtu.edu.cn/
impl Client {
    pub async fn login_jbox(&self, cookie: &str) -> Result<String> {
        self.jar
            .add_cookie_str(cookie, &Url::parse(AUTH_URL).unwrap());
        let resp = self
            .get_request(JBOX_LOGIN_URL, None::<&str>)
            .await?
            .error_for_status()?;
        let re = Regex::new(r"code=(.+?)&state=").unwrap();
        let url = resp.url().to_string();
        let Some(captures) = re.captures(&url) else {
            return Err(AppError::LoginError);
        };

        let Some(m) = captures.get(1) else {
            return Err(AppError::LoginError);
        };

        let code = m.as_str().to_owned();
        let next_url = format!("{}{}", JBOX_LOGIN_URL2, code);
        let login_result = self
            .post_request::<JboxLoginResult, _>(&next_url, "")
            .await?;

        if login_result.status != 0 || login_result.user_token.len() != 128 {
            return Err(AppError::LoginError);
        }
        Ok(login_result.user_token)
    }

    pub async fn get_user_space_info(&self, user_token: &str) -> Result<PersonalSpaceInfo> {
        let url = format!("{}?user_token={}", JBOX_USER_SPACE_URL, user_token);
        let info = self.post_request::<PersonalSpaceInfo, _>(&url, "").await?;
        if info.status != 0 {
            tracing::error!("{}", info.message);
            return Err(AppError::JBoxError(info.message));
        }
        Ok(info)
    }

    pub async fn start_chunk_upload(
        &self,
        path: &str,
        chunk_count: usize,
        info: &JBoxLoginInfo,
    ) -> Result<StartChunkUploadContext> {
        let url = format!(
            "{}/api/v1/file/{}/{}/{}?multipart=null&conflict_resolution_strategy=rename&access_token={}",
            JBOX_BASE_URL, info.library_id, info.space_id, path, info.access_token
        );
        let chunks: Vec<_> = (1..=chunk_count).collect();
        let data = json!({"partNumberRange": chunks}).to_string();
        let result = self
            .post_request::<StartChunkUploadContext, _>(&url, data)
            .await?;
        Ok(result)
    }

    pub async fn create_jbox_directory(&self, dir_path: &str, info: &JBoxLoginInfo) -> Result<()> {
        let url = format!(
            "{}/api/v1/directory/{}/{}/{}?conflict_resolution_strategy=ask&access_token={}",
            JBOX_BASE_URL, info.library_id, info.space_id, dir_path, info.access_token
        );
        let resp = self.cli.put(&url).send().await?;
        let bytes = resp.bytes().await?;
        let result = utils::parse_json::<JBoxErrorMessage>(&bytes)?;
        if result.status != 0 && result.code != "SameNameDirectoryOrFileExists" {
            return Err(AppError::JBoxError(result.message));
        }
        Ok(())
    }

    pub fn compute_chunk_size(&self, file_size: usize) -> usize {
        if file_size.is_multiple_of(JBOX_UPLOAD_CHUNK_SIZE) {
            file_size / JBOX_UPLOAD_CHUNK_SIZE
        } else {
            file_size / JBOX_UPLOAD_CHUNK_SIZE + 1
        }
    }

    async fn upload_chunk(
        &self,
        ctx: &StartChunkUploadContext,
        data: Vec<u8>,
        part_number: usize,
    ) -> Result<()> {
        let url = format!(
            "https://{}{}?uploadId={}&partNumber={}",
            ctx.domain, ctx.path, ctx.upload_id, part_number
        );
        let headers = &ctx
            .parts
            .get(&part_number.to_string())
            .ok_or(AppError::JBoxError("非法 Part 结构".to_owned()))?
            .headers;
        self.cli
            .put(&url)
            .header(ACCEPT, "*/*")
            .header(ACCEPT_ENCODING, "gzip, deflate, br")
            .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
            .header("x-amz-date", &headers.x_amz_date)
            .header("authorization", &headers.authorization)
            .header("x-amz-content-sha256", &headers.x_amz_content_sha256)
            .body(data)
            .send()
            .await?
            .error_for_status()?;
        tracing::info!("upload chunk: {}", part_number);
        Ok(())
    }

    async fn upload_chunk_with_retry(
        &self,
        ctx: &StartChunkUploadContext,
        data: &[u8],
        part_number: usize,
        max_retries: i64,
    ) -> Result<()> {
        let mut retries = 0;
        let mut result;
        loop {
            result = self.upload_chunk(ctx, data.to_owned(), part_number).await;
            if result.is_ok() || retries == max_retries {
                break;
            }
            retries += 1;
        }
        result
    }

    async fn confirm_chunk_upload(&self, confirm_key: &str, info: &JBoxLoginInfo) -> Result<()> {
        let url = format!(
            "{}/api/v1/file/{}/{}/{}?confirm=null&conflict_resolution_strategy=rename&access_token={}",
            JBOX_BASE_URL, info.library_id, info.space_id, confirm_key, info.access_token
        );
        let result = self
            .post_request::<ConfirmChunkUploadResult, _>(&url, "")
            .await?;
        tracing::info!("上传成功！crc64 = {}", result.crc64);
        Ok(())
    }

    pub async fn upload_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        save_dir: &str,
        info: &JBoxLoginInfo,
        progress_handler: F,
    ) -> Result<()> {
        // ensure directory exists
        self.create_jbox_directory(save_dir, info).await?;

        let save_path = Path::new(save_dir).join(&file.display_name);
        let response = self
            .get_request(&file.url, None::<&str>)
            .await?
            .error_for_status()?;
        let data = response.bytes().await?.to_vec();
        let file_size = data.len();
        let chunk_count = self.compute_chunk_size(file_size);
        let ctx = self
            .start_chunk_upload(save_path.to_str().unwrap(), chunk_count, info)
            .await?;
        let mut payload = ProgressPayload {
            uuid: file.uuid.clone(),
            processed: 0,
            total: file_size as u64,
        };
        for part_number in 1..=chunk_count {
            let start = (part_number - 1) * JBOX_UPLOAD_CHUNK_SIZE;
            let end = min(start + JBOX_UPLOAD_CHUNK_SIZE, file_size);
            let this_chunk_size = end - start;
            self.upload_chunk_with_retry(&ctx, &data[start..end], part_number, 3)
                .await?;
            payload.processed += this_chunk_size as u64;
            progress_handler(payload.clone());
        }
        // confirm
        self.confirm_chunk_upload(&ctx.confirm_key, info).await?;
        Ok(())
    }
}
