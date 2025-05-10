use super::Client;
use crate::{error::Result, model::File};
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
}
