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
