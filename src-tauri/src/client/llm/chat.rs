use super::model::{
    ChatCompletionRequest, ChatCompletionResponse, ChatCompletionStreamResponse, ContentPart,
    Message, ResponseContent,
};
use crate::{
    error::{AppError, Result},
    utils,
};
use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use std::time::Duration;
use tokio::sync::RwLock;

const DEFAULT_LLM_BASE_URL: &str = "https://api.deepseek.com/v1";
const DEFAULT_LLM_MODEL: &str = "deepseek-chat";
const DEFAULT_SYSTEM_PROMPT: &str = "You are a helpful assistant.";

#[async_trait]
pub trait LLMClient: Send + Sync {
    async fn chat(&self, prompt: String) -> Result<String>;
    async fn chat_stream(
        &self,
        prompt: String,
        on_chunk: &mut (dyn FnMut(String) + Send),
    ) -> Result<String>;
    async fn set_api_key(&self, api_key: String);
    async fn set_base_url(&self, base_url: String);
    async fn set_model(&self, model: String);
    async fn set_temperature(&self, temperature: Option<f32>);
}

pub struct OpenAICompatibleClient {
    api_key: RwLock<String>,
    base_url: RwLock<String>,
    model: RwLock<String>,
    temperature: RwLock<Option<f32>>,
    cli: Client,
}

pub fn new_llm_client<S: Into<String>>(
    api_key: S,
    base_url: S,
    model: S,
    temperature: Option<f32>,
) -> Result<Box<dyn LLMClient>> {
    let client = Client::builder().timeout(Duration::from_secs(60)).build()?;
    let llm_cli = OpenAICompatibleClient {
        api_key: RwLock::new(api_key.into()),
        base_url: RwLock::new(normalize_base_url(base_url.into())),
        model: RwLock::new(normalize_model(model.into())),
        temperature: RwLock::new(normalize_temperature(temperature)),
        cli: client,
    };
    Ok(Box::new(llm_cli))
}

fn normalize_base_url(base_url: String) -> String {
    let trimmed = base_url.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        DEFAULT_LLM_BASE_URL.to_string()
    } else {
        trimmed
    }
}

fn normalize_model(model: String) -> String {
    let trimmed = model.trim().to_string();
    if trimmed.is_empty() {
        DEFAULT_LLM_MODEL.to_string()
    } else {
        trimmed
    }
}

fn normalize_temperature(temperature: Option<f32>) -> Option<f32> {
    temperature.map(|value| value.clamp(0.0, 2.0))
}

fn content_text(text: String) -> Vec<ContentPart> {
    vec![ContentPart {
        content_type: "text".to_string(),
        text,
    }]
}

fn extract_response_text(response: ChatCompletionResponse) -> String {
    response
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .map(|content| match content {
            ResponseContent::Text(text) => text,
            ResponseContent::Parts(parts) => parts
                .into_iter()
                .filter(|part| part.content_type == "text")
                .filter_map(|part| part.text)
                .collect::<Vec<_>>()
                .join("\n"),
        })
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn extract_stream_delta_text(content: ResponseContent) -> String {
    match content {
        ResponseContent::Text(text) => text,
        ResponseContent::Parts(parts) => parts
            .into_iter()
            .filter(|part| part.content_type == "text")
            .filter_map(|part| part.text)
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

#[async_trait]
impl LLMClient for OpenAICompatibleClient {
    async fn chat_stream(
        &self,
        prompt: String,
        on_chunk: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let api_key = self.api_key.read().await.clone();
        if api_key.trim().is_empty() {
            return Err(AppError::LLMError(
                "LLM API key is not configured.".to_string(),
            ));
        }

        let request = ChatCompletionRequest {
            model: self.model.read().await.clone(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: content_text(DEFAULT_SYSTEM_PROMPT.to_string()),
                },
                Message {
                    role: "user".to_string(),
                    content: content_text(prompt),
                },
            ],
            temperature: *self.temperature.read().await,
            stream: true,
        };
        let endpoint = format!("{}/chat/completions", self.base_url.read().await);
        let response = self
            .cli
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&request)
            .send()
            .await?
            .error_for_status()?;

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut full_text = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(line_end) = buffer.find('\n') {
                let mut line = buffer[..line_end].trim().to_string();
                buffer.drain(..=line_end);

                if line.is_empty() {
                    continue;
                }

                if let Some(stripped) = line.strip_prefix("data:") {
                    line = stripped.trim().to_string();
                }

                if line == "[DONE]" {
                    continue;
                }

                let payload =
                    utils::json::parse_json::<ChatCompletionStreamResponse>(line.as_bytes())?;
                for choice in payload.choices {
                    if let Some(content) = choice.delta.content {
                        let text = extract_stream_delta_text(content);
                        if !text.is_empty() {
                            full_text.push_str(&text);
                            on_chunk(text);
                        }
                    }
                }
            }
        }

        if !buffer.trim().is_empty() {
            let mut line = buffer.trim().to_string();
            if let Some(stripped) = line.strip_prefix("data:") {
                line = stripped.trim().to_string();
            }
            if line != "[DONE]" {
                let payload =
                    utils::json::parse_json::<ChatCompletionStreamResponse>(line.as_bytes())?;
                for choice in payload.choices {
                    if let Some(content) = choice.delta.content {
                        let text = extract_stream_delta_text(content);
                        if !text.is_empty() {
                            full_text.push_str(&text);
                            on_chunk(text);
                        }
                    }
                }
            }
        }

        Ok(full_text.trim().to_string())
    }

    async fn set_api_key(&self, api_key: String) {
        *self.api_key.write().await = api_key;
    }

    async fn set_base_url(&self, base_url: String) {
        *self.base_url.write().await = normalize_base_url(base_url);
    }

    async fn set_model(&self, model: String) {
        *self.model.write().await = normalize_model(model);
    }

    async fn set_temperature(&self, temperature: Option<f32>) {
        *self.temperature.write().await = normalize_temperature(temperature);
    }

    async fn chat(&self, prompt: String) -> Result<String> {
        let api_key = self.api_key.read().await.clone();
        if api_key.trim().is_empty() {
            return Err(AppError::LLMError(
                "LLM API key is not configured.".to_string(),
            ));
        }

        let request = ChatCompletionRequest {
            model: self.model.read().await.clone(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: content_text(DEFAULT_SYSTEM_PROMPT.to_string()),
                },
                Message {
                    role: "user".to_string(),
                    content: content_text(prompt),
                },
            ],
            temperature: *self.temperature.read().await,
            stream: false,
        };
        let endpoint = format!("{}/chat/completions", self.base_url.read().await);
        let response = self
            .cli
            .post(&endpoint)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&request)
            .send()
            .await?
            .error_for_status()?;

        let data = response.bytes().await?;
        let chat_resp = utils::json::parse_json::<ChatCompletionResponse>(&data)?;
        Ok(extract_response_text(chat_resp))
    }
}

#[cfg(test)]
mod test {
    use crate::client::llm::chat;
    use crate::error::Result;
    use std::env;

    #[tokio::test]
    #[ignore]
    async fn test_openai_compatible_llm() -> Result<()> {
        let api_key = env::var("API_KEY").unwrap_or_default();
        let base_url = env::var("BASE_URL").unwrap_or_default();
        let model = env::var("MODEL").unwrap_or_default();
        let cli = chat::new_llm_client(api_key, base_url, model, None)?;
        let resp = cli.chat("你好！".into()).await?;
        println!("resp: {resp}");
        Ok(())
    }
}
