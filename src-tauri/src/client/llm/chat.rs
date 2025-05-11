use super::model::{ChatCompletionRequest, ChatCompletionResponse, Message};
use crate::{error::Result, utils};
use async_trait::async_trait;
use reqwest::Client;
use std::time::Duration;
use tokio::sync::RwLock;

#[async_trait]
pub trait LLMClient: Send + Sync {
    async fn chat(&self, prompt: String) -> Result<String>;
    async fn set_api_key(&self, api_key: String);
}

pub struct DeepSeekClient {
    api_key: RwLock<String>,
    cli: Client,
}

pub fn new_llm_client<S: Into<String>>(api_key: S) -> Result<Box<dyn LLMClient>> {
    let client = Client::builder().timeout(Duration::from_secs(60)).build()?;
    let llm_cli = DeepSeekClient {
        api_key: RwLock::new(api_key.into()),
        cli: client,
    };
    Ok(Box::new(llm_cli))
}

#[async_trait]
impl LLMClient for DeepSeekClient {
    async fn set_api_key(&self, api_key: String) {
        (*self.api_key.write().await) = api_key;
    }

    async fn chat(&self, prompt: String) -> Result<String> {
        let request = ChatCompletionRequest {
            model: "deepseek-chat".to_string(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: "You are a helpful assistant.".to_string(),
                },
                Message {
                    role: "user".to_string(),
                    content: prompt,
                },
            ],
            stream: false,
        };
        let response = self
            .cli
            .post("https://api.deepseek.com/chat/completions")
            .header("Content-Type", "application/json")
            .header(
                "Authorization",
                format!("Bearer {}", self.api_key.read().await),
            )
            .json(&request)
            .send()
            .await?;

        let data = response.bytes().await?;
        let chat_resp = utils::parse_json::<ChatCompletionResponse>(&data)?;
        let content = chat_resp
            .choices
            .into_iter()
            .next()
            .map(|choice| choice.message.content)
            .unwrap_or_default();
        Ok(content)
    }
}

#[cfg(test)]
mod test {
    use crate::client::llm::chat;
    use crate::error::Result;
    use std::env;

    #[tokio::test]
    #[ignore]
    async fn test_deepseek_llm() -> Result<()> {
        let api_key = env::var("API_KEY").unwrap_or_default();
        let cli = chat::new_llm_client(api_key)?;
        let resp = cli.chat("你好！".into()).await?;
        println!("resp: {}", resp);
        Ok(())
    }
}
