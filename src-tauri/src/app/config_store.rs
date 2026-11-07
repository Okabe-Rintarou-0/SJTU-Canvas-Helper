//! Single-writer ownership for the captured configuration directory.
//!
//! A lock is not proof that a previous multi-file transaction completed. Poison
//! survives until this App instance is dropped; a missing intent never clears it.
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use crate::error::{AppError, Result};

pub(super) struct ConfigStore {
    root: PathBuf,
    // Never unlink or replace this file: all cooperating processes must lock
    // the same inode. Dropping the descriptor releases the operating-system lock.
    _lock: File,
    poisoned: AtomicBool,
}

impl ConfigStore {
    pub(super) fn open(root: &Path) -> Result<Self> {
        let mut missing = Vec::new();
        let mut ancestor = root;
        loop {
            match fs::metadata(ancestor) {
                Ok(metadata) if metadata.is_dir() => break,
                Ok(_) => return Err(io::Error::new(io::ErrorKind::NotADirectory,
                    "configuration ancestor is not a directory").into()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    missing.push(ancestor.to_path_buf());
                    ancestor = ancestor.parent().ok_or_else(|| io::Error::new(
                        io::ErrorKind::InvalidInput, "configuration root has no existing ancestor"))?;
                }
                Err(error) => return Err(error.into()),
            }
        }
        fs::create_dir_all(root)?;
        for directory in missing.iter().rev() {
            if let Some(parent) = directory.parent() { sync_directory(parent)?; }
        }
        let root = fs::canonicalize(root)?;
        let lock_path = root.join(".account-store.lock");
        match fs::symlink_metadata(&lock_path) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => return Err(io::Error::new(
                io::ErrorKind::InvalidInput, "configuration lock is not a regular file",
            ).into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let lock = OpenOptions::new().read(true).write(true).create(true)
            .truncate(false).open(&lock_path)?;
        lock.try_lock().map_err(|_| io::Error::new(
            io::ErrorKind::WouldBlock, "exclusive configuration-store lock unavailable",
        ))?;
        if !fs::symlink_metadata(&lock_path)?.file_type().is_file()
            || !lock.metadata()?.file_type().is_file()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput, "configuration lock changed type",
            ).into());
        }
        #[cfg(not(unix))]
        tracing::warn!("Configuration directory durability is not confirmed on this platform; recovery is limited to process interruption");
        Ok(Self { root, _lock: lock, poisoned: AtomicBool::new(false) })
    }

    pub(super) fn root(&self) -> &Path { &self.root }

    pub(super) fn root_str(&self) -> Result<&str> {
        self.root.to_str().ok_or_else(|| io::Error::new(
            io::ErrorKind::InvalidInput, "configuration root is not UTF-8",
        ).into())
    }

    pub(super) fn ensure_ready(&self) -> Result<()> {
        if self.poisoned.load(Ordering::Acquire) {
            return Err(AppError::PersistenceUncertain);
        }
        // Detect an externally replaced lock path before a new mutation. This
        // protects cooperating writers, not arbitrary malicious filesystem races.
        let path_metadata = fs::symlink_metadata(self.root.join(".account-store.lock"))
            .inspect_err(|_| self.poison())?;
        if !path_metadata.file_type().is_file() {
            self.poison();
            return Err(AppError::PersistenceUncertain);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let held = self._lock.metadata().inspect_err(|_| self.poison())?;
            if path_metadata.dev() != held.dev() || path_metadata.ino() != held.ino() {
                self.poison();
                return Err(AppError::PersistenceUncertain);
            }
        }
        Ok(())
    }

    pub(super) fn poison(&self) {
        self.poisoned.store(true, Ordering::Release);
    }
}

/// Unix directory-entry persistence. Other platforms deliberately provide only
/// the weaker process-interruption guarantee announced at store initialization.
/// This is not a cross-platform power-loss durability guarantee.
pub(super) fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    { File::open(path)?.sync_all() }
    #[cfg(not(unix))]
    { let _ = path; Ok(()) }
}
