use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    pub stream: bool,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct Message {
    pub role: String,
    pub content: Vec<ContentPart>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct ContentPart {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct ChatCompletionResponse {
    pub id: Option<String>,
    pub object: Option<String>,
    pub created: Option<u64>,
    pub model: Option<String>,
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
    pub system_fingerprint: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct ChatCompletionStreamResponse {
    pub id: Option<String>,
    pub object: Option<String>,
    pub created: Option<u64>,
    pub model: Option<String>,
    pub choices: Vec<StreamChoice>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct StreamChoice {
    pub index: u32,
    pub delta: StreamDelta,
    pub finish_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct StreamDelta {
    pub role: Option<String>,
    pub content: Option<ResponseContent>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct Choice {
    pub index: u32,
    pub message: ResponseMessage,
    pub logprobs: Option<serde_json::Value>,
    pub finish_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct ResponseMessage {
    pub role: Option<String>,
    pub content: Option<ResponseContent>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
#[allow(dead_code)]
pub enum ResponseContent {
    Text(String),
    Parts(Vec<ResponseContentPart>),
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct ResponseContentPart {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct Usage {
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub prompt_tokens_details: Option<PromptTokensDetails>,
    pub prompt_cache_hit_tokens: Option<u32>,
    pub prompt_cache_miss_tokens: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug)]
#[allow(dead_code)]
pub struct PromptTokensDetails {
    pub cached_tokens: Option<u32>,
}
