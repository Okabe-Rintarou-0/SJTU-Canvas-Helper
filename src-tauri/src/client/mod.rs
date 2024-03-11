use std::{
    cmp::min,
    collections::HashMap,
    fs,
    io::Write,
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use md5::{Digest, Md5};
use reqwest::{
    cookie::{self, CookieStore, Jar},
    header::{HeaderValue, ACCEPT, CONTENT_RANGE, RANGE, REFERER},
    Response, StatusCode,
};
use select::{document::Document, node::Node, predicate::Name};
use serde::{de::DeserializeOwned, Serialize};
use tauri::Url;

use crate::{
    error::{ClientError, Result},
    model::{
        Assignment, CalendarEvent, Colors, Course, File, Folder, ItemPage, ProgressPayload,
        Subject, Submission, User, VideoCourse, VideoInfo, VideoPlayInfo,
    },
};
const BASE_URL: &str = "https://oc.sjtu.edu.cn";
const VIDEO_BASE_URL: &str = "https://courses.sjtu.edu.cn/app";
const VIDEO_LOGIN_URL: &str = "https://courses.sjtu.edu.cn/app/oauth/2.0/login?login_type=outer";
const VIDEO_OAUTH_KEY_URL: &str = "https://courses.sjtu.edu.cn/app/vodvideo/vodVideoPlay.d2j?ssoCheckToken=ssoCheckToken&refreshToken=&accessToken=&userId=&";
const VIDEO_INFO_URL: &str =
    "https://courses.sjtu.edu.cn/app/system/resource/vodVideo/getvideoinfos";
const AUTH_URL: &str = "https://jaccount.sjtu.edu.cn";
const MY_SJTU_URL: &str = "https://my.sjtu.edu.cn/ui/appmyinfo";
const EXPRESS_LOGIN_URL: &str = "https://jaccount.sjtu.edu.cn/jaccount/expresslogin";
const OAUTH_PATH: &str =
    "aHR0cHM6Ly9jb3Vyc2VzLnNqdHUuZWR1LmNuL2FwcC92b2R2aWRlby92b2RWaWRlb1BsYXkuZDJq";
const OAUTH_RANDOM: &str = "oauth_ABCDE=ABCDEFGH&oauth_VWXYZ=STUVWXYZ";
const OAUTH_RANDOM_P1: &str = "oauth_ABCDE";
const OAUTH_RANDOM_P2: &str = "oauth_VWXYZ";
const OAUTH_RANDOM_P1_VAL: &str = "ABCDEFGH";
const OAUTH_RANDOM_P2_VAL: &str = "STUVWXYZ";
const CHUNK_SIZE: u64 = 512 * 1024;
const VIDEO_CHUNK_SIZE: u64 = 4 * 1024 * 1024;
pub struct Client {
    cli: reqwest::Client,
    jar: Arc<Jar>,
}

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

    async fn get_request_with_token<T: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<Response> {
        let mut req = self
            .cli
            .get(url)
            .header("Authorization", format!("Bearer {}", token));

        if let Some(query) = query {
            req = req.query(query)
        }

        let res = req.send().await?;
        Ok(res)
    }

    async fn get_json_with_token<T: Serialize + ?Sized, D: DeserializeOwned>(
        &self,
        url: &str,
        query: Option<&T>,
        token: &str,
    ) -> Result<D> {
        let response = self
            .get_request_with_token(url, query, token)
            .await?
            .error_for_status()?;
        let json = serde_json::from_slice(&response.bytes().await?)?;
        Ok(json)
    }

    pub async fn post_form_with_token<T: Serialize + ?Sized, Q: Serialize + ?Sized>(
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
        self.post_form_with_token(
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
            .get_request_with_token(&file.url, None::<&str>, token)
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

    pub async fn list_ta_courses(&self, token: &str) -> Result<Vec<Course>> {
        let url = format!(
            "{}/api/v1/courses?include[]=teachers&include[]=term&enrollment_type=ta",
            BASE_URL
        );
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

// Apis here are for course video
// We take references from: https://github.com/prcwcy/sjtu-canvas-video-download/blob/master/sjtu_canvas_video.py
impl Client {
    pub fn init_cookie(&self, cookie: &str) {
        self.jar
            .add_cookie_str(cookie, &Url::parse(VIDEO_BASE_URL).unwrap());
    }

    async fn get_request<T: Serialize + ?Sized>(
        &self,
        url: &str,
        query: Option<&T>,
    ) -> Result<Response> {
        let mut req = self.cli.get(url);

        if let Some(query) = query {
            req = req.query(query);
        }

        let res = req.send().await?;
        Ok(res)
    }

    async fn get_json_with_cookie<T: Serialize + ?Sized, D: DeserializeOwned>(
        &self,
        url: &str,
        query: Option<&T>,
    ) -> Result<D> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let mut req = self.cli.get(url).headers(headers);

        if let Some(query) = query {
            req = req.query(query);
        }

        let response = req.send().await?.error_for_status()?;
        let json = serde_json::from_slice(&response.bytes().await?)?;
        Ok(json)
    }

    pub async fn get_uuid(&self) -> Result<Option<String>> {
        let resp = self.cli.get(MY_SJTU_URL).send().await?.error_for_status()?;

        let body = resp.text().await?;
        let document = Document::from(body.as_str());

        let Some(input) = document.find(Name("input")).find(|n: &Node| {
            n.attr("type").unwrap_or_default() == "hidden"
                && n.attr("name").unwrap_or_default() == "uuid"
        }) else {
            return Ok(None);
        };

        let uuid = input.attr("value").unwrap_or_default();
        Ok(Some(uuid.to_owned()))
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
                return Err(ClientError::LoginError);
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
            downloaded: 0,
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
            payload.downloaded += read_bytes;
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
mod test {
    use crate::{client::Client, error::Result};

    #[tokio::test]
    async fn test_get_uuid() -> Result<()> {
        let cli = Client::new();
        let uuid = cli.get_uuid().await?;
        println!("Read uuid: {:?}", uuid);
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
