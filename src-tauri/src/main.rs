// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::Path};

use client::Client;
use error::Result;
use model::{AppConfig, Course, File, Folder, ProgressPayload};
use tauri::{Runtime, Window};
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

    async fn list_course_files(&self, course_id: i32) -> Result<Vec<File>> {
        self.client
            .list_course_files(course_id, &self.config.read().await.token)
            .await
    }

    async fn list_folder_files(&self, folder_id: i32) -> Result<Vec<File>> {
        self.client
            .list_folder_files(folder_id, &self.config.read().await.token)
            .await
    }

    async fn list_folders(&self, course_id: i32) -> Result<Vec<Folder>> {
        self.client
            .list_folders(course_id, &self.config.read().await.token)
            .await
    }

    async fn download_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        progress_handler: F,
    ) -> Result<()> {
        let guard = self.config.read().await;
        let token = &guard.token.clone();
        let save_path = &guard.save_path.clone();
        self.client
            .download_file(file, token, save_path, progress_handler)
            .await?;
        Ok(())
    }

    async fn save_config(&self, config: AppConfig) {
        *self.config.write().await = config;
    }

    fn check_path(path: &str) -> bool {
        let path = Path::new(path);
        if path.exists() {
            if let Ok(metadata) = fs::metadata(path) {
                return metadata.is_dir();
            }
        }
        false
    }
}

#[tauri::command]
async fn list_courses() -> Result<Vec<Course>> {
    APP.list_courses().await
}

#[tauri::command]
async fn list_course_files(course_id: i32) -> Result<Vec<File>> {
    APP.list_course_files(course_id).await
}

#[tauri::command]
async fn list_folder_files(folder_id: i32) -> Result<Vec<File>> {
    APP.list_folder_files(folder_id).await
}

#[tauri::command]
async fn list_folders(course_id: i32) -> Result<Vec<Folder>> {
    APP.list_folders(course_id).await
}

#[tauri::command]
async fn get_config() -> AppConfig {
    APP.get_config().await
}

#[tauri::command]
fn check_path(path: String) -> bool {
    App::check_path(&path)
}

#[tauri::command]
async fn download_file<R: Runtime>(window: Window<R>, file: File) -> Result<()> {
    APP.download_file(&file, &|progress| {
        let _ = window.emit("download://progress", progress);
    })
    .await
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
            list_course_files,
            list_folder_files,
            list_folders,
            get_config,
            save_config,
            download_file,
            check_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
