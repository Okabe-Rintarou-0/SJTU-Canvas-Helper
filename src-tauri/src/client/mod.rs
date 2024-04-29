use reqwest::cookie::Jar;
use std::sync::Arc;

pub mod basic;
mod common;
mod constants;
pub mod jbox;
pub mod video;

pub struct Client {
    cli: reqwest::Client,
    jar: Arc<Jar>,
}
