use super::FileParser;
use crate::error::Result;
use async_trait::async_trait;
use bytes::Bytes;
use pdf_extract::extract_text_from_mem;

struct PdfParser {}

#[async_trait]
impl FileParser for PdfParser {
    async fn parse(&self, data: Bytes) -> Result<String> {
        Ok(extract_text_from_mem(&data)?)
    }
}

pub fn new() -> Box<dyn FileParser> {
    Box::new(PdfParser {})
}
