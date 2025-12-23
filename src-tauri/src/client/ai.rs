use super::Client;
use crate::{error::Result, model::{File, CanvasVideoSubTitle}, utils::format_time};
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

    pub async fn explain_file(&self, file: &File) -> Result<String> {
        let text = self.read_file_content(file).await?;
        let prompt = format!("你是一个大学课程助教，你的职责是帮助学生解释和总结课程文件的内容。如果文件是关于作业的，请列出得分点、作业提交要求等重要信息。
            请以 `Markdown` 格式输出（不需要用代码块包起来），并控制在 200-300 字。以下是文件的相关信息：
            文件名：{}。
            文件内容：{}",
                file.display_name,
                text
            );
        tracing::info!("Explain Prompt: {}", prompt);
        let resp = self.llm_cli.chat(prompt).await?;
        Ok(resp)
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

    pub async fn summarize_subtitle(&self, canvas_course_id: i64) -> Result<String> {
        let subtitle = &self.get_subtitle(canvas_course_id).await?.before_assembly_list;
        let compressed_subtitle = self.compress_subtitle(subtitle)?;
        let prompt = format!("你是一个大学课程助教，你的职责是从上课视频字幕中总结出这节课的关键信息。
            关键信息包含: 关于作业、小测、考试、签到等重要课程活动的信息或提示；这节课程涵盖的主要知识点及其主要框架。
            请以 Markdown 格式输出。
            视频字幕中包含了一些时间点，格式为 `[HH:MM:SS,FFF]`。如果你认为一条关键信息可以对应到一个时间点，请以同样的格式在这条关键信息之后输出这个时间点，并放在代码块中。如果有多个时间点，把每个时间点放在单独的代码块中。除此之外，不要使用代码块。
            不要输出总的一级标题。可以采取如下的二级标题：“课程活动与通知”、“主要知识点与框架”。
            保持简洁、风格专业严谨。注意不要输出额外的空格或换行。
            以下是视频字幕：{}。",
                compressed_subtitle
            );
        tracing::info!("Summarize Prompt: {}", prompt);
        let resp = self.llm_cli.chat(prompt).await?;
        Ok(resp)
    }
}
