use std::{
    collections::HashMap,
    fs,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use md5::{Digest, Md5};
use regex::Regex;
use reqwest::{
    cookie::CookieStore,
    header::{HeaderValue, ACCEPT, CONTENT_RANGE, RANGE, REFERER},
    Response, StatusCode,
};
use select::{document::Document, node::Node, predicate::Name};
use serde::{de::DeserializeOwned, Serialize};
use tauri::Url;

use super::{
    constants::{
        AUTH_URL, EXPRESS_LOGIN_URL, MY_SJTU_URL, VIDEO_BASE_URL, VIDEO_LOGIN_URL,
        VIDEO_OAUTH_KEY_URL,
    },
    Client,
};
use crate::{
    client::constants::{
        OAUTH_PATH, OAUTH_RANDOM, OAUTH_RANDOM_P1, OAUTH_RANDOM_P1_VAL, OAUTH_RANDOM_P2,
        OAUTH_RANDOM_P2_VAL, VIDEO_CHUNK_SIZE, VIDEO_INFO_URL,
    },
    error::{AppError, Result},
    model::{ItemPage, ProgressPayload, Subject, VideoCourse, VideoInfo, VideoPlayInfo},
};

// Apis here are for course video
// We take references from: https://github.com/prcwcy/sjtu-canvas-video-download/blob/master/sjtu_canvas_video.py
impl Client {
    pub fn init_cookie(&self, cookie: &str) {
        self.jar
            .add_cookie_str(cookie, &Url::parse(VIDEO_BASE_URL).unwrap());
    }

    pub async fn get_uuid(&self) -> Result<Option<String>> {
        let resp = self.cli.get(MY_SJTU_URL).send().await?.error_for_status()?;
        let body = resp.text().await?;
        // let document = Document::from(body.as_str());
        let re = Regex::new(
            r#"uuid=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"#,
        )
        .unwrap();

        if let Some(captures) = re.captures(&body) {
            if let Some(uuid) = captures.get(1) {
                return Ok(Some(uuid.as_str().to_owned()));
            }
        }

        Ok(None)
    }

    pub async fn express_login(&self, uuid: &str) -> Result<Option<String>> {
        let url = format!("{}?uuid={}", EXPRESS_LOGIN_URL, uuid);
        self.cli.get(&url).send().await?.error_for_status()?;
        let domain = Url::parse(AUTH_URL).unwrap();
        if let Some(value) = self.jar.cookies(&domain) {
            if let Ok(cookies) = value.to_str() {
                let kvs = cookies.split(';');
                for kv in kvs {
                    let kv: Vec<_> = kv.trim().split('=').collect();
                    if kv.len() >= 2 && kv[0] == "JAAuthCookie" {
                        return Ok(Some(kv[1].to_owned()));
                    }
                }
            }
        }
        Ok(None)
    }

    pub async fn login_video_website(&self, cookie: &str) -> Result<Option<String>> {
        self.jar
            .add_cookie_str(cookie, &Url::parse(AUTH_URL).unwrap());
        let response = self.get_request(VIDEO_LOGIN_URL, None::<&str>).await?;
        let url = response.url();
        if let Some(domain) = url.domain() {
            if domain == "jaccount.sjtu.edu.cn" {
                return Err(AppError::LoginError);
            }
        }
        if let Some(cookies) = self.jar.cookies(&Url::parse(VIDEO_BASE_URL).unwrap()) {
            if let Ok(cookies) = cookies.to_str() {
                return Ok(Some(cookies.to_owned()));
            }
        }
        Ok(None)
    }

    pub async fn get_page_items<T: Serialize + DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<Vec<T>> {
        let mut page_index = 1;
        let mut all_items = vec![];

        loop {
            let paged_url = format!("{}pageSize=100&pageIndex={}", url, page_index);
            let item_page = self
                .get_json_with_cookie::<_, ItemPage<T>>(&paged_url, None::<&str>)
                .await?;
            all_items.extend(item_page.list);
            let page = &item_page.page;
            if page.page_count == 0 || page.page_next == page_index {
                break;
            }
            page_index += 1;
        }
        Ok(all_items)
    }

    pub async fn get_subjects(&self) -> Result<Vec<Subject>> {
        let url = format!(
            "{}/system/course/subject/findSubjectVodList?",
            VIDEO_BASE_URL
        );
        self.get_page_items(&url).await
    }

    pub async fn get_oauth_consumer_key(&self) -> Result<Option<String>> {
        let resp = self.get_request(VIDEO_OAUTH_KEY_URL, None::<&str>).await?;
        let body = resp.text().await?;
        let document = Document::from(body.as_str());

        let Some(meta) = document
            .find(Name("meta"))
            .find(|n: &Node| n.attr("id").unwrap_or_default() == "xForSecName")
        else {
            return Ok(None);
        };
        let Some(v) = meta.attr("vaule") else {
            return Ok(None);
        };
        let bytes = &STANDARD.decode(v)?;
        Ok(Some(format!("{}", String::from_utf8_lossy(bytes))))
    }

    pub async fn get_video_course(
        &self,
        subject_id: i64,
        tecl_id: i64,
    ) -> Result<Option<VideoCourse>> {
        let url = format!(
            "{}/system/resource/vodVideo/getCourseListBySubject?orderField=courTimes&subjectId={}&teclId={}&",
            VIDEO_BASE_URL, subject_id, tecl_id
        );
        let mut courses = self.get_page_items(&url).await?;
        Ok(courses.remove(0))
    }

    fn get_oauth_signature(
        &self,
        video_id: i64,
        oauth_nonce: &str,
        oauth_consumer_key: &str,
    ) -> String {
        let signature_string = format!("/app/system/resource/vodVideo/getvideoinfos?id={}&oauth-consumer-key={}&oauth-nonce={}&oauth-path={}&{}&playTypeHls=true",
        video_id, oauth_consumer_key, oauth_nonce, OAUTH_PATH, OAUTH_RANDOM);
        let md5 = Md5::digest(signature_string);
        format!("{:x}", md5)
    }

    fn get_oauth_nonce(&self) -> String {
        let now = SystemTime::now();
        let since_the_epoch = now.duration_since(UNIX_EPOCH).expect("Time went backwards");
        (since_the_epoch.as_nanos() / 1_000_000).to_string()
    }

    async fn download_video_partial(&self, url: &str, begin: u64, end: u64) -> Result<Response> {
        let range_value = HeaderValue::from_str(&format!("bytes={}-{}", begin, end)).unwrap();
        let response = self
            .cli
            .get(url)
            .header(RANGE, range_value)
            .header(REFERER, "https://courses.sjtu.edu.cn")
            .send()
            .await?;
        Ok(response)
    }

    async fn get_download_video_size(&self, url: &str) -> Result<u64> {
        let resp = self.download_video_partial(url, 0, 0).await?;
        let range = resp.headers().get(CONTENT_RANGE);
        if let Some(range) = range {
            let range = range.to_str()?;
            let parts: Vec<_> = range.split('/').collect();
            let size = if parts.len() == 2 {
                parts[1].parse().unwrap_or_default()
            } else {
                0
            };
            Ok(size)
        } else {
            Ok(0)
        }
    }

    pub async fn download_video<F: Fn(ProgressPayload) + Send>(
        &self,
        video: &VideoPlayInfo,
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let mut output_file = fs::File::create(save_path)?;
        let mut read_total = 0_u64;
        let url = &video.rtmp_url_hdv;
        let size = self.get_download_video_size(url).await?;
        let mut payload = ProgressPayload {
            uuid: video.id.to_string(),
            processed: 0,
            total: size,
        };
        progress_handler(payload.clone());
        loop {
            let response = self
                .download_video_partial(url, read_total, read_total + VIDEO_CHUNK_SIZE)
                .await?;

            let status = response.status();
            if !(status == StatusCode::OK || status == StatusCode::PARTIAL_CONTENT) {
                tracing::error!("status not ok: {}", status);
            }
            let bytes = response.bytes().await?;
            let read_bytes = bytes.len() as u64;
            tracing::debug!("read bytes {}", read_bytes);

            output_file.write_all(&bytes)?;
            read_total += read_bytes;
            payload.processed += read_bytes;
            progress_handler(payload.clone());
            if read_bytes < VIDEO_CHUNK_SIZE {
                break;
            }
        }
        tracing::debug!("read total bytes {}", read_total);
        Ok(())
    }

    pub async fn get_video_info(
        &self,
        video_id: i64,
        oauth_consumer_key: &str,
    ) -> Result<VideoInfo> {
        let mut form_data = HashMap::new();
        let oauth_nonce = self.get_oauth_nonce();
        let oauth_signature = self.get_oauth_signature(video_id, &oauth_nonce, oauth_consumer_key);

        tracing::debug!("oauth_nonce: {}", oauth_nonce);
        tracing::debug!("oauth_signature: {}", oauth_signature);
        tracing::debug!("oauth_consumer_key: {}", oauth_consumer_key);
        tracing::debug!("video_id: {}", video_id);

        let video_id_str = video_id.to_string();
        form_data.insert("playTypeHls", "true");
        form_data.insert("id", &video_id_str);
        form_data.insert(OAUTH_RANDOM_P1, OAUTH_RANDOM_P1_VAL);
        form_data.insert(OAUTH_RANDOM_P2, OAUTH_RANDOM_P2_VAL);

        let response = self
            .cli
            .post(VIDEO_INFO_URL)
            .form(&form_data)
            .header(ACCEPT, "application/json")
            .header("oauth-consumer-key", oauth_consumer_key)
            .header("oauth-nonce", oauth_nonce)
            .header("oauth-path", OAUTH_PATH)
            .header("oauth-signature", oauth_signature)
            .send()
            .await?
            .error_for_status()?;
        let bytes = response.bytes().await?;
        let video = serde_json::from_slice(&bytes)?;
        Ok(video)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_uuid() -> Result<()> {
        let cli = Client::new();
        let uuid = cli.get_uuid().await?;
        assert!(uuid.is_some());
        let uuid: String = uuid.unwrap();
        assert!(!uuid.is_empty());
        Ok(())
    }

    #[test]
    fn test_get_oauth_signature() -> Result<()> {
        let cli = Client::new();
        let oauth_nonce = "1709784720392";
        let id = 3601811;
        let oauth_consumer_key = "DADD2CA9923D5E31331C4B79B39A1E4B";
        assert_eq!(
            "2b499a5303048d6522118e79711c5ee0",
            cli.get_oauth_signature(id, oauth_nonce, oauth_consumer_key)
        );
        Ok(())
    }
}
