use std::collections::HashMap;

use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Course {
    pub id: i64,
    #[serde(default)]
    pub uuid: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub course_code: String,
    #[serde(default)]
    pub enrollments: Vec<Enrollment>,
    #[serde(default)]
    pub access_restricted_by_date: Option<bool>,
}
impl Course {
    pub fn is_access_restricted(&self) -> bool {
        if let Some(restricted) = self.access_restricted_by_date {
            restricted
        } else {
            false
        }
    }
}
#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct File {
    pub id: i64,
    pub uuid: String,
    pub folder_id: i64,
    pub display_name: String,
    pub filename: String,
    pub url: String,
    pub size: u64,
    pub locked: bool,
    #[serde(default)]
    pub mime_class: String,
    #[serde(default, rename = "content-type")]
    pub content_type: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub parent_folder_id: Option<i64>,
    pub locked: bool,
    pub folders_url: String,
    pub files_url: String,
    pub files_count: i64,
    pub folders_count: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub save_path: String,
    #[serde(default)]
    pub serve_as_plaintext: String,
    #[serde(default)]
    pub ja_auth_cookie: String,
    #[serde(default)]
    pub video_cookies: String,
    #[serde(default)]
    pub oauth_consumer_key: String,
    #[serde(default = "default_proxy_port")]
    pub proxy_port: u16,
}

fn default_proxy_port() -> u16 {
    3030
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub uuid: String,
    pub downloaded: u64,
    pub total: u64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub sortable_name: String,
    pub short_name: String,
    #[serde(default)]
    pub login_id: String,
    #[serde(default)]
    pub email: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Colors {
    pub custom_colors: HashMap<String, String>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub title: String,
    pub workflow_state: String,
    pub id: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub assignment: Assignment,
    pub html_url: String,
    pub context_code: String,
    pub context_name: String,
    pub end_at: String,
    pub start_at: String,
    pub url: String,
    pub important_dates: bool,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assignment {
    pub id: i64,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub unlock_at: Option<String>,
    #[serde(default)]
    pub lock_at: Option<String>,
    #[serde(default)]
    pub points_possible: Option<f64>,
    pub course_id: i64,
    pub name: String,
    #[serde(default)]
    pub needs_grading_count: Option<i32>,
    pub html_url: String,
    #[serde(default)]
    pub allowed_extensions: Vec<String>,
    pub has_submitted_submissions: bool,
    pub published: bool,
    #[serde(default)]
    pub submissions_download_url: String,
    pub submission: Option<Submission>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowState {
    Submitted,
    Unsubmitted,
    Graded,
}

impl Default for WorkflowState {
    fn default() -> Self {
        Self::Unsubmitted
    }
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Submission {
    pub id: i64,
    #[serde(default)]
    pub submitted_at: Option<String>,
    #[serde(default)]
    pub grade: Option<String>,
    pub assignment_id: i64,
    pub user_id: i64,
    pub late: bool,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    pub workflow_state: WorkflowState,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attachment {
    pub id: i64,
    pub uuid: String,
    pub folder_id: i64,
    pub display_name: String,
    pub filename: String,
    #[serde(default)]
    pub url: String,
    pub size: i64,
    pub locked: bool,
    #[serde(default)]
    pub mime_class: String,
    #[serde(default, rename = "content-type")]
    pub content_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EnrollmentRole {
    StudentEnrollment,
    TaEnrollment,
}

impl Default for EnrollmentRole {
    fn default() -> Self {
        Self::StudentEnrollment
    }
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Enrollment {
    #[serde(rename = "type")]
    pub tp: String,
    pub role: EnrollmentRole,
    pub role_id: i64,
    pub user_id: i64,
    pub enrollment_state: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ItemPage<T>
where
    T: Serialize + DeserializeOwned,
{
    pub page: PageInfo,
    #[serde(deserialize_with = "Vec::<T>::deserialize")]
    pub list: Vec<T>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub page_index: i64,
    pub page_size: i64,
    pub page_count: i64,
    pub page_first: i64,
    pub page_last: i64,
    pub page_next: i64,
    pub page_prev: i64,
    pub page_show_begin: i64,
    pub page_show_end: i64,
    pub page_show_count: i64,
    pub row_count: i64,
    pub row_begin: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub subject_id: i64,
    pub cspl_id: i64,
    pub subject_name: String,
    pub classroom_id: i64,
    pub classroom_name: String,
    pub user_id: i64,
    pub user_name: String,
    pub cour_times: i64,
    pub subj_img_url: String,
    pub tecl_id: i64,
    pub tecl_name: String,
    pub term_time: i64,
    pub begin_year: i64,
    pub end_year: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCourse {
    pub vide_play_count: i64,
    pub vide_comment_average: f64,
    pub vide_paly_time: i64,
    pub vide_paly_times: i64,
    pub vide_img_url: String,
    pub subj_name: String,
    pub subj_id: i64,
    pub cour_id: i64,
    pub response_vo_list: Vec<Video>,
    pub cour_times: i64,
    pub subj_img_url: String,
    pub tecl_id: i64,
    pub tecl_name: String,
    pub index_count: i64,
    pub cspl_id: i64,
    pub teti_begin_year: i64,
    pub teti_end_year: i64,
    pub teti_term: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: i64,
    pub user_name: String,
    pub user_id: i64,
    pub vide_name: String,
    pub vide_play_count: i64,
    pub vide_comment_average: f64,
    pub vide_paly_time: i64,
    pub vide_paly_times: i64,
    pub vide_source: i64,
    pub subj_id: i64,
    pub cour_id: i64,
    pub cour_begin_time: i64,
    pub cour_end_time: i64,
    pub cour_times: i64,
    pub index_count: i64,
    pub cspl_id: i64,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub id: i64,
    pub cour_id: i64,
    pub vide_source: i64,
    pub smse_id: i64,
    pub vide_vod_id: i64,
    pub cmin_id: i64,
    pub devi_puid: String,
    pub vide_record_channel_num: i64,
    pub vide_begin_time: String,
    pub vide_end_time: String,
    pub vide_play_time: i64,
    pub vide_name: String,
    pub vide_play_count: i64,
    pub vide_comment_count: i64,
    pub vide_comment_average: f64,
    pub cour_times: i64,
    pub cour_name: String,
    pub organization_name: String,
    pub subj_id: i64,
    pub clro_id: i64,
    pub clro_name: String,
    pub user_id: i64,
    pub user_name: String,
    pub subj_name: String,
    pub tecl_name: String,
    pub tecl_id: i64,
    pub rtmp_url_hdv: String,
    pub user_avatar: String,
    pub login_user_id: i64,
    pub vide_begin_time_ms: i64,
    pub vide_end_time_ms: i64,
    pub video_play_response_vo_list: Vec<VideoPlayInfo>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPlayInfo {
    pub id: i64,
    pub vide_play_time: i64,
    pub client_ip_type: i64,
    pub rtmp_url_hdv: String,
    pub cdvi_channel_num: i64,
    pub cdvi_view_num: i64,
}
