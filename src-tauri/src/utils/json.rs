use std::any::type_name;

use crate::error::{AppError, Result};
use serde::de::DeserializeOwned;

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

    let start_idx = column.saturating_sub(20);
    let end_idx = if column + 20 < error_line.len() {
        column + 20
    } else {
        error_line.len()
    };

    let context = &error_line[start_idx..end_idx];

    format!("...{context}...")
}

pub fn parse_json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice::<T>(bytes).map_err(|e| {
        let json_str = std::str::from_utf8(bytes).unwrap_or("");
        let context = locate_failed_json_field(&e, json_str);
        let type_name = get_type_name::<T>().to_string();
        AppError::JsonDeserialize(e, type_name, context)
    })
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
        println!("{err}");

        // EOF
        json = r#""#;
        let result = parse_json::<Person>(json.as_bytes());
        assert!(result.is_err());
        let err = result.unwrap_err();
        println!("{err}");

        // Invalid json syntax
        json = r#"{123: "233"}"#;
        let result = parse_json::<Person>(json.as_bytes());
        assert!(result.is_err());
        let err = result.unwrap_err();
        println!("{err}");

        Ok(())
    }

    #[test]
    fn test_get_type_name() {
        // Test with primitive types
        assert!(get_type_name::<i32>().contains("i32"));
        assert!(get_type_name::<String>().contains("String"));
        assert!(get_type_name::<bool>().contains("bool"));

        // Test with custom types
        struct TestStruct;
        assert!(get_type_name::<TestStruct>().contains("TestStruct"));

        // Test with generic types
        assert!(get_type_name::<Vec<i32>>().contains("Vec"));
        assert!(get_type_name::<Vec<i32>>().contains("i32"));
        assert!(get_type_name::<Option<String>>().contains("Option"));
        assert!(get_type_name::<Option<String>>().contains("String"));
    }
}
