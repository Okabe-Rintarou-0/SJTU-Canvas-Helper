//! Small, local-only diagnostic log. Legacy app.log is deliberately never exported.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use regex::Regex;
use tracing_subscriber::{fmt::MakeWriter, layer::SubscriberExt, Layer};

const LOG_NAME: &str = "diagnostics.log";
const PREVIOUS_NAME: &str = "diagnostics.previous.log";
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REPORT_BYTES: usize = 256 * 1024;
const MAX_EVENT_BYTES: usize = 8 * 1024;
const MAX_INPUT_BYTES: usize = 64 * 1024;
const REDACTED: &str = "[redacted]";
static STORE: OnceLock<Arc<LogStore>> = OnceLock::new();

lazy_static::lazy_static! {
    static ref SECRETS: Mutex<Vec<String>> = Mutex::new(Vec::new());
    static ref URL: Regex = Regex::new(r#"(?i)https?://[^\s<>\"'\\)]+"#).unwrap();
    // Defense in depth for free-form error messages; sources must still avoid raw payloads.
    static ref CREDENTIAL: Regex = Regex::new(r#"(?i)(?:authorization|proxy-authorization|set-cookie|cookie|[a-z_]*(?:token|api[_-]?key|password|secret|signature)[a-z_]*|oauth_consumer_key)\s*[\\\"']*\s*[:=]\s*[^\r\n]*"#).unwrap();
    static ref BEARER: Regex = Regex::new(r"(?i)\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+").unwrap();
    static ref API_KEY: Regex = Regex::new(r"\bsk-[a-zA-Z0-9_-]{8,}").unwrap();
    static ref LOCAL_PATH: Regex = Regex::new(r#"(?i)(?:file://|\b[a-z]:[\\/]|\\\\|(?:^|[\s\"'(=])/[^/\s])[^\r\n\"<>]*"#).unwrap();
    static ref EMAIL: Regex = Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap();
    static ref APP_SCRIPT: Regex = Regex::new(r"^/assets/[a-zA-Z0-9_-]+\.js(?::[0-9]+){0,2}$").unwrap();
    // Matches field labels, including JSON-escaped quotes, without matching parts of identifiers.
    static ref FIELD: Regex = Regex::new(r#"(?:^|[^\p{L}\p{N}_-])(?:\\*["'])?(?P<key>(?:[\p{L}_]|\\+u[0-9a-fA-F]{4})(?:[\p{L}\p{N}_-]|\\+u[0-9a-fA-F]{4}){0,63})(?P<quote>\\*["'])?[ \t]*[:=：][ \t]*"#).unwrap();
}

fn normalized_field_key(key: &str) -> String {
    let mut key = key.to_owned();
    // Some upstream errors contain JSON encoded inside JSON. Decode only the bounded key.
    for _ in 0..4 {
        if !key.contains('\\') {
            break;
        }
        let Ok(decoded) = serde_json::from_str::<String>(&format!("\"{key}\"")) else {
            break;
        };
        if decoded == key {
            break;
        }
        key = decoded;
    }
    key.replace(['_', '-'], "").to_ascii_lowercase()
}

fn is_personal_field(key: &str) -> bool {
    matches!(
        key,
        "name"
            | "title"
            | "displayname"
            | "sortablename"
            | "shortname"
            | "fullname"
            | "nickname"
            | "username"
            | "realname"
            | "studentname"
            | "studentnames"
            | "teachername"
            | "teachernames"
            | "instructorname"
            | "instructornames"
            | "authorname"
            | "teacname"
            | "teacnames"
            | "tecname"
            | "teachers"
            | "loginid"
            | "studentid"
            | "studentids"
            | "studentnumber"
            | "studentno"
            | "studentnum"
            | "sno"
            | "teacherids"
            | "teacherno"
            | "employeeid"
            | "employeeno"
            | "workno"
            | "sisuserid"
            | "sisloginid"
            | "userid"
            | "userids"
            | "loginuserid"
            | "teacherid"
            | "instructorid"
            | "authorid"
            | "editorid"
            | "anonymousid"
            | "email"
            | "coursename"
            | "coursenames"
            | "courseid"
            | "courseids"
            | "coursecode"
            | "courseno"
            | "canvasid"
            | "canvascourseid"
            | "contextname"
            | "contextcode"
            | "subjectname"
            | "subjname"
            | "subjid"
            | "courname"
            | "courid"
            | "teclname"
            | "teclid"
            | "teclcode"
            | "teachingclassid"
            | "teachingclassname"
            | "videoname"
            | "videname"
            | "filename"
            | "outputname"
            | "savename"
            | "externaltitle"
            | "assignmentname"
            | "assignmetname"
            | "classroomname"
            | "clroname"
            | "organizationname"
            | "libraryid"
            | "spaceid"
            | "currentaccount"
            | "allaccounts"
            | "姓名"
            | "学生姓名"
            | "用户名"
            | "学号"
            | "学生学号"
            | "教师名"
            | "教师姓名"
            | "老师姓名"
            | "授课教师"
            | "教师"
            | "课程名"
            | "课程名称"
            | "课程编号"
            | "课程代码"
            | "课程号"
            | "班级名称"
            | "教学班名称"
            | "文件名"
            | "文件名称"
            | "名称"
            | "标题"
            | "显示名"
            | "昵称"
            | "用户姓名"
            | "用户id"
            | "用户编号"
            | "学生编号"
            | "学生id"
            | "学生名字"
            | "学生名单"
            | "教师id"
            | "教师编号"
            | "教师工号"
            | "任课教师姓名"
            | "工号"
            | "教工号"
            | "课程id"
            | "课号"
            | "教学班id"
            | "教学班编号"
            | "邮箱"
            | "电子邮箱"
    )
}

/// Classify only known private aliases: diagnostic keys such as hostname stay intact.
fn is_name_field(key: &str) -> bool {
    is_personal_field(key)
        && (key.ends_with("name")
            || key.ends_with("names")
            || matches!(
                key,
                "title"
                    | "externaltitle"
                    | "teachers"
                    | "姓名"
                    | "学生姓名"
                    | "用户名"
                    | "教师名"
                    | "教师姓名"
                    | "老师姓名"
                    | "授课教师"
                    | "教师"
                    | "课程名"
                    | "课程名称"
                    | "班级名称"
                    | "教学班名称"
                    | "文件名"
                    | "文件名称"
                    | "名称"
                    | "标题"
                    | "显示名"
                    | "昵称"
                    | "用户姓名"
                    | "学生名字"
                    | "学生名单"
                    | "任课教师姓名"
            ))
}

fn name_initial(value: &str) -> Option<char> {
    let value = value.trim_start();
    if matches!(value, REDACTED | "[personal data omitted]") {
        return None;
    }
    value
        .chars()
        .next()
        .filter(|ch| !ch.is_control() && !matches!(ch, '\\' | '"' | '\''))
}

fn redact_name_value(
    value: &serde_json::Value,
    depth: usize,
    nodes: &mut usize,
) -> serde_json::Value {
    *nodes += 1;
    if *nodes > 200 {
        return "[Node limit]".into();
    }
    if depth >= 5 {
        return "[Depth limit]".into();
    }
    match value {
        serde_json::Value::String(name)
            if matches!(
                name.as_str(),
                "[Items truncated]"
                    | "[Depth limit]"
                    | "[Node limit]"
                    | "[Accessor omitted]"
                    | "[Circular]"
                    | "[Unserializable value]"
                    | "[Function]"
                    | "[truncated]"
            ) =>
        {
            name.clone().into()
        }
        serde_json::Value::String(name) => name_initial(name)
            .map(|initial| format!("{initial}{REDACTED}"))
            .unwrap_or_else(|| REDACTED.to_owned())
            .into(),
        serde_json::Value::Array(names) => {
            let mut result: Vec<_> = names
                .iter()
                .take(30)
                .map(|name| redact_name_value(name, depth + 1, nodes))
                .collect();
            if names.len() > 30 {
                result.push("[Items truncated]".into());
            }
            result.into()
        }
        serde_json::Value::Object(fields) => fields
            .iter()
            .take(30)
            .filter_map(|(key, value)| {
                let normalized = normalized_field_key(key);
                // Names can also be map keys. Retain only recognized field labels.
                if !is_personal_field(&normalized)
                    && !matches!(normalized.as_str(), "id" | "ids" | "key" | "uuid")
                {
                    return None;
                }
                let value = if is_name_field(&normalized) {
                    redact_name_value(value, depth + 1, nodes)
                } else {
                    REDACTED.into()
                };
                Some((key.clone(), value))
            })
            .collect::<serde_json::Map<_, _>>()
            .into(),
        _ => REDACTED.into(),
    }
}

/// Decode the field's JSON layer before redacting arrays or objects, then restore that layer.
fn redact_name_field(value: &str, quote: &str) -> Option<String> {
    let slashes = quote.bytes().take_while(|&byte| byte == b'\\').count();
    if slashes > 7 || !(slashes + 1).is_power_of_two() {
        return None;
    }
    let layers = (slashes + 1).trailing_zeros();
    let mut decoded = value.to_owned();
    for _ in 0..layers {
        decoded = serde_json::from_str::<String>(&format!("\"{decoded}\"")).ok()?;
    }
    let value: serde_json::Value = serde_json::from_str(&decoded).ok()?;
    let safe = redact_name_value(&value, 0, &mut 0);
    let mut encoded = serde_json::to_string(&safe).ok()?;
    for _ in 0..layers {
        encoded = serde_json::to_string(&encoded).ok()?;
        encoded = encoded[1..encoded.len() - 1].to_owned();
    }
    Some(encoded)
}

/// End of a quoted value, including JSON strings encoded inside another string.
fn quoted_value_end(value: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    let slashes = bytes.iter().take_while(|&&byte| byte == b'\\').count();
    let quote = *bytes.get(slashes)?;
    if !matches!(quote, b'"' | b'\'') {
        return None;
    }
    let mut preceding_slashes = 0;
    for (index, &byte) in bytes.iter().enumerate().skip(slashes + 1) {
        // JSON does not escape single quotes: an outer JSON layer can double the
        // backslashes before an apostrophe. Never treat that apostrophe as the end.
        let closes = if quote == b'\'' {
            preceding_slashes == 0
        } else {
            preceding_slashes % (2 * (slashes + 1)) == slashes
        };
        if byte == quote && closes {
            return Some(index + 1);
        }
        preceding_slashes = if byte == b'\\' {
            preceding_slashes + 1
        } else {
            0
        };
    }
    None
}

fn personal_value_end(value: &str, quoted_key: bool) -> usize {
    if let Some(end) = quoted_value_end(value) {
        return end;
    }
    if quoted_key {
        let mut values = serde_json::Deserializer::from_str(value).into_iter::<serde_json::Value>();
        if matches!(
            values.next(),
            Some(Ok(serde_json::Value::Number(_)
                | serde_json::Value::Bool(_)
                | serde_json::Value::Null))
        ) {
            let end = values.byte_offset();
            let rest = value[end..].trim_start();
            if rest.is_empty() || rest.starts_with([',', '}', ']']) {
                return end;
            }
        }
    }
    let bytes = value.as_bytes();
    let mut index = if value.starts_with("Some(") { 4 } else { 0 };
    if !matches!(bytes.get(index), Some(b'[' | b'{' | b'(')) {
        // Free text can contain spaces, commas or newlines. Without a reliable boundary,
        // omit the remainder rather than accidentally exposing part of a name.
        return value.len();
    }
    let mut closings = Vec::new();
    while let Some(&byte) = bytes.get(index) {
        if matches!(byte, b'"' | b'\'' | b'\\') {
            if let Some(end) = quoted_value_end(&value[index..]) {
                index += end;
                continue;
            }
            return value.len();
        }
        match byte {
            b'[' => closings.push(b']'),
            b'{' => closings.push(b'}'),
            b'(' => closings.push(b')'),
            b']' | b'}' | b')' => {
                if closings.pop() != Some(byte) {
                    return value.len();
                }
                if closings.is_empty() {
                    return index + 1;
                }
            }
            _ => (),
        }
        index += 1;
    }
    value.len()
}

fn redact_personal_fields(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut copied = 0;
    for capture in FIELD.captures_iter(value) {
        let start = capture.get(0).unwrap().end();
        if start < copied {
            continue;
        }
        let key = normalized_field_key(&capture["key"]);
        if !is_personal_field(&key) {
            continue;
        }
        let end = start + personal_value_end(&value[start..], capture.name("quote").is_some());
        // Standard JS exception types are diagnostic metadata, not a user's name.
        if capture["key"].eq_ignore_ascii_case("name")
            && matches!(
                value[start..end].trim_matches(['\\', '"', '\'']),
                "Error"
                    | "TypeError"
                    | "RangeError"
                    | "ReferenceError"
                    | "SyntaxError"
                    | "URIError"
                    | "EvalError"
                    | "AggregateError"
            )
        {
            continue;
        }
        output.push_str(&value[copied..start]);
        let tail = &value[start..];
        let slashes = tail.bytes().take_while(|&byte| byte == b'\\').count();
        let value_quote = tail
            .as_bytes()
            .get(slashes)
            .filter(|&&byte| matches!(byte, b'"' | b'\''))
            .map(|_| &tail[..slashes + 1]);
        let quote = capture
            .name("quote")
            .map(|quote| quote.as_str())
            .or(value_quote)
            .unwrap_or("\"");
        if is_name_field(&key) {
            if let Some(safe) = redact_name_field(&value[start..end], quote) {
                output.push_str(&safe);
                copied = end;
                continue;
            }
        }
        output.push_str(quote);
        output.push_str(REDACTED);
        output.push_str(quote);
        copied = end;
    }
    output.push_str(&value[copied..]);
    output
}

/// Keep a small set of current/recent credentials out of arbitrary provider errors too.
pub fn protect_secret(value: &str) {
    if value.len() < 4 || value.len() > MAX_INPUT_BYTES {
        return;
    }
    if let Ok(mut values) = SECRETS.lock() {
        if !values.iter().any(|existing| existing == value) {
            if values.len() >= 128 {
                values.remove(0);
            }
            values.push(value.to_owned());
        }
    }
}

pub fn protect_config(config: &crate::model::AppConfig) {
    for value in [
        &config.token,
        &config.llm_api_key,
        &config.oauth_consumer_key,
        &config.jbox_login_info.access_token,
    ] {
        protect_secret(value);
    }
    for entry in &config.llm_api_keys {
        protect_secret(&entry.key);
    }
    for cookie in [&config.ja_auth_cookie, &config.video_cookies] {
        protect_secret(cookie);
        for part in cookie.split(';') {
            if let Some((_, value)) = part.trim().split_once('=') {
                protect_secret(value);
            }
        }
    }
}

pub fn sanitize_url(value: &str) -> String {
    let Ok(url) = reqwest::Url::parse(value) else {
        return "[url omitted]".into();
    };
    // Keep production stack coordinates for our own generated assets. These contain no user paths.
    if matches!(url.host_str(), Some("tauri.localhost" | "localhost"))
        && APP_SCRIPT.is_match(url.path())
    {
        return format!(
            "{}://{}{}",
            url.scheme(),
            url.host_str().unwrap_or("localhost"),
            url.path()
        );
    }
    // Only known route words survive. Signed paths, file names, IDs and userinfo do not.
    let path = url
        .path_segments()
        .map(|parts| {
            parts
                .take(12)
                .map(|part| match part {
                    "" | "api" | "v1" | "v2" | "v3" | "courses" | "files" | "folders" | "users"
                    | "self" | "assignments" | "submissions" | "modules" | "items"
                    | "calendar_events" | "discussion_topics" | "accounts" | "login" | "oauth"
                    | "token" | "videos" | "video" | "download" | "upload" | "chat"
                    | "completions" | "models" | "graphql" => part,
                    _ => "_",
                })
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default();
    format!(
        "{}://{}{}/{}",
        url.scheme(),
        url.host_str().unwrap_or("unknown"),
        url.port()
            .map(|port| format!(":{port}"))
            .unwrap_or_default(),
        path
    )
}

pub fn sanitize_text(value: &str) -> String {
    if value.len() > MAX_INPUT_BYTES {
        return "[oversized diagnostic omitted]".into();
    }
    let mut text = redact_personal_fields(value);
    if let Ok(values) = SECRETS.lock() {
        // Longest first prevents a short credential leaving part of a longer one visible.
        let mut values: Vec<_> = values.iter().collect();
        values.sort_by_key(|value| std::cmp::Reverse(value.len()));
        for value in values {
            text = text.replace(value, "[redacted]");
        }
    }
    text = URL
        .replace_all(&text, |caps: &regex::Captures<'_>| sanitize_url(&caps[0]))
        .into_owned();
    text = CREDENTIAL
        .replace_all(&text, "[credentials redacted]")
        .into_owned();
    text = BEARER
        .replace_all(&text, "[credentials redacted]")
        .into_owned();
    text = API_KEY
        .replace_all(&text, "[credentials redacted]")
        .into_owned();
    text = LOCAL_PATH
        .replace_all(&text, "[local path omitted]")
        .into_owned();
    text = EMAIL.replace_all(&text, "[email omitted]").into_owned();
    // Logs stay plain text (including when an external program supplies control codes).
    text.retain(|ch| !ch.is_control() || ch == '\n' || ch == '\t');
    if text.len() > MAX_EVENT_BYTES {
        let mut end = MAX_EVENT_BYTES - 32;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str(" [event truncated]\n");
    }
    text
}

struct State {
    write_error: Option<String>,
}

pub struct LogStore {
    directory: PathBuf,
    max_file_bytes: u64,
    state: Mutex<State>,
}

impl LogStore {
    fn new(directory: PathBuf, max_file_bytes: u64) -> Self {
        Self {
            directory,
            max_file_bytes,
            state: Mutex::new(State { write_error: None }),
        }
    }

    fn append(&self, text: &str) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let result = (|| -> io::Result<()> {
            fs::create_dir_all(&self.directory)?;
            let path = self.directory.join(LOG_NAME);
            // Reopen for each event: a partial write or another instance rotating the file
            // must not leave us with a stale size or a handle to the previous log.
            let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
            if file.metadata()?.len() + text.len() as u64 > self.max_file_bytes {
                drop(file); // Close before rename on Windows.
                let previous = self.directory.join(PREVIOUS_NAME);
                match fs::remove_file(&previous) {
                    Ok(()) => (),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                    Err(error) => return Err(error),
                }
                fs::rename(&path, previous)?;
                file = OpenOptions::new().create(true).append(true).open(&path)?;
            }
            file.write_all(text.as_bytes())?;
            file.flush()?;
            Ok(())
        })();
        // Never recurse into tracing or turn a logging failure into an application failure.
        state.write_error = result.err().map(|error| sanitize_text(&error.to_string()));
    }

    fn snapshot(&self, limit: usize) -> io::Result<(String, bool, Option<String>)> {
        let state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("diagnostic log unavailable"))?;
        let mut remaining = limit;
        let mut parts = Vec::new();
        let mut truncated = false;
        for name in [LOG_NAME, PREVIOUS_NAME] {
            let file = match File::open(self.directory.join(name)) {
                Ok(file) => file,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            // Read one bounded file before removing personal fields. Cutting first could
            // orphan the continuation of a multiline name from an older log.
            let mut bytes = Vec::new();
            file.take(self.max_file_bytes + 1).read_to_end(&mut bytes)?;
            if bytes.len() as u64 > self.max_file_bytes {
                return Err(io::Error::other("日志文件超过大小限制，未读取其内容"));
            }
            if let Some(last) = bytes.iter().rposition(|byte| *byte == b'\n') {
                bytes.truncate(last + 1);
            } else {
                bytes.clear();
            }
            let mut safe = redact_personal_fields(&String::from_utf8_lossy(&bytes));
            if !safe.is_empty() && !safe.ends_with('\n') {
                safe.push('\n');
            }
            let mut bytes = safe.into_bytes();
            let start = bytes.len().saturating_sub(remaining);
            truncated |= start > 0;
            bytes.drain(..start);
            remaining = remaining.saturating_sub(bytes.len());
            if start > 0 {
                // Discard a partial first line, including a possible split UTF-8 character.
                let next = bytes
                    .iter()
                    .position(|byte| *byte == b'\n')
                    .map(|at| at + 1)
                    .unwrap_or(bytes.len());
                bytes.drain(..next);
            }
            // Re-sanitize per event/line without letting a large report bypass the input limit.
            parts.push(
                String::from_utf8_lossy(&bytes)
                    .lines()
                    .map(sanitize_text)
                    .collect::<Vec<_>>()
                    .join("\n"),
            );
        }
        parts.reverse();
        Ok((parts.join("\n"), truncated, state.write_error.clone()))
    }
}

#[derive(Clone)]
struct DiagnosticWriter(Arc<LogStore>);

struct EventWriter {
    store: Arc<LogStore>,
    bytes: Vec<u8>,
    oversized: bool,
}

impl<'a> MakeWriter<'a> for DiagnosticWriter {
    type Writer = EventWriter;
    fn make_writer(&'a self) -> Self::Writer {
        EventWriter {
            store: self.0.clone(),
            bytes: Vec::new(),
            oversized: false,
        }
    }
}

impl Write for EventWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.bytes.len().saturating_add(bytes.len()) > MAX_INPUT_BYTES {
            self.oversized = true;
        }
        if !self.oversized {
            self.bytes.extend_from_slice(bytes);
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for EventWriter {
    fn drop(&mut self) {
        let mut text = if self.oversized {
            "[oversized diagnostic omitted]".to_owned()
        } else {
            sanitize_text(&String::from_utf8_lossy(&self.bytes))
        };
        if !text.ends_with('\n') {
            text.push('\n');
        }
        #[cfg(debug_assertions)]
        let _ = std::io::stdout().write_all(text.as_bytes());
        self.store.append(&text);
    }
}

pub fn init(directory: PathBuf) {
    let store = STORE
        .get_or_init(|| Arc::new(LogStore::new(directory, MAX_FILE_BYTES)))
        .clone();
    let layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(DiagnosticWriter(store))
        .with_filter(tracing_subscriber::filter::filter_fn(|metadata| {
            *metadata.level() <= tracing::Level::INFO
                && (metadata.target().starts_with("sjtu_canvas_helper")
                    || metadata.target() == "frontend_console")
        }));
    let _ = tracing::subscriber::set_global_default(tracing_subscriber::registry().with(layer));
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // The panic payload can be arbitrary data. Source location is sufficient for first triage.
        if let Some(location) = info.location() {
            tracing::error!(target: "sjtu_canvas_helper::diagnostics", file = location.file(), line = location.line(), "Rust panic");
        } else {
            tracing::error!(target: "sjtu_canvas_helper::diagnostics", "Rust panic");
        }
        previous(info);
    }));
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        os = std::env::consts::OS,
        arch = std::env::consts::ARCH,
        "Application starting"
    );
}

pub fn directory() -> io::Result<PathBuf> {
    STORE
        .get()
        .map(|store| store.directory.clone())
        .ok_or_else(|| io::Error::other("日志尚未初始化"))
}

pub fn read_log() -> io::Result<String> {
    let store = STORE
        .get()
        .ok_or_else(|| io::Error::other("日志尚未初始化"))?;
    let (text, truncated, error) = store.snapshot(MAX_REPORT_BYTES)?;
    let mut result = if truncated {
        "[仅显示近期日志，较早内容已截断]\n".to_owned()
    } else {
        String::new()
    };
    if let Some(error) = error {
        result.push_str(&format!("[日志写入不可用：{error}]\n"));
    }
    result.push_str(&text);
    Ok(result)
}

pub fn report() -> String {
    let logs = match read_log() {
        Ok(text) if text.trim().is_empty() => "尚无运行日志，可以只附环境信息反馈问题。".to_owned(),
        Ok(text) => text,
        Err(error) => format!(
            "无法读取日志：{}\n可以只附环境信息反馈问题。",
            sanitize_text(&error.to_string())
        ),
    };
    format!("SJTU Canvas Helper 诊断信息\n\n应用版本：{}\n系统平台：{}\n架构：{}\n运行方式：{}\n构建类型：{}\n导出时间：{}\n日志范围：最近两份日志，最多 256 KiB；各行时间为 UTC\n隐私说明：不包含旧版 app.log、配置文件或课程资料；提交前请检查内容。\n\n近期运行日志\n{}\n",
        env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH,
        if crate::app::App::portable() { "便携版" } else { "普通模式" },
        if cfg!(debug_assertions) { "开发构建" } else { "发布构建" }, chrono::Utc::now().to_rfc3339(), logs)
}

pub fn save_report(path: &Path) -> io::Result<()> {
    if !path.is_absolute()
        || path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| !value.eq_ignore_ascii_case("txt"))
            .unwrap_or(true)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "请选择 .txt 诊断文件的绝对路径",
        ));
    }
    fs::write(path, report())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("canvas-诊断-{}", uuid::Uuid::new_v4())))
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn redacts_credentials_paths_and_signed_urls() {
        protect_secret("standalone-test-credential");
        let cases = [
            ("Authorization: Bearer secret-value", "secret-value"),
            ("{\"api_key\":\"provider-value\"}", "provider-value"),
            (r#"{\"message\":\"{\\\"access_token\\\":\\\"escaped-secret\\\"}\"}"#, "escaped-secret"),
            ("Set-Cookie: session=private-value; HttpOnly", "private-value"),
            ("Bearer standalone-bearer", "standalone-bearer"),
            ("upstream rejected standalone-test-credential", "standalone-test-credential"),
            ("https://user:password@canvas.sjtu.edu.cn/api/v1/courses/123/files/中文.pdf?token=secret#private", "secret"),
            ("failed C:\\Users\\张三\\课程\\作业.pdf", "张三"),
            ("failed file:///mnt/课程/张三.pdf", "张三"),
            ("failed /Volumes/外部磁盘/张三/资料.pdf", "张三"),
            ("HTTPS://canvas.sjtu.edu.cn/files/张三.pdf?download=private", "private"),
            ("contact somebody@example.com", "somebody@example.com"),
        ];
        for (source, secret) in cases {
            assert!(!sanitize_text(source).contains(secret), "{source}");
        }
        assert_eq!(
            sanitize_url(
                "https://user:password@canvas.sjtu.edu.cn/api/v1/courses/123?token=secret"
            ),
            "https://canvas.sjtu.edu.cn/api/v1/courses/_"
        );
        assert!(sanitize_text("转换失败：权限不足 (os error 5)").contains("权限不足"));
        let network =
            sanitize_text("url=https://canvas.sjtu.edu.cn/api/v1/files/123 status=401 error=http");
        assert!(network.contains("https://canvas.sjtu.edu.cn/api/v1/files/_"));
        assert!(network.contains("status=401 error=http"));
        let stack =
            sanitize_text("at render (http://tauri.localhost/assets/index-Ab_12.js:1:1234)");
        assert!(stack.contains("index-Ab_12.js:1:1234"));
        assert!(
            !sanitize_text("http://tauri.localhost/files/张三.pdf?token=secret").contains("张三")
        );
    }

    #[test]
    fn redacts_personal_fields_without_losing_diagnostic_metadata() {
        let raw = r#"{"display_name":"王小明","login_id":"529031234567","user_id":987654,"courseId":13579,"subjName":"数据科学","teacNames":["教师甲","教师乙"],"student_ids":[12345,67890],"status":401,"request_id":"request-7","operation":"ppt_list","step":"schema","code":9}"#;
        let safe = sanitize_text(raw);
        let parsed: serde_json::Value = serde_json::from_str(&safe).unwrap();
        for private in [
            "王小明",
            "529031234567",
            "987654",
            "13579",
            "数据科学",
            "教师甲",
            "教师乙",
            "12345",
            "67890",
        ] {
            assert!(!safe.contains(private), "{safe}");
        }
        assert_eq!(parsed["status"], 401);
        assert_eq!(parsed["request_id"], "request-7");
        assert_eq!(parsed["operation"], "ppt_list");
        assert_eq!(parsed["step"], "schema");
        assert_eq!(parsed["code"], 9);
        assert!(
            sanitize_text(r#"{"name":"TypeError","message":"Failed to fetch","line":12}"#)
                .contains("TypeError")
        );
        assert_eq!(
            sanitize_text("hostname=example.test name_length=8 field=student_name status=200"),
            "hostname=example.test name_length=8 field=student_name status=200"
        );
    }

    #[test]
    fn preserves_name_initials_across_repeated_and_escaped_sanitization() {
        let fields = [
            "name",
            "title",
            "display_name",
            "sortableName",
            "short_name",
            "full_name",
            "realName",
            "nickname",
            "username",
            "author_name",
            "studentName",
            "teacher_name",
            "teacNames",
            "tecName",
            "instructorName",
            "fileName",
            "output_name",
            "saveName",
            "externalTitle",
            "contextName",
            "assignmentName",
            "assignmetName",
            "videoName",
            "videName",
            "classroomName",
            "clroName",
            "organizationName",
            "姓名",
            "教师名",
            "文件名",
            "文件名称",
            "标题",
            "显示名",
            "学生姓名",
            "任课教师姓名",
            "course_name",
            "subjectName",
            "subj_name",
            "courName",
            "teclName",
            "teachingClassName",
            "课程名",
            "课程名称",
            "教学班名称",
        ];
        for field in fields {
            for (name, initial) in [
                ("  高等数学 Advanced Mathematics", "高"),
                ("\nAdvanced Mathematics 高等数学", "A"),
                ("𠀀扩展字符", "𠀀"),
                ("🧪实验课", "🧪"),
                ("高[redacted]", "高"),
            ] {
                let mut raw = serde_json::json!({field: name, "status": 500}).to_string();
                let mut expected = serde_json::json!({
                    field: format!("{initial}{REDACTED}"), "status": 500
                })
                .to_string();
                for _ in 0..3 {
                    assert_eq!(redact_personal_fields(&raw), expected, "{raw}");
                    let safe = sanitize_text(&raw);
                    // Other filters may remove JSON escape sequences resembling local paths.
                    assert_eq!(safe, sanitize_text(&expected), "{raw}");
                    assert!(safe.contains(&format!("{initial}{REDACTED}")));
                    assert!(sanitize_text(&safe).contains(&format!("{initial}{REDACTED}")));
                    raw = serde_json::to_string(&raw).unwrap();
                    expected = serde_json::to_string(&expected).unwrap();
                }
            }
        }
        assert_eq!(
            sanitize_text(r#"{"\u0063ourseName":"\u9ad8等数学","status":500}"#),
            r#"{"\u0063ourseName":"高[redacted]","status":500}"#
        );
    }

    #[test]
    fn keeps_identifiers_and_ambiguous_name_values_fully_hidden() {
        for field in [
            "student_id",
            "course_id",
            "course_code",
            "login_id",
            "user_id",
            "teacher_id",
            "context_code",
            "email",
            "currentAccount",
            "allAccounts",
        ] {
            let raw = serde_json::json!({field: "私人值", "status": 500}).to_string();
            let safe: serde_json::Value = serde_json::from_str(&sanitize_text(&raw)).unwrap();
            assert_eq!(safe[field], REDACTED);
            assert_eq!(safe["status"], 500);
        }
        for value in [
            serde_json::json!(null),
            serde_json::json!(123),
            serde_json::json!(""),
            serde_json::json!("   "),
            serde_json::json!("[redacted]"),
            serde_json::json!("[personal data omitted]"),
            serde_json::json!("\u{001b}private"),
            serde_json::json!("\\private"),
            serde_json::json!("\"private"),
            serde_json::json!("'private"),
        ] {
            let raw = serde_json::json!({"course_name": value, "status": 500}).to_string();
            let safe: serde_json::Value = serde_json::from_str(&sanitize_text(&raw)).unwrap();
            assert_eq!(safe["course_name"], REDACTED);
            assert_eq!(safe["status"], 500);
        }
        for raw in [
            "course_name=高等数学 status=500",
            "course_name=\"高等数学",
            "course_name=Some(\"高等数学\") status=500",
        ] {
            let safe = sanitize_text(raw);
            assert!(!safe.contains('高'), "{safe}");
            assert!(safe.contains(REDACTED));
        }
    }

    #[test]
    fn keeps_name_array_initials_and_hides_other_fields_through_export() {
        let raw = serde_json::json!({
            "name": "高等数学", "display_name": "张三", "title": "Lecture One", "filename": "作业.pdf",
            "teacNames": ["王老师", "Alice", {"name": "李老师", "id": 345, "extra": "private"}],
            "teachers": [{"display_name": "陈老师", "id": 123}, {"name": "Bob", "student_id": 456}],
            "course_names": ["中文课", "English Course"], "student_ids": [789, 901], "status": 500
        });
        let expected = serde_json::json!({
            "name": "高[redacted]", "display_name": "张[redacted]", "title": "L[redacted]", "filename": "作[redacted]",
            "teacNames": ["王[redacted]", "A[redacted]", {"name": "李[redacted]", "id": REDACTED}],
            "teachers": [{"display_name": "陈[redacted]", "id": REDACTED}, {"name": "B[redacted]", "student_id": REDACTED}],
            "course_names": ["中[redacted]", "E[redacted]"], "student_ids": REDACTED, "status": 500
        });
        let mut encoded = raw.to_string();
        let mut encoded_expected = expected.to_string();
        for _ in 0..3 {
            assert_eq!(redact_personal_fields(&encoded), encoded_expected);
            assert_eq!(redact_personal_fields(&encoded_expected), encoded_expected);
            encoded = serde_json::to_string(&encoded).unwrap();
            encoded_expected = serde_json::to_string(&encoded_expected).unwrap();
        }
        let dir = TestDirectory::new();
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(
            dir.0.join(LOG_NAME),
            format!("{}\n", sanitize_text(&raw.to_string())),
        )
        .unwrap();
        let store = LogStore::new(dir.0.clone(), MAX_FILE_BYTES);
        let (snapshot, _, _) = store.snapshot(MAX_REPORT_BYTES).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&snapshot).unwrap(),
            expected
        );
    }

    #[test]
    fn omits_personal_names_used_as_keys_in_name_objects() {
        let raw = serde_json::json!({
            "teachers": {"张三": {"id": 123}, "李四": {"id": 456}},
            "teacher_names": [{"王老师": "private", "display_name": "Alice", "id": 789}],
            "name": {"陈小明": "private", "name": "Bob"}, "status": 500
        })
        .to_string();
        let expected = serde_json::json!({
            "teachers": {}, "teacher_names": [{"display_name": "A[redacted]", "id": REDACTED}],
            "name": {"name": "B[redacted]"}, "status": 500
        });
        let safe = sanitize_text(&raw);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&safe).unwrap(),
            expected
        );
        assert_eq!(sanitize_text(&safe), safe);
    }

    #[test]
    fn bounds_name_collections_and_keeps_existing_redaction_markers() {
        let names = vec!["张三"; 1000];
        let raw = serde_json::json!({"student_names": names}).to_string();
        let safe: serde_json::Value = serde_json::from_str(&sanitize_text(&raw)).unwrap();
        let names = safe["student_names"].as_array().unwrap();
        assert_eq!(names.len(), 31);
        assert!(names[..30].iter().all(|name| name == "张[redacted]"));
        assert_eq!(names[30], "[Items truncated]");
        assert_eq!(sanitize_text(&safe.to_string()), safe.to_string());
        for marker in [
            "[redacted]",
            "[Items truncated]",
            "[Depth limit]",
            "[Node limit]",
            "[Accessor omitted]",
            "[Circular]",
            "[Unserializable value]",
        ] {
            let raw = serde_json::json!({"name": marker}).to_string();
            assert_eq!(sanitize_text(&raw), raw);
        }
    }

    #[test]
    fn redacts_escaped_composite_multiline_and_incomplete_personal_values() {
        let mut encoded = r#"{"\u006eame":"Alice, \"status\":200, 李四","teacher_names":["教师甲","教师乙"],"status":500}"#.to_owned();
        for _ in 0..3 {
            let safe = sanitize_text(&encoded);
            for private in ["Alice", "李四", "教师甲", "教师乙"] {
                assert!(!safe.contains(private), "{safe}");
            }
            assert!(safe.contains("500"), "{safe}");
            encoded = serde_json::to_string(&encoded).unwrap();
        }
        let apostrophe = serde_json::to_string(r"name='O\'Connor' status=200").unwrap();
        let safe = sanitize_text(&apostrophe);
        assert!(!safe.contains("Connor"), "{safe}");
        assert!(safe.contains("200"), "{safe}");
        for raw in [
            "User { display_name: Some(\"Alice, Bob\\nSmith\"), status: 200 }",
            "老师姓名：\"王 小明\" status=200",
            "course_name=\"数据科学\n实验课\" status=200",
            r#"{"teacher_names":[{"name":"教师甲","id":123},{"name":"教师乙","id":456}],"status":200}"#,
        ] {
            let safe = sanitize_text(raw);
            for private in [
                "Alice",
                "Bob",
                "Smith",
                "王 小明",
                "数据科学",
                "实验课",
                "教师甲",
                "教师乙",
                "123",
                "456",
            ] {
                assert!(!safe.contains(private), "{safe}");
            }
            assert!(safe.contains("200"), "{safe}");
        }
        for raw in [
            "姓名：王 小明，课程名：数据科学\n实验课 status=200",
            "{\"name\":\"王小明\nunfinished",
            r#"{"teachers":[{"name":"教师甲"}"#,
        ] {
            let safe = sanitize_text(raw);
            for private in ["王", "小明", "数据科学", "实验课", "unfinished", "教师甲"]
            {
                assert!(!safe.contains(private), "{safe}");
            }
        }
    }

    #[test]
    fn snapshot_redacts_known_multiline_fields_from_existing_logs() {
        let dir = TestDirectory::new();
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(
            dir.0.join(LOG_NAME),
            "course_name=\"数据科学\n实验课\" status=500\n",
        )
        .unwrap();
        let store = LogStore::new(dir.0.clone(), MAX_FILE_BYTES);
        let (snapshot, _, _) = store.snapshot(MAX_REPORT_BYTES).unwrap();
        assert!(!snapshot.contains("数据科学"));
        assert!(!snapshot.contains("实验课"));
        assert!(snapshot.contains("500"));
        fs::write(dir.0.join(LOG_NAME), "name=\"Alice\nBob\"\nstatus=500\n").unwrap();
        let (snapshot, _, _) = store.snapshot(18).unwrap();
        assert!(!snapshot.contains("Alice"));
        assert!(!snapshot.contains("Bob"));
        assert!(snapshot.contains("500"));
        fs::write(
            dir.0.join(LOG_NAME),
            "course_name=\"高等数学\" status=500\n",
        )
        .unwrap();
        let (snapshot, _, _) = store.snapshot(MAX_REPORT_BYTES).unwrap();
        assert!(snapshot.contains("高[redacted]"));
        assert!(!snapshot.contains("等数学"));
        assert!(snapshot.contains("500"));
    }

    #[test]
    fn rotates_and_reads_bounded_complete_utf8_lines_without_legacy_logs() {
        let dir = TestDirectory::new();
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(dir.0.join("app.log"), "legacy-secret").unwrap();
        let store = LogStore::new(dir.0.clone(), 100);
        for index in 0..20 {
            store.append(&format!("{index:02} 中文错误：权限不足\n"));
        }
        assert!(fs::metadata(dir.0.join(LOG_NAME)).unwrap().len() <= 100);
        assert!(fs::metadata(dir.0.join(PREVIOUS_NAME)).unwrap().len() <= 100);
        let (text, truncated, error) = store.snapshot(75).unwrap();
        assert!(truncated);
        assert!(error.is_none());
        assert!(text.contains("19 中文错误：权限不足"));
        assert!(!text.contains('�'));
        assert!(!text.contains("legacy-secret"));
        assert!(text.len() <= 75);
    }

    #[test]
    fn event_writer_sanitizes_across_write_boundaries_and_bounds_large_events() {
        let dir = TestDirectory::new();
        let store = Arc::new(LogStore::new(dir.0.clone(), MAX_FILE_BYTES));
        let writer = DiagnosticWriter(store.clone());
        {
            let mut event = writer.make_writer();
            event.write_all(b"Authorization: Bear").unwrap();
            event.write_all(b"er secret-across-chunks\n").unwrap();
        }
        {
            let mut event = writer.make_writer();
            event.write_all(&vec![b'x'; MAX_INPUT_BYTES + 1]).unwrap();
        }
        let (text, _, _) = store.snapshot(MAX_REPORT_BYTES).unwrap();
        assert!(!text.contains("secret-across-chunks"));
        assert!(text.contains("oversized diagnostic omitted"));
    }

    #[test]
    fn unwritable_log_destination_does_not_panic() {
        let dir = TestDirectory::new();
        fs::write(&dir.0, "not a directory").unwrap();
        let store = LogStore::new(dir.0.clone(), MAX_FILE_BYTES);
        store.append("failure\n");
        assert!(store.state.lock().unwrap().write_error.is_some());
        fs::remove_file(&dir.0).unwrap();
    }

    #[test]
    fn exports_utf8_report_without_logs_and_surfaces_invalid_destinations() {
        let dir = TestDirectory::new();
        fs::create_dir_all(&dir.0).unwrap();
        let path = dir.0.join("问题反馈.txt");
        save_report(&path).unwrap();
        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("应用版本："));
        assert!(text.contains("\n近期运行日志\n"));
        assert!(!text.contains('�'));
        assert!(save_report(Path::new("relative.txt")).is_err());
        assert!(save_report(&dir.0.join("config.json")).is_err());
        assert!(save_report(&dir.0.join("missing").join("report.txt")).is_err());
    }

    #[test]
    fn reopens_after_another_writer_rotates_and_recovers_after_write_failure() {
        let dir = TestDirectory::new();
        let first = LogStore::new(dir.0.clone(), 32);
        let second = LogStore::new(dir.0.clone(), 32);
        first.append("first event\n");
        second.append("second event causes rotation\n");
        first.append("latest event\n");
        assert_eq!(
            fs::read_to_string(dir.0.join(LOG_NAME)).unwrap(),
            "latest event\n"
        );
        assert!(fs::metadata(dir.0.join(PREVIOUS_NAME)).unwrap().len() <= 32);
        fs::remove_dir_all(&dir.0).unwrap();
        fs::write(&dir.0, "not a directory").unwrap();
        first.append("failed\n");
        assert!(first.state.lock().unwrap().write_error.is_some());
        fs::remove_file(&dir.0).unwrap();
        first.append("recovered\n");
        assert_eq!(
            fs::read_to_string(dir.0.join(LOG_NAME)).unwrap(),
            "recovered\n"
        );
        assert!(first.state.lock().unwrap().write_error.is_none());
    }
}
