use std::convert::Infallible;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use warp::Filter;

use crate::{
    model::File,
    APP,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

fn json_rpc_error(id: Value, code: i32, message: impl Into<String>, data: Option<Value>) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.into(),
            data,
        }),
    }
}

fn json_rpc_result(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: Some(result),
        error: None,
    }
}

#[derive(Deserialize)]
struct ToolCallParams {
    name: String,
    #[serde(default)]
    arguments: Option<Value>,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
struct ToolDef {
    name: &'static str,
    description: &'static str,
    inputSchema: Value,
}

fn get_tools() -> Vec<ToolDef> {
    vec![
        ToolDef { name: "list_courses", description: "List all courses for the current Canvas user", inputSchema: json!({"type": "object", "properties": {}}) },
        ToolDef { name: "get_me", description: "Get the current user's profile information", inputSchema: json!({"type": "object", "properties": {}}) },
        ToolDef { name: "list_course_assignments", description: "List all assignments for a specific course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "list_course_files", description: "List all files in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "list_course_folders", description: "List all folders in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "list_course_users", description: "List all users enrolled in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "list_course_students", description: "List all students enrolled in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "list_folder_files", description: "List all files in a specific folder by folder ID", inputSchema: json!({"type": "object","properties": {"folder_id": {"type": "integer", "description": "Canvas folder ID"}},"required": ["folder_id"]}) },
        ToolDef { name: "list_folder_folders", description: "List all subfolders in a specific folder", inputSchema: json!({"type": "object","properties": {"folder_id": {"type": "integer", "description": "Canvas folder ID"}},"required": ["folder_id"]}) },
        ToolDef { name: "list_my_folders", description: "List the current user's personal folders", inputSchema: json!({"type": "object", "properties": {}}) },
        ToolDef { name: "get_folder_by_id", description: "Get folder details by folder ID", inputSchema: json!({"type": "object","properties": {"folder_id": {"type": "integer", "description": "Canvas folder ID"}},"required": ["folder_id"]}) },
        ToolDef { name: "get_colors", description: "Get course color assignments for the user's dashboard", inputSchema: json!({"type": "object", "properties": {}}) },
        ToolDef { name: "list_calendar_events", description: "List calendar events for specified courses within a date range", inputSchema: json!({"type": "object","properties": {"context_codes": {"type": "array", "items": {"type": "string"}, "description": "Course context codes (e.g. course_12345)"},"start_date": {"type": "string", "description": "Start date in ISO 8601 format"},"end_date": {"type": "string", "description": "End date in ISO 8601 format"}},"required": ["context_codes", "start_date", "end_date"]}) },
        ToolDef { name: "list_discussion_topics", description: "List all discussion topics for a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "get_full_discussion", description: "Get the full discussion including all replies for a topic", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"},"topic_id": {"type": "integer", "description": "Discussion topic ID"}},"required": ["course_id", "topic_id"]}) },
        ToolDef { name: "list_course_images", description: "List all image files in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "get_my_single_submission", description: "Get the current user's submission for a specific assignment", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"},"assignment_id": {"type": "integer", "description": "Assignment ID"}},"required": ["course_id", "assignment_id"]}) },
        ToolDef { name: "list_course_assignment_submissions", description: "List all submissions for a specific assignment in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"},"assignment_id": {"type": "integer", "description": "Assignment ID"}},"required": ["course_id", "assignment_id"]}) },
        ToolDef { name: "get_single_course_assignment_submission", description: "Get a specific student's submission for an assignment", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"},"assignment_id": {"type": "integer", "description": "Assignment ID"},"student_id": {"type": "integer", "description": "Student user ID"}},"required": ["course_id", "assignment_id", "student_id"]}) },
        ToolDef { name: "list_user_submissions", description: "List submissions for specific students across all assignments in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"},"student_ids": {"type": "array", "items": {"type": "integer"}, "description": "Array of student user IDs"}},"required": ["course_id", "student_ids"]}) },
        ToolDef { name: "list_external_module_items", description: "List external URL module items in a course", inputSchema: json!({"type": "object","properties": {"course_id": {"type": "integer", "description": "Canvas course ID"}},"required": ["course_id"]}) },
        ToolDef { name: "chat", description: "Send a prompt to the configured LLM and get a response", inputSchema: json!({"type": "object","properties": {"prompt": {"type": "string", "description": "The prompt to send to the LLM"}},"required": ["prompt"]}) },
        ToolDef { name: "explain_file", description: "Get an AI explanation of a file's content", inputSchema: json!({"type": "object","properties": {"file": {"type": "object", "description": "File object with at least a `url` field"}},"required": ["file"]}) },
        ToolDef { name: "test_token", description: "Test if a Canvas API token is valid and return the associated user", inputSchema: json!({"type": "object","properties": {"token": {"type": "string", "description": "Canvas API token to test"}},"required": ["token"]}) },
    ]
}

async fn handle_initialize(id: Value) -> JsonRpcResponse {
    json_rpc_result(id, json!({
        "protocolVersion": "2025-03-26",
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": "sjtu-canvas-helper-mcp",
            "version": "3.0.2"
        }
    }))
}

async fn handle_tools_list(id: Value) -> JsonRpcResponse {
    json_rpc_result(id, json!({ "tools": get_tools() }))
}

async fn handle_tools_call(id: Value, params: Option<Value>) -> JsonRpcResponse {
    let params: ToolCallParams = match params
        .map(|v| serde_json::from_value(v))
        .transpose()
    {
        Ok(Some(p)) => p,
        Ok(None) => {
            return json_rpc_error(
                id,
                -32602,
                "Missing params for tools/call",
                None,
            )
        }
        Err(e) => {
            return json_rpc_error(
                id,
                -32602,
                format!("Invalid params: {e}"),
                None,
            )
        }
    };

    match execute_tool(&params.name, params.arguments).await {
        Ok(result) => json_rpc_result(id, result),
        Err(e) => json_rpc_error(id, -32603, e.message, e.data),
    }
}

struct ToolError {
    message: String,
    data: Option<Value>,
}

fn tool_error(msg: impl Into<String>) -> ToolError {
    ToolError {
        message: msg.into(),
        data: None,
    }
}

async fn execute_tool(name: &str, args: Option<Value>) -> Result<Value, ToolError> {
    let args = args.unwrap_or(json!({}));
    match name {
        "list_courses" => {
            let courses = APP.list_courses().await.map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(courses))
        }
        "get_me" => {
            let user = APP.get_me().await.map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(user))
        }
        "list_course_assignments" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let assignments = APP.list_course_assignments(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(assignments))
        }
        "list_course_files" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let files = APP.list_course_files(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(files))
        }
        "list_course_folders" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let folders = APP.list_course_folders(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(folders))
        }
        "list_course_users" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let users = APP.list_course_users(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(users))
        }
        "list_course_students" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let students = APP.list_course_students(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(students))
        }
        "list_folder_files" => {
            let folder_id: i64 = args.get("folder_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid folder_id"))?;
            let files = APP.list_folder_files(folder_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(files))
        }
        "list_folder_folders" => {
            let folder_id: i64 = args.get("folder_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid folder_id"))?;
            let folders = APP.list_folder_folders(folder_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(folders))
        }
        "list_my_folders" => {
            let folders = APP.list_my_folders().await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(folders))
        }
        "get_folder_by_id" => {
            let folder_id: i64 = args.get("folder_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid folder_id"))?;
            let folder = APP.get_folder_by_id(folder_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(folder))
        }
        "get_colors" => {
            let colors = APP.get_colors().await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(colors))
        }
        "list_calendar_events" => {
            let context_codes: Vec<String> = args.get("context_codes")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .ok_or_else(|| tool_error("Missing or invalid context_codes"))?;
            let start_date: String = args.get("start_date")
                .and_then(|v| v.as_str().map(String::from))
                .ok_or_else(|| tool_error("Missing or invalid start_date"))?;
            let end_date: String = args.get("end_date")
                .and_then(|v| v.as_str().map(String::from))
                .ok_or_else(|| tool_error("Missing or invalid end_date"))?;
            let events = APP.list_calendar_events(&context_codes, &start_date, &end_date).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(events))
        }
        "list_discussion_topics" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let topics = APP.list_discussion_topics(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(topics))
        }
        "get_full_discussion" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let topic_id: i64 = args.get("topic_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid topic_id"))?;
            let discussion = APP.get_full_discussion(course_id, topic_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(discussion))
        }
        "list_course_images" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let images = APP.list_course_images(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(images))
        }
        "get_my_single_submission" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let assignment_id: i64 = args.get("assignment_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid assignment_id"))?;
            let submission = APP.get_my_single_submission(course_id, assignment_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(submission))
        }
        "list_course_assignment_submissions" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let assignment_id: i64 = args.get("assignment_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid assignment_id"))?;
            let submissions = APP.list_course_assignment_submissions(course_id, assignment_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(submissions))
        }
        "get_single_course_assignment_submission" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let assignment_id: i64 = args.get("assignment_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid assignment_id"))?;
            let student_id: i64 = args.get("student_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid student_id"))?;
            let submission = APP.get_single_course_assignment_submission(course_id, assignment_id, student_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(submission))
        }
        "list_user_submissions" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let student_ids: Vec<i64> = args.get("student_ids")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .ok_or_else(|| tool_error("Missing or invalid student_ids"))?;
            let submissions = APP.list_user_submissions(course_id, &student_ids).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(submissions))
        }
        "list_external_module_items" => {
            let course_id: i64 = args.get("course_id")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| tool_error("Missing or invalid course_id"))?;
            let items = APP.list_external_module_items(course_id).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(items))
        }
        "chat" => {
            let prompt: String = args.get("prompt")
                .and_then(|v| v.as_str().map(String::from))
                .ok_or_else(|| tool_error("Missing or invalid prompt"))?;
            let response = APP.chat(prompt).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!({ "response": response }))
        }
        "explain_file" => {
            let file: File = args.get("file")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .ok_or_else(|| tool_error("Missing or invalid file"))?;
            let explanation = APP.explain_file(&file).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!({ "explanation": explanation }))
        }
        "test_token" => {
            let token: String = args.get("token")
                .and_then(|v| v.as_str().map(String::from))
                .ok_or_else(|| tool_error("Missing or invalid token"))?;
            let user = APP.test_token(&token).await
                .map_err(|e| tool_error(e.to_string()))?;
            Ok(json!(user))
        }
        _ => Err(ToolError {
            message: format!("Unknown tool: {name}"),
            data: None,
        }),
    }
}

#[derive(Debug)]
struct AuthReject;

impl warp::reject::Reject for AuthReject {}

pub fn start_mcp_server(port: u16) -> tokio::task::JoinHandle<()> {
    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["POST", "OPTIONS"])
        .allow_headers(vec!["content-type", "authorization"]);

    let auth = warp::header::optional::<String>("authorization")
        .and_then(|auth: Option<String>| async move {
            let config = APP.get_config().await;
            if config.token.is_empty() {
                return Err(warp::reject::custom(AuthReject));
            }
            let expected = format!("Bearer {}", config.token);
            match auth {
                Some(a) if a == expected => Ok(()),
                _ => Err(warp::reject::custom(AuthReject)),
            }
        });

    let rpc_route = warp::path::end()
        .and(warp::post())
        .and(auth)
        .and(warp::body::json::<JsonRpcRequest>())
        .and_then(|_auth: (), body: JsonRpcRequest| async move {
            let response = match body.method.as_str() {
                "initialize" => handle_initialize(body.id).await,
                "tools/list" => handle_tools_list(body.id).await,
                "tools/call" => handle_tools_call(body.id, body.params).await,
                _ => json_rpc_error(body.id, -32601, "Method not found", None),
            };
            Ok::<_, Infallible>(warp::reply::json(&response))
        })
        .with(&cors);

    let routes = rpc_route
        .or(warp::path("health").and(warp::get()).map(|| warp::reply::json(&json!({"status": "ok"}))));

    tracing::info!("Starting MCP server on port {port}");
    tokio::spawn(warp::serve(routes).run(([127, 0, 0, 1], port)))
}
