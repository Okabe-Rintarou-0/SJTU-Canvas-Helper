use std::{
    fs::{self, File},
    io::Write,
};

use crate::error::{AppError, Result};
use serde::de::DeserializeOwned;
use uuid::Uuid;

// RAII temp file
pub struct TempFile {
    path: String,
    file_obj: File,
}

impl TempFile {
    pub fn with_extension<D, E>(dir: D, ext: E) -> Result<Self>
    where
        D: Into<String>,
        E: Into<String>,
    {
        let uuid = Uuid::new_v4();
        let path = format!("{}/tmp_{}.{}", dir.into(), uuid, ext.into());
        let file_obj = File::create(&path)?;
        Ok(Self { path, file_obj })
    }

    pub fn path(&self) -> &str {
        &self.path
    }

    pub fn write_all(&mut self, buf: &[u8]) -> Result<()> {
        self.file_obj.write_all(buf)?;
        Ok(())
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        _ = fs::remove_file(&self.path);
    }
}

pub fn parse_json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice::<T>(bytes)
        .map_err(|e| AppError::JsonDeserialize(e, String::from_utf8_lossy(bytes).to_string()))
}
