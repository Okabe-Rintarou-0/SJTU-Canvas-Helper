use serde::{Deserialize, Serialize};

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Course {
    pub id: i64,
    pub uuid: String,
    pub name: String,
    pub course_code: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct File {
    pub id: i64,
    pub uuid: String,
    pub folder_id: i64,
    pub display_name: String,
    pub filename: String,
    pub url: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppConfig {
    pub token: String,
}
