use crate::error::Result;
use std::fs;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use uuid::Uuid;

pub fn write_file_at_offset(file: &mut File, data: &[u8], offset: u64) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(offset))?;
    file.write_all(data)?;
    Ok(())
}

pub fn get_file_name(file_path: &str) -> String {
    file_path
        .replace("\\", "/")
        .split("/")
        .last()
        .unwrap_or_default()
        .to_owned()
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_file_name() -> Result<()> {
        let nix_path = "/path/to/file.txt";
        let win_path = "\\path\\to\\file.txt";
        let expected_file_name = "file.txt".to_owned();
        assert_eq!(get_file_name(nix_path), expected_file_name);
        assert_eq!(get_file_name(win_path), expected_file_name);
        Ok(())
    }

    #[test]
    fn test_temp_file() -> Result<()> {
        let path: String;
        {
            let mut tmp = TempFile::with_extension("./", "txt")?;
            path = tmp.path().to_string();
            let data = b"hello temp file";
            tmp.write_all(data)?;
            assert!(std::path::Path::new(&path).exists());
            let content = std::fs::read(&path)?;
            assert_eq!(content, data);
        }
        assert!(!std::path::Path::new(&path).exists());
        Ok(())
    }
}
