use std::{
    collections::HashMap,
    fs::File,
    io::Write,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use super::{
    constants::{
        AUTH_URL, CANVAS_LOGIN_URL, EXPRESS_LOGIN_URL, MY_SJTU_URL, VIDEO_BASE_URL,
        VIDEO_LOGIN_URL, VIDEO_OAUTH_KEY_URL,
    },
    Client,
};
use crate::{
    client::constants::{
        OAUTH_PATH, OAUTH_RANDOM, OAUTH_RANDOM_P1, OAUTH_RANDOM_P1_VAL, OAUTH_RANDOM_P2,
        OAUTH_RANDOM_P2_VAL, VIDEO_CHUNK_SIZE, VIDEO_INFO_URL,
    },
    error::{AppError, Result},
    model::{
        CanvasVideo, CanvasVideoPPT, CanvasVideoPPTResponse, CanvasVideoResponse,
        CanvasVideoSubTitle, CanvasVideoSubTitleResponse, CanvasVideoSubTitleResponseBody,
        GetCanvasVideoInfoResponse, ItemPage, ProgressPayload, Subject, VideoCourse, VideoInfo,
        VideoPlayInfo,
    },
    utils::{self, format_time, get_file_name, write_file_at_offset},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use md5::{Digest, Md5};
use printpdf::*;
use regex::Regex;
use reqwest::{
    cookie::CookieStore,
    header::{HeaderValue, ACCEPT, CONTENT_RANGE, RANGE, REFERER},
    redirect::Policy,
    Response, StatusCode,
};
use select::{
    document::Document,
    node::Node,
    predicate::{Attr, Name},
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use tauri::Url;
use tokio::{sync::Mutex, task::JoinSet};

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

    pub async fn login_canvas_website(&self, cookie: &str) -> Result<()> {
        self.jar
            .add_cookie_str(cookie, &Url::parse(AUTH_URL).unwrap());
        let response = self.get_request(CANVAS_LOGIN_URL, None::<&str>).await?;
        let url = response.url();
        if let Some(domain) = url.domain() {
            if domain == "jaccount.sjtu.edu.cn" {
                return Err(AppError::LoginError);
            }
        }
        Ok(())
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

    // https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/getAccessTokenByTokenId?tokenId=

    fn get_form_data_from_doc(
        &self,
        document: Document,
        action_url: &str,
    ) -> Result<Option<HashMap<String, String>>> {
        // Find the from on this page
        let form = document.find(Attr("action", action_url)).next();

        if form.is_none() {
            return Err(AppError::VideoDownloadError("No Form Found".to_string()));
        }

        let form = form.unwrap();

        let mut data = HashMap::new();
        for input in form.find(Name("input")) {
            if let Some(name) = input.attr("name") {
                if let Some(value) = input.attr("value") {
                    data.insert(name.to_owned(), value.to_owned());
                }
            }
        }
        Ok(Some(data))
    }

    /**
     * Parse the form
     */
    async fn get_form_data_for_canvas_course_id(
        &self,
        course_id: i64,
    ) -> Result<Option<HashMap<String, String>>> {
        // New Course Video
        let url = format!(
            "https://oc.sjtu.edu.cn/courses/{}/external_tools/8329",
            course_id
        );
        let response = self.cli.get(&url).send().await?;
        let body = response.text().await?;
        let document = Document::from(body.as_str());

        self.get_form_data_from_doc(
            document,
            "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/oidc/login_initiations",
        )
    }

    async fn get_canvas_course_id_token_id(&self, course_id: i64) -> Result<(String, String)> {
        let data = match self.get_form_data_for_canvas_course_id(course_id).await? {
            Some(data) => data,
            None => {
                return Err(AppError::VideoDownloadError(
                    "No Form Data Found".to_string(),
                ))
            }
        };

        // Submit the form
        let resp = self
            .cli
            .post("https://v.sjtu.edu.cn/jy-application-canvas-sjtu/oidc/login_initiations")
            .form(&data)
            .send()
            .await?;

        let body = resp.text().await?;
        let document = Document::from(body.as_str());

        // Get another form
        let data = self.get_form_data_from_doc(
            document,
            "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/lti3Auth/ivs",
        )?;

        // Cancel Redirect
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .cookie_provider(self.jar.clone())
            .build()?;

        // Submit Another Form
        let resp = client
            .post("https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/lti3Auth/ivs")
            .form(&data)
            .send()
            .await?;

        // Submit Form to: https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/lti3Auth/ivs
        match resp.headers().get("location") {
            None => Err(AppError::VideoDownloadError(
                "Redirect URL not found".to_string(),
            )),
            Some(location_header) => {
                // URL Example:
                // https://v.sjtu.edu.cn/jy-application-canvas-sjtu-ui/#/ivsModules/index
                // ?tokenId=
                // &isAdmin=0
                // &clientId=
                // &courId=
                // &ltiCourseId=
                // &courseName=
                tracing::info!("Header: {:?}", location_header);
                let params: Vec<_> = location_header.to_str()?.split(&['&', '?'][..]).collect();
                let canvas_course_id = params
                    .iter()
                    .find_map(|s| s.strip_prefix("courId="))
                    .ok_or(AppError::VideoDownloadError(
                        "Canvas Course Id not found".to_string(),
                    ))?
                    .to_owned();
                // tokenId
                let token_id = params
                    .iter()
                    .find_map(|s| s.strip_prefix("tokenId="))
                    .ok_or(AppError::VideoDownloadError(
                        "Token Id not found".to_string(),
                    ))?
                    .to_owned();
                tracing::info!("Course Id: {:?}", canvas_course_id);
                tracing::info!("Token Id: {:?}", token_id);
                Ok((canvas_course_id, token_id))
            }
        }
    }

    // Get Token from token_id
    // https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/getAccessTokenByTokenId?tokenId=
    async fn get_token_by_token_id(&self, token_id: &str) -> Result<String> {
        let url = format!(
            "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/getAccessTokenByTokenId?tokenId={}",
            token_id
        );
        let resp = self.cli.get(&url).send().await?;
        let body = resp.text().await?;
        tracing::info!("body: {}", body);
        let json: Value = serde_json::from_str(&body)?;
        let token = json["data"]["token"]
            .as_str()
            .ok_or(AppError::VideoDownloadError(String::from(
                "Token not found",
            )))?;
        Ok(token.to_owned())
    }

    async fn get_canvas_course_id_token(&self, course_id: i64) -> Result<(String, String)> {
        let (canvas_course_id, token_id) = self.get_canvas_course_id_token_id(course_id).await?;
        let token = self.get_token_by_token_id(token_id.as_str()).await?;
        Ok((canvas_course_id, token))
    }

    pub async fn get_canvas_videos(&self, course_id: i64) -> Result<Vec<CanvasVideo>> {
        let (canvas_course_id, token) = self.get_canvas_course_id_token(course_id).await?;

        let url =
            "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/directOnDemandPlay/findVodVideoList";
        let mut data = HashMap::new();
        // data.insert("pageIndex", "1");
        // data.insert("pageSize", "1000");
        data.insert("canvasCourseId", canvas_course_id.as_str());

        *self.token.write().await = token.to_owned();

        let resp = self
            .cli
            .post(url)
            .header(
                REFERER,
                "https://v.sjtu.edu.cn/jy-application-canvas-sjtu-ui/",
            )
            .header("token", token)
            .json(&data)
            .send()
            .await?;
        let body = resp.bytes().await?;
        tracing::info!("body: {}", String::from_utf8_lossy(&body));

        let resp = utils::parse_json::<CanvasVideoResponse>(&body).unwrap();
        tracing::info!("resp: {:?}", resp);
        let videos = match resp.data {
            Some(body) => body.records,
            None => vec![],
        };
        Ok(videos)
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

    pub async fn download_video<F: Fn(ProgressPayload) + Send + 'static>(
        self: Arc<Self>,
        video: &VideoPlayInfo,
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let output_file = Arc::new(Mutex::new(File::create(save_path)?));
        let url = &video.rtmp_url_hdv;
        let size = self.get_download_video_size(url).await?;
        let payload = ProgressPayload {
            uuid: video.id.to_string(),
            processed: 0,
            total: size,
        };
        progress_handler(payload.clone());
        if size == 0 {
            tracing::warn!(
                "try to download video as {}, but size is 0, can't download",
                save_path
            );
            return Err(AppError::VideoDownloadError(save_path.to_owned()));
        }

        let progress_handler = Arc::new(Mutex::new(progress_handler));
        let payload = Arc::new(Mutex::new(payload));

        let nproc = num_cpus::get();
        tracing::info!("nproc: {}", nproc);
        let chunk_size = size / nproc as u64;
        let mut tasks = JoinSet::new();
        for i in 0..nproc {
            let begin = i as u64 * chunk_size;
            let end = if i == nproc - 1 {
                size - 1
            } else {
                (i + 1) as u64 * chunk_size - 1
            };
            let self_clone = self.clone();
            let save_path = save_path.to_owned();
            let output_file = output_file.clone();
            let url = url.clone();
            let payload = payload.clone();
            let progress_handler = progress_handler.clone();
            tasks.spawn(async move {
                let mut current_begin = begin;
                while current_begin < end {
                    let response = self_clone
                        .download_video_partial(
                            &url,
                            current_begin,
                            current_begin + VIDEO_CHUNK_SIZE,
                        )
                        .await?;
                    let status = response.status();
                    if !(status == StatusCode::OK || status == StatusCode::PARTIAL_CONTENT) {
                        tracing::error!("status not ok: {}", status);
                        return Err(AppError::VideoDownloadError(save_path));
                    }
                    let bytes = response.bytes().await?;
                    let read_bytes = bytes.len() as u64;
                    tracing::info!("read_bytes: {:?}", read_bytes);
                    {
                        let mut file = output_file.lock().await;
                        write_file_at_offset(file.by_ref(), &bytes, current_begin)?;
                        // release lock automatically after scope release
                    }

                    current_begin += read_bytes;

                    let mut payload_guard = payload.lock().await;
                    payload_guard.processed += read_bytes;
                    progress_handler.lock().await(payload_guard.clone());
                }
                Ok(())
            });
        }
        while let Some(result) = tasks.join_next().await {
            result??;
        }
        tracing::info!("Successfully downloaded video to {}", save_path);
        Ok(())
    }

    pub async fn get_canvas_video_info(&self, video_id: &str) -> Result<VideoInfo> {
        let mut form_data = HashMap::new();
        let url =
            "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/directOnDemandPlay/getVodVideoInfos";
        form_data.insert("playTypeHls", "true");
        form_data.insert("id", video_id);
        form_data.insert("isAudit", "true");
        tracing::info!("{:?}", form_data);
        let resp = self
            .cli
            .post(url)
            .form(&form_data)
            .header("token", self.token.read().await.as_str())
            .send()
            .await?
            .error_for_status()?;
        let bytes = resp.bytes().await?;
        let resp = utils::parse_json::<GetCanvasVideoInfoResponse>(&bytes)?;
        Ok(resp.data)
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
        let video = utils::parse_json(&bytes)?;
        Ok(video)
    }

    // TODO: Download Subtitles
    // https://v.sjtu.edu.cn/jy-application-canvas-sjtu/transfer/translate/2070965
    pub async fn get_subtitle(
        &self,
        canvas_course_id: i64,
    ) -> Result<CanvasVideoSubTitleResponseBody> {
        // TODO: Save Token
        let url = format!(
            "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/transfer/translate/{}",
            canvas_course_id
        );
        let resp = self
            .cli
            .get(url)
            .header("token", self.token.read().await.as_str())
            .send()
            .await?
            .error_for_status()?;
        let bytes = resp.bytes().await?;
        let resp = utils::parse_json::<CanvasVideoSubTitleResponse>(&bytes)?;
        resp.data.ok_or(AppError::VideoDownloadError(
            "No Subtitle Found".to_string(),
        ))
    }

    // TODO: Choose a Version & Convert to SRT
    // 1. Original
    // 2. Original + Eng
    // 3. Eng
    // 4. Eng + Translated Chs
    pub fn convert_to_srt(&self, subtitle: &[CanvasVideoSubTitle]) -> Result<String> {
        let mut srt = String::new();
        for (i, item) in subtitle.iter().enumerate() {
            // Start time & End time in milliseconds
            // Convert to SRT format: HH:MM:SS,ms --> HH:MM:SS,ms
            let start_time = format_time(item.bg);
            let end_time = if i == subtitle.len() - 1 {
                format_time(item.ed)
            } else {
                format_time(subtitle[i + 1].bg)
            };

            let text = item.res.clone();
            srt.push_str(&format!("{}\n", i + 1));
            srt.push_str(&format!("{} --> {}\n", start_time, end_time));
            srt.push_str(&format!("{}\n\n", text));
        }
        Ok(srt)
    }

    // https://v.sjtu.edu.cn/jy-application-canvas-sjtu/directOnDemandPlay/vod-analysis/query-ppt-slice-es?ivsVideoId=${courId}
    pub async fn get_ppt(&self, canvas_course_id: i64) -> Result<Vec<CanvasVideoPPT>> {
        // TODO: Save Token
        let url = format!("https://v.sjtu.edu.cn/jy-application-canvas-sjtu/directOnDemandPlay/vod-analysis/query-ppt-slice-es?ivsVideoId={}", canvas_course_id);
        let resp = self
            .cli
            .get(url)
            .header("token", self.token.read().await.as_str())
            .send()
            .await?
            .error_for_status()?;
        let bytes = resp.bytes().await?;
        let resp = utils::parse_json::<CanvasVideoPPTResponse>(&bytes)?;
        resp.data
            .ok_or(AppError::VideoDownloadError("No PPT Found".to_string()))
    }

    /// Downloads PPT images and converts them to a PDF document
    pub async fn download_ppt_pdf<F: Fn(ProgressPayload) + Send + 'static>(
        self: Arc<Self>,
        ppts: &[CanvasVideoPPT],
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let total = ppts.len() as u64;
        let mut warning: Vec<PdfWarnMsg> = Vec::new();
        // extract savename from save_path
        let save_name = get_file_name(save_path);
        
        let mut images: Vec<RawImage> = Vec::new();
        // Process each PPT slide
        for (total_processed, (index, ppt)) in ppts.iter().enumerate().enumerate() {
            // Download image with error handling
            let image_data = match self.cli.get(&ppt.ppt_img_url).send().await {
                Ok(response) => response.bytes().await?,
                Err(e) => {
                    return Err(AppError::VideoDownloadError(
                        format!("Failed to download PPT image {}: {}", index, e),
                    ))
                }
            };

            tracing::info!(
                "Downloaded image {}: {} bytes",
                index,
                image_data.len()
            );

            // TODO: Add To PDF
            let image = RawImage::decode_from_bytes(&image_data, &mut warning).unwrap();
            images.push(image.clone());

            // Report progress
            progress_handler(ProgressPayload {
                uuid: format!("ppt_{}", save_name),
                processed: total_processed as u64,
                total,
            });
        }

        // TODO: Create A PDF Document
        let mut doc = PdfDocument::new(save_path);
        let mut pages: Vec<PdfPage> = Vec::new();

        for image in images {
            let dpi = 300.0; // 假设默认 96 DPI
            let conversion_factor = 25.4 / dpi;
            let width = Mm(image.width as f32 * conversion_factor);
            let height = Mm(image.height as f32 * conversion_factor);
            let image_xobject_id = doc.add_image(&image);
            let page_contents = vec![Op::UseXobject {
                id: image_xobject_id.clone(),
                transform: XObjectTransform::default(),
            }];
            let page = PdfPage::new(width, height, page_contents); // Adjust page size dynamically
            pages.push(page);
        }

        // TODO: Save PDF
        let pdf_bytes: Vec<u8> = doc
            .with_pages(pages)
            .save(&PdfSaveOptions::default(), &mut warning);

        let mut file = File::create(save_path)?;
        file.write_all(&pdf_bytes)?;
        file.flush()?;
        tracing::info!("PDF saved to {}", save_path);
        tracing::info!("PDF warnings: {:?}", warning);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

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

    #[tokio::test]
    async fn test_download_video() -> Result<()> {
        let cli = Arc::new(Client::new());
        // let video_url = "https://www.w3schools.com/html/mov_bbb.mp4";
        // a bigger one, more than one video block
        let video_url = "https://download.samplelib.com/mp4/sample-10s.mp4";
        let save_path = "test.mp4";
        let video_info = VideoPlayInfo {
            rtmp_url_hdv: video_url.to_owned(),
            ..Default::default()
        };
        let cli_cloned = cli.clone();
        cli_cloned
            .download_video(&video_info, save_path, |_| {})
            .await?;

        // download original video
        let original = cli
            .get_request(video_url, None::<&str>)
            .await?
            .bytes()
            .await?
            .to_vec();

        let downloaded = fs::read(save_path)?;
        assert_eq!(original, downloaded);
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
