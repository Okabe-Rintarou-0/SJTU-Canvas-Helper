use llm::chat::LlmRuntime;
pub(crate) use llm::chat::{EffectiveLlmConfig, LlmSnapshot};
use reqwest::cookie::Jar;
use std::sync::Arc;
use tokio::sync::RwLock;

pub mod ai;
pub mod annual;
pub mod basic;
mod common;
mod canvas_session;
pub mod constants;
mod debug;
mod file_parser;
pub mod jbox;
mod llm;
pub mod video;
mod video_auth;
pub mod video_library;
mod transcription;
pub mod subtitle_proofread;

pub struct Client {
    cli: reqwest::Client,
    jar: Arc<Jar>,
    base_url: RwLock<String>,
    token: RwLock<String>,
    video_auth: tokio::sync::Mutex<video_auth::VideoAuth>,
    transcription: transcription::TranscriptionRuntime,
    subtitle_proofread: subtitle_proofread::ProofreadRuntime,
    llm_cli: LlmRuntime,
    file_parser: file_parser::GenericFileParser,
    debug_store: debug::NetworkDebugStore,
}
