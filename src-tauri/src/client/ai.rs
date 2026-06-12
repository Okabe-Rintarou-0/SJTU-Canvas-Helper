use super::Client;
use crate::{
    error::Result,
    model::{CanvasVideoSubTitle, File, LLMChatMessage},
    utils::time::format_time,
};
use std::path::Path;

impl Client {
    pub async fn chat<S: Into<String>>(&self, prompt: S) -> Result<String> {
        self.llm_cli.chat(prompt.into()).await
    }

    async fn read_file_content(&self, file: &File) -> Result<String> {
        let path = Path::new(&file.display_name);
        let ext = path
            .extension()
            .and_then(|os_str| os_str.to_str())
            .unwrap_or("");
        let resp = self.get_request(&file.url, None::<&str>).await?;
        let data = resp.bytes().await?;
        let text = self.file_parser.parse(data, ext).await?;
        Ok(text)
    }

    fn default_file_summary_request(file_name: &str) -> String {
        format!(
            "请先总结这份文件。若它与作业相关，请额外列出得分点、提交要求、截止时间、文件格式限制和任何容易遗漏的注意事项。请使用 Markdown 输出，不要把整段内容包在代码块里。文件名：{file_name}"
        )
    }

    fn build_file_chat_prompt(&self, file: &File, text: &str, messages: &[LLMChatMessage]) -> String {
        let history = messages
            .iter()
            .map(|message| {
                let speaker = if message.role.eq_ignore_ascii_case("assistant") {
                    "AI"
                } else {
                    "User"
                };
                format!("{speaker}: {}", message.content.trim())
            })
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            "你是一个大学课程助教，正在围绕同一份课程文件与学生持续对话。请优先依据文件内容回答；如果问题超出文件内容，请明确说明这一点，再给出最接近的帮助。回答请使用 Markdown，但不要把整段回答包在代码块中。\n\n文件名：{}\n\n文件内容：\n{}\n\n对话历史：\n{}",
            file.display_name, text, history
        )
    }

    pub async fn chat_with_file(&self, file: &File, messages: &[LLMChatMessage]) -> Result<String> {
        let text = self.read_file_content(file).await?;
        let prompt = self.build_file_chat_prompt(file, &text, messages);
        tracing::info!("File Chat Prompt built for: {}", file.display_name);
        self.llm_cli.chat(prompt).await
    }

    pub async fn chat_with_file_stream(
        &self,
        file: &File,
        messages: &[LLMChatMessage],
        on_chunk: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let text = self.read_file_content(file).await?;
        let prompt = self.build_file_chat_prompt(file, &text, messages);
        tracing::info!("File Stream Chat Prompt built for: {}", file.display_name);
        self.llm_cli.chat_stream(prompt, on_chunk).await
    }

    pub async fn explain_file(&self, file: &File) -> Result<String> {
        let messages = vec![LLMChatMessage {
            role: "user".to_string(),
            content: Self::default_file_summary_request(&file.display_name),
        }];
        self.chat_with_file(file, &messages).await
    }

    pub fn compress_subtitle(&self, subtitle: &[CanvasVideoSubTitle]) -> Result<String> {
        let mut result = String::new();

        let mut current_sentence = String::new();
        let mut sentence_start_time: Option<u64> = None;

        for item in subtitle {
            if sentence_start_time.is_none() {
                sentence_start_time = Some(item.bg);
            }

            current_sentence.push_str(item.res.trim());

            if current_sentence.ends_with('.') || current_sentence.ends_with('。') {
                let start_time = format_time(sentence_start_time.unwrap());

                result.push_str(&format!(
                    "[{}] {} ",
                    start_time,
                    current_sentence.trim()
                ));

                current_sentence.clear();
                sentence_start_time = None;
            }
        }

        if !current_sentence.is_empty() {
            let start_time = format_time(sentence_start_time.unwrap());
            result.push_str(&format!(
                "[{}] {}",
                start_time,
                current_sentence.trim()
            ));
        }

        Ok(result.trim().to_string())
    }

    fn default_subtitle_summary_request() -> String {
        "请先总结这节课的核心内容。重点关注课程活动与通知、作业/小测/考试/签到提醒，以及主要知识点与框架；如果合适，请引用对应的字幕时间点。请使用 Markdown 输出。".to_string()
    }

    fn build_subtitle_chat_prompt(
        &self,
        compressed_subtitle: &str,
        messages: &[LLMChatMessage],
    ) -> String {
        let history = messages
            .iter()
            .map(|message| {
                let speaker = if message.role.eq_ignore_ascii_case("assistant") {
                    "AI"
                } else {
                    "User"
                };
                format!("{speaker}: {}", message.content.trim())
            })
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            "你是一个大学课程助教，正在围绕一段课程视频字幕与学生持续对话。请优先依据字幕回答；如果问题超出字幕，请明确说明。回答请使用 Markdown。字幕中包含一些时间点，格式为 `[HH:MM:SS,FFF]`；当你引用时间点时，请保留这个格式，方便前端跳转。\n\n视频字幕：\n{}\n\n对话历史：\n{}",
            compressed_subtitle, history
        )
    }

    pub async fn chat_with_subtitle(
        &self,
        canvas_course_id: i64,
        messages: &[LLMChatMessage],
    ) -> Result<String> {
        let subtitle = &self.get_subtitle(canvas_course_id).await?.before_assembly_list;
        let compressed_subtitle = self.compress_subtitle(subtitle)?;
        let prompt = self.build_subtitle_chat_prompt(&compressed_subtitle, messages);
        tracing::info!("Subtitle Chat Prompt built for course id: {}", canvas_course_id);
        self.llm_cli.chat(prompt).await
    }

    pub async fn chat_with_subtitle_stream(
        &self,
        canvas_course_id: i64,
        messages: &[LLMChatMessage],
        on_chunk: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        let subtitle = &self.get_subtitle(canvas_course_id).await?.before_assembly_list;
        let compressed_subtitle = self.compress_subtitle(subtitle)?;
        let prompt = self.build_subtitle_chat_prompt(&compressed_subtitle, messages);
        tracing::info!(
            "Subtitle Stream Chat Prompt built for course id: {}",
            canvas_course_id
        );
        self.llm_cli.chat_stream(prompt, on_chunk).await
    }

    pub async fn summarize_subtitle(&self, canvas_course_id: i64) -> Result<String> {
        let messages = vec![LLMChatMessage {
            role: "user".to_string(),
            content: Self::default_subtitle_summary_request(),
        }];
        self.chat_with_subtitle(canvas_course_id, &messages).await
    }
}
