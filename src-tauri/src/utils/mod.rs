use std::{
    fs::{self, File},
    io::{Seek, SeekFrom, Write},
};

use crate::error::{AppError, Result};
use serde::de::DeserializeOwned;
use std::any::type_name;
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

fn get_type_name<T>() -> &'static str {
    type_name::<T>()
}

fn locate_failed_json_field(e: &serde_json::Error, json_str: &str) -> String {
    let line = e.line();
    let column = e.column();

    let lines: Vec<&str> = json_str.lines().collect();

    if line == 0 || line > lines.len() {
        return json_str.to_owned();
    }

    let error_line = lines[line - 1];

    let start_idx = if column > 20 { column - 20 } else { 0 };
    let end_idx = if column + 20 < error_line.len() {
        column + 20
    } else {
        error_line.len()
    };

    let context = &error_line[start_idx..end_idx];

    format!("...{}...", context)
}

pub fn parse_json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice::<T>(bytes).map_err(|e| {
        let json_str = std::str::from_utf8(bytes).unwrap_or("");
        let context = locate_failed_json_field(&e, json_str);
        let type_name = get_type_name::<T>().to_string();
        AppError::JsonDeserialize(e, type_name, context)
    })
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[test]
    fn test_parse_json() -> Result<()> {
        // parse successfully
        #[derive(Deserialize, Debug)]
        struct Person {
            name: String,
            age: u32,
        }
        let mut json = r#"{"name": "Alice", "age": 30}"#;
        let person = parse_json::<Person>(json.as_bytes())?;
        assert_eq!(person.name, "Alice");
        assert_eq!(person.age, 30);

        // wrong age type
        json = r#"{"name": "Alice", "age": "30"}"#;
        let result = parse_json::<Person>(json.as_bytes());
        assert!(result.is_err());
        let err = result.unwrap_err();
        println!("{}", err);

        // EOF
        json = r#""#;
        let result = parse_json::<Person>(json.as_bytes());
        assert!(result.is_err());
        let err = result.unwrap_err();
        println!("{}", err);

        // Invalid json syntax
        json = r#"{123: "233}"#;
        let result = parse_json::<Person>(json.as_bytes());
        assert!(result.is_err());
        let err = result.unwrap_err();
        println!("{}", err);

        Ok(())
    }

    #[test]
    fn test_get_file_name() -> Result<()> {
        let nix_path = "/path/to/file.txt";
        let win_path = "\\path\\to\\file.txt";
        let expected_file_name = "file.txt".to_owned();
        assert_eq!(get_file_name(nix_path), expected_file_name);
        assert_eq!(get_file_name(win_path), expected_file_name);
        Ok(())
    }
}
