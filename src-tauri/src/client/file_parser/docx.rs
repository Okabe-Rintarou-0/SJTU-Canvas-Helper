use super::FileParser;
use crate::error::Result;
use async_trait::async_trait;
use bytes::Bytes;
use docx_rs::read_docx;
use serde_json::Value;

struct DocxParser {}

fn read_children(node: &Value, text: &mut String) {
    if let Some(children) = node["data"]["children"].as_array() {
        children.iter().for_each(|child| {
            if child["type"] != "text" {
                read_children(child, text);
            } else {
                let mut paragraph = child["data"]["text"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                paragraph.push('\n');
                text.push_str(&paragraph);
            }
        });
    }
}

#[async_trait]
impl FileParser for DocxParser {
    async fn parse(&self, data: Bytes) -> Result<String> {
        let docx = read_docx(&data)?;
        let data: Value = serde_json::from_str(&docx.json())?;
        let mut text = String::new();
        if let Some(children) = data["document"]["children"].as_array() {
            children
                .iter()
                .for_each(|node| read_children(node, &mut text));
        }
        Ok(text)
    }
}

pub fn new() -> Box<dyn FileParser> {
    Box::new(DocxParser {})
}
