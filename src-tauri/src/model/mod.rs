use serde::{Deserialize, Serialize};

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
