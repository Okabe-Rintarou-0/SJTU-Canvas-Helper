use crate::error::Result;
#[cfg(test)]
use std::fs;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
#[cfg(test)]
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

// Remote names are components, never paths. This is a lexical boundary, not
// protection against another local process replacing ancestor directories.
pub fn checked_download_path(
    base: &std::path::Path,
    group: Option<&str>,
    folder: &str,
    name: &str,
) -> Result<std::path::PathBuf> {
    if base.as_os_str().is_empty() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Download directory is empty").into());
    }
    let mut path = base.to_path_buf();
    if let Some(group) = group {
        validate_download_component(group)?;
        path.push(group);
    }
    if !folder.is_empty() {
        for component in folder.split('/') {
            validate_download_component(component)?;
            path.push(component);
        }
    }
    validate_download_component(name)?;
    path.push(name);
    Ok(path)
}

fn validate_download_component(name: &str) -> Result<()> {
    if name.is_empty() || matches!(name, "." | "..")
        || name.chars().any(|c| c == '/' || c == '\\' || c.is_control())
        || (cfg!(windows) && invalid_windows_component(name))
    {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid download path component").into());
    }
    Ok(())
}

fn invalid_windows_component(name: &str) -> bool {
    if name.ends_with([' ', '.']) || name.contains(['<', '>', ':', '"', '|', '?', '*']) {
        return true;
    }
    let stem = name.split('.').next().unwrap_or_default().trim_end_matches(' ').to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || stem.strip_prefix("COM").or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))
}

pub fn write_file_atomic(path: &std::path::Path, data: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| std::io::Error::new(
        std::io::ErrorKind::InvalidInput, "File path has no parent"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(data)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

// Test-only RAII temp file; QR scanning now decodes directly from memory.
#[cfg(test)]
pub struct TempFile {
    path: String,
    file_obj: File,
}

#[cfg(test)]
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

#[cfg(test)]
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
