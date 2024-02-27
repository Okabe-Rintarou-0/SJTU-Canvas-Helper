// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;

use client::Client;
use error::Result;
use model::{AppConfig, Course, File};
use tokio::sync::RwLock;
mod client;
mod error;
mod model;

#[macro_use]
extern crate lazy_static;

lazy_static! {
    static ref APP: App = App::new();
}

const CONFIG_PATH: &'static str = "./config.json";

struct App {
    client: Client,
    config: RwLock<AppConfig>,
}

impl App {
    fn new() -> Self {
        let config = match App::read_config_from_file() {
            Ok(config) => config,
            Err(_) => Default::default(),
        };

        Self {
            client: Client::new(),
            config: RwLock::new(config),
        }
    }

    fn read_config_from_file() -> Result<AppConfig> {
        let content = fs::read(CONFIG_PATH)?;
        let config = serde_json::from_slice(&content)?;
        Ok(config)
    }

    async fn get_config(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    async fn list_courses(&self) -> Result<Vec<Course>> {
        self.client
            .list_courses(&self.config.read().await.token)
            .await
    }

    async fn list_files(&self, course_id: i32) -> Result<Vec<File>> {
        self.client
            .list_files(course_id, &self.config.read().await.token)
            .await
    }

    async fn download_file(&self, url: &str, out_path: &str) -> Result<()> {
        self.client
            .download_file(url, out_path, &self.config.read().await.token)
            .await?;
        Ok(())
    }

    async fn save_config(&self, config: AppConfig) {
        *self.config.write().await = config;
    }
}

#[tauri::command]
async fn list_courses() -> Result<Vec<Course>> {
    APP.list_courses().await
}

#[tauri::command]
async fn list_files(course_id: i32) -> Result<Vec<File>> {
    APP.list_files(course_id).await
}

#[tauri::command]
async fn get_config() -> AppConfig {
    APP.get_config().await
}

#[tauri::command]
async fn download_file(url: String, out_path: String) -> Result<()> {
    APP.download_file(&url, &out_path).await
}

#[tauri::command]
async fn save_config(config: AppConfig) -> Result<()> {
    tracing::info!("Receive config: {:?}", config);
    fs::write(CONFIG_PATH, serde_json::to_vec(&config).unwrap())?;
    APP.save_config(config).await;
    Ok(())
}

fn main() {
    tracing_subscriber::fmt::init();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_courses,
            list_files,
            get_config,
            save_config,
            download_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
