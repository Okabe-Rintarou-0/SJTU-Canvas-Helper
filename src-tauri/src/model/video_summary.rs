use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};

pub const DEFAULT_VIDEO_SUMMARY_PROMPT: &str = "按主题组织精炼的 Markdown 笔记，优先解释概念、结论和联系。列出主要知识点、作业、测验、考试及通知。每个知识点通常只引用 1 个最相关的资料位置，必要时最多 2 个；不逐句堆叠时间戳。";
pub fn default_video_summary_prompt() -> String {
    DEFAULT_VIDEO_SUMMARY_PROMPT.into()
}
pub fn default_video_context_tokens() -> u32 {
    256_000
}
pub fn default_video_output_tokens() -> u32 {
    32_768
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummaryOptions {
    #[serde(default = "default_video_summary_prompt")]
    pub prompt: String,
    #[serde(default = "default_video_context_tokens")]
    pub context_tokens: u32,
    #[serde(default = "default_video_output_tokens")]
    pub output_tokens: u32,
}

impl Default for VideoSummaryOptions {
    fn default() -> Self {
        Self {
            prompt: default_video_summary_prompt(),
            context_tokens: default_video_context_tokens(),
            output_tokens: default_video_output_tokens(),
        }
    }
}

impl VideoSummaryOptions {
    pub fn validate(&self) -> Result<()> {
        if !(4_096..=2_097_152).contains(&self.context_tokens) {
            return Err(AppError::LLMError(
                "上下文容量须为 4096–2097152 之间的整数".into(),
            ));
        }
        if self.output_tokens < 256 || self.output_tokens > self.context_tokens / 2 {
            return Err(AppError::LLMError(
                "输出预留须至少为 256，且不超过上下文容量的一半".into(),
            ));
        }
        Ok(())
    }
    pub fn input_budget(&self) -> usize {
        self.context_tokens as usize
            - self.output_tokens as usize
            - (self.context_tokens as usize / 16).min(2_048)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPreparedContext {
    pub source_hash: String,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoChatResponse {
    pub content: String,
    pub prepared_context: Option<VideoPreparedContext>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_configs_get_defaults_and_reserves_are_validated() {
        let config: crate::model::AppConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(config.video_summary_prompt, DEFAULT_VIDEO_SUMMARY_PROMPT);
        assert_eq!(config.video_summary_context_tokens, 256_000);
        assert_eq!(config.video_summary_output_tokens, 32_768);
        assert_eq!(VideoSummaryOptions::default().input_budget(), 221_184);
        assert!(VideoSummaryOptions::default().validate().is_ok());
        // Explicit values, including the old default, remain user-controlled.
        let saved: crate::model::AppConfig = serde_json::from_str(
            r#"{"video_summary_context_tokens":65536,"video_summary_output_tokens":8192}"#,
        )
        .unwrap();
        assert_eq!(saved.video_summary_context_tokens, 65_536);
        assert_eq!(saved.video_summary_output_tokens, 8_192);
        assert!(VideoSummaryOptions {
            context_tokens: 4096,
            ..Default::default()
        }
        .validate()
        .is_err());
        assert!(VideoSummaryOptions {
            context_tokens: 4096,
            output_tokens: 512,
            ..Default::default()
        }
        .validate()
        .is_ok());
    }
}
