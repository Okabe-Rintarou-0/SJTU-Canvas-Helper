//! Versioned, account-scoped application data. All disk operations (including moving
//! the store) share one lock; callers never pass filesystem paths for record keys.
use super::App;
use crate::utils::download::display_path;
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

static STORAGE_LOCK: Mutex<()> = Mutex::new(());
const FORMAT: u32 = 1;
const MARKER: &str = "store.json";
const MAX_RECORD_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Cache,
    History,
    State,
}
impl Category {
    fn name(self) -> &'static str {
        match self {
            Self::Cache => "cache",
            Self::History => "history",
            Self::State => "state",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum DataRequest {
    Get {
        category: Category,
        collection: String,
        key: String,
    },
    List {
        category: Category,
        collection: String,
    },
    Put {
        category: Category,
        collection: String,
        key: String,
        version: u32,
        value: Value,
        #[serde(default)]
        if_absent: bool,
    },
    Delete {
        category: Category,
        collection: String,
        key: String,
    },
    Clear {
        category: Category,
        collection: Option<String>,
    },
    Overview,
    Relocate {
        directory: String,
    },
    Backup {
        directory: String,
    },
    Open,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    format: u32,
    key: String,
    version: u32,
    updated_at: String,
    value: Value,
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}
fn hash(value: &str) -> String {
    format!("{:x}", Md5::digest(value.as_bytes()))
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> io::Result<T> {
    serde_json::from_slice(&fs::read(path)?)
        .map_err(|_| invalid("应用数据文件损坏，请先备份并检查文件"))
}

// A sibling temporary file and rename avoid truncating the last complete record.
fn atomic_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let bytes = serde_json::to_vec(value).map_err(|_| invalid("应用数据无法序列化"))?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn plain(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    let linked = metadata.file_type().is_symlink();
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        linked || metadata.file_attributes() & 0x400 != 0 // junctions too
    };
    if linked {
        return Err(invalid("应用数据目录中不支持符号链接或目录联接"));
    }
    Ok(())
}

fn directory(path: &Path) -> io::Result<()> {
    if !path.exists() {
        fs::create_dir(path)?;
    }
    plain(path)?;
    if !path.is_dir() {
        return Err(invalid("应用数据目录不是文件夹"));
    }
    Ok(())
}

struct Store {
    config: PathBuf,
    root: PathBuf,
}
impl Store {
    fn load(config: PathBuf) -> io::Result<Self> {
        let pointer = config.join("data-storage.json");
        let root = if pointer.exists() {
            let value: Value = read_json(&pointer)?;
            if value["format"] != FORMAT {
                return Err(invalid("应用数据目录配置版本不受支持"));
            }
            PathBuf::from(
                value["directory"]
                    .as_str()
                    .ok_or_else(|| invalid("应用数据目录配置无效"))?,
            )
        } else {
            config.join("app-data")
        };
        if !root.is_absolute() {
            return Err(invalid("应用数据目录必须是绝对路径"));
        }
        // A missing custom directory must not silently turn into a fresh store.
        if pointer.exists() && !root.join(MARKER).exists() {
            return Err(invalid(
                "应用数据目录不可用，请恢复原目录或重新连接所在磁盘",
            ));
        }
        directory(&root)?;
        let marker = root.join(MARKER);
        if !marker.exists() {
            if fs::read_dir(&root)?.next().is_some() {
                return Err(invalid("应用数据目录包含未知文件"));
            }
            atomic_json(&marker, &json!({ "format": FORMAT }))?;
        }
        plain(&marker)?;
        let manifest: Value = read_json(&marker)?;
        if manifest["format"] != FORMAT {
            return Err(invalid("应用数据版本不受支持，请使用兼容版本打开"));
        }
        Ok(Self {
            config,
            root: fs::canonicalize(root)?,
        })
    }

    fn category_directory(&self, account: &str, category: Category) -> io::Result<PathBuf> {
        let mut path = self.root.clone();
        for part in ["accounts", &hash(account), category.name()] {
            path.push(part);
            directory(&path)?;
        }
        Ok(path)
    }

    fn collection(
        &self,
        account: &str,
        category: Category,
        collection: &str,
    ) -> io::Result<PathBuf> {
        if collection.is_empty()
            || collection.len() > 80
            || !collection
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_')
        {
            return Err(invalid("应用数据集合名称无效"));
        }
        let path = self.category_directory(account, category)?.join(collection);
        directory(&path)?;
        Ok(path)
    }

    fn record_path(
        &self,
        account: &str,
        category: Category,
        collection: &str,
        key: &str,
    ) -> io::Result<PathBuf> {
        if key.is_empty() || key.len() > 65536 {
            return Err(invalid("应用数据键无效"));
        }
        let path = self
            .collection(account, category, collection)?
            .join(format!("{}.json", hash(key)));
        if path.exists() {
            plain(&path)?;
        }
        Ok(path)
    }

    fn get(path: &Path) -> io::Result<Option<Record>> {
        if !path.exists() {
            return Ok(None);
        }
        plain(path)?;
        let record: Record = read_json(path)?;
        if record.format != FORMAT || record.version == 0 {
            return Err(invalid("应用数据记录版本不受支持"));
        }
        Ok(Some(record))
    }

    fn overview(&self, account: &str) -> io::Result<Value> {
        let mut categories = Vec::new();
        for category in [Category::Cache, Category::History, Category::State] {
            let path = self
                .root
                .join("accounts")
                .join(hash(account))
                .join(category.name());
            let (bytes, files) = usage(&path)?;
            categories.push(json!({ "category": category, "bytes": bytes, "files": files }));
        }
        let (total_bytes, _) = usage(&self.root)?;
        Ok(
            json!({ "directory": display_path(&self.root), "totalBytes": total_bytes, "categories": categories }),
        )
    }

    fn copy_to(&self, directory: &str) -> io::Result<PathBuf> {
        let destination = PathBuf::from(directory);
        if !destination.is_absolute() || !destination.is_dir() {
            return Err(invalid("请选择现有的空文件夹"));
        }
        plain(&destination)?;
        let destination = fs::canonicalize(destination)?;
        if destination.starts_with(&self.root) || self.root.starts_with(&destination) {
            return Err(invalid("目标目录不能与当前应用数据目录相同或互相包含"));
        }
        if fs::read_dir(&destination)?.next().is_some() {
            return Err(invalid("请选择空文件夹，避免覆盖已有文件"));
        }
        // Verify every copied file before switching the directory pointer. On failure
        // the source and pointer remain intact; partial copies can be inspected.
        copy_tree(&self.root, &destination)?;
        Ok(destination)
    }

    fn execute(&mut self, account: &str, request: DataRequest) -> io::Result<Value> {
        match request {
            DataRequest::Get {
                category,
                collection,
                key,
            } => {
                let record = Self::get(&self.record_path(account, category, &collection, &key)?)?;
                if record.as_ref().is_some_and(|r| r.key != key) {
                    return Err(invalid("应用数据键冲突"));
                }
                Ok(json!(record))
            }
            DataRequest::List {
                category,
                collection,
            } => {
                let mut records = Vec::new();
                for entry in fs::read_dir(self.collection(account, category, &collection)?)? {
                    let path = entry?.path();
                    if path.extension().is_some_and(|e| e == "json") {
                        if let Some(record) = Self::get(&path)? {
                            records.push(record);
                        }
                    }
                }
                records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
                Ok(json!(records))
            }
            DataRequest::Put {
                category,
                collection,
                key,
                version,
                value,
                if_absent,
            } => {
                if version == 0
                    || serde_json::to_vec(&value)
                        .map_err(|_| invalid("数据无法序列化"))?
                        .len()
                        > MAX_RECORD_BYTES
                {
                    return Err(invalid("记录版本无效或单条数据超过 32 MiB"));
                }
                let path = self.record_path(account, category, &collection, &key)?;
                if let Some(record) = Self::get(&path)? {
                    if record.key != key {
                        return Err(invalid("应用数据键冲突"));
                    }
                    if if_absent {
                        return Ok(json!(record));
                    }
                    if record.version > version {
                        return Err(invalid("禁止用旧版数据覆盖新版记录"));
                    }
                }
                let record = Record {
                    format: FORMAT,
                    key,
                    version,
                    value,
                    updated_at: chrono::Utc::now().to_rfc3339(),
                };
                atomic_json(&path, &record)?;
                Ok(json!(record))
            }
            DataRequest::Delete {
                category,
                collection,
                key,
            } => {
                let path = self.record_path(account, category, &collection, &key)?;
                if let Some(record) = Self::get(&path)? {
                    if record.key != key {
                        return Err(invalid("应用数据键冲突"));
                    }
                    fs::remove_file(path)?;
                }
                Ok(Value::Null)
            }
            DataRequest::Clear {
                category,
                collection,
            } => {
                let path = if let Some(collection) = collection {
                    self.collection(account, category, &collection)?
                } else {
                    // Validate each parent before walking/deleting a managed subtree.
                    self.category_directory(account, category)?
                };
                usage(&path)?; // rejects links before recursive removal
                fs::remove_dir_all(path)?;
                Ok(Value::Null)
            }
            DataRequest::Overview => self.overview(account),
            DataRequest::Backup { directory } => {
                Ok(json!({ "directory": display_path(&self.copy_to(&directory)?) }))
            }
            DataRequest::Relocate { directory } => {
                let destination = self.copy_to(&directory)?;
                let overview = Self {
                    config: self.config.clone(),
                    root: destination.clone(),
                }
                .overview(account)?;
                atomic_json(
                    &self.config.join("data-storage.json"),
                    &json!({ "format": FORMAT, "directory": destination.to_string_lossy() }),
                )?;
                let previous = self.root.clone();
                self.root = destination;
                Ok(json!({ "overview": overview, "previousDirectory": display_path(&previous) }))
            }
            DataRequest::Open => unreachable!("handled by App"),
        }
    }
}

fn usage(path: &Path) -> io::Result<(u64, u64)> {
    if !path.exists() {
        return Ok((0, 0));
    }
    plain(path)?;
    if path.is_file() {
        return Ok((fs::metadata(path)?.len(), 1));
    }
    let (mut bytes, mut files) = (0, 0);
    for entry in fs::read_dir(path)? {
        let (next_bytes, next_files) = usage(&entry?.path())?;
        bytes += next_bytes;
        files += next_files;
    }
    Ok((bytes, files))
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    plain(source)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        plain(&path)?;
        let target = destination.join(entry.file_name());
        if path.is_dir() {
            fs::create_dir(&target)?;
            copy_tree(&path, &target)?;
        } else {
            let bytes = fs::read(path)?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)?;
            output.write_all(&bytes)?;
            output.sync_all()?;
            if fs::read(target)? != bytes {
                return Err(invalid("应用数据复制校验失败，原目录仍然保留"));
            }
        }
    }
    Ok(())
}

pub(super) fn execute_request(
    config: PathBuf,
    account: &str,
    request: DataRequest,
) -> io::Result<Value> {
    let _lock = STORAGE_LOCK
        .lock()
        .map_err(|_| invalid("应用数据存储锁不可用"))?;
    Store::load(config)?.execute(account, request)
}

pub(super) fn storage_directory(config: PathBuf) -> io::Result<PathBuf> {
    let _lock = STORAGE_LOCK
        .lock()
        .map_err(|_| invalid("应用数据存储锁不可用"))?;
    Ok(Store::load(config)?.root)
}

impl App {
    pub async fn application_data(
        &self,
        expected_account: String,
        request: DataRequest,
    ) -> Result<Value, String> {
        // Hold the account read lock until IO completes. A queued write from the old
        // frontend cannot land in a newly selected account.
        let account = self.current_account.read().await;
        let current = serde_json::to_value(&*account).map_err(|e| e.to_string())?;
        if current.as_str() != Some(&expected_account) {
            return Err("账号已切换，请重新打开当前页面".into());
        }
        let config = PathBuf::from(Self::config_dir().map_err(|e| e.to_string())?);
        if matches!(request, DataRequest::Open) {
            let _lock = STORAGE_LOCK.lock().map_err(|_| "应用数据存储锁不可用")?;
            let store = Store::load(config).map_err(|e| e.to_string())?;
            self.open_local_path(&display_path(&store.root))
                .map_err(|e| e.to_string())?;
            return Ok(Value::Null);
        }
        let result = tokio::task::spawn_blocking(move || {
            execute_request(config, &expected_account, request).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("canvas-data-测试-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn store(&self) -> Store {
            Store::load(self.0.clone()).unwrap()
        }
        fn folder(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir(&path).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn put(store: &mut Store, account: &str, category: Category, key: &str, value: Value) -> Value {
        store
            .execute(
                account,
                DataRequest::Put {
                    category,
                    collection: "test-records".into(),
                    key: key.into(),
                    version: 1,
                    value,
                    if_absent: false,
                },
            )
            .unwrap()
    }
    fn get(store: &mut Store, account: &str, category: Category, key: &str) -> Value {
        store
            .execute(
                account,
                DataRequest::Get {
                    category,
                    collection: "test-records".into(),
                    key: key.into(),
                },
            )
            .unwrap()
    }

    #[test]
    fn records_survive_reopening_and_cache_clear_preserves_histories_and_state() {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        put(
            &mut store,
            "Default",
            Category::History,
            "总结",
            json!({ "text": "中文上下文", "messages": ["追问"] }),
        );
        put(
            &mut store,
            "Default",
            Category::State,
            "播放",
            json!({ "seconds": 123.5 }),
        );
        put(
            &mut store,
            "Default",
            Category::Cache,
            "字幕",
            json!("缓存"),
        );
        put(
            &mut store,
            "Study",
            Category::Cache,
            "字幕",
            json!("其他账号"),
        );
        drop(store);
        let mut store = fixture.store();
        assert_eq!(
            get(&mut store, "Default", Category::State, "播放")["value"]["seconds"],
            123.5
        );
        store
            .execute(
                "Default",
                DataRequest::Clear {
                    category: Category::Cache,
                    collection: None,
                },
            )
            .unwrap();
        assert!(get(&mut store, "Default", Category::Cache, "字幕").is_null());
        assert_eq!(
            get(&mut store, "Study", Category::Cache, "字幕")["value"],
            "其他账号"
        );
        assert_eq!(
            get(&mut store, "Default", Category::History, "总结")["value"]["text"],
            "中文上下文"
        );
        assert_eq!(
            get(&mut store, "Default", Category::State, "播放")["value"]["seconds"],
            123.5
        );
    }

    #[test]
    fn replaces_records_atomically_and_preserves_newer_data_during_import() {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        put(
            &mut store,
            "Default",
            Category::History,
            "key",
            json!("first"),
        );
        put(
            &mut store,
            "Default",
            Category::History,
            "key",
            json!("updated"),
        );
        let imported = store
            .execute(
                "Default",
                DataRequest::Put {
                    category: Category::History,
                    collection: "test-records".into(),
                    key: "key".into(),
                    version: 1,
                    value: json!("old legacy"),
                    if_absent: true,
                },
            )
            .unwrap();
        assert_eq!(imported["value"], "updated");
        assert_eq!(
            get(&mut fixture.store(), "Default", Category::History, "key")["value"],
            "updated"
        );
        let path = store
            .record_path("Default", Category::History, "test-records", "key")
            .unwrap();
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn migration_and_backup_copy_all_accounts_and_reopen_at_new_location() {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        put(
            &mut store,
            "Default",
            Category::History,
            "summary",
            json!("总结"),
        );
        put(&mut store, "Study", Category::State, "position", json!(42));
        let old = store.root.clone();
        let target = fixture.folder("迁移目录");
        store
            .execute(
                "Default",
                DataRequest::Relocate {
                    directory: target.to_string_lossy().into(),
                },
            )
            .unwrap();
        let mut reopened = fixture.store();
        assert_eq!(reopened.root, fs::canonicalize(&target).unwrap());
        assert_eq!(
            get(&mut reopened, "Study", Category::State, "position")["value"],
            42
        );
        assert!(old.join(MARKER).exists());
        put(
            &mut reopened,
            "Default",
            Category::History,
            "summary",
            json!("迁移后更新"),
        );
        let backup = fixture.folder("备份目录");
        reopened
            .execute(
                "Default",
                DataRequest::Backup {
                    directory: backup.to_string_lossy().into(),
                },
            )
            .unwrap();
        let relative = reopened
            .record_path("Default", Category::History, "test-records", "summary")
            .unwrap()
            .strip_prefix(&reopened.root)
            .unwrap()
            .to_owned();
        assert_eq!(
            fs::read(backup.join(&relative)).unwrap(),
            fs::read(target.join(relative)).unwrap()
        );
        assert_eq!(fixture.store().root, reopened.root);
    }

    #[test]
    fn failed_migration_never_switches_the_pointer_or_overwrites_destination() {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        let original = store.root.clone();
        let target = fixture.folder("nonempty");
        fs::write(target.join("user.txt"), "keep").unwrap();
        assert!(store
            .execute(
                "Default",
                DataRequest::Relocate {
                    directory: target.to_string_lossy().into()
                }
            )
            .is_err());
        assert_eq!(fixture.store().root, original);
        assert_eq!(fs::read_to_string(target.join("user.txt")).unwrap(), "keep");
        let nested = original.join("nested");
        fs::create_dir(&nested).unwrap();
        assert!(store.copy_to(&nested.to_string_lossy()).is_err());
    }

    #[test]
    fn rejects_traversal_collections_and_never_uses_record_keys_as_paths() {
        let fixture = Fixture::new();
        let store = fixture.store();
        for name in ["../", "C:\\data", ".", "", "foo/bar"] {
            assert!(store.collection("Default", Category::State, name).is_err());
        }
        let path = store
            .record_path("../other", Category::State, "positions", "../../配置.json")
            .unwrap();
        assert!(path.starts_with(&store.root));
        assert_eq!(path.file_name().unwrap().to_string_lossy().len(), 37);
    }

    #[test]
    fn corrupt_files_and_future_versions_are_reported_without_resetting_them() {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        let path = store
            .record_path("Default", Category::State, "test-records", "key")
            .unwrap();
        fs::write(&path, "{broken").unwrap();
        assert!(store
            .execute(
                "Default",
                DataRequest::Get {
                    category: Category::State,
                    collection: "test-records".into(),
                    key: "key".into()
                }
            )
            .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{broken");
        atomic_json(
            &path,
            &Record {
                format: FORMAT,
                key: "key".into(),
                version: 2,
                updated_at: "now".into(),
                value: json!({ "new": true }),
            },
        )
        .unwrap();
        assert!(store
            .execute(
                "Default",
                DataRequest::Put {
                    category: Category::State,
                    collection: "test-records".into(),
                    key: "key".into(),
                    version: 1,
                    value: json!("older"),
                    if_absent: false
                }
            )
            .is_err());
        fs::write(store.root.join(MARKER), r#"{"format":999}"#).unwrap();
        assert!(Store::load(fixture.0.clone()).is_err());
    }

    #[test]
    fn missing_custom_directory_does_not_silently_start_an_empty_store() {
        let fixture = Fixture::new();
        let mut store = fixture.store();
        let target = fixture.folder("external");
        store
            .execute(
                "Default",
                DataRequest::Relocate {
                    directory: target.to_string_lossy().into(),
                },
            )
            .unwrap();
        fs::rename(&target, fixture.0.join("unavailable")).unwrap();
        assert!(Store::load(fixture.0.clone()).is_err());
        assert!(!target.exists());
    }
}
