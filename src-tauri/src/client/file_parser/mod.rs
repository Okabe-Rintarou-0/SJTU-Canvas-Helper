use crate::error::{AppError, Result};
use async_trait::async_trait;
use bytes::Bytes;
use std::collections::HashMap;

mod docx;
mod pdf;

#[async_trait]
pub trait FileParser: Send + Sync {
    async fn parse(&self, data: Bytes) -> Result<String>;
}

pub struct GenericFileParser {
    dispatcher: HashMap<String, Box<dyn FileParser>>,
}

impl GenericFileParser {
    pub async fn parse(&self, data: Bytes, extension: &str) -> Result<String> {
        let parser = self
            .dispatcher
            .get(extension)
            .ok_or(AppError::UnsupportedFileExtensionError(extension.into()))?;

        parser.parse(data).await
    }
}

pub fn new_generic_file_reader() -> GenericFileParser {
    let dispatcher = HashMap::from([("pdf".into(), pdf::new()), ("docx".into(), docx::new())]);
    GenericFileParser { dispatcher }
}
