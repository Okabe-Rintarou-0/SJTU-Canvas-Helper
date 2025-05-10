use llm::chat::LLMClient;
use reqwest::cookie::Jar;
use std::sync::Arc;
use tokio::sync::RwLock;

pub mod ai;
pub mod annual;
pub mod basic;
mod common;
pub mod constants;
mod file_parser;
pub mod jbox;
mod llm;
pub mod video;

pub struct Client {
    cli: reqwest::Client,
    jar: Arc<Jar>,
    base_url: RwLock<String>,
    token: RwLock<String>,
    llm_cli: Box<dyn LLMClient>,
    file_parser: file_parser::GenericFileParser,
}
