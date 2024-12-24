use reqwest::cookie::Jar;
use std::sync::Arc;
use tokio::sync::RwLock;

pub mod annual;
pub mod basic;
mod common;
pub mod constants;
pub mod jbox;
pub mod video;

pub struct Client {
    cli: reqwest::Client,
    jar: Arc<Jar>,
    base_url: RwLock<String>,
}
