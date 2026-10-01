use std::{
    collections::HashMap,
    fs::File,
    io::Write,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use super::{
    constants::{
        AUTH_URL, CANVAS_LOGIN_URL, EXPRESS_LOGIN_URL, MY_SJTU_ACCOUNT_URL, MY_SJTU_URL,
        VIDEO_BASE_URL, VIDEO_LOGIN_URL, VIDEO_OAUTH_KEY_URL,
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
        CanvasVideo, CanvasVideoPPT, CanvasVideoPPTOcr, CanvasVideoSubTitle, CanvasVideoSubTitleResponseBody, Course,
        ItemPage, ProgressPayload, Teacher, Term, VideoCourse, VideoInfo, VideoPlayInfo,
        VideoSource,
    },
    utils::{self, file::get_file_name, file::write_file_at_offset, time::format_time},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, TimeZone};
use md5::{Digest, Md5};
use printpdf::*;
use regex::Regex;
use reqwest::{
    cookie::{CookieStore, Jar},
    header::{
        HeaderMap, HeaderValue, ACCEPT, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, RANGE,
        REFERER,
    },
    redirect::Policy,
    Response, StatusCode,
};
use select::{document::Document, node::Node, predicate::Name};
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tauri::Url;
use tokio::{sync::Mutex, task::JoinSet};

const RESOURCE_MANAGE_BASE_URL: &str = "https://v.sjtu.edu.cn/jy-application-resourcemanage";
const RESOURCE_MANAGE_UI_URL: &str = "https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/";
const VIDEO_SPACE_LAUNCH_URL: &str =
    "https://oc.sjtu.edu.cn/accounts/1/external_tools/3136?launch_type=global_navigation";
const CANVAS_VIDEO_TOOL_ID: i64 = 8329;
const LEGACY_VIDEO_LIST_URL: &str = "https://courses.sjtu.edu.cn/lti/vodVideo/findVodVideoList";
const LEGACY_VIDEO_INFO_URL: &str = "https://courses.sjtu.edu.cn/lti/vodVideo/getVodVideoInfos";

fn deserialize_null_default<'de, D, T>(deserializer: D) -> std::result::Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCanvasVideoResponse {
    body: Option<LegacyCanvasVideoResponseBody>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCanvasVideoResponseBody {
    #[serde(default)]
    list: Vec<LegacyCanvasVideo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyVideoInfoResponse {
    code: i64,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    desc: String,
    body: Option<VideoInfo>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyCanvasVideo {
    #[serde(default, deserialize_with = "deserialize_null_default")]
    video_id: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    user_name: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    video_name: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    classroom_name: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    course_begin_time: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    course_end_time: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacySubject {
    #[serde(default, deserialize_with = "deserialize_null_default")]
    subject_id: i64,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    subject_name: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    tecl_id: i64,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    user_name: String,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    begin_year: i64,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    end_year: i64,
    #[serde(default, deserialize_with = "deserialize_null_default")]
    term_time: i64,
}

impl From<LegacyCanvasVideo> for CanvasVideo {
    fn from(video: LegacyCanvasVideo) -> Self {
        Self {
            source: VideoSource::Legacy,
            video_id: video.video_id,
            user_name: video.user_name,
            video_name: video.video_name,
            classroom_name: video.classroom_name,
            course_begin_time: video.course_begin_time,
            course_end_time: video.course_end_time,
            playable: true,
            ..Default::default()
        }
    }
}

fn normalize_legacy_match(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn raw_query_parameter(url: &Url, name: &str) -> Option<String> {
    url.query()?.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then(|| value.to_string())
    })
}

fn external_tool_urls_from_tabs(value: &Value, base_url: &Url) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|tab| {
            tab.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| id.starts_with("context_external_tool_"))
        })
        .filter_map(|tab| tab.get("html_url").and_then(Value::as_str))
        .filter_map(|url| base_url.join(url).ok())
        .map(|url| url.to_string())
        .collect()
}

fn legacy_subject_matches_term(subject: &LegacySubject, term_name: &str) -> bool {
    let normalized = normalize_legacy_match(term_name);
    let years_match = normalized.contains(&subject.begin_year.to_string())
        && normalized.contains(&subject.end_year.to_string());
    if !years_match {
        return false;
    }
    let semester = match subject.term_time {
        1 => ["-1", "第一学期", "秋", "fall"].as_slice(),
        2 => ["-2", "第二学期", "春", "spring"].as_slice(),
        3 => ["-3", "第三学期", "夏", "summer"].as_slice(),
        _ => return true,
    };
    semester.iter().any(|marker| normalized.contains(marker))
}

fn legacy_video_time(timestamp: i64) -> String {
    let datetime = if timestamp.abs() >= 10_000_000_000 {
        Local.timestamp_millis_opt(timestamp).single()
    } else {
        Local.timestamp_opt(timestamp, 0).single()
    };
    datetime
        .map(|value| value.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

fn legacy_videos_from_course(course: VideoCourse) -> Vec<CanvasVideo> {
    let course_name = course.subj_name;
    course
        .response_vo_list
        .into_iter()
        .filter(|video| video.id > 0)
        .map(|video| CanvasVideo {
            source: VideoSource::Legacy,
            video_id: video.id.to_string(),
            user_name: video.user_name,
            video_name: if video.vide_name.is_empty() {
                course_name.clone()
            } else {
                video.vide_name
            },
            course_begin_time: legacy_video_time(video.cour_begin_time),
            course_end_time: legacy_video_time(video.cour_end_time),
            playable: true,
            availability: "ready".to_string(),
            availability_label: "可播放".to_string(),
            ..Default::default()
        })
        .collect()
}

// These IDs belong to the video service, not Canvas. Keep this list separate.
fn video_space_courses_from_response(value: &Value) -> Result<Vec<Course>> {
    let records = api_data(value)?
        .get("records")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::VideoDownloadError("Video course list is missing records".into())
        })?;
    records
        .iter()
        .map(|record| {
            let id = value_as_i64(record.get("teclId"))
                .filter(|id| *id > 0)
                .ok_or_else(|| {
                    AppError::VideoDownloadError("Video course is missing teaching class id".into())
                })?;
            Ok(Course {
                id,
                name: first_string(record, &["subjName", "teclName"]),
                course_code: first_string(record, &["courseNo", "teclCode"]),
                teachers: record
                    .get("teacNames")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(|name| Teacher {
                        display_name: name.into(),
                        ..Default::default()
                    })
                    .collect(),
                term: Term {
                    id: value_as_i64(record.get("acteId")).unwrap_or_default(),
                    name: format!(
                        "{}-{} 第{}学期",
                        first_string(record, &["acyeBeginYear"]),
                        first_string(record, &["acyeEndYear"]),
                        first_string(record, &["acteName"])
                    ),
                    ..Default::default()
                },
                ..Default::default()
            })
        })
        .collect()
}

fn value_as_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
            .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
    })
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    })
}

fn first_string(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| value_as_string(value.get(*key)))
        .unwrap_or_default()
}

fn weekday_name(day: i64) -> String {
    match day {
        1 => "周一".to_string(),
        2 => "周二".to_string(),
        3 => "周三".to_string(),
        4 => "周四".to_string(),
        5 => "周五".to_string(),
        6 => "周六".to_string(),
        7 => "周日".to_string(),
        _ => format!("星期{day}"),
    }
}

fn canvas_video_availability(record: &Value) -> (bool, String, String) {
    match value_as_i64(record.get("vodStatus")) {
        Some(5) => (true, "ready".to_string(), "可播放".to_string()),
        Some(4) => (false, "repairing".to_string(), "修复中".to_string()),
        Some(6) => (false, "unavailable".to_string(), "暂无回放".to_string()),
        _ => (false, "unavailable".to_string(), "暂不可用".to_string()),
    }
}

fn daily_lesson_numbers(records: &[Value]) -> HashMap<usize, i64> {
    let mut daily_records: HashMap<String, Vec<(usize, String)>> = HashMap::new();
    for (index, record) in records.iter().enumerate() {
        let begin_time = first_string(record, &["courBeginTime", "beginTime"]);
        let date = begin_time.split_whitespace().next().unwrap_or_default();
        let subject_id = first_string(record, &["subjId", "teclId"]);
        let key = if date.is_empty() {
            format!("record-{index}")
        } else {
            format!("{subject_id}-{date}")
        };
        daily_records
            .entry(key)
            .or_default()
            .push((index, begin_time));
    }

    let mut lesson_numbers = HashMap::new();
    for records in daily_records.values_mut() {
        records.sort_by(|left, right| left.1.cmp(&right.1));
        for (lesson_index, (record_index, _)) in records.iter().enumerate() {
            lesson_numbers.insert(*record_index, lesson_index as i64 + 1);
        }
    }
    lesson_numbers
}

fn api_data(value: &Value) -> Result<&Value> {
    let status = value_as_i64(value.get("status")).unwrap_or(200);
    if status != 200 {
        let message = first_string(value, &["message", "msg", "code"]);
        return Err(AppError::VideoDownloadError(if message.is_empty() {
            format!("Video service returned status {status}")
        } else {
            message
        }));
    }

    value
        .get("data")
        .filter(|value| !value.is_null())
        .or_else(|| value.get("result"))
        .filter(|value| !value.is_null())
        .ok_or_else(|| AppError::VideoDownloadError("Video service returned no data".to_string()))
}

fn canvas_videos_from_response(value: &Value, source: VideoSource) -> Result<Vec<CanvasVideo>> {
    let records = api_data(value)?
        .get("records")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::VideoDownloadError("Video list is missing records".to_string()))?;
    let daily_lesson_numbers = daily_lesson_numbers(records);

    Ok(records
        .iter()
        .enumerate()
        .filter_map(|(record_index, record)| {
            let video_id = first_string(record, &["id", "courseId", "courId"]);
            if video_id.is_empty() {
                return None;
            }
            let subject_name = first_string(record, &["subjName", "courName", "courseName"]);
            let week_number =
                value_as_i64(record.get("weekNumber").or_else(|| record.get("weekNo")))
                    .unwrap_or_default();
            let week_day = value_as_i64(record.get("week")).unwrap_or_default();
            let lesson_number = value_as_i64(record.get("letiNumber")).unwrap_or_default();
            let daily_lesson_number = daily_lesson_numbers
                .get(&record_index)
                .copied()
                .unwrap_or(1);
            let schedule_name = if week_number > 0 && week_day > 0 {
                format!(
                    "第{week_number}周 {} 第{daily_lesson_number}节",
                    weekday_name(week_day)
                )
            } else {
                first_string(record, &["courBeginTime", "beginTime"])
            };
            let video_name = match subject_name.as_str() {
                "" => schedule_name,
                name => format!("{name} {schedule_name}"),
            };
            let (playable, availability, availability_label) = canvas_video_availability(record);
            Some(CanvasVideo {
                source,
                video_id,
                user_name: first_string(record, &["tecName", "userName", "teacherName"]),
                video_name,
                classroom_name: first_string(
                    record,
                    &["classRoomName", "classroomName", "clroName"],
                ),
                course_begin_time: first_string(record, &["courBeginTime", "beginTime"]),
                course_end_time: first_string(record, &["courEndTime", "endTime"]),
                week_number,
                week_day,
                lesson_number,
                daily_lesson_number,
                playable,
                availability,
                availability_label,
            })
        })
        .collect())
}

fn video_info_from_response(value: &Value) -> Result<VideoInfo> {
    let data = api_data(value)?;
    let course_id = value_as_i64(
        data.get("id")
            .or_else(|| data.get("courseId"))
            .or_else(|| data.get("courId")),
    )
    .ok_or_else(|| AppError::VideoDownloadError("Video id is missing".to_string()))?;
    let views = data
        .get("courseVodViewList")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let video_play_response_vo_list = views
        .iter()
        .enumerate()
        .filter_map(|(index, view)| {
            let url = first_string(view, &["url", "playUrl", "rtmpUrlHdv"]);
            if url.is_empty() {
                return None;
            }
            let view_num = value_as_i64(view.get("viewNum")).unwrap_or(index as i64 + 1);
            Some(VideoPlayInfo {
                id: course_id.saturating_mul(100).saturating_add(view_num),
                rtmp_url_hdv: url,
                cdvi_view_num: view_num,
                ..Default::default()
            })
        })
        .collect::<Vec<_>>();
    if video_play_response_vo_list.is_empty() {
        return Err(AppError::VideoDownloadError(
            "No playable video source was returned".to_string(),
        ));
    }

    Ok(VideoInfo {
        id: course_id,
        cour_id: course_id,
        vide_name: first_string(data, &["courName", "subjName", "courseName"]),
        cour_name: first_string(data, &["courName", "subjName", "courseName"]),
        clro_name: first_string(data, &["classRoomName", "classroomName", "clroName"]),
        user_name: first_string(data, &["tecName", "userName", "teacherName"]),
        vide_begin_time: first_string(data, &["courBeginTime", "beginTime"]),
        vide_end_time: first_string(data, &["courEndTime", "endTime"]),
        rtmp_url_hdv: video_play_response_vo_list[0].rtmp_url_hdv.clone(),
        vide_record_channel_num: video_play_response_vo_list.len() as i64,
        video_play_response_vo_list,
        ..Default::default()
    })
}

fn subtitles_from_response(value: &Value) -> Result<CanvasVideoSubTitleResponseBody> {
    let data = api_data(value).map_err(|error| match error {
        AppError::VideoDownloadError(message) if message == "Video service returned no data" => {
            AppError::VideoDownloadError("Subtitle unavailable".to_string())
        }
        error => error,
    })?;
    let subtitles: CanvasVideoSubTitleResponseBody = serde_json::from_value(data.clone())?;
    if subtitles.before_assembly_list.is_empty() && subtitles.after_assembly_list.is_empty() {
        return Err(AppError::VideoDownloadError(
            "Subtitle unavailable".to_string(),
        ));
    }
    Ok(subtitles)
}

fn ppts_from_response(value: &Value) -> Result<Vec<CanvasVideoPPT>> {
    let docs = api_data(value)?
        .get("docList")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::VideoDownloadError("No PPT found".to_string()))?;
    Ok(docs
        .iter()
        .filter_map(|doc| {
            let url = first_string(doc, &["imageUrl", "pptImgUrl", "url"]);
            let mut ocr = doc.get("textKeywordList").map(parse_ppt_ocr).unwrap_or_default();
            if ocr.is_empty() {
                ocr = doc.get("ocr").map(parse_ppt_ocr).unwrap_or_default();
            }
            let ocr_text = first_string(doc, &["ocrText"]);
            (!url.is_empty() || !ocr.is_empty() || !ocr_text.trim().is_empty()).then(|| CanvasVideoPPT {
                // imageSnapshotTime is a wall-clock placeholder, not the playback offset.
                create_sec: first_string(doc, &["imageSeekTime", "createSec", "createTime", "time"]),
                ocr,
                ocr_text,
                animation_start_sec: None,
                related_slide_secs: Vec::new(),
                ppt_img_url: (!url.is_empty()).then_some(url),
            })
        })
        .collect())
}

fn parse_ppt_ocr(value: &Value) -> Vec<CanvasVideoPPTOcr> {
    match value {
        Value::Array(items) => items.iter().flat_map(parse_ppt_ocr).collect(),
        Value::Object(_) => {
            let word = first_string(value, &["word", "text"]);
            if word.trim().is_empty() { Vec::new() } else { vec![CanvasVideoPPTOcr { word }] }
        }
        Value::String(word) if !word.trim().is_empty() => {
            // Some service versions JSON-encode the OCR list.
            if let Ok(parsed) = serde_json::from_str::<Value>(word) {
                if parsed.is_array() || parsed.is_object() { return parse_ppt_ocr(&parsed); }
            }
            vec![CanvasVideoPPTOcr { word: word.clone() }]
        }
        _ => Vec::new(),
    }
}

fn jwt_token_from_location(location: &str) -> Option<String> {
    let fragment = location.split('#').nth(1).unwrap_or(location);
    let query = fragment
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or(fragment);
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "jwt_token")
            .then(|| {
                urlencoding::decode(value)
                    .ok()
                    .map(|value| value.into_owned())
            })
            .flatten()
    })
}

fn parse_download_probe(status: StatusCode, headers: &HeaderMap) -> (u64, bool) {
    let supports_range = status == StatusCode::PARTIAL_CONTENT
        || headers.get(CONTENT_RANGE).is_some()
        || headers
            .get(ACCEPT_RANGES)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.contains("bytes"))
            .unwrap_or(false);

    if let Some(range) = headers
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
    {
        let parts: Vec<_> = range.split('/').collect();
        if parts.len() == 2 {
            let size = parts[1].parse().unwrap_or_default();
            if size > 0 {
                return (size, supports_range);
            }
        }
    }

    if let Some(length) = headers
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
    {
        let size = length.parse().unwrap_or_default();
        if size > 0 {
            return (size, supports_range);
        }
    }

    (0, supports_range)
}

fn get_cookie_value(cookies: &str, name: &str) -> Option<String> {
    cookies.split(';').find_map(|kv| {
        let (key, value) = kv.trim().split_once('=')?;
        if key == name {
            Some(value.to_owned())
        } else {
            None
        }
    })
}

// Apis here are for course video
// We take references from: https://github.com/prcwcy/sjtu-canvas-video-download/blob/master/sjtu_canvas_video.py
impl Client {
    pub fn init_cookie(&self, cookie: &str) {
        self.jar
            .add_cookie_str(cookie, &Url::parse(VIDEO_BASE_URL).unwrap());
    }

    // The extra login flow may bounce across jAccount and my.sjtu domains,
    // so we attach the cookie to both hosts before probing protected pages.
    fn attach_ja_auth_cookie(&self, cookie: &str) {
        for url in [AUTH_URL, MY_SJTU_URL] {
            self.jar.add_cookie_str(cookie, &Url::parse(url).unwrap());
        }
    }

    pub async fn get_uuid(&self) -> Result<Option<String>> {
        let resp = self.cli.get(MY_SJTU_URL).send().await?.error_for_status()?;
        let body = resp.text().await?;
        // let document = Document::from(body.as_str());
        let re = Regex::new(
            r#"uuid\s*[:=]\s*["']?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})["']?"#,
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
        let url = format!("{EXPRESS_LOGIN_URL}?uuid={uuid}");
        self.cli.get(&url).send().await?.error_for_status()?;
        let domain = Url::parse(AUTH_URL).unwrap();
        if let Some(value) = self.jar.cookies(&domain) {
            if let Ok(cookies) = value.to_str() {
                if let Some(cookie) = get_cookie_value(cookies, "JAAuthCookie") {
                    return Ok(Some(cookie));
                }
            }
        }
        Ok(None)
    }

    pub async fn login_video_website(&self, cookie: &str) -> Result<Option<String>> {
        // Keep the legacy OAuth flow isolated from Canvas LTI launches. Both
        // services use jAccount, but mixing their transient cookies in the
        // shared jar can make the legacy endpoint redirect back to itself.
        let login_jar = Arc::new(Jar::default());
        for url in [AUTH_URL, MY_SJTU_URL] {
            login_jar.add_cookie_str(cookie, &Url::parse(url).unwrap());
        }
        let login_client = reqwest::Client::builder()
            .no_proxy()
            .redirect(Policy::limited(32))
            .cookie_provider(login_jar.clone())
            .build()?;
        let response = login_client.get(VIDEO_LOGIN_URL).send().await?;
        let url = response.url();
        if let Some(domain) = url.domain() {
            if domain == "jaccount.sjtu.edu.cn" {
                return Err(AppError::LoginError);
            }
        }
        if let Some(cookies) = login_jar.cookies(&Url::parse(VIDEO_BASE_URL).unwrap()) {
            if let Ok(cookies) = cookies.to_str() {
                self.init_cookie(cookies);
                return Ok(Some(cookies.to_owned()));
            }
        }
        Ok(None)
    }

    pub async fn login_canvas_website(&self, cookie: &str) -> Result<()> {
        self.attach_ja_auth_cookie(cookie);
        let response = self.get_request(CANVAS_LOGIN_URL, None::<&str>).await?;
        let url = response.url();
        if let Some(domain) = url.domain() {
            if domain == "jaccount.sjtu.edu.cn" {
                return Err(AppError::LoginError);
            }
        }
        Ok(())
    }

    pub async fn check_extra_login_status(&self, cookie: &str) -> Result<bool> {
        self.attach_ja_auth_cookie(cookie);
        // Warm up the SSO chain first. Without this request, the first direct
        // API probe can report unauthenticated even when the cookie is valid.
        let warmup = self.get_request(MY_SJTU_URL, None::<&str>).await?;
        if !warmup.status().is_success() {
            return Ok(false);
        }
        let response = self.get_request(MY_SJTU_ACCOUNT_URL, None::<&str>).await?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return Ok(false);
        }
        if !status.is_success() {
            return Ok(false);
        }
        let body = response.text().await?;
        Ok(!body.trim().is_empty())
    }

    pub async fn get_page_items<T: Serialize + DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<Vec<T>> {
        let mut page_index = 1;
        let mut all_items = vec![];

        loop {
            let paged_url = format!("{url}pageSize=100&pageIndex={page_index}");
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

    async fn get_video_space_token(&self) -> Result<String> {
        self.get_video_space_token_from_url(VIDEO_SPACE_LAUNCH_URL)
            .await
    }

    async fn get_video_space_token_from_url(&self, launch_url: &str) -> Result<String> {
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .cookie_provider(self.jar.clone())
            .build()?;
        let mut request = client.get(launch_url);
        for _ in 0..16 {
            let response = request.send().await?.error_for_status()?;
            let base = response.url().clone();
            if base.domain() == Some("jaccount.sjtu.edu.cn") {
                return Err(AppError::LoginError);
            }
            if let Some(location) = response.headers().get("location") {
                let next = base
                    .join(location.to_str()?)
                    .map_err(|_| AppError::LoginError)?;
                if let Some(token) = jwt_token_from_location(next.as_str()) {
                    return Ok(token);
                }
                request = client.get(next);
                continue;
            }
            let body = response.text().await?;
            let document = Document::from(body.as_str());
            let embedded_token = document
                .find(Name("iframe"))
                .filter_map(|node| node.attr("src"))
                .find_map(jwt_token_from_location);
            if let Some(token) = embedded_token {
                return Ok(token);
            }
            let (action, data) = self.get_form_submission_from_doc(document)?;
            request = client
                .post(self.resolve_form_action(&base, &action)?)
                .form(&data);
        }
        Err(AppError::VideoDownloadError(
            "Video space login did not finish".into(),
        ))
    }

    pub async fn list_video_space_courses(&self) -> Result<Vec<Course>> {
        let token = self.get_video_space_token().await?;
        let mut courses = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for page in 1..=1000 {
            let response = self
                .cli
                .get(format!(
                    "{RESOURCE_MANAGE_BASE_URL}/v1/group_subject_vod_list/t-1"
                ))
                .header("jwt-token", &token)
                .header(REFERER, RESOURCE_MANAGE_UI_URL)
                .query(&[
                    ("page.pageIndex", page.to_string()),
                    ("page.pageSize", "100".into()),
                    ("page.orders[0].asc", "false".into()),
                    ("page.orders[0].field", "updateTime".into()),
                ])
                .send()
                .await?
                .error_for_status()?;
            let value: Value = response.json().await?;
            let batch = video_space_courses_from_response(&value)?;
            let empty = batch.is_empty();
            let previous_len = courses.len();
            courses.extend(batch.into_iter().filter(|course| seen.insert(course.id)));
            let total = value_as_i64(api_data(&value)?.get("rowCount"));
            if empty || total.is_some_and(|total| courses.len() as i64 >= total) {
                return Ok(courses);
            }
            if previous_len == courses.len() {
                return Err(AppError::VideoDownloadError(
                    "Video course pagination made no progress".into(),
                ));
            }
        }
        Err(AppError::VideoDownloadError(
            "Video course pagination limit reached".into(),
        ))
    }

    pub async fn get_video_space_videos(&self, teaching_class_id: i64) -> Result<Vec<CanvasVideo>> {
        let token = self.get_video_space_token().await?;
        *self.token.write().await = token.clone();
        self.get_videos_for_teaching_class(teaching_class_id, token, VideoSource::VideoSpace)
            .await
    }

    fn get_form_submission_from_doc(
        &self,
        document: Document,
    ) -> Result<(String, HashMap<String, String>)> {
        let form = document
            .find(Name("form"))
            .next()
            .ok_or_else(|| AppError::VideoDownloadError("No launch form found".to_string()))?;
        let action = form
            .attr("action")
            .filter(|action| !action.is_empty())
            .ok_or_else(|| AppError::VideoDownloadError("Launch form has no action".to_string()))?
            .to_owned();

        let mut data = HashMap::new();
        for input in form.find(Name("input")) {
            if let Some(name) = input.attr("name") {
                if let Some(value) = input.attr("value") {
                    data.insert(name.to_owned(), value.to_owned());
                }
            }
        }
        Ok((action, data))
    }

    fn resolve_form_action(&self, base_url: &Url, action: &str) -> Result<String> {
        base_url
            .join(action)
            .map(|url| url.to_string())
            .map_err(|error| AppError::VideoDownloadError(format!("Invalid launch URL: {error}")))
    }

    async fn get_launch_form_for_canvas_course_id(
        &self,
        course_id: i64,
        tool_id: i64,
    ) -> Result<(String, HashMap<String, String>)> {
        let url = format!("https://oc.sjtu.edu.cn/courses/{course_id}/external_tools/{tool_id}");
        self.get_launch_form_from_url(&url).await
    }

    async fn get_launch_form_from_url(
        &self,
        url: &str,
    ) -> Result<(String, HashMap<String, String>)> {
        let response = self.cli.get(url).send().await?.error_for_status()?;
        let response_url = response.url().clone();
        let body = response.text().await?;
        let document = Document::from(body.as_str());
        let (action, data) = self.get_form_submission_from_doc(document)?;
        Ok((self.resolve_form_action(&response_url, &action)?, data))
    }

    async fn get_course_external_tool_urls(&self, course_id: i64) -> Result<Vec<String>> {
        let base_url = Url::parse(self.base_url.read().await.trim_end_matches('/')).map_err(|error| {
            AppError::VideoDownloadError(format!("Invalid Canvas base URL: {error}"))
        })?;
        let url = base_url
            .join(&format!("/api/v1/courses/{course_id}/tabs"))
            .map_err(|error| {
                AppError::VideoDownloadError(format!("Invalid Canvas tabs URL: {error}"))
            })?;
        let response = self.cli.get(url).send().await?.error_for_status()?;
        let value: Value = serde_json::from_slice(&response.bytes().await?)?;
        Ok(external_tool_urls_from_tabs(&value, &base_url))
    }

    async fn get_video_launch_token(&self, course_id: i64) -> Result<String> {
        let (action, data) = self
            .get_launch_form_for_canvas_course_id(course_id, CANVAS_VIDEO_TOOL_ID)
            .await?;
        let resp = self
            .cli
            .post(action)
            .form(&data)
            .send()
            .await?
            .error_for_status()?;

        let response_url = resp.url().clone();
        let body = resp.text().await?;
        let document = Document::from(body.as_str());
        let (action, data) = self.get_form_submission_from_doc(document)?;
        let action = self.resolve_form_action(&response_url, &action)?;

        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .cookie_provider(self.jar.clone())
            .build()?;
        let resp = client.post(&action).form(&data).send().await?;

        let location = resp
            .headers()
            .get("location")
            .ok_or_else(|| AppError::VideoDownloadError("Launch redirect not found".to_string()))?
            .to_str()?;
        let location = Url::parse(&action)
            .map_err(|error| AppError::VideoDownloadError(format!("Invalid launch URL: {error}")))?
            .join(location)
            .map_err(|error| {
                AppError::VideoDownloadError(format!("Invalid redirect URL: {error}"))
            })?
            .to_string();
        jwt_token_from_location(&location).ok_or_else(|| {
            AppError::VideoDownloadError("JWT token not found in launch redirect".to_string())
        })
    }

    async fn get_teaching_class_id_token(&self, course_id: i64) -> Result<(i64, String)> {
        let token = self.get_video_launch_token(course_id).await?;
        let url = format!("{RESOURCE_MANAGE_BASE_URL}/lms/launch-context");
        let response = self
            .cli
            .get(url)
            .header("jwt-token", &token)
            .header(REFERER, RESOURCE_MANAGE_UI_URL)
            .send()
            .await?
            .error_for_status()?;
        let value: Value = serde_json::from_slice(&response.bytes().await?)?;
        let data = api_data(&value)?;
        let teaching_class_id = value_as_i64(
            data.get("canvasRecord")
                .and_then(|record| record.get("teachingClassId")),
        )
        .ok_or_else(|| AppError::VideoDownloadError("Teaching class id is missing".to_string()))?;
        Ok((teaching_class_id, token))
    }

    pub async fn get_canvas_videos(&self, course_id: i64) -> Result<Vec<CanvasVideo>> {
        let (teaching_class_id, token) = self.get_teaching_class_id_token(course_id).await?;
        *self.token.write().await = token.to_owned();
        self.get_videos_for_teaching_class(teaching_class_id, token, VideoSource::Canvas)
            .await
    }

    async fn get_legacy_canvas_course_id(&self, course_id: i64) -> Result<Option<String>> {
        let tool_urls = self.get_course_external_tool_urls(course_id).await?;
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .cookie_provider(self.jar.clone())
            .build()?;
        for tool_url in tool_urls {
            let Ok((action, data)) = self.get_launch_form_from_url(&tool_url).await else {
                continue;
            };
            let Ok(response) = client.post(&action).form(&data).send().await else {
                continue;
            };
            if !response.status().is_redirection() {
                continue;
            }
            let Some(location) = response.headers().get("location") else {
                continue;
            };
            let Ok(location) = location.to_str() else {
                continue;
            };
            let Ok(action_url) = Url::parse(&action) else {
                continue;
            };
            let Ok(location) = action_url.join(location) else {
                continue;
            };
            if location.host_str() != Some("courses.sjtu.edu.cn") {
                continue;
            }
            // The legacy page embeds the still-percent-encoded token directly in
            // JavaScript and posts that value. Decoding it here changes the token
            // and makes findVodVideoList return an empty list.
            if let Some(canvas_course_id) = raw_query_parameter(&location, "canvasCourseId") {
                return Ok(Some(canvas_course_id));
            }
        }
        Ok(None)
    }

    async fn get_legacy_videos_from_lti(&self, course_id: i64) -> Result<Vec<CanvasVideo>> {
        let Some(canvas_course_id) = self.get_legacy_canvas_course_id(course_id).await? else {
            return Ok(Vec::new());
        };
        let response = self
            .cli
            .post(LEGACY_VIDEO_LIST_URL)
            .form(&[
                ("pageIndex", "1"),
                ("pageSize", "1000"),
                ("canvasCourseId", canvas_course_id.as_str()),
            ])
            .send()
            .await?
            .error_for_status()?;
        let response: LegacyCanvasVideoResponse =
            crate::utils::json::parse_json(&response.bytes().await?)?;
        Ok(response
            .body
            .map(|body| body.list.into_iter().map(CanvasVideo::from).collect())
            .unwrap_or_default())
    }

    async fn find_legacy_subjects(&self, course_name: &str) -> Result<Vec<LegacySubject>> {
        let response = self
            .cli
            .post(format!(
                "{VIDEO_BASE_URL}/system/course/subject/findSubjectVodList"
            ))
            .form(&[
                ("termTimeId", ""),
                ("firstFromCache", "true"),
                ("subjectName", course_name),
                ("orderByType", "1"),
                ("clroType", ""),
                ("pageIndex", "1"),
                ("pageSize", "100"),
            ])
            .send()
            .await?
            .error_for_status()?;
        let page: ItemPage<LegacySubject> =
            crate::utils::json::parse_json(&response.bytes().await?)?;
        Ok(page.list)
    }

    pub async fn get_legacy_videos(
        &self,
        course_id: i64,
        course_name: &str,
        term_name: &str,
        teacher_names: &[String],
    ) -> Result<Vec<CanvasVideo>> {
        let videos = self.get_legacy_videos_from_lti(course_id).await?;
        if !videos.is_empty() || course_name.trim().is_empty() {
            return Ok(videos);
        }

        let normalized_name = normalize_legacy_match(course_name);
        let normalized_teachers: Vec<String> = teacher_names
            .iter()
            .map(|teacher| normalize_legacy_match(teacher))
            .filter(|teacher| !teacher.is_empty())
            .collect();
        let subjects = self.find_legacy_subjects(course_name).await?;
        let mut candidates: Vec<LegacySubject> = subjects
            .into_iter()
            .filter(|subject| subject.subject_id > 0 && subject.tecl_id > 0)
            .filter(|subject| normalize_legacy_match(&subject.subject_name) == normalized_name)
            .collect();
        if candidates
            .iter()
            .any(|subject| legacy_subject_matches_term(subject, term_name))
        {
            candidates.retain(|subject| legacy_subject_matches_term(subject, term_name));
        }
        if !normalized_teachers.is_empty() {
            let teacher_matches = |subject: &LegacySubject| {
                normalized_teachers.contains(&normalize_legacy_match(&subject.user_name))
            };
            if candidates.iter().any(teacher_matches) {
                candidates.retain(teacher_matches);
            }
        }

        let mut videos = Vec::new();
        for subject in candidates {
            if let Some(course) = self
                .get_video_course(subject.subject_id, subject.tecl_id)
                .await?
            {
                videos.extend(legacy_videos_from_course(course));
            }
        }
        Ok(videos)
    }

    pub async fn get_legacy_video_info(&self, video_id: &str) -> Result<VideoInfo> {
        let response = self
            .cli
            .post(LEGACY_VIDEO_INFO_URL)
            .form(&[
                ("playTypeHls", "true"),
                ("id", video_id),
                ("isAudit", "true"),
            ])
            .send()
            .await?
            .error_for_status()?;
        let response: LegacyVideoInfoResponse =
            crate::utils::json::parse_json(&response.bytes().await?)?;
        if response.code != 200 {
            return Err(AppError::VideoDownloadError(response.desc));
        }
        response.body.ok_or_else(|| {
            AppError::VideoDownloadError("Legacy video service returned no data".to_string())
        })
    }

    async fn get_videos_for_teaching_class(
        &self,
        teaching_class_id: i64,
        token: String,
        source: VideoSource,
    ) -> Result<Vec<CanvasVideo>> {
        let url = format!("{RESOURCE_MANAGE_BASE_URL}/v1/subject_vod_list_new");
        let resp = self
            .cli
            .get(url)
            .header(REFERER, RESOURCE_MANAGE_UI_URL)
            .header("jwt-token", token)
            .query(&[
                ("page.pageIndex", "1".to_string()),
                ("page.pageSize", "1000".to_string()),
                ("teclIds", teaching_class_id.to_string()),
                ("page.orders[0].asc", "false".to_string()),
                ("page.orders[0].field", "courBeginTime".to_string()),
                ("schoolOpenStatusFlag", "false".to_string()),
            ])
            .send()
            .await?
            .error_for_status()?;
        let value: Value = serde_json::from_slice(&resp.bytes().await?)?;
        canvas_videos_from_response(&value, source)
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
            "{VIDEO_BASE_URL}/system/resource/vodVideo/getCourseListBySubject?orderField=courTimes&subjectId={subject_id}&teclId={tecl_id}&",
        );
        let mut courses = self.get_page_items(&url).await?;
        Ok((!courses.is_empty()).then(|| courses.remove(0)))
    }

    fn get_oauth_signature(
        &self,
        video_id: i64,
        oauth_nonce: &str,
        oauth_consumer_key: &str,
    ) -> String {
        let signature_string = format!("/app/system/resource/vodVideo/getvideoinfos?id={video_id}&oauth-consumer-key={oauth_consumer_key}&oauth-nonce={oauth_nonce}&oauth-path={OAUTH_PATH}&{OAUTH_RANDOM}&playTypeHls=true");
        let md5 = Md5::digest(signature_string);
        format!("{md5:x}")
    }

    fn get_oauth_nonce(&self) -> String {
        let now = SystemTime::now();
        let since_the_epoch = now.duration_since(UNIX_EPOCH).expect("Time went backwards");
        (since_the_epoch.as_nanos() / 1_000_000).to_string()
    }

    async fn download_video_partial(&self, url: &str, begin: u64, end: u64) -> Result<Response> {
        let range_value = HeaderValue::from_str(&format!("bytes={begin}-{end}")).unwrap();
        let response = self
            .cli
            .get(url)
            .header(RANGE, range_value)
            .header(REFERER, RESOURCE_MANAGE_UI_URL)
            .send()
            .await?;
        Ok(response)
    }

    async fn get_download_video_metadata(&self, url: &str) -> Result<(u64, bool)> {
        let resp = self.download_video_partial(url, 0, 0).await?;
        // log headers:
        tracing::info!("headers: {:?}", resp.headers());
        Ok(parse_download_probe(resp.status(), resp.headers()))
    }

    pub async fn download_video<F: Fn(ProgressPayload) + Send + 'static>(
        self: Arc<Self>,
        video: &VideoPlayInfo,
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let output_file = Arc::new(Mutex::new(File::create(save_path)?));
        let url = &video.rtmp_url_hdv;
        let (size, supports_range) = self.get_download_video_metadata(url).await?;
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

        if !supports_range {
            tracing::info!(
                "video source does not support range requests, fallback to single stream"
            );
            let mut response = self
                .cli
                .get(url)
                .header(REFERER, RESOURCE_MANAGE_UI_URL)
                .send()
                .await?;
            let status = response.status();
            if status != StatusCode::OK {
                tracing::error!("status not ok: {}", status);
                return Err(AppError::VideoDownloadError(save_path.to_owned()));
            }

            let progress_handler = Arc::new(Mutex::new(progress_handler));
            let payload = Arc::new(Mutex::new(payload));
            let mut current_offset = 0;
            while let Some(chunk) = response.chunk().await? {
                {
                    let mut file = output_file.lock().await;
                    write_file_at_offset(file.by_ref(), &chunk, current_offset)?;
                }
                current_offset += chunk.len() as u64;
                let mut payload_guard = payload.lock().await;
                payload_guard.processed = current_offset;
                progress_handler.lock().await(payload_guard.clone());
            }
            tracing::info!("Successfully downloaded video to {}", save_path);
            return Ok(());
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
        let url = format!("{RESOURCE_MANAGE_BASE_URL}/v1/course_vod_urls_new");
        let resp = self
            .cli
            .get(url)
            .query(&[("courseId", video_id)])
            .header("jwt-token", self.token.read().await.as_str())
            .header(REFERER, RESOURCE_MANAGE_UI_URL)
            .send()
            .await?
            .error_for_status()?;
        let value: Value = serde_json::from_slice(&resp.bytes().await?)?;
        video_info_from_response(&value)
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
        let video = utils::json::parse_json(&bytes)?;
        Ok(video)
    }

    pub async fn get_subtitle(
        &self,
        canvas_course_id: i64,
    ) -> Result<CanvasVideoSubTitleResponseBody> {
        let url = format!("{RESOURCE_MANAGE_BASE_URL}/v1/course/ai/translate/{canvas_course_id}");
        let resp = self
            .cli
            .get(url)
            .query(&[("useOriginal", true)])
            .header("jwt-token", self.token.read().await.as_str())
            .header(REFERER, RESOURCE_MANAGE_UI_URL)
            .send()
            .await?
            .error_for_status()?;
        let value: Value = serde_json::from_slice(&resp.bytes().await?)?;
        subtitles_from_response(&value)
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
            srt.push_str(&format!("{start_time} --> {end_time}\n"));
            srt.push_str(&format!("{text}\n\n"));
        }
        Ok(srt)
    }

    pub async fn get_ppt(&self, canvas_course_id: i64) -> Result<Vec<CanvasVideoPPT>> {
        let url = format!("{RESOURCE_MANAGE_BASE_URL}/v1/course/ai/ppt");
        let resp = self
            .cli
            .get(url)
            .query(&[("courseId", canvas_course_id)])
            .header("jwt-token", self.token.read().await.as_str())
            .header(REFERER, RESOURCE_MANAGE_UI_URL)
            .send()
            .await?
            .error_for_status()?;
        let value: Value = serde_json::from_slice(&resp.bytes().await?)?;
        ppts_from_response(&value)
    }

    /// Downloads PPT images and converts them to a PDF document
    pub async fn download_ppt_pdf<F: Fn(ProgressPayload) + Send + 'static>(
        self: Arc<Self>,
        ppts: &[CanvasVideoPPT],
        save_path: &str,
        progress_handler: F,
    ) -> Result<()> {
        let total = ppts.len() as u64;
        if !ppts.iter().any(|ppt| ppt.ppt_img_url.is_some()) {
            return Err(AppError::VideoDownloadError("PPT 切片缺少可用图片".into()));
        }
        let mut warning: Vec<PdfWarnMsg> = Vec::new();
        // extract savename from save_path
        let save_name = get_file_name(save_path);

        let mut images: Vec<RawImage> = Vec::new();
        // Process each PPT slide
        for (total_processed, (index, ppt)) in ppts.iter().enumerate().enumerate() {
            if ppt.ppt_img_url.is_none() {
                continue;
            }
            let ppt_img_url = ppt.ppt_img_url.clone().unwrap();
            // Download image with error handling
            let image_data = match self.cli.get(&ppt_img_url).send().await {
                Ok(response) => response.bytes().await?,
                Err(e) => {
                    return Err(AppError::VideoDownloadError(format!(
                        "Failed to download PPT image {index}: {e}"
                    )))
                }
            };

            tracing::info!("Downloaded image {}: {} bytes", index, image_data.len());

            // TODO: Add To PDF
            let image = RawImage::decode_from_bytes(&image_data, &mut warning)
                .map_err(|e| AppError::VideoDownloadError(format!("Invalid PPT image {index}: {e}")))?;
            images.push(image.clone());

            // Report progress
            progress_handler(ProgressPayload {
                uuid: format!("ppt_{save_name}"),
                processed: total_processed as u64,
                total,
            });
        }

        // TODO: Create A PDF Document
        let mut doc = PdfDocument::new(save_path);
        let mut pages: Vec<PdfPage> = Vec::new();

        for image in images {
            let dpi = 300.0; // 假设默认 300 DPI
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
    use crate::client::constants::BASE_URL;
    use reqwest::header::{HeaderMap, HeaderValue, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE};

    #[test]
    fn test_ppt_response_preserves_full_text_keywords_and_seek_times() {
        // Synthetic content with the field names used by the service.
        let response: Value = serde_json::from_str(include_str!("fixtures/ppt_ocr_response.json")).unwrap();
        let slides = ppts_from_response(&response).unwrap();
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0].create_sec, "359");
        assert_eq!(slides[1].create_sec, "1768");
        assert_eq!(slides[0].ocr.len(), 5);
        assert_eq!(slides[1].ocr[1].word, "ISBN");
        assert_eq!(slides[1].ocr_text, response["data"]["docList"][1]["ocrText"].as_str().unwrap());
        let (text, available, untimed) = crate::app::ppt::material_timeline("videoSpace:example", &[], &slides);
        assert!(available);
        assert_eq!(untimed, 0);
        assert!(text.contains("#video=videoSpace%3Aexample&t=1768"));
        assert!(text.contains("核对标题、版本和馆藏位置"));
        assert!(!text.contains("[仅关键词]"));
        assert_eq!(text.matches("核对标题、版本和馆藏位置").count(), 1);
        assert_eq!(crate::app::ppt::filter_export_slides(slides, true).0.len(), 2);
    }

    #[test]
    fn test_ppt_animation_simplification_and_summary_keep_complete_pages_and_original_times() {
        // De-identified sequence preserves OCR order/noise, formulas and page counters.
        let response: Value = serde_json::from_str(include_str!("fixtures/ppt_animation_sequence.json")).unwrap();
        let original = ppts_from_response(&response).unwrap();
        assert_eq!(original.len(), 41);
        assert!(!crate::model::AppConfig::default().experimental_ppt_cleanup);
        assert_eq!(crate::app::ppt::simplify_animation_slides(original.clone(), false), (original.clone(), vec![]));
        let (kept, notes) = crate::app::ppt::simplify_animation_slides(original, true);
        assert_eq!(kept.len(), 38);
        assert!(notes[0].contains("41 张 → 38 张"));
        for time in ["995", "1555", "2555"] {
            assert!(!kept.iter().any(|slide| slide.create_sec == time), "redundant slice {time}");
        }
        let complete = kept.iter().find(|slide| slide.create_sec == "1061").unwrap();
        assert_eq!(complete.animation_start_sec.as_deref(), Some("995"));
        assert!(complete.ocr_text.contains("负采样（negative sampling）"));
        // Complete annotated formula pages are retained, while different pages and
        // different section highlights are preserved even when their titles match.
        for time in ["80", "415", "418", "824", "1148", "1418", "2743", "2865", "402", "429", "434", "444", "514", "683", "736", "790", "911", "1800", "2867", "952", "2382", "2541", "2913"] {
            assert!(kept.iter().any(|slide| slide.create_sec == time));
        }
        let all_times: std::collections::HashSet<_> = kept.iter().flat_map(|slide| std::iter::once(slide.create_sec.clone()).chain(slide.related_slide_secs.iter().cloned())).collect();
        assert_eq!(all_times.len(), 41);
        let subtitles = vec![CanvasVideoSubTitle { bg: 995000, res: "这一页开始讲优化".into(), ..Default::default() }];
        let (text, available, _) = crate::app::ppt::material_timeline("videoSpace:example", &subtitles, &kept);
        assert!(available);
        assert!(text.contains("&t=995) [字幕] 这一页开始讲优化"));
        assert!(!text.contains("&t=995) [PPT OCR"));
        assert!(text.contains("&t=1061) [PPT OCR"));
        assert!(!text.contains("逐步展开"));
        assert!(text.contains("&t=2743)"));
        assert!(text.contains("&t=2867)"));
        assert!(!text.contains("&t=1555)"));
        assert!(text.contains("&t=1800) [PPT OCR"));
        assert!(text.contains("&t=418)"));
        assert!(text.contains("&t=434) [PPT OCR"));
        assert_eq!(text.matches("[PPT OCR]").count(), 37); // one image has no OCR
        // The same resulting slice list is the input to PDF export.
        assert_eq!(crate::app::ppt::filter_export_slides(kept, false).0.len(), 38);
    }

    #[test]
    fn test_ppt_full_text_only_and_zero_seek_time_take_precedence() {
        let slides = ppts_from_response(&serde_json::json!({"data": {"docList": [
            {"imageSeekTime": 0, "createSec": 999, "imageSnapshotTime": "1970-01-01 08:00:00", "ocrText": "全文独立可用", "textKeywordList": []},
            {"imageSnapshotTime": "1970-01-01 08:00:02", "ocrText": "时间未知全文"}
        ]}})).unwrap();
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0].create_sec, "0");
        assert_eq!(slides[1].create_sec, "");
        let (text, available, untimed) = crate::app::ppt::material_timeline("canvas:0", &[], &slides);
        assert!(available);
        assert_eq!(untimed, 1);
        assert!(text.contains("&t=0)"));
        assert!(text.contains("全文独立可用"));
        assert!(text.contains("时间未知全文"));
        assert!(!text.contains("&t=999"));
    }

    #[test]
    fn test_ppt_preserves_ocr_across_service_shapes_and_missing_images() {
        let slides = ppts_from_response(&serde_json::json!({"data": {"docList": [
            {"createSec": 356, "imageUrl": "https://example.test/one.png", "ocr": [{"word": "语法分析"}, {"word": "解析树"}]},
            {"createSec": "00:07:01", "pptImgUrl": "https://example.test/two.png", "ocr": ["Parser", {"text": "规约"}, null, {"word": ""}]},
            {"time": "bad", "ocr": "[{\"word\":\"无图片文字\"}]"},
            {"createSec": 0, "url": "https://example.test/empty.png"}
        ]}})).unwrap();
        assert_eq!(slides.len(), 4);
        assert_eq!(slides[0].create_sec, "356");
        assert_eq!(slides[0].ocr[0].word, "语法分析");
        assert_eq!(slides[1].ocr.len(), 2);
        assert_eq!(slides[1].ocr[1].word, "规约");
        assert_eq!(slides[2].ocr[0].word, "无图片文字");
        assert_eq!(slides[2].ppt_img_url, None);
        assert!(slides[3].ocr.is_empty());
    }

    #[test]
    fn test_video_space_courses_use_teaching_class_ids() {
        let courses = video_space_courses_from_response(&serde_json::json!({
            "status": 200, "data": { "rowCount": 2, "records": [
                {"id": 7, "teclId": "910", "subjName": "测试课程甲",
                 "teacNames": ["测试教师甲"], "acyeBeginYear": 2098, "acyeEndYear": 2099,
                 "acteName": "一", "acteId": 42},
                {"teclId": 911, "subjName": "测试课程乙"}
            ]}
        }))
        .unwrap();
        assert_eq!(courses.len(), 2);
        assert_eq!(courses[0].id, 910);
        assert_eq!(courses[0].teachers[0].display_name, "测试教师甲");
        assert_eq!(courses[0].term.name, "2098-2099 第一学期");
        assert_eq!(courses[1].name, "测试课程乙");
        assert!(video_space_courses_from_response(&serde_json::json!({
            "data": {"records": [{"id": 7}]}
        }))
        .is_err());
        assert!(video_space_courses_from_response(&serde_json::json!({
            "status": 401, "message": "expired"
        }))
        .is_err());
    }

    #[test]
    fn test_legacy_subject_term_matching() {
        let subject = LegacySubject {
            subject_id: 1,
            subject_name: "测试课程".to_string(),
            tecl_id: 2,
            user_name: "测试教师".to_string(),
            begin_year: 2098,
            end_year: 2099,
            term_time: 1,
        };
        assert!(legacy_subject_matches_term(&subject, "2098-2099 Fall"));
        assert!(legacy_subject_matches_term(&subject, "2098-2099 秋"));
        assert!(!legacy_subject_matches_term(&subject, "2098-2099 Spring"));
    }

    #[test]
    fn test_legacy_subject_accepts_null_fields() {
        let subject: LegacySubject = crate::utils::json::parse_json(
            r#"{"subjectId":1,"subjectName":"测试课程","teclId":2,"userName":null,"beginYear":2098,"endYear":2099,"termTime":1}"#.as_bytes(),
        )
        .unwrap();
        assert_eq!(subject.user_name, "");
    }

    #[test]
    fn test_legacy_canvas_course_id_keeps_percent_encoding() {
        let url = Url::parse(
            "https://courses.sjtu.edu.cn/lti/app?canvasCourseId=abc%2Fdef%2Bghi",
        )
        .unwrap();
        assert_eq!(
            raw_query_parameter(&url, "canvasCourseId").as_deref(),
            Some("abc%2Fdef%2Bghi")
        );
    }

    #[test]
    fn test_external_tool_urls_from_tabs_uses_only_tool_tabs() {
        let base_url = Url::parse("https://canvas.example/").unwrap();
        let tabs = serde_json::json!([
            {
                "id": "context_external_tool_400001",
                "html_url": "/courses/42/external_tools/400001"
            },
            {
                "id": "context_external_tool_400002",
                "html_url": "https://canvas.example/courses/42/external_tools/400002"
            },
            {"id": "modules", "html_url": "/courses/42/modules"}
        ]);
        assert_eq!(
            external_tool_urls_from_tabs(&tabs, &base_url),
            vec![
                "https://canvas.example/courses/42/external_tools/400001".to_string(),
                "https://canvas.example/courses/42/external_tools/400002".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn test_video_space_login_forms_and_redirect() {
        use httpmock::prelude::*;
        let server = MockServer::start();
        let launch = server.mock(|when, then| {
            when.method(GET).path("/launch");
            then.status(200).body(
                r#"<form action="/sso" method="post"><input name="launch" value="test"></form>"#,
            );
        });
        let sso = server.mock(|when, then| {
            when.method(POST).path("/sso").body("launch=test");
            then.status(302)
                .header("Location", "/ui/#/?jwt_token=test%2Btoken");
        });
        let client = Client::new_without_proxy(server.base_url().as_str(), "", "", "", None);
        assert_eq!(
            client
                .get_video_space_token_from_url(&server.url("/launch"))
                .await
                .unwrap(),
            "test+token"
        );
        launch.assert();
        sso.assert();
    }

    #[tokio::test]
    async fn test_get_uuid() -> Result<()> {
        let cli = Client::default();
        let uuid = cli.get_uuid().await?;
        assert!(uuid.is_some());
        let uuid: String = uuid.unwrap();
        assert!(!uuid.is_empty());
        Ok(())
    }

    #[cfg_attr(
        target_os = "macos",
        ignore = "macOS system-configuration panics in CI/local test env"
    )]
    #[tokio::test]
    async fn test_download_video() -> Result<()> {
        let _ = tracing_subscriber::fmt::try_init();
        let cli = Arc::new(Client::new_without_proxy(BASE_URL, "", "", "", None));
        let video_url = "https://www.w3schools.com/html/mov_bbb.mp4";
        let save_path = "test_download_video.mp4";
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
        let _ = fs::remove_file(save_path);
        Ok(())
    }

    #[test]
    fn test_parse_download_probe_with_partial_content() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_RANGE, HeaderValue::from_static("bytes 0-0/5485935"));
        let (size, supports_range) = parse_download_probe(StatusCode::PARTIAL_CONTENT, &headers);
        assert_eq!(size, 5_485_935);
        assert!(supports_range);
    }

    #[test]
    fn test_parse_download_probe_with_content_length_only() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_LENGTH, HeaderValue::from_static("5485935"));
        headers.insert(ACCEPT_RANGES, HeaderValue::from_static("none"));
        let (size, supports_range) = parse_download_probe(StatusCode::OK, &headers);
        assert_eq!(size, 5_485_935);
        assert!(!supports_range);
    }

    #[test]
    fn test_get_cookie_value_keeps_equals_in_value() {
        let cookies = "foo=bar; JAAuthCookie=abc==; other=value";

        assert_eq!(
            get_cookie_value(cookies, "JAAuthCookie"),
            Some("abc==".to_owned())
        );
    }

    #[test]
    fn test_get_oauth_signature() -> Result<()> {
        let cli = Client::default();
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
