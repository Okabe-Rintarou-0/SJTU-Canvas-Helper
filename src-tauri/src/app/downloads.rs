//! Local file management. The index uses the application data store, so Save As
//! outputs and files from previous download locations survive restarts.
use super::{
    data::{self, Category, DataRequest},
    App,
};
use crate::{
    error::Result,
    utils::download::{directory, display_path, DownloadCourse},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

static WRITERS: Mutex<usize> = Mutex::new(0);
const COLLECTION: &str = "download-files";
const LIMIT: usize = 100_000;

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::other(message.into())
}

pub struct DownloadOutput {
    account: String,
    config: PathBuf,
}
impl Drop for DownloadOutput {
    fn drop(&mut self) {
        if let Ok(mut writers) = WRITERS.lock() {
            *writers = writers.saturating_sub(1);
        }
    }
}
impl DownloadOutput {
    pub async fn register(&self, path: &Path) -> Result<()> {
        let config = self.config.clone();
        let account = self.account.clone();
        let path = path.to_path_buf();
        tokio::task::spawn_blocking(move || {
            let path = display_path(&fs::canonicalize(path)?);
            data::execute_request(
                config,
                &account,
                DataRequest::Put {
                    category: Category::State,
                    collection: COLLECTION.into(),
                    key: path.clone(),
                    version: 1,
                    value: json!({ "path": path }),
                    if_absent: false,
                },
            )
            .map(|_| ())
        })
        .await?
        .map_err(|e| invalid(format!("文件已保存，但下载记录写入失败：{e}")))?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum DownloadRequest {
    List,
    Open {
        path: String,
        #[serde(default)]
        folder: bool,
    },
    Delete {
        files: Vec<DownloadedFile>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    path: String,
    name: String,
    relative_path: String,
    size: u64,
    modified_at: u64,
    stamp: String,
    external: bool,
}

// Check every ancestor as well as the file: symlink_metadata alone misses a
// junction in a parent folder. No link is ever traversed for listing/deleting.
fn ordinary_path(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(invalid("文件路径必须是绝对路径"));
    }
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor)?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(invalid("不管理符号链接或目录联接"));
            }
        }
        if meta.file_type().is_symlink() {
            return Err(invalid("不管理符号链接"));
        }
    }
    fs::canonicalize(path)
}

fn describe(path: &Path, root: &Path) -> io::Result<DownloadedFile> {
    let path = ordinary_path(path)?;
    let meta = fs::metadata(&path)?;
    if !meta.is_file() {
        return Err(invalid("只允许管理普通文件"));
    }
    let modified = meta
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let external = !path.starts_with(root);
    Ok(DownloadedFile {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        relative_path: path
            .strip_prefix(root)
            .map(display_path)
            .unwrap_or_else(|_| display_path(&path)),
        path: display_path(&path),
        size: meta.len(),
        modified_at: modified.as_millis() as u64,
        stamp: format!("{}:{}", meta.len(), modified.as_nanos()),
        external,
    })
}

struct Catalog {
    root: PathBuf,
    config: PathBuf,
    account: String,
    excluded: Vec<PathBuf>,
    indexed: HashSet<PathBuf>,
    warnings: Vec<String>,
}
impl Catalog {
    fn load(config: PathBuf, account: String, root: PathBuf) -> io::Result<Self> {
        let excluded = vec![
            fs::canonicalize(&config)?,
            data::storage_directory(config.clone())?,
        ];
        let records = data::execute_request(
            config.clone(),
            &account,
            DataRequest::List {
                category: Category::State,
                collection: COLLECTION.into(),
            },
        )?;
        let mut indexed = HashSet::new();
        for record in records
            .as_array()
            .ok_or_else(|| invalid("下载索引格式无效"))?
        {
            if record["version"].as_u64() != Some(1) {
                return Err(invalid("下载索引版本不兼容，请更新应用后重试"));
            }
            let path = record["value"]["path"]
                .as_str()
                .ok_or_else(|| invalid("下载索引路径无效"))?;
            if !Path::new(path).is_absolute() {
                return Err(invalid("下载索引路径必须是绝对路径"));
            }
            // Missing/unmounted files remain indexed and can reappear later.
            if let Ok(path) = ordinary_path(Path::new(path)) {
                indexed.insert(path);
            }
        }
        let root = if root.exists() {
            ordinary_path(&root)?
        } else {
            root
        };
        Ok(Self {
            root,
            config,
            account,
            excluded,
            indexed,
            warnings: Vec::new(),
        })
    }
    fn excluded(&self, path: &Path) -> bool {
        self.excluded.iter().any(|p| path.starts_with(p))
    }
    fn checked(&self, path: &Path) -> io::Result<DownloadedFile> {
        let canonical = ordinary_path(path)?;
        if self.excluded(&canonical)
            || (!canonical.starts_with(&self.root) && !self.indexed.contains(&canonical))
        {
            return Err(invalid("该文件不在下载目录或已保存的下载记录中"));
        }
        describe(&canonical, &self.root)
    }
    fn scan(&mut self) -> Vec<DownloadedFile> {
        let mut files = BTreeMap::new();
        let mut visited = 0;
        let mut pending = vec![(self.root.clone(), 0)];
        if !self.root.exists() {
            self.warnings
                .push("下载目录不存在，请在设置中重新选择。".into());
            pending.clear();
        }
        while let Some((folder, depth)) = pending.pop() {
            if self.excluded(&folder) {
                continue;
            }
            let entries = match fs::read_dir(&folder) {
                Ok(e) => e,
                Err(e) => {
                    self.warnings
                        .push(format!("无法读取 {}：{e}", display_path(&folder)));
                    continue;
                }
            };
            for entry in entries {
                visited += 1;
                if visited > LIMIT {
                    self.warnings
                        .push("文件过多，仅显示前 100000 个目录项。请缩小下载目录范围。".into());
                    return files.into_values().collect();
                }
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => {
                        self.warnings.push(e.to_string());
                        continue;
                    }
                };
                let path = entry.path();
                if self.excluded(&path) {
                    continue;
                }
                let canonical = match ordinary_path(&path) {
                    Ok(p) => p,
                    Err(_) => {
                        self.warnings.push(format!(
                            "已跳过链接或不可读取的项目：{}",
                            display_path(&path)
                        ));
                        continue;
                    }
                };
                if canonical.is_dir() {
                    if depth < 32 {
                        pending.push((canonical, depth + 1));
                    } else {
                        self.warnings
                            .push(format!("目录层级过深，已跳过：{}", display_path(&path)));
                    }
                } else {
                    match describe(&canonical, &self.root) {
                        Ok(f) => {
                            files.insert(f.path.clone(), f);
                        }
                        Err(e) => self.warnings.push(e.to_string()),
                    }
                }
            }
        }
        for path in &self.indexed {
            if !self.excluded(path) {
                if let Ok(file) = describe(path, &self.root) {
                    files.insert(file.path.clone(), file);
                }
            }
        }
        files.into_values().collect()
    }
    fn delete(&self, files: Vec<DownloadedFile>, gate: &Mutex<usize>) -> io::Result<Value> {
        if files.is_empty() || files.len() > LIMIT {
            return Err(invalid("请选择需要删除的文件"));
        }
        let writers = gate.lock().map_err(|_| invalid("下载管理锁不可用"))?;
        if *writers != 0 {
            return Err(invalid("下载或导出正在进行，请完成后再删除文件"));
        }
        // Validate the entire selection before deleting any file. Recheck each
        // timestamp immediately before removal; a refreshed download is retained.
        for file in &files {
            if self.checked(Path::new(&file.path))?.stamp != file.stamp {
                return Err(invalid("文件已发生变化，请刷新列表后重新选择"));
            }
        }
        let mut deleted = Vec::new();
        let mut errors = Vec::new();
        let mut seen = HashSet::new();
        for file in files {
            if !seen.insert(file.path.clone()) {
                continue;
            }
            let result = self.checked(Path::new(&file.path)).and_then(|current| {
                if current.stamp != file.stamp {
                    return Err(invalid("文件已发生变化"));
                }
                fs::remove_file(&file.path)
            });
            match result {
                Ok(()) => {
                    deleted.push(file.path.clone());
                    if let Err(e) = data::execute_request(
                        self.config.clone(),
                        &self.account,
                        DataRequest::Delete {
                            category: Category::State,
                            collection: COLLECTION.into(),
                            key: file.path.clone(),
                        },
                    ) {
                        errors.push(format!("文件已删除，记录清理失败：{e}"));
                    }
                }
                Err(e) => errors.push(format!("{}：{e}", file.name)),
            }
        }
        Ok(json!({ "deleted": deleted, "errors": errors }))
    }
}

impl App {
    pub async fn download_output(&self) -> Result<DownloadOutput> {
        let account = self.current_account.read().await;
        let name = serde_json::to_value(&*account)?
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let config = PathBuf::from(Self::config_dir()?);
        *WRITERS.lock().map_err(|_| invalid("下载管理锁不可用"))? += 1;
        Ok(DownloadOutput {
            account: name,
            config,
        })
    }
    pub async fn download_directory(
        &self,
        kind: &str,
        course: Option<&DownloadCourse>,
        root: Option<&str>,
    ) -> Result<String> {
        let guard = self.config.read().await;
        Ok(display_path(&directory(
            Path::new(root.unwrap_or(&guard.save_path)),
            kind,
            course,
        )?))
    }
    pub async fn downloaded_files(
        &self,
        expected_account: String,
        request: DownloadRequest,
    ) -> std::result::Result<Value, String> {
        let account = self.current_account.read().await;
        if serde_json::to_value(&*account)
            .map_err(|e| e.to_string())?
            .as_str()
            != Some(&expected_account)
        {
            return Err("账号已切换，请刷新页面".into());
        }
        let config = PathBuf::from(Self::config_dir().map_err(|e| e.to_string())?);
        let config_guard = self.config.read().await;
        let root = PathBuf::from(&config_guard.save_path);
        let (value, open) = tokio::task::spawn_blocking(move || -> io::Result<_> {
            let mut catalog = Catalog::load(config, expected_account, root)?;
            match request {
                DownloadRequest::List => {
                    let files = catalog.scan();
                    let total: u64 = files.iter().map(|f| f.size).sum();
                    let busy = *WRITERS.lock().map_err(|_| invalid("下载管理锁不可用"))? > 0;
                    catalog.warnings.truncate(20);
                    Ok((json!({ "directory": display_path(&catalog.root), "files": files, "totalBytes": total, "warnings": catalog.warnings, "busy": busy }), None))
                },
                DownloadRequest::Open { path, folder } => {
                    let file = catalog.checked(Path::new(&path))?;
                    let path = if folder { display_path(Path::new(&file.path).parent().ok_or_else(|| invalid("目录不存在"))?) } else { file.path };
                    Ok((Value::Null, Some(path)))
                },
                DownloadRequest::Delete { files } => Ok((catalog.delete(files, &WRITERS)?, None)),
            }
        }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        if let Some(path) = open {
            self.open_local_path(&path).map_err(|e| e.to_string())?;
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("canvas-downloads-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn catalog(temp: &Temp) -> Catalog {
        let config = temp.0.join("config");
        fs::create_dir_all(&config).unwrap();
        let root = temp.0.join("downloads");
        fs::create_dir_all(&root).unwrap();
        Catalog::load(config, "Default".into(), root).unwrap()
    }
    #[test]
    fn manages_legacy_nested_and_external_outputs_without_app_data() {
        let temp = Temp::new();
        let mut c = catalog(&temp);
        fs::create_dir_all(c.root.join("旧课程/第一章")).unwrap();
        fs::write(c.root.join("旧课程/第一章/课件.pdf"), "pdf").unwrap();
        let course = DownloadCourse {
            id: "10".into(),
            name: "课程".into(),
            term: "2026-2027 秋".into(),
        };
        for (kind, name) in [
            ("file", "课件.pdf"),
            ("video", "录像.mp4"),
            ("subtitle", "字幕.srt"),
        ] {
            let folder = directory(&c.root, kind, Some(&course)).unwrap();
            fs::write(folder.join(name), "new").unwrap();
        }
        let external = temp.0.join("另存为.srt");
        fs::write(&external, "字幕").unwrap();
        c.indexed.insert(fs::canonicalize(external).unwrap());
        // Even when the download root is an ancestor, config/app-data is excluded.
        c.root = fs::canonicalize(&temp.0).unwrap();
        let files = c.scan();
        assert_eq!(files.len(), 5);
        assert!(files.iter().all(|f| !f.path.contains("store.json")));
    }
    #[test]
    fn refuses_outside_files_and_changed_downloads() {
        let temp = Temp::new();
        let c = catalog(&temp);
        let path = c.root.join("保留.txt");
        fs::write(&path, "old").unwrap();
        let file = describe(&path, &c.root).unwrap();
        fs::write(&path, "new content").unwrap();
        assert!(c.delete(vec![file], &Mutex::new(0)).is_err());
        assert!(path.exists());
        let outside = temp.0.join("私人.txt");
        fs::write(&outside, "private").unwrap();
        assert!(c
            .delete(vec![describe(&outside, &c.root).unwrap()], &Mutex::new(0))
            .is_err());
        assert!(outside.exists());
    }
    #[test]
    fn deletes_selected_files_and_retains_folders_and_unselected_files() {
        let temp = Temp::new();
        let c = catalog(&temp);
        let path = c.root.join("删除.txt");
        fs::write(&path, "delete").unwrap();
        fs::write(c.root.join("保留.txt"), "keep").unwrap();
        let result = c
            .delete(vec![describe(&path, &c.root).unwrap()], &Mutex::new(0))
            .unwrap();
        assert_eq!(result["deleted"].as_array().unwrap().len(), 1);
        assert!(!path.exists());
        assert!(c.root.join("保留.txt").exists());
        assert!(c.root.is_dir());
    }
    #[test]
    fn refuses_cleanup_during_writes_and_validates_entire_selection() {
        let temp = Temp::new();
        let c = catalog(&temp);
        let path = c.root.join("下载中.txt");
        fs::write(&path, "keep").unwrap();
        let file = describe(&path, &c.root).unwrap();
        assert!(c.delete(vec![file.clone()], &Mutex::new(1)).is_err());
        let outside = temp.0.join("不属于下载.txt");
        fs::write(&outside, "private").unwrap();
        assert!(c
            .delete(
                vec![file, describe(&outside, &c.root).unwrap()],
                &Mutex::new(0)
            )
            .is_err());
        assert!(path.exists());
        assert!(outside.exists());
    }
    #[test]
    fn index_survives_reopening_and_store_relocation_and_is_account_scoped() {
        let temp = Temp::new();
        let c = catalog(&temp);
        let path = temp.0.join("另存的成果.pdf");
        fs::write(&path, "pdf").unwrap();
        let path = display_path(&fs::canonicalize(&path).unwrap());
        data::execute_request(
            c.config.clone(),
            "Default",
            DataRequest::Put {
                category: Category::State,
                collection: COLLECTION.into(),
                key: path.clone(),
                version: 1,
                value: json!({"path": path}),
                if_absent: false,
            },
        )
        .unwrap();
        assert_eq!(
            Catalog::load(c.config.clone(), "Default".into(), c.root.clone())
                .unwrap()
                .scan()
                .len(),
            1
        );
        assert!(
            Catalog::load(c.config.clone(), "other-account".into(), c.root.clone())
                .unwrap()
                .scan()
                .is_empty()
        );
        let target = temp.0.join("迁移后的应用数据");
        fs::create_dir_all(&target).unwrap();
        data::execute_request(
            c.config.clone(),
            "Default",
            DataRequest::Relocate {
                directory: display_path(&target),
            },
        )
        .unwrap();
        let mut reopened = Catalog::load(c.config, "Default".into(), c.root).unwrap();
        let files = reopened.scan();
        assert_eq!(files.len(), 1);
        assert!(files[0].external);
        reopened.delete(files, &Mutex::new(0)).unwrap();
        assert!(!Path::new(&path).exists());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_ancestors() {
        let temp = Temp::new();
        let mut c = catalog(&temp);
        let outside = temp.0.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("private.txt"), "keep").unwrap();
        std::os::unix::fs::symlink(&outside, c.root.join("link")).unwrap();
        assert!(c.scan().is_empty());
        assert!(c.checked(&c.root.join("link/private.txt")).is_err());
    }
}
