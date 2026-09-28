use crate::{
    error::{AppError, Result},
    model::AppConfig,
};
use futures::StreamExt;
use rig::{
    agent::MultiTurnStreamItem,
    client::CompletionClient,
    completion::Prompt,
    providers::openai,
    streaming::{StreamedAssistantContent, StreamingPrompt},
};
use tokio::sync::RwLock;

pub const DEFAULT_LLM_BASE_URL: &str = "https://api.deepseek.com/v1";
pub const DEFAULT_LLM_MODEL: &str = "deepseek-flash";
const LEGACY_DEEPSEEK_MODEL: &str = "deepseek-chat";
const DEFAULT_SYSTEM_PROMPT: &str = "You are a helpful assistant.";

#[derive(Debug, Clone, PartialEq)]
pub struct EffectiveLlmConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub temperature: Option<f32>,
}

impl EffectiveLlmConfig {
    pub fn from_app_config(config: &AppConfig) -> Self {
        let active_entry = (!config.llm_active_api_key.trim().is_empty())
            .then(|| {
                config
                    .llm_api_keys
                    .iter()
                    .find(|entry| entry.name == config.llm_active_api_key)
            })
            .flatten();

        let api_key = active_entry
            .map(|entry| entry.key.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| config.llm_api_key.trim())
            .to_string();
        let base_url = active_entry
            .map(|entry| entry.base_url.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| config.llm_base_url.trim());
        let model = active_entry
            .map(|entry| entry.model.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| config.llm_model.trim());

        Self::from_parts(api_key, base_url, model, config.llm_temperature)
    }

    pub fn from_parts(
        api_key: impl Into<String>,
        base_url: impl Into<String>,
        model: impl Into<String>,
        temperature: Option<f32>,
    ) -> Self {
        let base_url = normalize_base_url(base_url.into());
        let model = normalize_model(model.into(), &base_url);
        Self {
            api_key: api_key.into().trim().to_string(),
            base_url,
            model,
            temperature: temperature.map(|value| value.clamp(0.0, 2.0)),
        }
    }
}

fn normalize_base_url(base_url: String) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_LLM_BASE_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_model(model: String, base_url: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty()
        || (is_deepseek_base_url(base_url) && trimmed.eq_ignore_ascii_case(LEGACY_DEEPSEEK_MODEL))
    {
        DEFAULT_LLM_MODEL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_deepseek_base_url(base_url: &str) -> bool {
    base_url.to_ascii_lowercase().contains("deepseek.com")
}

#[derive(Clone)]
pub struct LlmSnapshot {
    pub client: openai::CompletionsClient,
    pub model: String,
    pub temperature: Option<f32>,
}

pub struct LlmRuntime {
    state: RwLock<Option<LlmSnapshot>>,
}

impl LlmRuntime {
    pub fn new(config: EffectiveLlmConfig) -> Result<Self> {
        Ok(Self {
            state: RwLock::new(Self::build_snapshot(config)?),
        })
    }

    fn build_snapshot(config: EffectiveLlmConfig) -> Result<Option<LlmSnapshot>> {
        if config.api_key.is_empty() {
            return Ok(None);
        }

        let client = openai::CompletionsClient::builder()
            .api_key(&config.api_key)
            .base_url(&config.base_url)
            .build()
            .map_err(|error| AppError::LLMError(error.to_string()))?;
        Ok(Some(LlmSnapshot {
            client,
            model: config.model,
            temperature: config.temperature,
        }))
    }

    pub async fn reconfigure(&self, config: EffectiveLlmConfig) -> Result<()> {
        let next = Self::build_snapshot(config)?;
        *self.state.write().await = next;
        Ok(())
    }

    pub async fn snapshot(&self) -> Result<LlmSnapshot> {
        self.state
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::LLMError("LLM API key is not configured.".to_string()))
    }

    pub async fn chat(&self, prompt: String) -> Result<String> {
        let snapshot = self.snapshot().await?;
        let mut builder = snapshot
            .client
            .agent(&snapshot.model)
            .preamble(DEFAULT_SYSTEM_PROMPT);
        if let Some(temperature) = snapshot.temperature {
            builder = builder.temperature(f64::from(temperature));
        }
        builder
            .build()
            .prompt(prompt)
            .await
            .map_err(|error| AppError::LLMError(error.to_string()))
    }

    pub async fn chat_stream(
        &self,
        prompt: String,
        on_chunk: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let snapshot = self.snapshot().await?;
        let mut builder = snapshot
            .client
            .agent(&snapshot.model)
            .preamble(DEFAULT_SYSTEM_PROMPT);
        if let Some(temperature) = snapshot.temperature {
            builder = builder.temperature(f64::from(temperature));
        }
        let agent = builder.build();
        let mut stream = agent.stream_prompt(prompt).await;
        let mut full_text = String::new();

        while let Some(item) = stream.next().await {
            match item.map_err(|error| AppError::LLMError(error.to_string()))? {
                MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text)) => {
                    full_text.push_str(&text.text);
                    on_chunk(text.text);
                }
                _ => continue,
            }
        }

        Ok(full_text.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::LlmApiKeyEntry;
    use httpmock::{Method::POST, MockServer};
    use serde_json::json;

    #[test]
    fn legacy_key_uses_deepseek_flash_defaults() {
        let config = AppConfig {
            llm_api_key: "legacy-key".to_string(),
            ..Default::default()
        };

        let effective = EffectiveLlmConfig::from_app_config(&config);

        assert_eq!(effective.api_key, "legacy-key");
        assert_eq!(effective.base_url, DEFAULT_LLM_BASE_URL);
        assert_eq!(effective.model, DEFAULT_LLM_MODEL);
    }

    #[test]
    fn legacy_deepseek_chat_model_is_migrated() {
        let config = AppConfig {
            llm_api_key: "legacy-key".to_string(),
            llm_base_url: "https://api.deepseek.com/".to_string(),
            llm_model: LEGACY_DEEPSEEK_MODEL.to_string(),
            ..Default::default()
        };

        let effective = EffectiveLlmConfig::from_app_config(&config);

        assert_eq!(effective.base_url, "https://api.deepseek.com");
        assert_eq!(effective.model, DEFAULT_LLM_MODEL);
    }

    #[test]
    fn active_entry_takes_precedence() {
        let config = AppConfig {
            llm_api_key: "legacy-key".to_string(),
            llm_base_url: DEFAULT_LLM_BASE_URL.to_string(),
            llm_model: DEFAULT_LLM_MODEL.to_string(),
            llm_active_api_key: "custom".to_string(),
            llm_api_keys: vec![LlmApiKeyEntry {
                name: "custom".to_string(),
                key: "custom-key".to_string(),
                base_url: "https://example.com/v1/".to_string(),
                model: "custom-model".to_string(),
            }],
            ..Default::default()
        };

        let effective = EffectiveLlmConfig::from_app_config(&config);

        assert_eq!(effective.api_key, "custom-key");
        assert_eq!(effective.base_url, "https://example.com/v1");
        assert_eq!(effective.model, "custom-model");
    }

    #[test]
    fn missing_active_entry_falls_back_to_legacy_fields() {
        let config = AppConfig {
            llm_api_key: "legacy-key".to_string(),
            llm_active_api_key: "missing".to_string(),
            ..Default::default()
        };

        let effective = EffectiveLlmConfig::from_app_config(&config);

        assert_eq!(effective.api_key, "legacy-key");
        assert_eq!(effective.base_url, DEFAULT_LLM_BASE_URL);
        assert_eq!(effective.model, DEFAULT_LLM_MODEL);
    }

    #[test]
    fn deepseek_chat_is_not_rewritten_for_other_backends() {
        let effective = EffectiveLlmConfig::from_parts(
            "key",
            "https://example.com/v1",
            LEGACY_DEEPSEEK_MODEL,
            None,
        );

        assert_eq!(effective.model, LEGACY_DEEPSEEK_MODEL);
    }

    #[tokio::test]
    async fn runtime_chat_uses_the_configured_openai_compatible_endpoint() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path("/chat/completions")
                .header("authorization", "Bearer test-key")
                .body_contains("\"model\":\"deepseek-flash\"");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(json!({
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "created": 1,
                    "model": DEFAULT_LLM_MODEL,
                    "system_fingerprint": null,
                    "choices": [{
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "测试成功"
                        },
                        "logprobs": null,
                        "finish_reason": "stop"
                    }],
                    "usage": null
                }));
        });
        let runtime = LlmRuntime::new(EffectiveLlmConfig::from_parts(
            "test-key",
            server.base_url(),
            DEFAULT_LLM_MODEL,
            None,
        ))
        .unwrap();

        let response = runtime.chat("你好".to_string()).await.unwrap();

        assert_eq!(response, "测试成功");
        request.assert();
    }

    #[tokio::test]
    async fn runtime_stream_forwards_text_chunks() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path("/chat/completions")
                .body_contains("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body(concat!(
                    "data: {\"id\":\"chunk-1\",\"model\":\"deepseek-flash\",\"choices\":[{\"delta\":{\"content\":\"测试\"},\"finish_reason\":null}],\"usage\":null}\n\n",
                    "data: {\"id\":\"chunk-2\",\"model\":\"deepseek-flash\",\"choices\":[{\"delta\":{\"content\":\"成功\"},\"finish_reason\":\"stop\"}],\"usage\":null}\n\n",
                    "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2,\"total_tokens\":3}}\n\n",
                    "data: [DONE]\n\n"
                ));
        });
        let runtime = LlmRuntime::new(EffectiveLlmConfig::from_parts(
            "test-key",
            server.base_url(),
            DEFAULT_LLM_MODEL,
            None,
        ))
        .unwrap();
        let mut chunks = Vec::new();

        let response = runtime
            .chat_stream("你好".to_string(), &mut |chunk| chunks.push(chunk))
            .await
            .unwrap();

        assert_eq!(chunks, vec!["测试", "成功"]);
        assert_eq!(response, "测试成功");
        request.assert();
    }
}
