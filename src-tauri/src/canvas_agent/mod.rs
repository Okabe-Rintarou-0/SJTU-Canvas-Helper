use rig::{
    client::CompletionClient,
    completion::{Prompt, ToolDefinition},
    providers::openai,
    tool::{Tool, ToolDyn},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    error::{AppError, Result},
    model::{
        AppConfig, Assignment, CalendarEvent, Colors, Course, DiscussionTopic, File, Folder,
        FullDiscussion, LLMChatMessage, LlmApiKeyEntry, ModuleItem, Submission, User,
        UserSubmissions,
    },
    APP,
};

#[derive(Debug, thiserror::Error)]
pub enum CanvasAgentToolError {
    #[error("{0}")]
    App(#[from] AppError),
}

fn course_id_schema(description: &str) -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "course_id": {
                "type": "number",
                "description": description
            }
        },
        "required": ["course_id"]
    })
}

fn folder_id_schema(description: &str) -> serde_json::Value {
    json!({
        "type": "object",
        "properties": {
            "folder_id": {
                "type": "number",
                "description": description
            }
        },
        "required": ["folder_id"]
    })
}

#[derive(Deserialize)]
struct CourseIdArgs {
    course_id: i64,
}

#[derive(Deserialize)]
struct EmptyArgs {}

const DEFAULT_MAX_TURNS: usize = 6;
const MIN_MAX_TURNS: usize = 1;
const MAX_MAX_TURNS: usize = 12;

const DEFAULT_MAX_TOKENS: u64 = 4096;
const MIN_MAX_TOKENS: u64 = 256;
const MAX_MAX_TOKENS: u64 = 8192;

#[derive(Debug, Clone, Deserialize)]
pub struct CanvasAgentOptions {
    pub max_turns: Option<usize>,
    pub max_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct FolderIdArgs {
    folder_id: i64,
}

#[derive(Deserialize)]
struct CalendarArgs {
    context_codes: Vec<String>,
    start_date: String,
    end_date: String,
}

#[derive(Deserialize)]
struct DiscussionArgs {
    course_id: i64,
    topic_id: i64,
}

#[derive(Deserialize)]
struct AssignmentArgs {
    course_id: i64,
    assignment_id: i64,
}

#[derive(Deserialize)]
struct AssignmentStudentArgs {
    course_id: i64,
    assignment_id: i64,
    student_id: i64,
}

#[derive(Deserialize)]
struct UserSubmissionsArgs {
    course_id: i64,
    student_ids: Vec<i64>,
}

#[derive(Deserialize, Serialize)]
struct ListCoursesTool;

impl Tool for ListCoursesTool {
    const NAME: &'static str = "list_courses";
    type Error = CanvasAgentToolError;
    type Args = EmptyArgs;
    type Output = Vec<Course>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List all Canvas courses for the current user".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn call(&self, _args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_courses().await.map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct GetMeTool;

impl Tool for GetMeTool {
    const NAME: &'static str = "get_me";
    type Error = CanvasAgentToolError;
    type Args = EmptyArgs;
    type Output = User;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get the current Canvas user profile".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn call(&self, _args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.get_me().await.map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCourseAssignmentsTool;

impl Tool for ListCourseAssignmentsTool {
    const NAME: &'static str = "list_course_assignments";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<Assignment>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List assignments for a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_course_assignments(args.course_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCourseFilesTool;

impl Tool for ListCourseFilesTool {
    const NAME: &'static str = "list_course_files";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<File>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List files for a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_course_files(args.course_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCourseFoldersTool;

impl Tool for ListCourseFoldersTool {
    const NAME: &'static str = "list_course_folders";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<Folder>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List folders for a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_course_folders(args.course_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCourseUsersTool;

impl Tool for ListCourseUsersTool {
    const NAME: &'static str = "list_course_users";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<User>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List enrolled users for a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_course_users(args.course_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCourseStudentsTool;

impl Tool for ListCourseStudentsTool {
    const NAME: &'static str = "list_course_students";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<User>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List enrolled students for a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_course_students(args.course_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListFolderFilesTool;

impl Tool for ListFolderFilesTool {
    const NAME: &'static str = "list_folder_files";
    type Error = CanvasAgentToolError;
    type Args = FolderIdArgs;
    type Output = Vec<File>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List files inside a Canvas folder".to_string(),
            parameters: folder_id_schema("Canvas folder id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_folder_files(args.folder_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListFolderFoldersTool;

impl Tool for ListFolderFoldersTool {
    const NAME: &'static str = "list_folder_folders";
    type Error = CanvasAgentToolError;
    type Args = FolderIdArgs;
    type Output = Vec<Folder>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List subfolders inside a Canvas folder".to_string(),
            parameters: folder_id_schema("Canvas folder id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_folder_folders(args.folder_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListMyFoldersTool;

impl Tool for ListMyFoldersTool {
    const NAME: &'static str = "list_my_folders";
    type Error = CanvasAgentToolError;
    type Args = EmptyArgs;
    type Output = Vec<Folder>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List the current user's personal Canvas folders".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn call(&self, _args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_my_folders().await.map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct GetFolderByIdTool;

impl Tool for GetFolderByIdTool {
    const NAME: &'static str = "get_folder_by_id";
    type Error = CanvasAgentToolError;
    type Args = FolderIdArgs;
    type Output = Folder;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get details for a Canvas folder".to_string(),
            parameters: folder_id_schema("Canvas folder id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.get_folder_by_id(args.folder_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct GetColorsTool;

impl Tool for GetColorsTool {
    const NAME: &'static str = "get_colors";
    type Error = CanvasAgentToolError;
    type Args = EmptyArgs;
    type Output = Colors;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get the current user's Canvas course color mapping".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    async fn call(&self, _args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.get_colors().await.map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCalendarEventsTool;

impl Tool for ListCalendarEventsTool {
    const NAME: &'static str = "list_calendar_events";
    type Error = CanvasAgentToolError;
    type Args = CalendarArgs;
    type Output = Vec<CalendarEvent>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List Canvas calendar events in a date range".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "context_codes": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Canvas context codes like course_12345"
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Start date in ISO-8601 format"
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date in ISO-8601 format"
                    }
                },
                "required": ["context_codes", "start_date", "end_date"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_calendar_events(&args.context_codes, &args.start_date, &args.end_date)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListDiscussionTopicsTool;

impl Tool for ListDiscussionTopicsTool {
    const NAME: &'static str = "list_discussion_topics";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<DiscussionTopic>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List discussion topics for a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_discussion_topics(args.course_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct GetFullDiscussionTool;

impl Tool for GetFullDiscussionTool {
    const NAME: &'static str = "get_full_discussion";
    type Error = CanvasAgentToolError;
    type Args = DiscussionArgs;
    type Output = FullDiscussion;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get a full Canvas discussion thread with replies".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "course_id": {
                        "type": "number",
                        "description": "Canvas course id"
                    },
                    "topic_id": {
                        "type": "number",
                        "description": "Canvas discussion topic id"
                    }
                },
                "required": ["course_id", "topic_id"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.get_full_discussion(args.course_id, args.topic_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCourseImagesTool;

impl Tool for ListCourseImagesTool {
    const NAME: &'static str = "list_course_images";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<File>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List image files for a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_course_images(args.course_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct GetMySingleSubmissionTool;

impl Tool for GetMySingleSubmissionTool {
    const NAME: &'static str = "get_my_single_submission";
    type Error = CanvasAgentToolError;
    type Args = AssignmentArgs;
    type Output = Submission;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get the current user's submission for an assignment".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "course_id": {
                        "type": "number",
                        "description": "Canvas course id"
                    },
                    "assignment_id": {
                        "type": "number",
                        "description": "Canvas assignment id"
                    }
                },
                "required": ["course_id", "assignment_id"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.get_my_single_submission(args.course_id, args.assignment_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListCourseAssignmentSubmissionsTool;

impl Tool for ListCourseAssignmentSubmissionsTool {
    const NAME: &'static str = "list_course_assignment_submissions";
    type Error = CanvasAgentToolError;
    type Args = AssignmentArgs;
    type Output = Vec<Submission>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List submissions for an assignment in a Canvas course".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "course_id": {
                        "type": "number",
                        "description": "Canvas course id"
                    },
                    "assignment_id": {
                        "type": "number",
                        "description": "Canvas assignment id"
                    }
                },
                "required": ["course_id", "assignment_id"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_course_assignment_submissions(args.course_id, args.assignment_id)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct GetSingleCourseAssignmentSubmissionTool;

impl Tool for GetSingleCourseAssignmentSubmissionTool {
    const NAME: &'static str = "get_single_course_assignment_submission";
    type Error = CanvasAgentToolError;
    type Args = AssignmentStudentArgs;
    type Output = Submission;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Get one student's submission for a Canvas assignment".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "course_id": {
                        "type": "number",
                        "description": "Canvas course id"
                    },
                    "assignment_id": {
                        "type": "number",
                        "description": "Canvas assignment id"
                    },
                    "student_id": {
                        "type": "number",
                        "description": "Canvas student user id"
                    }
                },
                "required": ["course_id", "assignment_id", "student_id"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.get_single_course_assignment_submission(
            args.course_id,
            args.assignment_id,
            args.student_id,
        )
        .await
        .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListUserSubmissionsTool;

impl Tool for ListUserSubmissionsTool {
    const NAME: &'static str = "list_user_submissions";
    type Error = CanvasAgentToolError;
    type Args = UserSubmissionsArgs;
    type Output = Vec<UserSubmissions>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List submissions across assignments for several students in a Canvas course".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "course_id": {
                        "type": "number",
                        "description": "Canvas course id"
                    },
                    "student_ids": {
                        "type": "array",
                        "items": { "type": "number" },
                        "description": "Canvas student user ids"
                    }
                },
                "required": ["course_id", "student_ids"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_user_submissions(args.course_id, &args.student_ids)
            .await
            .map_err(Into::into)
    }
}

#[derive(Deserialize, Serialize)]
struct ListExternalModuleItemsTool;

impl Tool for ListExternalModuleItemsTool {
    const NAME: &'static str = "list_external_module_items";
    type Error = CanvasAgentToolError;
    type Args = CourseIdArgs;
    type Output = Vec<ModuleItem>;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "List external module items in a Canvas course".to_string(),
            parameters: course_id_schema("Canvas course id"),
        }
    }

    async fn call(&self, args: Self::Args) -> std::result::Result<Self::Output, Self::Error> {
        APP.list_external_module_items(args.course_id)
            .await
            .map_err(Into::into)
    }
}

fn boxed_tools() -> Vec<Box<dyn ToolDyn>> {
    vec![
        Box::new(ListCoursesTool),
        Box::new(GetMeTool),
        Box::new(ListCourseAssignmentsTool),
        Box::new(ListCourseFilesTool),
        Box::new(ListCourseFoldersTool),
        Box::new(ListCourseUsersTool),
        Box::new(ListCourseStudentsTool),
        Box::new(ListFolderFilesTool),
        Box::new(ListFolderFoldersTool),
        Box::new(ListMyFoldersTool),
        Box::new(GetFolderByIdTool),
        Box::new(GetColorsTool),
        Box::new(ListCalendarEventsTool),
        Box::new(ListDiscussionTopicsTool),
        Box::new(GetFullDiscussionTool),
        Box::new(ListCourseImagesTool),
        Box::new(GetMySingleSubmissionTool),
        Box::new(ListCourseAssignmentSubmissionsTool),
        Box::new(GetSingleCourseAssignmentSubmissionTool),
        Box::new(ListUserSubmissionsTool),
        Box::new(ListExternalModuleItemsTool),
    ]
}

fn build_history_prompt(messages: &[LLMChatMessage]) -> String {
    let history = messages
        .iter()
        .map(|message| {
            let speaker = if message.role.eq_ignore_ascii_case("assistant") {
                "Assistant"
            } else {
                "User"
            };
            format!("{speaker}: {}", message.content.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "请继续下面的对话。涉及 Canvas 课程、作业、文件、讨论、提交、成员、日历等信息时，请优先调用已提供的 tools，再基于结果回答。\n\n对话历史：\n{history}"
    )
}

fn resolve_active_key_entry<'a>(config: &'a AppConfig) -> Option<&'a LlmApiKeyEntry> {
    if config.llm_active_api_key.is_empty() {
        return None;
    }
    config
        .llm_api_keys
        .iter()
        .find(|entry| entry.name == config.llm_active_api_key)
}

fn resolve_active_api_key(config: &AppConfig) -> String {
    resolve_active_key_entry(config)
        .filter(|entry| !entry.key.is_empty())
        .map(|entry| entry.key.clone())
        .unwrap_or_else(|| config.llm_api_key.clone())
}

fn resolve_active_base_url(config: &AppConfig) -> String {
    resolve_active_key_entry(config)
        .filter(|entry| !entry.base_url.is_empty())
        .map(|entry| entry.base_url.clone())
        .unwrap_or_else(|| config.llm_base_url.clone())
}

fn resolve_active_model(config: &AppConfig) -> String {
    resolve_active_key_entry(config)
        .filter(|entry| !entry.model.is_empty())
        .map(|entry| entry.model.clone())
        .unwrap_or_else(|| config.llm_model.clone())
}

fn build_agent_model(config: &AppConfig) -> String {
    resolve_active_model(config)
}

fn build_openai_client(config: &AppConfig) -> Result<openai::CompletionsClient> {
    let api_key = resolve_active_api_key(config);
    if api_key.trim().is_empty() {
        return Err(AppError::LLMError(
            "LLM API key is not configured.".to_string(),
        ));
    }

    let base_url = resolve_active_base_url(config);
    let mut builder = openai::CompletionsClient::builder().api_key(&api_key);
    if !base_url.trim().is_empty() {
        builder = builder.base_url(&base_url);
    }
    builder
        .build()
        .map_err(|error| AppError::LLMError(error.to_string()))
}

fn resolve_agent_options(options: Option<CanvasAgentOptions>) -> (usize, u64) {
    let max_turns = options
        .as_ref()
        .and_then(|value| value.max_turns)
        .unwrap_or(DEFAULT_MAX_TURNS)
        .clamp(MIN_MAX_TURNS, MAX_MAX_TURNS);

    let max_tokens = options
        .as_ref()
        .and_then(|value| value.max_tokens)
        .unwrap_or(DEFAULT_MAX_TOKENS)
        .clamp(MIN_MAX_TOKENS, MAX_MAX_TOKENS);

    (max_turns, max_tokens)
}

pub async fn chat(messages: &[LLMChatMessage], options: Option<CanvasAgentOptions>) -> Result<String> {
    if messages.is_empty() {
        return Err(AppError::LLMError("Messages cannot be empty.".to_string()));
    }

    let config = APP.get_config().await;
    let client = build_openai_client(&config)?;
    let (max_turns, max_tokens) = resolve_agent_options(options);
    let agent = client
        .agent(build_agent_model(&config))
        .preamble(
            "You are Canvas Agent, an SJTU Canvas assistant. \
            Use the provided tools whenever the user asks for factual Canvas data. \
            Answer in Chinese by default, summarize tool results clearly, and do not invent missing data.",
        )
        .tools(boxed_tools())
        .default_max_turns(max_turns)
        .max_tokens(max_tokens)
        .build();

    agent
        .prompt(build_history_prompt(messages))
        .await
        .map_err(|error| AppError::LLMError(error.to_string()))
}
