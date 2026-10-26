use dirs::config_dir;
use error::{AppError, Result};
use futures::StreamExt;
use reqwest::{header::TE, StatusCode};
use rust_xlsxwriter::Workbook;
use std::convert::Infallible;
use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tauri::{Emitter, Runtime, Window};
use tokio::{io::AsyncReadExt, process::Command as TokioCommand};
use tokio::sync::RwLock;
use uuid::Uuid;
use warp::filters::query::raw as query_raw;
use warp::{hyper::Response, Filter};

use crate::{
    client::{
        constants::{BASE_URL, JI_BASE_URL},
        Client,
    },
    error,
    model::*,
    utils::file::{checked_download_path, write_file_atomic},
};

use super::{
    constants::{COURSES_CACHE_KEY, RELATIONSHIP_CACHE_KEY},
    App,
    config_store::{ConfigStore, sync_directory},
};

const MY_CANVAS_FILES_FOLDER_NAME: &str = "我的Canvas文件";

fn canvas_stream_host(host: &str) -> bool {
    host == "live.sjtu.edu.cn" || host.strip_prefix("mss")
        .and_then(|rest| rest.strip_suffix(".sjtu.edu.cn"))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()))
}

fn rewrite_live_playlist(playlist: &str, upstream: &str, proxy_origin: &str) -> String {
    let Ok(base) = tauri::Url::parse(upstream) else { return playlist.to_string(); };
    let rewrite = |uri: &str| -> String {
        let Ok(url) = base.join(uri) else { return uri.to_string(); };
        let Some(host) = url.host_str().filter(|host| canvas_stream_host(host)) else { return uri.to_string(); };
        if url.scheme() != "https" || url.port_or_known_default() != Some(443) { return uri.to_string(); }
        format!("{proxy_origin}/canvas-stream/{host}{}{}", url.path(),
            url.query().map(|query| format!("?{query}")).unwrap_or_default())
    };
    let uri_attribute = regex::Regex::new(r#"URI="([^"]+)""#).unwrap();
    playlist.lines().map(|line| {
        if line.starts_with('#') {
            uri_attribute.replace_all(line, |captures: &regex::Captures| format!("URI=\"{}\"", rewrite(&captures[1]))).into_owned()
        } else if line.trim().is_empty() { line.to_string() }
        else { rewrite(line.trim()) }
    }).collect::<Vec<_>>().join("\n") + "\n"
}

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
enum AccountOperation { Create, Delete }

// Identity and content fingerprints only. Never persist configuration bodies,
// authentication tokens, cookies, or client secrets in the recovery record.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountIntent {
    version: u8,
    operation: AccountOperation,
    account: Account,
    before: AccountInfo,
    after: AccountInfo,
    target_sha256: String,
}


async fn proxy_video_request(
    upstream_base: &str,
    referer: &'static str,
    origin: &'static str,
    tail: warp::path::Tail,
    query: String,
    headers: warp::http::HeaderMap,
    hls_proxy_origin: Option<String>,
) -> std::result::Result<Response<warp::hyper::Body>, Infallible> {
    let range_value = headers
        .get("Range")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    let mut url = format!("{upstream_base}/{}", tail.as_str());
    if !query.is_empty() {
        url.push('?');
        url.push_str(&query);
    }

    let client = reqwest::Client::new();
    let mut request = client
        .get(&url)
        .header("Referer", referer)
        .header("Origin", origin)
        .header("Accept-Encoding", "identity");
    if !range_value.is_empty() {
        request = request.header("Range", range_value);
    }
    for name in ["If-Range", "Accept", "User-Agent"] {
        if let Some(value) = headers.get(name) {
            request = request.header(name, value.as_bytes());
        }
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() && tail.as_str().ends_with(".m3u8") {
                if let Some(proxy_origin) = hls_proxy_origin {
                    return match response.text().await {
                        Ok(playlist) => Ok(Response::builder().status(status)
                            .header("Content-Type", "application/vnd.apple.mpegurl")
                            .header("Cache-Control", "no-store")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(rewrite_live_playlist(&playlist, &url, &proxy_origin).into()).unwrap()),
                        Err(_) => Ok(Response::builder().status(StatusCode::BAD_GATEWAY)
                            .header("Access-Control-Allow-Origin", "*")
                            .body("Failed to read live playlist".into()).unwrap()),
                    };
                }
            }
            let mut builder = Response::builder().status(status);
            for (key, value) in response.headers() {
                if key.as_str() != TE.as_str()
                    && !matches!(
                        key.as_str(),
                        "connection"
                            | "keep-alive"
                            | "proxy-authenticate"
                            | "proxy-authorization"
                            | "trailer"
                            | "transfer-encoding"
                            | "upgrade"
                            | "access-control-allow-origin"
                            | "access-control-expose-headers"
                    )
                {
                    builder = builder.header(key, value);
                }
            }
            builder = builder.header("Access-Control-Allow-Origin", "*").header(
                "Access-Control-Expose-Headers",
                "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
            );
            let stream = response
                .bytes_stream()
                .map(|chunk| chunk.map_err(std::io::Error::other));
            let body = warp::hyper::Body::wrap_stream(stream);
            Ok(builder.body(body).unwrap())
        }
        Err(error) => Ok(Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header("Access-Control-Allow-Origin", "*")
            .body(if hls_proxy_origin.is_some() { "Error connecting to live media".to_string() } else { format!("Error downloading video: {error}") }.into())
            .unwrap()),
    }
}

impl App {
    pub(super) fn store_ready(&self) -> Result<&ConfigStore> {
        let store = self.config_store.as_ref().ok_or(AppError::StaleConfigOwner)?;
        store.ensure_ready()?;
        Ok(store)
    }

    fn sync_parent_directory(path: &str) -> Result<()> {
        let parent = Path::new(path).parent().ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput, "configuration path has no parent",
        ))?;
        sync_directory(parent).map_err(|_| AppError::PersistenceUncertain)
    }

    fn persist_prepared(staged: tempfile::NamedTempFile, path: &str) -> Result<()> {
        staged.persist(path).map_err(|error| error.error)?;
        Self::sync_parent_directory(path)
    }

    pub(crate) fn portable() -> bool {
        let exe_dir = std::env::current_exe()
            .map(|path| path.parent().unwrap().to_owned())
            .ok();

        if let Some(dir) = exe_dir {
            let portable_file = dir.join(".config/PORTABLE");
            portable_file.exists()
        } else {
            false
        }
    }

    pub fn config_dir() -> Result<String> {
        let directory = if App::portable() {
            std::env::current_exe()?.parent()
                .ok_or_else(|| std::io::Error::other("Application directory unavailable"))?
                .join(".config")
        } else {
            config_dir().ok_or_else(|| std::io::Error::other("Configuration directory unavailable"))?
                .join("SJTU-Canvas-Helper")
        };
        Ok(directory.to_str().ok_or_else(|| std::io::Error::other("Configuration path is not valid UTF-8"))?.to_owned())
    }

    fn prepare_config_write(path: &str, bytes: &[u8]) -> Result<tempfile::NamedTempFile> {
        let target = std::path::Path::new(path);
        let parent = target.parent().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "configuration path has no parent")
        })?;
        let permissions = match std::fs::symlink_metadata(target) {
            Ok(metadata) => {
                if !metadata.file_type().is_file() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "configuration target is not a regular file",
                    ).into());
                }
                if metadata.permissions().readonly() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "configuration target is read-only",
                    ).into());
                }
                Some(metadata.permissions())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let mut staged = tempfile::NamedTempFile::new_in(parent)?;
        if let Some(permissions) = permissions {
            staged.as_file().set_permissions(permissions)?;
        }
        std::io::Write::write_all(staged.as_file_mut(), bytes)?;
        staged.as_file().sync_all()?;
        Ok(staged)
    }

    fn write_config_atomically(path: &str, bytes: &[u8]) -> Result<()> {
        let staged = Self::prepare_config_write(path, bytes)?;
        Self::persist_prepared(staged, path)
    }

    fn save_account_info_in(config_dir: &str, account: &AccountInfo) -> Result<()> {
        let account_path = Self::account_index_path_in(config_dir);
        let content = serde_json::to_vec(account)?;
        Self::write_config_atomically(&account_path, &content)?;
        Ok(())
    }

    fn validate_account_name(account: &Account) -> Result<()> {
        if let Account::Custom(name) = account {
            let unsafe_path = name.contains('/') || name.contains('\0')
                || (cfg!(windows) && (name.contains('\\') || name.contains(':')));
            // The unit enum variant serializes as "Default" too; it cannot name a custom account.
            if name == "Default" || unsafe_path {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput, "invalid account file name",
                ).into());
            }
        }
        Ok(())
    }

    fn read_regular_config_file(path: &str) -> Result<Vec<u8>> {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.file_type().is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput, "configuration is not a regular file",
            ).into());
        }
        Ok(fs::read(path)?)
    }

    #[cfg(test)]
    pub fn read_account_info() -> Result<AccountInfo> {
        Self::read_account_info_in(&Self::config_dir()?)
    }

    pub fn active_account_info(&self) -> Result<AccountInfo> {
        Self::read_account_info_in(self.store_ready()?.root_str()?)
    }

    pub fn active_accounts(&self) -> Result<Vec<Account>> {
        Ok(self.active_account_info()?.all_accounts)
    }

    fn account_index_path_in(directory: &str) -> String {
        Path::new(directory).join("account.json").to_string_lossy().into_owned()
    }

    fn read_account_info_in(directory: &str) -> Result<AccountInfo> {
        let account_path = Self::account_index_path_in(directory);
        let content = Self::read_regular_config_file(&account_path)?;
        let account: AccountInfo = serde_json::from_slice(&content).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid account metadata")
        })?;
        Self::validate_account_info(&account)?;
        Ok(account)
    }

    #[cfg(test)]
    pub fn account_exists(account: &Account) -> Result<bool> {
        Self::account_exists_in(&Self::config_dir()?, account)
    }

    fn account_exists_in(directory: &str, account: &Account) -> Result<bool> {
        Self::validate_account_name(account)?;
        match fs::symlink_metadata(Self::get_config_path_in(directory, account)) {
            Ok(metadata) if metadata.file_type().is_file() => Ok(true),
            Ok(_) => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput, "configuration is not a regular file",
            ).into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    fn validate_account_info(account: &AccountInfo) -> Result<()> {
        for (index, entry) in account.all_accounts.iter().enumerate() {
            Self::validate_account_name(entry)?;
            if account.all_accounts[..index].contains(entry) {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,
                    "duplicate account metadata entry").into());
            }
        }
        Self::validate_account_name(&account.current_account)?;
        if !account.all_accounts.contains(&Account::Default)
            || !account.all_accounts.contains(&account.current_account)
        {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,
                "account metadata membership is inconsistent").into());
        }
        Ok(())
    }

    fn content_fingerprint(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(bytes))
    }

    fn intent_path(directory: &str) -> String {
        Path::new(directory).join(".account-transaction.json").to_string_lossy().into_owned()
    }

    // Call only while holding config_owner. A read-only UI inspection must not
    // mistake this instance's in-flight transaction for abandoned recovery work.
    fn ensure_no_pending_intent(store: &ConfigStore) -> Result<()> {
        match fs::symlink_metadata(store.root().join(".account-transaction.json")) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => { store.poison(); Err(AppError::PersistenceUncertain) }
        }
    }

    fn validate_intent(intent: &AccountIntent) -> Result<()> {
        let invalid = || std::io::Error::new(std::io::ErrorKind::InvalidData,
            "invalid or unsupported account transaction");
        if intent.version != 1 || intent.account == Account::Default
            || intent.target_sha256.len() != 64
            || !intent.target_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        { return Err(invalid().into()); }
        Self::validate_account_name(&intent.account)?;
        Self::validate_account_info(&intent.before)?;
        Self::validate_account_info(&intent.after)?;
        let mut expected = intent.before.clone();
        match intent.operation {
            AccountOperation::Create => {
                if expected.all_accounts.contains(&intent.account) { return Err(invalid().into()); }
                expected.all_accounts.push(intent.account.clone());
            }
            AccountOperation::Delete => {
                if !expected.all_accounts.contains(&intent.account) { return Err(invalid().into()); }
                expected.all_accounts.retain(|account| account != &intent.account);
                if expected.current_account == intent.account {
                    expected.current_account = Account::Default;
                }
            }
        }
        if expected != intent.after { return Err(invalid().into()); }
        Ok(())
    }

    fn transaction_may_have_started(directory: &str, error: &AppError) -> bool {
        matches!(error, AppError::PersistenceUncertain)
            || !matches!(fs::symlink_metadata(Self::intent_path(directory)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound)
    }

    fn begin_account_transaction(directory: &str, intent: &AccountIntent) -> Result<()> {
        Self::validate_intent(intent)?;
        let path = Self::intent_path(directory);
        let bytes = serde_json::to_vec(intent)?;
        Self::prepare_config_write(&path, &bytes)?
            .persist_noclobber(&path).map_err(|error| error.error)?;
        Self::sync_parent_directory(&path)
    }

    fn recover_account_transaction(directory: &str) -> Result<()> {
        let path = Self::intent_path(directory);
        let bytes = match Self::read_regular_config_file(&path) {
            Ok(bytes) => bytes,
            Err(AppError::IO(error)) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        let intent: AccountIntent = serde_json::from_slice(&bytes).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid account transaction")
        })?;
        Self::validate_intent(&intent)?;
        let current = Self::read_account_info_in(directory)?;
        if current != intent.before && current != intent.after {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,
                "account metadata changed outside the pending transaction").into());
        }
        let target = Self::get_config_path_in(directory, &intent.account);
        let existing = match Self::read_regular_config_file(&target) {
            Ok(bytes) => Some(bytes),
            Err(AppError::IO(error)) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        if let Some(bytes) = &existing {
            if Self::content_fingerprint(bytes) != intent.target_sha256 {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,
                    "account transaction target was replaced; original files preserved").into());
            }
        }
        // A prior process may have renamed the intent but failed before syncing
        // its directory. Visibility alone is not a durable write-ahead record.
        Self::sync_parent_directory(&path)?;
        match intent.operation {
            AccountOperation::Create => {
                if let Some(bytes) = &existing {
                    let _: AppConfig = serde_json::from_slice(bytes).map_err(|_| {
                        std::io::Error::new(std::io::ErrorKind::InvalidData,
                            "transaction configuration is invalid")
                    })?;
                } else {
                    let bytes = serde_json::to_vec(&AppConfig::default())?;
                    if Self::content_fingerprint(&bytes) != intent.target_sha256 {
                        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData,
                            "default schema changed; transaction requires explicit recovery").into());
                    }
                    Self::prepare_config_write(&target, &bytes)?
                        .persist_noclobber(&target).map_err(|error| error.error)?;
                    Self::sync_parent_directory(&target)?;
                }
                if current != intent.after { Self::save_account_info_in(directory, &intent.after)?; }
            }
            AccountOperation::Delete => {
                if intent.before.current_account == intent.account {
                    Self::read_config_from_file(&Self::get_config_path_in(directory, &Account::Default))?;
                }
                if current != intent.after { Self::save_account_info_in(directory, &intent.after)?; }
                if existing.is_some() { fs::remove_file(&target)?; }
                // Also sync when already absent: a previous unlink may have returned
                // before the directory entry was confirmed persistent.
                Self::sync_parent_directory(&target)?;
            }
        }
        // Confirm a previously completed metadata replacement as well, rather
        // than assuming that observing its bytes proves directory durability.
        Self::sync_parent_directory(&Self::account_index_path_in(directory))?;
        fs::remove_file(&path)?;
        Self::sync_parent_directory(&path)
    }

    // Startup never repairs corrupt or unreadable metadata by overwriting it.
    // Only a genuinely absent account index can initialize a new default account.
    fn load_startup_configuration(directory: &str) -> Result<(AccountInfo, AppConfig)> {
        let account_info = match Self::read_account_info_in(directory) {
            Ok(info) => info,
            Err(AppError::IO(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                // A lost index alongside existing custom accounts is not a fresh installation.
                for entry in fs::read_dir(directory)? {
                    let name = entry?.file_name();
                    let name = name.to_string_lossy();
                    if name.starts_with("sjtu_canvas_helper_config_") && name.ends_with(".json") {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidData, "account metadata is missing for existing accounts",
                        ).into());
                    }
                }
                let account = AccountInfo::default();
                let config_path = Self::get_config_path_in(directory, &Account::Default);
                match Self::read_config_from_file(&config_path) {
                    Ok(_) => {},
                    Err(AppError::IO(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                        let bytes = serde_json::to_vec(&AppConfig::default())?;
                        Self::prepare_config_write(&config_path, &bytes)?
                            .persist_noclobber(&config_path).map_err(|error| error.error)?;
                Self::sync_parent_directory(&config_path)?;
                    }
                    Err(error) => return Err(error),
                }
                let account_path = Self::account_index_path_in(directory);
                let bytes = serde_json::to_vec(&account)?;
                Self::prepare_config_write(&account_path, &bytes)?
                    .persist_noclobber(&account_path).map_err(|error| error.error)?;
                Self::sync_parent_directory(&account_path)?;
                account
            }
            Err(error) => return Err(error),
        };
        let config_path = Self::get_config_path_in(directory, &account_info.current_account);
        let config = match Self::read_config_from_file(&config_path) {
            Ok(config) => config,
            Err(AppError::IO(error))
                if error.kind() == std::io::ErrorKind::NotFound
                    && account_info == AccountInfo::default() =>
            {
                // Older versions legitimately created only a Default-only index at first launch.
                // This is indistinguishable from a lost Default-only configuration: initialize
                // empty defaults, never claim credential recovery or adopt any orphaned account.
                for entry in fs::read_dir(directory)? {
                    let name = entry?.file_name();
                    let name = name.to_string_lossy();
                    if name.starts_with("sjtu_canvas_helper_config_") && name.ends_with(".json") {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "default configuration is missing alongside existing custom accounts",
                        ).into());
                    }
                }
                let bytes = serde_json::to_vec(&AppConfig::default())?;
                Self::prepare_config_write(&config_path, &bytes)?
                    .persist_noclobber(&config_path).map_err(|error| error.error)?;
                Self::sync_parent_directory(&config_path)?;
                tracing::warn!("Missing Default-only configuration initialized with empty defaults; no credentials recovered");
                Self::read_config_from_file(&config_path)?
            }
            Err(error) => return Err(error),
        };
        Ok((account_info, config))
    }

    pub async fn create_account(&self, account: &Account) -> Result<()> {
        let mut owner = self.config_owner.lock().await;
        let store = self.store_ready()?;
        Self::ensure_no_pending_intent(store)?;
        let directory = store.root_str()?;
        owner.as_ref().ok_or(AppError::StaleConfigOwner)?;
        if *account == Account::Default { return Err(AppError::NotAllowedToCreateDefaultAccount); }
        Self::validate_account_name(account)?;
        let before = Self::read_account_info_in(directory)?;
        if before.current_account != *self.current_account.read().await {
            return Err(AppError::StaleConfigOwner);
        }
        if Self::account_exists_in(directory, account)? || before.all_accounts.contains(account) {
            return Err(AppError::AccountAlreadyExists);
        }
        let bytes = serde_json::to_vec(&AppConfig::default())?;
        let mut after = before.clone();
        after.all_accounts.push(account.clone());
        let intent = AccountIntent { version: 1, operation: AccountOperation::Create,
            account: account.clone(), before, after,
            target_sha256: Self::content_fingerprint(&bytes) };
        let previous_owner = owner.clone();
        if let Err(error) = Self::begin_account_transaction(directory, &intent) {
            if Self::transaction_may_have_started(directory, &error) {
                store.poison();
                *owner = None;
            }
            return Err(error);
        }
        *owner = None;
        if let Err(error) = Self::recover_account_transaction(directory) {
            store.poison();
            return Err(error);
        }
        *owner = previous_owner;
        Ok(())
    }

    #[cfg(test)]
    pub fn list_accounts() -> Result<Vec<Account>> {
        let account_info = App::read_account_info()?;
        Ok(account_info.all_accounts)
    }

    pub async fn delete_account(&self, account: &Account) -> Result<()> {
        let mut owner = self.config_owner.lock().await;
        let store = self.store_ready()?;
        Self::ensure_no_pending_intent(store)?;
        let directory = store.root_str()?;
        owner.as_ref().ok_or(AppError::StaleConfigOwner)?;
        if *account == Account::Default { return Err(AppError::NotAllowedToDeleteDefaultAccount); }
        Self::validate_account_name(account)?;
        let before = Self::read_account_info_in(directory)?;
        if before.current_account != *self.current_account.read().await {
            return Err(AppError::StaleConfigOwner);
        }
        if !before.all_accounts.contains(account) { return Err(AppError::AccountNotExists); }
        let target = Self::get_config_path_in(directory, account);
        let bytes = Self::read_regular_config_file(&target)?;
        let deleting_current = before.current_account == *account;
        let default_config = if deleting_current {
            Some(Self::read_config_from_file(&Self::get_config_path_in(directory, &Account::Default))?)
        } else { None };
        let mut after = before.clone();
        after.all_accounts.retain(|entry| entry != account);
        if deleting_current { after.current_account = Account::Default; }
        let intent = AccountIntent { version: 1, operation: AccountOperation::Delete,
            account: account.clone(), before, after,
            target_sha256: Self::content_fingerprint(&bytes) };
        Self::validate_intent(&intent)?;
        let previous_owner = owner.clone();
        let previous = self.config.read().await.clone();
        let previous_llm = if deleting_current {
            Some(self.client.llm_state_snapshot().await)
        } else { None };
        let mcp_was_running = if deleting_current { self.quiesce_mcp_locked().await? } else { false };
        let mcp_enabled = default_config.as_ref().is_some_and(|config| config.mcp_enabled);
        let result: Result<()> = async {
            if deleting_current { self.invalidate_cache()?; }
            *owner = None;
            if let Some(config) = &default_config {
                self.client.set_base_url(Self::get_base_url(&config.account_type)).await;
                if let Err(error) = Self::apply_llm_config(config, &self.client).await {
                    self.client.set_base_url(Self::get_base_url(&previous.account_type)).await;
                    self.client.restore_llm_snapshot(previous_llm.unwrap()).await;
                    *owner = previous_owner;
                    return Err(error);
                }
            }
            if let Err(error) = Self::begin_account_transaction(directory, &intent) {
                if Self::transaction_may_have_started(directory, &error) {
                    store.poison();
                } else {
                    if let Some(snapshot) = previous_llm {
                        self.client.set_base_url(Self::get_base_url(&previous.account_type)).await;
                        self.client.restore_llm_snapshot(snapshot).await;
                    }
                    *owner = previous_owner;
                }
                return Err(error);
            }
            // No ordinary error rollback after the intent can be persistent. A
            // restart will finish exactly this before -> after transition.
            if let Err(error) = Self::recover_account_transaction(directory) {
                store.poison();
                return Err(error);
            }
            if let Some(config) = default_config {
                self.client.set_debug_mode(config.debug_mode);
                *self.config.write().await = config;
                *self.current_account.write().await = Account::Default;
                *owner = Some(Uuid::new_v4().to_string());
            } else {
                *owner = previous_owner;
            }
            Ok(())
        }.await;
        if let Err(error) = result {
            return Err(self.restore_mcp_after_failure(mcp_was_running, &owner, error).await);
        }
        if deleting_current { self.start_mcp_after_commit(mcp_enabled).await?; }
        Ok(())
    }

    fn invalidate_cache(&self) -> Result<()> {
        self.cache.clear()?;
        Ok(())
    }

    pub async fn switch_account(&self, account: &Account) -> Result<()> {
        let mut owner = self.config_owner.lock().await;
        self.switch_account_locked(account, &mut owner).await
    }

    async fn switch_account_locked(
        &self,
        account: &Account,
        owner: &mut Option<String>,
    ) -> Result<()> {
        let store = self.store_ready()?;
        Self::ensure_no_pending_intent(store)?;
        let directory = store.root_str()?;
        Self::validate_account_name(account)?;
        let mut account_info = Self::read_account_info_in(directory)?;
        // An orphaned file after an interrupted deletion must not revive the account.
        if !account_info.all_accounts.contains(account) {
            return Err(AppError::AccountNotExists);
        }
        let config_path = Self::get_config_path_in(directory, account);
        let config = App::read_config_from_file(&config_path)?;
        crate::diagnostics::protect_config(&config);
        account_info.current_account = account.clone();
        let previous = self.config.read().await.clone();
        let previous_llm = self.client.llm_state_snapshot().await;
        let previous_owner = owner.clone();
        let mcp_was_running = self.quiesce_mcp_locked().await?;
        let mcp_enabled = config.mcp_enabled;
        let result: Result<()> = async {
            self.invalidate_cache()?;
            *owner = None;
            let base_url = Self::get_base_url(&config.account_type);
            self.client.set_base_url(base_url).await;
            if let Err(error) = Self::apply_llm_config(&config, &self.client).await {
                self.client.set_base_url(Self::get_base_url(&previous.account_type)).await;
                self.client.restore_llm_snapshot(previous_llm).await;
                *owner = previous_owner;
                return Err(error);
            }
            if let Err(error) = Self::save_account_info_in(directory, &account_info) {
                if matches!(error, AppError::PersistenceUncertain) {
                    store.poison();
                    return Err(error);
                }
                self.client.set_base_url(Self::get_base_url(&previous.account_type)).await;
                self.client.restore_llm_snapshot(previous_llm).await;
                *owner = previous_owner;
                return Err(error);
            }
            self.client.set_debug_mode(config.debug_mode);
            *self.config.write().await = config;
            *self.current_account.write().await = account.clone();
            *owner = Some(uuid::Uuid::new_v4().to_string());
            Ok(())
        }.await;
        if let Err(error) = result {
            return Err(self.restore_mcp_after_failure(mcp_was_running, owner, error).await);
        }
        self.start_mcp_after_commit(mcp_enabled).await
    }

    pub(super) fn get_base_url(tp: &AccountType) -> &'static str {
        if *tp == AccountType::JI {
            JI_BASE_URL
        } else {
            BASE_URL
        }
    }

    pub fn new() -> Self {
        let config_store = Self::config_dir()
            .and_then(|directory| ConfigStore::open(Path::new(&directory))).ok();
        let loaded = config_store.as_ref().ok_or(AppError::StaleConfigOwner)
            .and_then(|store| {
                let directory = store.root_str()?;
                if let Err(error) = Self::recover_account_transaction(directory) {
                    store.poison();
                    return Err(error);
                }
                Self::load_startup_configuration(directory)
            });
        if matches!(&loaded, Err(AppError::PersistenceUncertain)) {
            if let Some(store) = &config_store { store.poison(); }
        }
        let config_is_valid = loaded.is_ok();
        let (account_info, config) = loaded.unwrap_or_else(|_| {
            // Do not include parser context: configuration files may contain credentials.
            tracing::error!("Configuration unavailable; owner withheld until the store can be validated");
            (AccountInfo::default(), AppConfig::default())
        });
        crate::diagnostics::protect_config(&config);

        let canvas_base_url = Self::get_base_url(&config.account_type);
        let llm_config = crate::client::EffectiveLlmConfig::from_app_config(&config);
        let client = Client::new_with_llm_config(canvas_base_url, llm_config);
        client.set_debug_mode(config.debug_mode);

        Self {
            canvas_session: Default::default(),
            login_attempt: Default::default(),
            config_store,
            client: Arc::new(client),
            current_account: RwLock::new(account_info.current_account),
            config: RwLock::new(config),
            config_owner: tokio::sync::Mutex::new(
                config_is_valid.then(|| uuid::Uuid::new_v4().to_string()),
            ),
            handle: Default::default(),
            mcp_handle: Default::default(),
            cache: Default::default(),
        }
    }

    pub async fn init(&self) -> Result<()> {
        let snapshot = match self.get_config_snapshot().await {
            Ok(snapshot) => snapshot,
            Err(AppError::StaleConfigOwner) => return Ok(()),
            Err(error) => return Err(error),
        };
        let cookies = &snapshot.config.video_cookies;
        if !cookies.is_empty() {
            tracing::info!("Detected saved video cookies");
            if let Ok(Some(consumer_key)) = self.client.get_oauth_consumer_key_for_cookies(cookies).await {
                self.commit_video_consumer_key(&snapshot.owner, consumer_key).await?;
            }
        }
        Ok(())
    }

    async fn wait_proxy_ready(&self, proxy_port: u16) -> Result<bool> {
        let url = format!("http://localhost:{proxy_port}/ready");
        let client = reqwest::Client::builder().no_proxy().build()?;
        let timeout_cnt = 10;
        let mut cnt = 0;
        loop {
            if client.get(&url).send().await.is_ok_and(|response| response.status() == 200) {
                tracing::info!("Proxy ready check success");
                break Ok(true);
            }
            cnt += 1;
            if cnt >= timeout_cnt {
                tracing::info!("Proxy ready check timeout");
                break Ok(false);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    pub async fn prepare_proxy(&self) -> Result<bool> {
        // Serialize startup so live and recording requests cannot bind the same port twice.
        let mut proxy_handle = self.handle.write().await;
        if proxy_handle.as_ref().is_some_and(|handle| !handle.is_finished()) {
            return Ok(true);
        }
        let proxy_port = self.config.read().await.proxy_port;

        // Proxy Endpoint: /vod/*
        let legacy_video_proxy = warp::get()
            .and(warp::path("vod").and(warp::path::tail()))
            .and(query_raw().or(warp::any().map(|| "".to_string())).unify())
            .and(warp::header::headers_cloned())
            .and_then(|tail, query, headers| {
                proxy_video_request(
                    "https://live.sjtu.edu.cn/vod",
                    "https://courses.sjtu.edu.cn",
                    "https://courses.sjtu.edu.cn",
                    tail,
                    query,
                    headers,
                    None,
                )
            });
        let canvas_video_proxy = warp::get()
            .and(warp::path("canvas-vod").and(warp::path::tail()))
            .and(query_raw().or(warp::any().map(|| "".to_string())).unify())
            .and(warp::header::headers_cloned())
            .and_then(|tail, query, headers| {
                proxy_video_request(
                    "https://videos.sjtu.edu.cn/vod",
                    "https://v.sjtu.edu.cn/",
                    "https://v.sjtu.edu.cn",
                    tail,
                    query,
                    headers,
                    None,
                )
            });
        let legacy_canvas_video_proxy = warp::get()
            .and(warp::path("legacy-vod").and(warp::path::tail()))
            .and(query_raw().or(warp::any().map(|| "".to_string())).unify())
            .and(warp::header::headers_cloned())
            .and_then(|tail, query, headers| {
                proxy_video_request(
                    "https://videos.sjtu.edu.cn/vod",
                    "https://courses.sjtu.edu.cn/",
                    "https://courses.sjtu.edu.cn",
                    tail,
                    query,
                    headers,
                    None,
                )
            });
        let canvas_live_proxy = warp::get()
            .and(warp::path("canvas-live").and(warp::path::tail()))
            .and(query_raw().or(warp::any().map(|| "".to_string())).unify())
            .and(warp::header::headers_cloned())
            .and_then(|tail, query, headers| {
                proxy_video_request(
                    "https://live.sjtu.edu.cn",
                    "https://v.sjtu.edu.cn/",
                    "https://v.sjtu.edu.cn",
                    tail,
                    query,
                    headers,
                    None,
                )
            });
        let canvas_stream_proxy = warp::get()
            .and(warp::path("canvas-stream"))
            .and(warp::path::param::<String>())
            .and(warp::path::tail())
            .and(query_raw().or(warp::any().map(|| "".to_string())).unify())
            .and(warp::header::headers_cloned())
            .and_then(move |host: String, tail, query, headers| async move {
                if !canvas_stream_host(&host) {
                    return Ok::<_, Infallible>(Response::builder().status(StatusCode::BAD_REQUEST)
                        .header("Access-Control-Allow-Origin", "*").body("Unsupported live media host".into()).unwrap());
                }
                proxy_video_request(&format!("https://{host}"), "https://v.sjtu.edu.cn/",
                    "https://v.sjtu.edu.cn", tail, query, headers,
                    Some(format!("http://localhost:{proxy_port}"))).await
            });
        // Ready Check Endpoint: /ready
        let ready_check = warp::path!("ready").map(|| Response::builder().body(""));

        let routes = legacy_video_proxy
            .or(legacy_canvas_video_proxy)
            .or(canvas_video_proxy)
            .or(canvas_live_proxy)
            .or(canvas_stream_proxy)
            .or(ready_check);
        let (_, server) = warp::serve(routes).try_bind_ephemeral(([127, 0, 0, 1], proxy_port))
            .map_err(|_| AppError::VideoDownloadError(format!("播放代理端口 {proxy_port} 无法使用，请检查端口是否被占用")))?;
        *proxy_handle = Some(tokio::spawn(server));
        let ready = self.wait_proxy_ready(proxy_port).await;
        if !matches!(ready, Ok(true)) {
            if let Some(handle) = proxy_handle.take() { handle.abort(); }
        }
        ready
    }

    pub async fn stop_proxy(&self) {
        let mut handle = self.handle.write().await;
        if let Some(handle) = handle.as_ref() {
            tracing::info!("stop proxy");
            handle.abort();
        }
        *handle = None;
    }

    pub async fn start_mcp(&self) -> Result<bool> {
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        owner.as_ref().ok_or(AppError::StaleConfigOwner)?;
        self.start_mcp_locked().await
    }

    // Internal helpers require the configuration owner lock. The lifecycle
    // mutex serializes the complete check/bind/store and stop/join transition.
    async fn start_mcp_locked(&self) -> Result<bool> {
        let mut slot = self.mcp_handle.lock().await;
        self.start_mcp_slot(&mut slot).await
    }

    async fn start_mcp_slot(&self, slot: &mut Option<crate::mcp::McpRuntime>) -> Result<bool> {
        if slot.as_ref().is_some_and(crate::mcp::McpRuntime::is_running) {
            return Ok(true);
        }
        Self::stop_mcp_slot(slot).await?;
        let port = self.config.read().await.mcp_port;
        let runtime = crate::mcp::start_mcp_server(port).await?;
        *slot = Some(runtime);
        tracing::info!("MCP listener bound on port {port}");
        Ok(true)
    }

    async fn stop_mcp_slot(slot: &mut Option<crate::mcp::McpRuntime>) -> Result<()> {
        if let Some(runtime) = slot.as_mut() {
            runtime.stop().await?;
        }
        *slot = None;
        Ok(())
    }

    async fn quiesce_mcp_locked(&self) -> Result<bool> {
        let mut slot = self.mcp_handle.lock().await;
        let was_running = slot.as_ref().is_some_and(crate::mcp::McpRuntime::is_running);
        Self::stop_mcp_slot(&mut slot).await?;
        Ok(was_running)
    }

    pub async fn stop_mcp(&self) -> Result<()> {
        let _owner = self.config_owner.lock().await;
        self.quiesce_mcp_locked().await.map(|_| ())
    }

    async fn restore_mcp_after_failure(
        &self, was_running: bool, owner: &Option<String>, error: AppError,
    ) -> AppError {
        // Uncertain persistence and an invalid owner must remain fail-closed.
        if was_running && owner.is_some() && self.store_ready().is_ok() {
            if let Err(restore) = self.start_mcp_locked().await {
                return std::io::Error::other(format!(
                    "Configuration operation failed ({error}); previous MCP runtime could not be restored ({restore})"
                )).into();
            }
        }
        error
    }

    async fn start_mcp_after_commit(&self, enabled: bool) -> Result<()> {
        if enabled {
            self.start_mcp_locked().await.map_err(|error| std::io::Error::other(format!(
                "Configuration committed, but MCP could not start: {error}"
            )))?;
        }
        Ok(())
    }

    fn read_config_from_file(config_path: &str) -> Result<AppConfig> {
        let content = Self::read_regular_config_file(config_path)?;
        serde_json::from_slice(&content).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid configuration JSON").into()
        })
    }

    /// Owner tokens change across account switches and credential revisions,
    /// including A -> B -> A. Account display names are not cache identities.
    fn owner_cache_key(base: &str, owner: &str) -> String {
        format!("{base}:owner:{owner}")
    }

    fn get_config_path_in(config_dir: &str, account: &Account) -> String {
        let mut config_file_name = "sjtu_canvas_helper_config".to_owned();
        if let Account::Custom(name) = account {
            config_file_name += &format!("_{name}");
        }
        Path::new(config_dir).join(format!("{config_file_name}.json")).to_string_lossy().into_owned()
    }

    pub async fn get_config(&self) -> AppConfig {
        self.config.read().await.clone()
    }

    pub async fn get_config_snapshot(&self) -> Result<super::ConfigSnapshot> {
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        let token = owner
            .as_ref()
            .ok_or(AppError::StaleConfigOwner)?
            .clone();
        Ok(super::ConfigSnapshot {
            config: self.config.read().await.clone(),
            owner: token,
        })
    }

    pub(super) async fn ensure_config_owner(&self, expected_owner: &str) -> Result<()> {
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() == Some(expected_owner) {
            Ok(())
        } else {
            Err(AppError::StaleConfigOwner)
        }
    }

    pub async fn get_raw_config(&self) -> Result<String> {
        let store = self.store_ready()?;
        let account = self.current_account.read().await.clone();
        let config_path = Self::get_config_path_in(store.root_str()?, &account);
        let content = fs::read_to_string(config_path)?;
        Ok(content)
    }

    pub async fn list_courses(&self) -> Result<Vec<Course>> {
        let (expected_owner, cache_key, token, client) = {
            let owner = self.config_owner.lock().await;
            self.store_ready()?;
            let expected_owner = owner.as_ref().ok_or(AppError::StaleConfigOwner)?.clone();
            let cache_key = Self::owner_cache_key(COURSES_CACHE_KEY, &expected_owner);
            if let Some(cached) = self.cache.get(&cache_key)? {
                return Ok(cached);
            }
            let config = self.config.read().await.clone();
            // These Canvas read methods use only bearer-token requests. Give
            // their entire request tree an immutable origin and a fresh Jar;
            // never reuse the mutable App client after releasing owner.
            let client = Arc::new(self.client.canvas_read_snapshot(Self::get_base_url(&config.account_type)));
            (expected_owner, cache_key, config.token, client)
        };
        let response = client.list_courses(&token).await;
        // Keep comparison, cache publication and return in one critical section.
        // No network await holds the account-transition lock.
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() != Some(expected_owner.as_str()) {
            return Err(AppError::StaleConfigOwner);
        }
        let courses = response?;
        self.cache.set(&cache_key, courses.clone())?;
        Ok(courses)
    }

    pub async fn list_user_submissions(
        &self,
        course_id: i64,
        student_ids: &[i64],
    ) -> Result<Vec<UserSubmissions>> {
        let token = self.config.read().await.token.clone();
        let user_submissions = self
            .client
            .clone()
            .list_user_submissions(course_id, student_ids, &token)
            .await?;
        Ok(user_submissions)
    }

    pub async fn get_single_course_assignment_submission(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
    ) -> Result<Submission> {
        self.client
            .get_single_course_assignment_submission(
                course_id,
                assignment_id,
                student_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn list_course_assignment_submissions(
        &self,
        course_id: i64,
        assignment_id: i64,
    ) -> Result<Vec<Submission>> {
        self.client
            .list_course_assignment_submissions(
                course_id,
                assignment_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn list_external_module_items(&self, course_id: i64) -> Result<Vec<ModuleItem>> {
        let token = self.config.read().await.token.clone();
        let modules = self.client.list_modules(course_id, &token).await?;
        let mut ret = vec![];
        for module in modules {
            let items = self
                .client
                .list_module_items(course_id, module.id, &token)
                .await?;
            for item in items {
                if item.type_ == ModuleItemType::ExternalUrl {
                    ret.push(item);
                }
            }
        }
        Ok(ret)
    }

    pub async fn update_grade(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        grade: Option<&str>,
        comment: Option<&str>,
    ) -> Result<()> {
        self.client
            .update_grade(
                course_id,
                assignment_id,
                student_id,
                grade,
                comment,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn delete_submission_comment(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: &str,
        comment_id: i64,
    ) -> Result<()> {
        self.client
            .delete_submission_comment(
                course_id,
                assignment_id,
                student_id,
                comment_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn modify_assignment_ddl(
        &self,
        course_id: i64,
        assignment_id: i64,
        due_at: Option<&str>,
        lock_at: Option<&str>,
    ) -> Result<()> {
        self.client
            .modify_assignment_ddl(
                course_id,
                assignment_id,
                due_at,
                lock_at,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn modify_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        override_id: i64,
        due_at: Option<&str>,
        lock_at: Option<&str>,
    ) -> Result<()> {
        self.client
            .modify_assignment_ddl_override(
                course_id,
                assignment_id,
                override_id,
                due_at,
                lock_at,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn delete_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        override_id: i64,
    ) -> Result<()> {
        self.client
            .delete_assignment_ddl_override(
                course_id,
                assignment_id,
                override_id,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn add_assignment_ddl_override(
        &self,
        course_id: i64,
        assignment_id: i64,
        student_id: i64,
        title: &str,
        due_at: Option<&str>,
        lock_at: Option<&str>,
    ) -> Result<()> {
        self.client
            .add_assignment_ddl_override(
                course_id,
                assignment_id,
                student_id,
                title,
                due_at,
                lock_at,
                &self.config.read().await.token,
            )
            .await
    }

    pub async fn test_token(&self, token: &str) -> Result<User> {
        self.client.test_credential(token).await
    }

    pub async fn get_me(&self) -> Result<User> {
        self.client.get_me(&self.config.read().await.token).await
    }

    pub async fn list_discussion_topics(&self, course_id: i64) -> Result<Vec<DiscussionTopic>> {
        let token = self.config.read().await.token.clone();
        self.client.list_discussion_topics(course_id, &token).await
    }

    pub async fn get_full_discussion(
        &self,
        course_id: i64,
        topic_id: i64,
    ) -> Result<FullDiscussion> {
        let token = self.config.read().await.token.clone();
        self.client
            .get_full_discussion(course_id, topic_id, &token)
            .await
    }

    pub async fn list_course_files(&self, course_id: i64) -> Result<Vec<File>> {
        let token = self.config.read().await.token.clone();
        self.client.list_course_files(course_id, &token).await
    }

    pub async fn get_file_preview_session_url(&self, file_id: i64) -> Result<String> {
        let token = self.config.read().await.token.clone();
        self.client
            .get_file_preview_session_url(file_id, &token)
            .await
    }

    pub async fn list_course_images(&self, course_id: i64) -> Result<Vec<File>> {
        let token = self.config.read().await.token.clone();
        self.client.list_course_images(course_id, &token).await
    }

    pub async fn list_course_users(&self, course_id: i64) -> Result<Vec<User>> {
        self.client
            .list_course_users(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_course_students(&self, course_id: i64) -> Result<Vec<User>> {
        self.client
            .list_course_students(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn get_course_syllabus(&self, course_id: i64) -> Result<Course> {
        self.client
            .get_course_syllabus(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_course_assignments(&self, course_id: i64) -> Result<Vec<Assignment>> {
        self.client
            .list_course_assignments(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn get_my_single_submission(
        &self,
        course_id: i64,
        assignment_id: i64,
    ) -> Result<Submission> {
        self.client
            .get_my_single_submission(course_id, assignment_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_folder_files(&self, folder_id: i64) -> Result<Vec<File>> {
        self.client
            .list_folder_files(folder_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_course_folders(&self, course_id: i64) -> Result<Vec<Folder>> {
        self.client
            .list_course_folders(course_id, &self.config.read().await.token)
            .await
    }

    pub async fn list_my_folders(&self) -> Result<Vec<Folder>> {
        self.client
            .list_my_folders(&self.config.read().await.token)
            .await
    }

    pub async fn list_folder_folders(&self, folder_id: i64) -> Result<Vec<Folder>> {
        self.client
            .list_folder_folders(folder_id, &self.config.read().await.token)
            .await
    }

    pub async fn save_file_content(&self, content: &[u8], file_name: &str) -> Result<()> {
        let save_dir = self.config.read().await.save_path.clone();
        let path = Path::new(&save_dir).join(file_name);
        // create file if path not exists, else open it in append mode
        let mut file = match fs::metadata(&path) {
            Ok(_) => fs::OpenOptions::new().append(true).open(&path)?,
            Err(_) => fs::File::create(&path)?,
        };
        file.write_all(content)?;
        Ok(())
    }

    pub async fn download_file<F: Fn(ProgressPayload) + Send>(
        &self, file: &File, expected_owner: &str, progress_handler: F,
    ) -> Result<()> {
        let snapshot = self.get_config_snapshot().await?;
        if snapshot.owner != expected_owner { return Err(AppError::StaleConfigOwner); }
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        client.download_file(file, &snapshot.config.token, &snapshot.config.save_path, progress_handler).await?;
        Ok(())
    }

    pub async fn download_course_file<F: Fn(ProgressPayload) + Send>(
        &self, file: &File, course: &Course, folder_path: &str,
        expected_owner: &str, progress_handler: F,
    ) -> Result<()> {
        let snapshot = self.get_config_snapshot().await?;
        if snapshot.owner != expected_owner { return Err(AppError::StaleConfigOwner); }
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        let course_identifier = self.get_course_identifier(course);
        let target = checked_download_path(Path::new(&snapshot.config.save_path), Some(&course_identifier), folder_path, &file.display_name)?;
        let save_path = target.parent().ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput, "Download path has no parent"))?;
        fs::create_dir_all(save_path)?;
        client.download_file(file, &snapshot.config.token, save_path, progress_handler).await?;
        Ok(())
    }

    pub async fn download_my_file<F: Fn(ProgressPayload) + Send>(
        &self, file: &File, folder_path: &str, expected_owner: &str, progress_handler: F,
    ) -> Result<()> {
        let snapshot = self.get_config_snapshot().await?;
        if snapshot.owner != expected_owner { return Err(AppError::StaleConfigOwner); }
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        let target = checked_download_path(Path::new(&snapshot.config.save_path), Some(MY_CANVAS_FILES_FOLDER_NAME), folder_path, &file.display_name)?;
        let save_path = target.parent().ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput, "Download path has no parent"))?;
        fs::create_dir_all(save_path)?;
        client.download_file(file, &snapshot.config.token, save_path, progress_handler).await?;
        Ok(())
    }

    pub async fn download_course_file_as_pdf(
        &self,
        file: &File,
        course: &Course,
        folder_path: &str,
        expected_owner: &str,
    ) -> Result<()> {
        let snapshot = self.get_config_snapshot().await?;
        if snapshot.owner != expected_owner {
            return Err(AppError::StaleConfigOwner);
        }
        let save_root = snapshot.config.save_path.clone();
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        checked_download_path(Path::new(&save_root), Some(&self.get_course_identifier(course)), folder_path, &file.display_name)?;
        let converted = self.convert_office_file_to_pdf_with_client(file, &client, &snapshot.config.token).await;
        // Account admission and atomic output publication are one critical section.
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() != Some(snapshot.owner.as_str()) {
            return Err(AppError::StaleConfigOwner);
        }
        let (pdf_name, pdf_content) = converted?;
        let target = checked_download_path(Path::new(&save_root), Some(&self.get_course_identifier(course)), folder_path, &pdf_name)?;
        let directory = target.parent().ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput, "Download path has no parent"))?;
        fs::create_dir_all(directory)?;
        write_file_atomic(&target, &pdf_content)?;
        Ok(())
    }

    pub async fn download_my_file_as_pdf(&self, file: &File, folder_path: &str, expected_owner: &str) -> Result<()> {
        let snapshot = self.get_config_snapshot().await?;
        if snapshot.owner != expected_owner {
            return Err(AppError::StaleConfigOwner);
        }
        let save_root = snapshot.config.save_path.clone();
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        checked_download_path(Path::new(&save_root), Some(MY_CANVAS_FILES_FOLDER_NAME), folder_path, &file.display_name)?;
        let converted = self.convert_office_file_to_pdf_with_client(file, &client, &snapshot.config.token).await;
        // Account admission and atomic output publication are one critical section.
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() != Some(snapshot.owner.as_str()) {
            return Err(AppError::StaleConfigOwner);
        }
        let (pdf_name, pdf_content) = converted?;
        let target = checked_download_path(Path::new(&save_root), Some(MY_CANVAS_FILES_FOLDER_NAME), folder_path, &pdf_name)?;
        let directory = target.parent().ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput, "Download path has no parent"))?;
        fs::create_dir_all(directory)?;
        write_file_atomic(&target, &pdf_content)?;
        Ok(())
    }

    fn get_course_identifier(&self, course: &Course) -> String {
        self.client.get_course_identifier(course)
    }

    pub async fn sync_course_files(&self, course: &Course) -> Result<Vec<File>> {
        let guard = self.config.read().await;
        let save_dir = guard.save_path.clone();
        let token = guard.token.clone();
        self.client
            .sync_course_files(course, &save_dir, &token)
            .await
    }

    async fn open_download_for_owner(
        &self, name: &str, group: Option<&str>, folder_path: &str,
        expected_owner: &str, expected_save_path: &str,
    ) -> Result<()> {
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() != Some(expected_owner) {
            return Err(AppError::StaleConfigOwner);
        }
        let config = self.config.read().await;
        if config.save_path != expected_save_path {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Download destination changed; reopen the file from its original location",
            ).into());
        }
        let path = checked_download_path(Path::new(&config.save_path), group, folder_path, name)?;
        let program = if cfg!(target_os = "macos") { "open" }
            else if cfg!(target_os = "linux") { "xdg-open" }
            else if cfg!(target_os = "windows") { "explorer" }
            else { return Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported, "Opening downloads is unsupported on this platform",
            ).into()); };
        // Admission covers only spawning the captured path, not the viewer lifetime.
        let mut child = TokioCommand::new(program).arg(&path)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn()?;
        drop(config);
        drop(owner);
        // Preserve the existing opener exit-status semantics; reap without blocking Tokio.
        let _ = child.wait().await?;
        Ok(())
    }

    pub async fn open_file(
        &self, name: &str, expected_owner: &str, expected_save_path: &str,
    ) -> Result<()> {
        self.open_download_for_owner(name, None, "", expected_owner, expected_save_path).await
    }

    pub async fn open_course_file(
        &self, name: &str, course: &Course, folder_path: &str,
        expected_owner: &str, expected_save_path: &str,
    ) -> Result<()> {
        let course_identifier = self.get_course_identifier(course);
        self.open_download_for_owner(name, Some(&course_identifier), folder_path,
            expected_owner, expected_save_path).await
    }

    pub async fn open_my_file(
        &self, name: &str, folder_path: &str, expected_owner: &str, expected_save_path: &str,
    ) -> Result<()> {
        self.open_download_for_owner(name, Some(MY_CANVAS_FILES_FOLDER_NAME), folder_path,
            expected_owner, expected_save_path).await
    }

    pub fn open_local_path(&self, path: &str) -> Result<()> {
        let local = Path::new(path);
        if !local.is_absolute() {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "请选择本地文件或目录的绝对路径").into());
        }
        // Check existence before handing the path to the system file opener.
        std::fs::metadata(local)?;
        self.open_path(path)
    }

    fn open_path(&self, path: &str) -> Result<()> {
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg(path).output()?;

        #[cfg(target_os = "linux")]
        let _ = std::process::Command::new("xdg-open").arg(path).output()?;

        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("explorer").arg(path).output()?;

        Ok(())
    }

    pub async fn open_save_dir(&self) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        self.open_path(save_path)
    }

    pub async fn open_config_dir(&self) -> Result<()> {
        // Keep manual inspection available even when persistence is poisoned.
        if let Some(store) = &self.config_store {
            self.open_path(store.root_str()?)
        } else {
            self.open_path(&Self::config_dir()?)
        }
    }

    pub async fn delete_file(&self, file: &File) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = checked_download_path(Path::new(save_path), None, "", &file.display_name)?;
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn delete_course_file(
        &self,
        file: &File,
        course: &Course,
        folder_path: &str,
    ) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = checked_download_path(Path::new(save_path), Some(&self.get_course_identifier(course)), folder_path, &file.display_name)?;
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn delete_my_file(&self, file: &File, folder_path: &str) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = checked_download_path(Path::new(save_path), Some(MY_CANVAS_FILES_FOLDER_NAME), folder_path, &file.display_name)?;
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn delete_file_with_name(&self, name: &str) -> Result<()> {
        let save_path = &self.config.read().await.save_path;
        let path = checked_download_path(Path::new(save_path), None, "", name)?;
        fs::remove_file(path)?;
        Ok(())
    }

    pub async fn get_folder_by_id(&self, folder_id: i64) -> Result<Folder> {
        self.client
            .get_folder_by_id(folder_id, &self.config.read().await.token)
            .await
    }

    pub async fn get_colors(&self) -> Result<Colors> {
        self.client
            .get_colors(&self.config.read().await.token)
            .await
    }

    pub async fn list_calendar_events(
        &self,
        context_codes: &[String],
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<CalendarEvent>> {
        self.client
            .list_calendar_events(
                &self.config.read().await.token,
                context_codes,
                start_date,
                end_date,
            )
            .await
    }

    async fn apply_llm_config(config: &AppConfig, client: &Client) -> Result<()> {
        client
            .reconfigure_llm(crate::client::EffectiveLlmConfig::from_app_config(config))
            .await
    }

    pub async fn save_config(&self, config: AppConfig, expected_owner: &str) -> Result<String> {
        let mut owner = self.config_owner.lock().await;
        self.save_config_locked(config, expected_owner, &mut owner).await
    }

    // The caller owns the account-transition lock for the complete commit.
    pub(super) async fn save_config_locked(
        &self, config: AppConfig, expected_owner: &str, owner: &mut Option<String>,
    ) -> Result<String> {
        let store = self.store_ready()?;
        Self::ensure_no_pending_intent(store)?;
        let directory = store.root_str()?;
        if owner.as_deref() != Some(expected_owner) {
            return Err(AppError::StaleConfigOwner);
        }
        crate::model::VideoSummaryOptions { prompt: config.video_summary_prompt.clone(),
            context_tokens: config.video_summary_context_tokens,
            output_tokens: config.video_summary_output_tokens }.validate()?;
        let previous = self.config.read().await.clone();
        let rotates = previous.token != config.token
            || previous.account_type != config.account_type
            || previous.ja_auth_cookie != config.ja_auth_cookie
            || previous.video_cookies != config.video_cookies
            || previous.oauth_consumer_key != config.oauth_consumer_key
            || previous.jbox_login_info != config.jbox_login_info;
        let next_owner = if rotates {
            uuid::Uuid::new_v4().to_string()
        } else {
            expected_owner.to_owned()
        };
        crate::diagnostics::protect_config(&config);
        let account = self.current_account.read().await.clone();
        let account_info = Self::read_account_info_in(directory)?;
        if account_info.current_account != account || !account_info.all_accounts.contains(&account)
            || !Self::account_exists_in(directory, &account)?
        { return Err(AppError::StaleConfigOwner); }
        let config_path = Self::get_config_path_in(directory, &account);
        let bytes = serde_json::to_vec(&config)?;
        let staged = Self::prepare_config_write(&config_path, &bytes)?;
        let previous_llm = self.client.llm_state_snapshot().await;
        let mcp_was_running = self.quiesce_mcp_locked().await?;
        let should_start = config.mcp_enabled || (!previous.mcp_enabled && mcp_was_running);
        let result: Result<()> = async {
            self.invalidate_cache()?;
            *owner = None;
            self.client
                .set_base_url(Self::get_base_url(&config.account_type))
                .await;
            if let Err(error) = Self::apply_llm_config(&config, &self.client).await {
                self.client.set_base_url(Self::get_base_url(&previous.account_type)).await;
                self.client.restore_llm_snapshot(previous_llm).await;
                *owner = Some(expected_owner.to_owned());
                return Err(error);
            }
            if let Err(error) = Self::persist_prepared(staged, &config_path) {
                if matches!(error, AppError::PersistenceUncertain) {
                    store.poison();
                    return Err(error);
                }
                self.client.set_base_url(Self::get_base_url(&previous.account_type)).await;
                self.client.restore_llm_snapshot(previous_llm).await;
                *owner = Some(expected_owner.to_owned());
                return Err(error);
            }
            self.client.set_debug_mode(config.debug_mode);
            *self.config.write().await = config;
            *owner = Some(next_owner.clone());
            Ok(())
        }.await;
        if let Err(error) = result {
            return Err(self.restore_mcp_after_failure(mcp_was_running, owner, error).await);
        }
        self.start_mcp_after_commit(should_start).await?;
        Ok(next_owner)
    }

    /// Merge derived login information into the latest configuration, so a
    /// same-owner appearance/path change made during authentication is retained.
    pub(super) async fn commit_jbox_login(
        &self, expected_owner: &str, info: crate::model::JBoxLoginInfo,
    ) -> Result<super::ConfigSnapshot> {
        let mut owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() != Some(expected_owner) {
            return Err(AppError::StaleConfigOwner);
        }
        let mut config = self.config.read().await.clone();
        config.jbox_login_info = info;
        let next_owner = self.save_config_locked(config.clone(), expected_owner, &mut owner).await?;
        Ok(super::ConfigSnapshot { config, owner: next_owner })
    }

    pub async fn list_network_logs(&self) -> Vec<NetworkRequestLog> {
        self.client.list_network_logs().await
    }

    pub async fn clear_network_logs(&self) {
        self.client.clear_network_logs().await;
    }

    pub async fn chat<S: Into<String>>(&self, prompt: S) -> Result<String> {
        self.client.chat(prompt).await
    }

    pub(crate) async fn llm_snapshot(&self) -> Result<crate::client::LlmSnapshot> {
        self.client.llm_snapshot().await
    }

    pub async fn explain_file(&self, file: &File) -> Result<String> {
        self.client.explain_file(file).await
    }

    pub async fn chat_with_file(&self, file: &File, messages: &[LLMChatMessage]) -> Result<String> {
        self.client.chat_with_file(file, messages).await
    }

    pub async fn chat_with_file_stream(
        &self,
        file: &File,
        messages: &[LLMChatMessage],
        on_chunk: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.client.chat_with_file_stream(file, messages, on_chunk).await
    }

    pub async fn summarize_subtitle(&self, canvas_course_id: i64) -> Result<String> {
        self.client.summarize_subtitle(canvas_course_id).await
    }

    pub async fn chat_with_subtitle_stream(
        &self,
        canvas_course_id: i64,
        messages: &[LLMChatMessage],
        on_chunk: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.client
            .chat_with_subtitle_stream(canvas_course_id, messages, on_chunk)
            .await
    }

    pub fn check_path(path: &str) -> bool {
        let path = Path::new(path);
        if path.exists() {
            if let Ok(metadata) = fs::metadata(path) {
                return metadata.is_dir();
            }
        }
        false
    }

    pub async fn submit_assignment(
        &self,
        course_id: i64,
        assignment_id: i64,
        file_paths: &[String],
        comment: Option<&str>,
    ) -> Result<()> {
        let token = self.config.read().await.token.clone();
        self.client
            .submit_assignment(course_id, assignment_id, file_paths, comment, &token)
            .await?;
        Ok(())
    }

    pub async fn upload_submission_file(
        &self,
        course_id: i64,
        assignment_id: i64,
        file_path: &str,
        file_name: &str,
    ) -> Result<File> {
        let token = self.config.read().await.token.clone();
        let file = self
            .client
            .upload_submission_file(course_id, assignment_id, file_path, file_name, &token)
            .await?;
        Ok(file)
    }

    pub async fn collect_relationship(&self) -> Result<RelationshipTopo> {
        let (expected_owner, cache_key, token, client) = {
            let owner = self.config_owner.lock().await;
            self.store_ready()?;
            let expected_owner = owner.as_ref().ok_or(AppError::StaleConfigOwner)?.clone();
            let cache_key = Self::owner_cache_key(RELATIONSHIP_CACHE_KEY, &expected_owner);
            if let Some(cached) = self.cache.get(&cache_key)? {
                return Ok(cached);
            }
            let config = self.config.read().await.clone();
            // These Canvas read methods use only bearer-token requests. Give
            // their entire request tree an immutable origin and a fresh Jar;
            // never reuse the mutable App client after releasing owner.
            let client = Arc::new(self.client.canvas_read_snapshot(Self::get_base_url(&config.account_type)));
            (expected_owner, cache_key, config.token, client)
        };
        let response = client.collect_relationship(&token).await;
        // Keep comparison, cache publication and return in one critical section.
        // No network await holds the account-transition lock.
        let owner = self.config_owner.lock().await;
        self.store_ready()?;
        if owner.as_deref() != Some(expected_owner.as_str()) {
            return Err(AppError::StaleConfigOwner);
        }
        let topo = response?;
        self.cache.set(&cache_key, topo.clone())?;
        Ok(topo)
    }

    pub async fn export_excel(
        &self,
        data: &[Vec<String>],
        file_name: &str,
        folder_path: &str,
    ) -> Result<()> {
        let path = Path::new(folder_path).join(file_name);
        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        for (row, row_data) in data.iter().enumerate() {
            for (col, col_data) in row_data.iter().enumerate() {
                sheet.write_string(row as u32, col as u16, col_data)?;
            }
        }
        workbook.save(path)?;
        Ok(())
    }

    pub async fn export_users(&self, users: &[User], save_name: &str) -> Result<()> {
        let save_path = self.config.read().await.save_path.clone();
        let path = Path::new(&save_path).join(save_name);

        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();

        // setup headers
        sheet.write_string(0, 0, "id")?;
        sheet.write_string(0, 1, "name")?;
        sheet.write_string(0, 2, "email")?;
        sheet.write_string(0, 3, "created_at")?;
        sheet.write_string(0, 4, "sortable_name")?;
        sheet.write_string(0, 5, "short_name")?;
        sheet.write_string(0, 6, "login_id")?;

        for (row, user) in users.iter().enumerate() {
            let row = row as u32 + 1;
            sheet.write_string(row, 0, user.id.to_string())?;
            sheet.write_string(row, 1, &user.name)?;
            sheet.write_string(row, 2, user.email.clone().unwrap_or_default())?;
            sheet.write_string(row, 3, &user.created_at)?;
            sheet.write_string(row, 4, &user.sortable_name)?;
            sheet.write_string(row, 5, &user.short_name)?;
            sheet.write_string(row, 6, &user.login_id)?;
        }
        workbook.save(path)?;
        Ok(())
    }

    async fn try_convert_with_libreoffice(
        &self,
        input_path: &Path,
        pdf_path: &Path,
    ) -> std::result::Result<(), String> {
        // Keep an explicit waiter after cancellation; kill_on_drop alone
        // only offers best-effort orphan reaping. Runtime shutdown remains
        // outside this guarantee, as does termination of descendant processes.
        struct ConversionChild(Option<tokio::process::Child>);
        impl Drop for ConversionChild {
            fn drop(&mut self) {
                if let Some(mut child) = self.0.take() {
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        return;
                    }
                    let _ = child.start_kill();
                    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                        runtime.spawn(async move {
                            if child.wait().await.is_err() {
                                tracing::warn!("Failed to reap conversion child");
                            }
                        });
                    }
                    // Without an active runtime, the child's existing
                    // kill_on_drop policy is the remaining best effort.
                }
            }
        }

        // The console launcher waits for conversion on Windows. Do not fall
        // back to Word/PowerPoint automation or attach to the user's session.
        #[cfg(target_os = "windows")]
        let candidates = [
            "soffice.com",
            r"C:\Program Files\LibreOffice\program\soffice.com",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.com",
        ];
        #[cfg(target_os = "macos")]
        let candidates = ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "soffice"];
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let candidates = ["libreoffice", "soffice"];

        let output_dir = pdf_path.parent().ok_or_else(|| "无法确定 PDF 输出目录".to_owned())?;
        let stem = input_path.file_stem().ok_or_else(|| "无法确定源文件名".to_owned())?;
        let mut output_name = stem.to_os_string();
        output_name.push(".pdf");
        let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
        let mut errors = Vec::new();
        for candidate in candidates {
            // Private profiles prevent command forwarding into an existing UI
            // instance. Each attempt also has a fresh output directory so an
            // earlier failed conversion cannot supply a stale success result.
            let profile = tempfile::tempdir().map_err(|error| error.to_string())?;
            let profile_user = profile.path().join("user");
            fs::create_dir(&profile_user).map_err(|error| error.to_string())?;
            fs::write(profile_user.join("registrymodifications.xcu"), br#"<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>
  </item>
</oor:items>"#).map_err(|error| error.to_string())?;
            let profile_url = reqwest::Url::from_directory_path(profile.path())
                .map_err(|_| "无法创建隔离的 LibreOffice 配置地址".to_owned())?;
            let attempt_output = tempfile::tempdir_in(output_dir).map_err(|error| error.to_string())?;
            let generated_pdf = attempt_output.path().join(&output_name);
            let mut command = TokioCommand::new(candidate);
            command
                .arg(format!("-env:UserInstallation={profile_url}"))
                .args(["--headless", "--norestore", "--convert-to", "pdf", "--outdir"])
                .arg(attempt_output.path())
                .arg(input_path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            if tokio::time::Instant::now() >= deadline {
                return Err("LibreOffice 转换已超过 5 分钟预算".to_owned());
            }
            let child = match command.spawn() {
                Ok(child) => child,
                Err(error) => { errors.push(format!("{candidate}: {error}")); continue; }
            };
            let mut child_owner = ConversionChild(Some(child));
            let child = child_owner.0.as_mut().expect("conversion child is owned until drop");
            let status = match tokio::time::timeout_at(deadline, child.wait()).await {
                Ok(Ok(status)) => status,
                Ok(Err(error)) => {
                    let _ = child.start_kill();
                    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
                    errors.push(format!("{candidate}: {error}"));
                    continue;
                }
                Err(_) => {
                    let _ = child.start_kill();
                    let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
                    return Err("LibreOffice 转换超过 5 分钟，已请求停止转换进程".to_owned());
                }
            };
            let has_pdf_header = fs::File::open(&generated_pdf).and_then(|mut file| {
                let mut header = [0u8; 5];
                std::io::Read::read_exact(&mut file, &mut header)?;
                Ok(header == *b"%PDF-")
            }).unwrap_or(false);
            if status.success() && has_pdf_header {
                fs::rename(&generated_pdf, pdf_path).map_err(|error| error.to_string())?;
                return Ok(());
            }
            errors.push(format!("{candidate}: {status}，未生成具有 PDF 文件头的输出"));
        }
        Err(errors.join("; "))
    }

    async fn convert_docx_to_pdf_inner(&self, docx_path: &Path, pdf_path: &Path) -> Result<()> {
        self.try_convert_with_libreoffice(docx_path, pdf_path).await.map_err(|error|
            AppError::DocumentConversion(format!("自动转换 Word 文件需要可用的 LibreOffice：{error}")))
    }

    async fn convert_pptx_to_pdf_inner(&self, pptx_path: &Path, pdf_path: &Path) -> Result<()> {
        self.try_convert_with_libreoffice(pptx_path, pdf_path).await.map_err(|error|
            AppError::DocumentConversion(format!("自动转换 PowerPoint 文件需要可用的 LibreOffice：{error}")))
    }

    fn pdf_file_name(file_name: &str) -> Result<String> {
        let path = Path::new(file_name);
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or_else(|| AppError::DocumentConversion("无法识别源文件名".to_owned()))?;
        Ok(format!("{stem}.pdf"))
    }

    pub async fn convert_office_file_to_pdf(&self, file: &File) -> Result<(String, Vec<u8>)> {
        let snapshot = self.get_config_snapshot().await?;
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        let result = self.convert_office_file_to_pdf_with_client(file, &client, &snapshot.config.token).await;
        self.ensure_config_owner(&snapshot.owner).await?;
        result
    }

    pub(super) async fn convert_office_file_to_pdf_with_client(
        &self, file: &File, client: &Client, token: &str,
    ) -> Result<(String, Vec<u8>)> {
        let extension = Path::new(&file.display_name)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_lowercase)
            .ok_or_else(|| AppError::UnsupportedFileExtensionError("(missing)".to_owned()))?;
        if !matches!(extension.as_str(), "doc" | "docx" | "ppt" | "pptx") {
            return Err(AppError::UnsupportedFileExtensionError(extension));
        }

        // RAII also attempts cleanup when the conversion future is cancelled.
        let temp_dir = tempfile::Builder::new().prefix("sjtu-canvas-helper-").tempdir()?;
        let input_path = temp_dir.path().join(format!("source.{extension}"));
        let pdf_path = temp_dir.path().join("source.pdf");
        let pdf_name = Self::pdf_file_name(&file.display_name)?;
        let mut temp_file = file.clone();
        temp_file.display_name = format!("source.{extension}");

        let result = async {
            client
                .download_file(&temp_file, token, temp_dir.path(), |_| {})
                .await?;
            if matches!(extension.as_str(), "doc" | "docx") {
                self.convert_docx_to_pdf_inner(&input_path, &pdf_path).await?;
            } else {
                self.convert_pptx_to_pdf_inner(&input_path, &pdf_path).await?;
            }
            Ok((pdf_name, fs::read(&pdf_path)?))
        }
        .await;

        if temp_dir.close().is_err() {
            tracing::warn!("Failed to remove conversion temp directory");
        }
        result
    }

    pub async fn convert_pptx_to_pdf(&self, file: &mut File) -> Result<Vec<u8>> {
        let (_, content) = self.convert_office_file_to_pdf(file).await?;
        Ok(content)
    }

    pub async fn convert_docx_to_pdf(&self, file: &mut File) -> Result<Vec<u8>> {
        let (_, content) = self.convert_office_file_to_pdf(file).await?;
        Ok(content)
    }

    pub fn is_ffmpeg_installed() -> bool {
        let output = Command::new("ffmpeg").arg("-version").output();
        match output {
            Ok(output) => {
                let success = output.status.success();
                tracing::info!(
                    operation = "ffmpeg_probe",
                    success,
                    exit_code = ?output.status.code(),
                    "FFmpeg availability check completed"
                );
                success
            }
            Err(error) => {
                tracing::warn!(
                    operation = "ffmpeg_probe",
                    success = false,
                    error_kind = ?error.kind(),
                    raw_os_error = ?error.raw_os_error(),
                    "FFmpeg availability check failed"
                );
                false
            }
        }
    }

    // return execute command, whether succeeded and exit code
    pub async fn run_video_aggregate<R: Runtime>(
        window: Window<R>,
        params: &VideoAggregateParams,
    ) -> Result<i32> {
        let scale_percentage = params.sub_video_size_percentage as f64 / 100.0;
        let scale_width = format!("iw*{scale_percentage}");
        let scale_height = format!("ih*{scale_percentage}");

        let alpha_value = params.sub_video_alpha as f64 / 100.0;
        let output_path = format!("{}/{}", params.output_dir, params.output_name);

        let mut command = TokioCommand::new("ffmpeg")
            .args([
                "-i",
                &params.main_video_path,
                "-i",
                &params.sub_video_path,
                "-filter_complex",
                &format!(
                    "[1:v]scale={scale_width}:{scale_height}[overlay];[0:v][overlay]overlay=W-w:H-h:format=auto:alpha={alpha_value}"
                ),
                "-c:a",
                "copy",
                &output_path,
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        // catch stdout
        let mut stdout = command.stdout.take().ok_or(AppError::OpenStdoutError)?;
        let mut stderr = command.stderr.take().ok_or(AppError::OpenStderrError)?;

        let command_str = format!(
            "ffmpeg -i \"{}\" -i \"{}\" -filter_complex \"[1:v]scale={}:{}[overlay];[0:v][overlay]overlay=W-w:H-h:format=auto:alpha={}\" -c:a copy \"{}\"",
            params.main_video_path,
            params.sub_video_path,
            scale_width,
            scale_height,
            alpha_value,
            output_path
        );
        let _ = window.emit("ffmpeg://output", command_str + "\n");
        let window_cloned = window.clone();

        tokio::spawn(async move {
            let mut buffer = [0; 128];
            while let Ok(bytes_read) = stdout.read(&mut buffer).await {
                if bytes_read == 0 {
                    break; // EOF
                }
                let output = String::from_utf8_lossy(&buffer[..bytes_read]);
                let _ = window.emit("ffmpeg://output", output.to_string());
            }
        });

        tokio::spawn(async move {
            let mut buffer = [0; 128];
            while let Ok(bytes_read) = stderr.read(&mut buffer).await {
                if bytes_read == 0 {
                    break; // EOF
                }
                let output = String::from_utf8_lossy(&buffer[..bytes_read]);
                let _ = window_cloned.emit("ffmpeg://output", output.to_string());
            }
        });

        let status = command.wait().await?;
        Ok(status.code().unwrap_or_default())
    }

    pub fn read_log_content() -> Result<String> {
        Ok(crate::diagnostics::read_log()?)
    }
}

#[cfg(test)]
mod live_proxy_tests {
    use super::*;

    #[test]
    fn live_playlist_rewrites_segments_variants_keys_and_maps() {
        let playlist = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin?key=signed\"\n#EXT-X-MAP:URI=\"/live/init.mp4\"\n../camera/index.m3u8?auth_key=abc\nhttps://mss3.sjtu.edu.cn/live/segment.ts\nsegment.ts?signature=xyz\n";
        let rewritten = rewrite_live_playlist(playlist, "https://mss2.sjtu.edu.cn/live/a/index.m3u8?auth_key=abc", "http://localhost:3030");
        assert!(rewritten.contains("URI=\"http://localhost:3030/canvas-stream/mss2.sjtu.edu.cn/live/a/key.bin?key=signed\""));
        assert!(rewritten.contains("URI=\"http://localhost:3030/canvas-stream/mss2.sjtu.edu.cn/live/init.mp4\""));
        assert!(rewritten.contains("http://localhost:3030/canvas-stream/mss2.sjtu.edu.cn/live/camera/index.m3u8?auth_key=abc"));
        assert!(rewritten.contains("http://localhost:3030/canvas-stream/mss3.sjtu.edu.cn/live/segment.ts"));
        assert!(rewritten.contains("http://localhost:3030/canvas-stream/mss2.sjtu.edu.cn/live/a/segment.ts?signature=xyz"));
    }

    #[test]
    fn live_proxy_only_accepts_known_sjtu_media_hosts() {
        assert!(canvas_stream_host("mss2.sjtu.edu.cn"));
        assert!(canvas_stream_host("live.sjtu.edu.cn"));
        for host in ["localhost", "127.0.0.1", "mss2.sjtu.edu.cn.evil.test", "mss.sjtu.edu.cn", "example.test"] {
            assert!(!canvas_stream_host(host));
        }
        let unchanged = rewrite_live_playlist("#EXTM3U\nhttps://example.test/private.ts\n", "https://mss2.sjtu.edu.cn/live/a.m3u8", "http://localhost:3030");
        assert!(unchanged.contains("https://example.test/private.ts"));
    }

    #[tokio::test]
    async fn live_and_recording_share_one_ready_proxy() {
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        let config_directory = tempfile::tempdir().unwrap();
        let store = ConfigStore::open(config_directory.path()).unwrap();
        let directory = store.root_str().unwrap();
        App::recover_account_transaction(directory).unwrap();
        let (account_info, config) = App::load_startup_configuration(directory).unwrap();
        let app = App {
            canvas_session: Default::default(),
            login_attempt: Default::default(),
            config_store: Some(store),
            client: Arc::new(Client::new_without_proxy("http://127.0.0.1", "", "", "", None)),
            current_account: RwLock::new(account_info.current_account),
            config: RwLock::new(config),
            config_owner: tokio::sync::Mutex::new(Some(uuid::Uuid::new_v4().to_string())),
            handle: Default::default(), mcp_handle: Default::default(), cache: Default::default(),
        };
        assert!(app.store_ready().is_ok());
        assert!(app.get_config_snapshot().await.is_ok());
        app.config.write().await.proxy_port = port;
        let (live, recording) = tokio::join!(app.prepare_proxy(), app.prepare_proxy());
        let denied = reqwest::Client::builder().no_proxy().build().unwrap()
            .get(format!("http://localhost:{port}/canvas-stream/localhost/private"))
            .send().await.unwrap();
        app.stop_proxy().await;
        assert!(live.unwrap()); assert!(recording.unwrap());
        assert_eq!(denied.status(), StatusCode::BAD_REQUEST);
        drop(app);
        drop(config_directory);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_keys_are_scoped_to_the_owning_generation() {
        let first_a = App::owner_cache_key(COURSES_CACHE_KEY, "owner-a-first");
        let b = App::owner_cache_key(COURSES_CACHE_KEY, "owner-b");
        let returned_a = App::owner_cache_key(COURSES_CACHE_KEY, "owner-a-returned");
        let relationship = App::owner_cache_key(RELATIONSHIP_CACHE_KEY, "owner-a-first");
        assert_ne!(first_a, b);
        assert_ne!(first_a, returned_a);
        assert_ne!(first_a, relationship);
        assert_ne!(b, relationship);
        assert_eq!(first_a, App::owner_cache_key(COURSES_CACHE_KEY, "owner-a-first"));
        assert_eq!(b, App::owner_cache_key(COURSES_CACHE_KEY, "owner-b"));
        // Account names never enter these keys: Default and Custom("default")
        // have different owner generations, as do credential revisions.
        assert_ne!(App::owner_cache_key(COURSES_CACHE_KEY, "default-generation"),
                   App::owner_cache_key(COURSES_CACHE_KEY, "custom-default-generation"));
    }
}
