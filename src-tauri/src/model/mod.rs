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
    #[serde(default)]
    pub teachers: Vec<Teacher>,
    #[serde(default)]
    pub term: Term,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Teacher {
    pub id: i64,
    pub anonymous_id: String,
    pub display_name: String,
    pub avatar_image_url: String,
    pub html_url: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Term {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub workflow_state: String,
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
pub struct UserSubmissions {
    pub user_id: i64,
    #[serde(default)]
    pub submissions: Vec<Submission>,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Account {
    Default,
    #[serde(untagged)]
    Custom(String),
}

impl Default for Account {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountInfo {
    pub current_account: Account,
    pub all_accounts: Vec<Account>,
}

impl Default for AccountInfo {
    fn default() -> Self {
        Self {
            current_account: Default::default(),
            all_accounts: vec![Default::default()],
        }
    }
}

impl AccountInfo {
    #[allow(dead_code)]
    pub fn custom<T: Into<String>>(name: T) -> Self {
        Self {
            current_account: Account::Custom(name.into()),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    #[serde(default)]
    pub jbox_login_info: JBoxLoginInfo,
    #[serde(default)]
    pub course_assignment_file_bindings: HashMap<i64, Vec<File>>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            token: Default::default(),
            save_path: Default::default(),
            serve_as_plaintext: Default::default(),
            ja_auth_cookie: Default::default(),
            video_cookies: Default::default(),
            oauth_consumer_key: Default::default(),
            proxy_port: 3030,
            jbox_login_info: Default::default(),
            course_assignment_file_bindings: Default::default(),
        }
    }
}

fn default_proxy_port() -> u16 {
    3030
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub uuid: String,
    pub processed: u64,
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
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    pub url: String,
    pub important_dates: bool,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assignment {
    pub id: i64,
    #[serde(default)]
    pub description: Option<String>,
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
    pub submission_types: Vec<String>,
    #[serde(default)]
    pub allowed_extensions: Vec<String>,
    pub has_submitted_submissions: bool,
    pub published: bool,
    #[serde(default)]
    pub submissions_download_url: String,
    pub submission: Option<Submission>,
    #[serde(default)]
    pub overrides: Vec<AssignmentOverride>,
    #[serde(default)]
    pub all_dates: Vec<AssignmentDate>,
    #[serde(default)]
    pub score_statistics: Option<ScoreStatistics>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssignmentDate {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub base: bool,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub unlock_at: Option<String>,
    #[serde(default)]
    pub lock_at: Option<String>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssignmentOverride {
    pub id: i64,
    pub assignment_id: i64,
    #[serde(default)]
    pub quiz_id: i64,
    #[serde(default)]
    pub context_module_id: i64,
    #[serde(default)]
    pub student_ids: Vec<i64>,
    #[serde(default)]
    pub group_id: i64,
    #[serde(default)]
    pub course_section_id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub all_day_date: Option<String>,
    #[serde(default)]
    pub unlock_at: Option<String>,
    #[serde(default)]
    pub lock_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowState {
    Submitted,
    Unsubmitted,
    Graded,
    PendingReview,
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
    #[serde(default)]
    pub submission_comments: Vec<SubmissionComment>,
    pub workflow_state: WorkflowState,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attachment {
    pub id: i64,
    pub uuid: String,
    #[serde(default)]
    pub folder_id: Option<i64>,
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
#[allow(clippy::enum_variant_names)]
pub enum EnrollmentRole {
    StudentEnrollment,
    TaEnrollment,
    TeacherEnrollment,
    ObserverEnrollment,
    DesignerEnrollment,
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

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JboxLoginResult {
    #[serde(default)]
    pub user_id: i64,
    #[serde(default)]
    pub user_token: String,
    #[serde(default)]
    pub expires_in: i64,
    #[serde(default)]
    pub is_new_user: bool,
    #[serde(default)]
    pub status: i32,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalSpaceInfo {
    #[serde(default)]
    pub library_id: String,
    #[serde(default)]
    pub space_id: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub expires_in: i64,
    #[serde(default)]
    pub status: i64,
    #[serde(default)]
    pub message: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JBoxLoginInfo {
    #[serde(default)]
    pub library_id: String,
    #[serde(default)]
    pub space_id: String,
    #[serde(default)]
    pub access_token: String,
}

impl From<PersonalSpaceInfo> for JBoxLoginInfo {
    fn from(p: PersonalSpaceInfo) -> Self {
        JBoxLoginInfo {
            library_id: p.library_id,
            space_id: p.space_id,
            access_token: p.access_token,
        }
    }
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Headers {
    #[serde(rename = "x-amz-date")]
    pub x_amz_date: String,
    #[serde(rename = "x-amz-content-sha256")]
    pub x_amz_content_sha256: String,
    pub authorization: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChunkUploadPart {
    pub headers: Headers,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChunkUploadContext {
    pub confirm_key: String,
    pub domain: String,
    pub path: String,
    pub upload_id: String,
    pub parts: HashMap<String, StartChunkUploadPart>,
    pub expiration: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JBoxErrorMessage {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub status: i64,
    #[serde(default)]
    pub message: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmChunkUploadResult {
    #[serde(default)]
    pub path: Vec<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub type_: String,
    #[serde(default)]
    pub creation_time: String,
    #[serde(default)]
    pub modification_time: String,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub e_tag: String,
    #[serde(default)]
    pub crc64: String,
    #[serde(default)]
    pub is_overwrittened: bool,
    #[serde(default)]
    pub virus_audit_status: i64,
    #[serde(default)]
    pub sensitive_word_audit_status: i64,
    #[serde(default)]
    pub preview_by_doc: bool,
    #[serde(default)]
    pub preview_by_ci: bool,
    #[serde(default)]
    pub preview_as_icon: bool,
    #[serde(default)]
    pub file_type: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MediaComment {
    #[serde(rename = "content-type")]
    pub content_type: String,
    pub display_name: String,
    pub media_id: String,
    pub media_type: String,
    pub url: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubmissionComment {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub author_id: i64,
    #[serde(default)]
    pub author_name: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub avatar_path: String,
    #[serde(default)]
    pub media_comment: Option<MediaComment>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum SubmissionUploadResult {
    Success(SubmissionUploadSuccessResponse),
    Error(SubmissionUploadErrorResponse),
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubmissionUploadSuccessResponse {
    #[serde(default)]
    pub upload_url: String,
    #[serde(default)]
    pub upload_params: SubmissionUploadParams,
    #[serde(default)]
    pub file_param: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubmissionUploadParams {
    #[serde(rename = "x-amz-credential")]
    pub x_amz_credential: String,
    #[serde(rename = "x-amz-algorithm")]
    pub x_amz_algorithm: String,
    #[serde(rename = "x-amz-date")]
    pub x_amz_date: String,
    #[serde(rename = "Filename")]
    pub filename: String,
    pub key: String,
    pub acl: String,
    #[serde(rename = "Policy")]
    pub policy: String,
    #[serde(rename = "x-amz-signature")]
    pub x_amz_signature: String,
    pub success_action_redirect: String,
    #[serde(rename = "content-type")]
    pub content_type: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubmissionUploadErrorResponse {
    pub status: String,
    pub message: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QRCodeScanResult {
    pub file: File,
    pub contents: Vec<String>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiscussionTopic {
    pub id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub last_reply_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub delayed_post_at: Option<String>,
    #[serde(default)]
    pub posted_at: Option<String>,
    #[serde(default)]
    pub user_name: Option<String>,
    #[serde(default)]
    pub lock_at: Option<String>,
    #[serde(default)]
    pub assignment_id: Option<i64>,
    #[serde(default)]
    pub podcast_has_student_posts: Option<bool>,
    #[serde(default)]
    pub discussion_type: String,
    #[serde(default)]
    pub allow_rating: Option<bool>,
    #[serde(default)]
    pub only_graders_can_rate: Option<bool>,
    #[serde(default)]
    pub sort_by_rating: Option<bool>,
    #[serde(default)]
    pub is_section_specific: Option<bool>,
    #[serde(default)]
    pub discussion_subentry_count: i64,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default)]
    pub require_initial_post: Option<bool>,
    #[serde(default)]
    pub user_can_see_posts: Option<bool>,
    #[serde(default)]
    pub podcast_url: Option<String>,
    #[serde(default)]
    pub read_state: String,
    #[serde(default)]
    pub unread_count: i64,
    #[serde(default)]
    pub subscribed: Option<bool>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub published: Option<bool>,
    #[serde(default)]
    pub can_unpublish: Option<bool>,
    #[serde(default)]
    pub locked: Option<bool>,
    #[serde(default)]
    pub can_lock: Option<bool>,
    #[serde(default)]
    pub comments_disabled: Option<bool>,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub pinned: Option<bool>,
    #[serde(default)]
    pub can_group: Option<bool>,
    #[serde(default)]
    pub locked_for_user: Option<bool>,
    #[serde(default)]
    pub lock_explanation: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub assignment: Option<Assignment>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Permissions {
    #[serde(default)]
    pub attach: bool,
    #[serde(default)]
    pub update: bool,
    #[serde(default)]
    pub reply: bool,
    #[serde(default)]
    pub delete: bool,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FullDiscussion {
    #[serde(default)]
    pub unread_entries: Vec<i64>,
    #[serde(default)]
    pub new_entries: Vec<i64>,
    #[serde(default)]
    pub participants: Vec<Participant>,
    #[serde(default)]
    pub view: Vec<DiscussionView>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Participant {
    pub id: i64,
    #[serde(default)]
    pub anonymous_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub avatar_image_url: String,
    #[serde(default)]
    pub html_url: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiscussionView {
    pub id: i64,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub editor_id: Option<i64>,
    #[serde(default)]
    pub rating_count: Option<i64>,
    #[serde(default)]
    pub rating_sum: Option<i64>,
    #[serde(default)]
    pub deleted: Option<bool>,
    #[serde(default)]
    pub user_id: Option<i64>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub replies: Vec<Reply>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reply {
    pub id: i64,
    #[serde(default)]
    pub user_id: i64,
    #[serde(default)]
    pub parent_id: i64,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub rating_count: Option<i64>,
    #[serde(default)]
    pub rating_sum: Option<i64>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoreStatistics {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
}

#[derive(Default, Debug)]
pub struct FoldersAndFiles {
    pub files: Vec<File>,
    // folder_id -> folder
    pub folders_map: HashMap<i64, Folder>,
}

impl FoldersAndFiles {
    pub fn new(folders: Vec<Folder>, files: Vec<File>) -> Self {
        let mut folders_map = HashMap::new();
        for folder in folders {
            folders_map.insert(folder.id, folder);
        }
        Self { files, folders_map }
    }
}
