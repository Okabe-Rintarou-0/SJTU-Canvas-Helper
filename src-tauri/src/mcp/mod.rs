use axum::{Router, response::Json};
use rmcp::{
    ErrorData, ServerHandler,
    handler::server::wrapper::Parameters,
    model::*,
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService,
        session::local::LocalSessionManager,
    },
};
use serde_json::{json, Value, Map};
use tokio_util::sync::CancellationToken;

use serde::Serialize;
use std::net::SocketAddr;

use crate::{model::File, APP};

#[derive(Clone)]
struct McpServer;

fn internal(e: impl ToString) -> ErrorData {
    ErrorData::internal_error(e.to_string(), None)
}

fn invalid(e: impl ToString) -> ErrorData {
    ErrorData::invalid_params(e.to_string(), None)
}

fn get_i64(params: &Map<String, Value>, key: &str) -> Result<i64, ErrorData> {
    params
        .get(key)
        .and_then(|v| v.as_i64())
        .ok_or_else(|| invalid(format!("Missing or invalid {key}")))
}

fn get_string(params: &Map<String, Value>, key: &str) -> Result<String, ErrorData> {
    params
        .get(key)
        .and_then(|v| v.as_str().map(String::from))
        .ok_or_else(|| invalid(format!("Missing or invalid {key}")))
}

fn get_vec<T>(params: &Map<String, Value>, key: &str) -> Result<Vec<T>, ErrorData>
where
    T: serde::de::DeserializeOwned,
{
    params
        .get(key)
        .map(|v| serde_json::from_value::<Vec<T>>(v.clone()))
        .transpose()
        .map_err(|e| invalid(e.to_string()))?
        .ok_or_else(|| invalid(format!("Missing or invalid {key}")))
}

fn tool_json(data: impl Serialize) -> CallToolResult {
    CallToolResult::success(vec![Content::text(
        serde_json::to_string_pretty(&data).unwrap_or_default(),
    )])
}

#[tool_router]
impl McpServer {
    #[tool(description = "List all courses for the current Canvas user")]
    async fn list_courses(&self) -> Result<CallToolResult, ErrorData> {
        APP.list_courses().await.map(tool_json).map_err(internal)
    }

    #[tool(description = "Get the current user's profile information")]
    async fn get_me(&self) -> Result<CallToolResult, ErrorData> {
        APP.get_me().await.map(tool_json).map_err(internal)
    }

    #[tool(description = "List all assignments for a specific course")]
    async fn list_course_assignments(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_course_assignments(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all files in a course")]
    async fn list_course_files(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_course_files(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all folders in a course")]
    async fn list_course_folders(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_course_folders(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all users enrolled in a course")]
    async fn list_course_users(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_course_users(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all students enrolled in a course")]
    async fn list_course_students(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_course_students(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all files in a specific folder by folder ID")]
    async fn list_folder_files(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let folder_id = get_i64(&params, "folder_id")?;
        APP.list_folder_files(folder_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all subfolders in a specific folder")]
    async fn list_folder_folders(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let folder_id = get_i64(&params, "folder_id")?;
        APP.list_folder_folders(folder_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List the current user's personal folders")]
    async fn list_my_folders(&self) -> Result<CallToolResult, ErrorData> {
        APP.list_my_folders()
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "Get folder details by folder ID")]
    async fn get_folder_by_id(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let folder_id = get_i64(&params, "folder_id")?;
        APP.get_folder_by_id(folder_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "Get course color assignments for the user's dashboard")]
    async fn get_colors(&self) -> Result<CallToolResult, ErrorData> {
        APP.get_colors().await.map(tool_json).map_err(internal)
    }

    #[tool(description = "List calendar events for specified courses within a date range")]
    async fn list_calendar_events(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let context_codes: Vec<String> = get_vec(&params, "context_codes")?;
        let start_date = get_string(&params, "start_date")?;
        let end_date = get_string(&params, "end_date")?;
        APP.list_calendar_events(&context_codes, &start_date, &end_date)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all discussion topics for a course")]
    async fn list_discussion_topics(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_discussion_topics(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "Get the full discussion including all replies for a topic")]
    async fn get_full_discussion(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        let topic_id = get_i64(&params, "topic_id")?;
        APP.get_full_discussion(course_id, topic_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all image files in a course")]
    async fn list_course_images(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_course_images(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "Get the current user's submission for a specific assignment")]
    async fn get_my_single_submission(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        let assignment_id = get_i64(&params, "assignment_id")?;
        APP.get_my_single_submission(course_id, assignment_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List all submissions for a specific assignment in a course")]
    async fn list_course_assignment_submissions(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        let assignment_id = get_i64(&params, "assignment_id")?;
        APP.list_course_assignment_submissions(course_id, assignment_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "Get a specific student's submission for an assignment")]
    async fn get_single_course_assignment_submission(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        let assignment_id = get_i64(&params, "assignment_id")?;
        let student_id = get_i64(&params, "student_id")?;
        APP.get_single_course_assignment_submission(course_id, assignment_id, student_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List submissions for specific students across all assignments in a course")]
    async fn list_user_submissions(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        let student_ids: Vec<i64> = get_vec(&params, "student_ids")?;
        APP.list_user_submissions(course_id, &student_ids)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "List external URL module items in a course")]
    async fn list_external_module_items(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let course_id = get_i64(&params, "course_id")?;
        APP.list_external_module_items(course_id)
            .await
            .map(tool_json)
            .map_err(internal)
    }

    #[tool(description = "Send a prompt to the configured LLM and get a response")]
    async fn chat(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let prompt = get_string(&params, "prompt")?;
        let response = APP.chat(prompt).await.map_err(internal)?;
        Ok(tool_json(json!({ "response": response })))
    }

    #[tool(description = "Get an AI explanation of a file's content")]
    async fn explain_file(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let file: File = params
            .get("file")
            .map(|v| serde_json::from_value(v.clone()))
            .transpose()
            .map_err(|e| invalid(e.to_string()))?
            .ok_or_else(|| invalid("Missing file"))?;
        let explanation = APP.explain_file(&file).await.map_err(internal)?;
        Ok(tool_json(json!({ "explanation": explanation })))
    }

    #[tool(description = "Test if a Canvas API token is valid and return the associated user")]
    async fn test_token(
        &self,
        Parameters(params): Parameters<Map<String, Value>>,
    ) -> Result<CallToolResult, ErrorData> {
        let token = get_string(&params, "token")?;
        APP.test_token(&token)
            .await
            .map(tool_json)
            .map_err(internal)
    }
}

#[tool_handler]
impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder().enable_tools().build(),
        )
        .with_server_info(Implementation::from_build_env())
        .with_protocol_version(ProtocolVersion::V_2024_11_05)
        .with_instructions(
            "Canvas course management assistant. Use list_courses to browse courses, \
            list_course_assignments/files/folders/users/students for course details, \
            and get_my_single_submission to check your own submissions."
                .to_string(),
        )
    }
}

pub fn start_mcp_server(port: u16) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let ct = CancellationToken::new();

        let service = StreamableHttpService::new(
            || Ok(McpServer),
            LocalSessionManager::default().into(),
            StreamableHttpServerConfig::default()
                .with_sse_keep_alive(Some(std::time::Duration::from_secs(15)))
                .with_stateful_mode(true)
                .with_cancellation_token(ct.child_token()),
        );

        let router = Router::new()
            .route(
                "/health",
                axum::routing::get(|| async { Json(json!({"status": "ok"})) }),
            )
            .fallback_service(service);

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .expect("Failed to bind MCP server address");

        tracing::info!("MCP SSE server started on port {port}");

        axum::serve(listener, router)
            .with_graceful_shutdown(async move { ct.cancelled().await; })
            .await
            .expect("MCP server failed");
    })
}
