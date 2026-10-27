use std::any::type_name;

use crate::error::{AppError, Result};
use serde::de::DeserializeOwned;

fn get_type_name<T>() -> &'static str {
    type_name::<T>()
}

pub fn parse_json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice::<T>(bytes).map_err(|e| {
        let context = error_context(&e);
        let type_name = get_type_name::<T>().to_string();
        AppError::JsonDeserialize(e, type_name, context)
    })
}

/// Serde messages can contain response values. Keep only fixed reasons, never
/// field names, enum values or snippets from the original message.
pub fn error_context(error: &serde_json::Error) -> String {
    use serde_json::error::Category;

    let message = error.to_string();
    let reason = match error.classify() {
        Category::Io => "io",
        Category::Syntax => "syntax",
        Category::Eof => "unexpected_eof",
        Category::Data => [
            ("missing field", "missing_field"),
            ("unknown variant", "unknown_variant"),
            ("unknown field", "unknown_field"),
            ("duplicate field", "duplicate_field"),
            ("invalid type", "invalid_type"),
            ("invalid value", "invalid_value"),
            ("invalid length", "invalid_length"),
        ]
        .iter()
        .find_map(|(prefix, reason)| message.starts_with(prefix).then_some(*reason))
        .unwrap_or("data_mismatch"),
    };
    format!(
        "category: {:?}, reason: {reason}, line: {}, column: {}",
        error.classify(),
        error.line(),
        error.column()
    )
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

        // Error diagnostics must remain safe around multi-byte UTF-8 text.
        json = r#"{"padding":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","age":"学院"}"#;
        let result = parse_json::<Person>(json.as_bytes());
        assert!(result.is_err());

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

    #[test]
    fn invalid_values_and_eof_never_echo_response_contents() {
        for input in [r#""private-student-data""#, r#"{"token":"private-token""#] {
            let error = parse_json::<u64>(input.as_bytes()).unwrap_err();
            let text = error.to_string();
            assert!(!text.contains("private"));
            assert!(text.contains("line:"));
            assert!(text.contains("column:"));
        }
    }

    #[test]
    fn schema_errors_keep_actionable_reasons_without_response_values() {
        #[derive(Debug, Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Record {
            #[serde(rename = "count")]
            _count: u64,
        }
        #[derive(Debug, Deserialize)]
        enum Role {
            Student,
        }

        let missing = parse_json::<Record>(br#"{}"#).unwrap_err().to_string();
        assert!(missing.contains("missing_field"));
        for (input, expected) in [
            (r#"{"count":"private-student-data"}"#, "invalid_type"),
            (r#"{"private-key":1,"count":2}"#, "unknown_field"),
            (r#"{"count":1,"count":2}"#, "duplicate_field"),
        ] {
            let error = parse_json::<Record>(input.as_bytes()).unwrap_err();
            let message = crate::diagnostics::sanitize_text(&error.to_string());
            assert!(message.contains(expected), "{message}");
            assert!(message.contains("line:"));
            assert!(message.contains("column:"));
            assert!(!message.contains("private"));
        }
        let error = parse_json::<Role>(br#""private-enrollment""#).unwrap_err();
        assert!(error.to_string().contains("unknown_variant"));
        assert!(!error.to_string().contains("private-enrollment"));

        // Direct serde_json callers use the same safe context through AppError::JsonParse.
        let error: AppError = serde_json::from_str::<u64>(r#""private-token""#)
            .unwrap_err()
            .into();
        let message = error.to_string();
        assert!(message.contains("invalid_type"));
        assert!(message.contains("line:"));
        assert!(!message.contains("private-token"));

        let custom: serde_json::Error = serde::de::Error::custom("missing field `private_token`");
        assert!(!error_context(&custom).contains("private_token"));
    }
}
