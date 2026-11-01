use super::AppConfig;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Deserialize)]
struct PromptDefaults {
    correction: String,
    analysis: String,
}
fn defaults() -> &'static PromptDefaults {
    static DEFAULTS: OnceLock<PromptDefaults> = OnceLock::new();
    DEFAULTS.get_or_init(|| {
        serde_json::from_str(include_str!("subtitle_proofread_prompts.json"))
            .expect("valid built-in subtitle prompts")
    })
}
pub fn builtin_subtitle_proofread_prompt() -> &'static str {
    &defaults().correction
}
pub fn builtin_subtitle_analysis_prompt() -> &'static str {
    &defaults().analysis
}

#[derive(Clone, Default, Serialize)]
pub struct VideoProofreadOptions {
    pub generate_topics: bool,
}
impl From<&AppConfig> for VideoProofreadOptions {
    fn from(config: &AppConfig) -> Self {
        Self {
            generate_topics: config.experimental_video_topics,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recording_topics_default_off_and_roundtrip() {
        let mut config: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(!config.experimental_video_topics);
        assert!(!VideoProofreadOptions::from(&config).generate_topics);
        config.experimental_video_topics = true;
        let restored: AppConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert!(VideoProofreadOptions::from(&restored).generate_topics);
    }
}
