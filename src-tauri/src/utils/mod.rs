use std::{
    fs::{self, File},
    io::Write,
};

use crate::error::Result;
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
