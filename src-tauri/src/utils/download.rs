//! New outputs share a term/course/type layout; reads also probe legacy paths.
use crate::model::Course;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Component, Path, PathBuf},
    sync::LazyLock,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DownloadCourse {
    pub id: String,
    pub name: String,
    pub term: String,
}

impl From<&Course> for DownloadCourse {
    fn from(course: &Course) -> Self {
        Self {
            id: course.id.to_string(),
            name: course.name.clone(),
            term: course.term.name.clone(),
        }
    }
}

// Canvas and video space label the same term differently. Normalize only a
// recognized academic year/semester; preserve other institution-defined names.
fn term_name(value: &str) -> String {
    static YEARS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(20\d{2})\s*[-_/]\s*(20\d{2})").unwrap());
    static SEMESTER: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"第?\s*([一二三123])\s*学期").unwrap());
    let Some(years) = YEARS.captures(value) else {
        return value.trim().to_owned();
    };
    let suffix = &value[years.get(0).unwrap().end()..];
    let lower = suffix.to_ascii_lowercase();
    let numeric = SEMESTER.captures(suffix).map(|c| c[1].to_owned());
    let tail = suffix.trim().trim_start_matches(['-', '_', '/']).trim();
    let season = if suffix.contains('秋')
        || lower.contains("fall")
        || matches!(numeric.as_deref(), Some("一" | "1"))
        || tail == "1"
    {
        "秋"
    } else if suffix.contains('春')
        || lower.contains("spring")
        || matches!(numeric.as_deref(), Some("二" | "2"))
        || tail == "2"
    {
        "春"
    } else if suffix.contains('夏')
        || lower.contains("summer")
        || matches!(numeric.as_deref(), Some("三" | "3"))
        || tail == "3"
    {
        "夏"
    } else {
        return value.trim().to_owned();
    };
    format!("{}-{} {season}", &years[1], &years[2])
}

pub fn legacy_course_identifier(course: &Course) -> String {
    format!(
        "{}({} {})",
        course.name,
        course.term.name,
        course
            .teachers
            .first()
            .map(|t| t.display_name.as_str())
            .unwrap_or("未知教师")
    )
}

pub fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    if let Some(drive) = text.strip_prefix(r"\\?\") {
        if drive.as_bytes().get(1) == Some(&b':') {
            return drive.into();
        }
    }
    text.into_owned()
}

pub fn safe_name(name: &str) -> String {
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let name = name.trim().trim_end_matches('.');
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if name.is_empty() {
        "未命名".into()
    } else if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        format!("_{name}")
    } else {
        name.into()
    }
}

pub fn relative_path(folder: &str) -> io::Result<PathBuf> {
    let normalized = folder.replace('\\', "/");
    let path = Path::new(&normalized);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
        || normalized.contains(':')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "下载目录必须是相对路径，不能包含上级目录",
        ));
    }
    Ok(path
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(safe_name(&s.to_string_lossy())),
            _ => None,
        })
        .collect())
}

pub fn course_directory(root: &Path, course: &DownloadCourse) -> PathBuf {
    let term = term_name(&course.term);
    root.join(if term.is_empty() {
        "未知学期".into()
    } else {
        safe_name(&term)
    })
    .join(format!(
        "{} [{}]",
        safe_name(&course.name),
        safe_name(&course.id)
    ))
}

pub fn course_file_path(
    root: &Path,
    course: &Course,
    folder: &str,
    name: &str,
) -> io::Result<PathBuf> {
    let folder = relative_path(folder)?;
    let name = safe_name(name);
    let current = course_directory(root, &DownloadCourse::from(course))
        .join("课件")
        .join(&folder)
        .join(&name);
    if current.is_file() {
        return Ok(current);
    }
    let legacy = safe_name(&legacy_course_identifier(course));
    for base in [root.join("课程文件").join(&legacy), root.join(&legacy)] {
        let old = base.join(&folder).join(&name);
        if old.is_file() {
            return Ok(old);
        }
    }
    Ok(current)
}

pub fn directory(root: &Path, kind: &str, course: Option<&DownloadCourse>) -> io::Result<PathBuf> {
    if !root.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "请设置下载目录的绝对路径",
        ));
    }
    if kind == "root" {
        fs::create_dir_all(root)?;
        return Ok(root.to_path_buf());
    }
    let name = match kind {
        "file" | "ppt" => "课件",
        "attachment" => "附件",
        "video" => "视频",
        "subtitle" | "reading" => "字幕",
        "export" => "导出",
        _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, "未知下载类型")),
    };
    let base = course.map_or_else(
        || root.join("其他文件"),
        |course| course_directory(root, course),
    );
    let path = base.join(name);
    fs::create_dir_all(&path)?;
    Ok(path)
}

pub fn existing_file(
    root: &Path,
    name: &str,
    kind: &str,
    course: Option<&DownloadCourse>,
) -> PathBuf {
    let name = safe_name(name);
    let folder = match kind {
        "video" | "ppt" | "subtitle" | "reading" => "视频",
        "export" => "导出",
        _ => "附件",
    };
    let type_name = match kind {
        "file" | "ppt" => "课件",
        "subtitle" | "reading" => "字幕",
        _ => folder,
    };
    let base = course.map_or_else(
        || root.join("其他文件"),
        |course| course_directory(root, course),
    );
    let current = base.join(type_name).join(&name);
    for path in [
        current.clone(),
        root.join(folder).join(&name),
        root.join(&name),
    ] {
        if path.is_file() {
            return path;
        }
    }
    current
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn friendly_windows_paths() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\目录\app-data")),
            r"C:\目录\app-data"
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share\数据")),
            r"\\server\share\数据"
        );
        assert_eq!(display_path(Path::new("/tmp/data")), "/tmp/data");
    }
    #[test]
    fn validate_remote_names() {
        assert!(relative_path("../outside").is_err());
        assert!(relative_path(r"C:\outside").is_err());
        assert!(relative_path("/outside").is_err());
        assert_eq!(
            relative_path(r"第一章\练习").unwrap(),
            Path::new("第一章").join("练习")
        );
        assert_eq!(safe_name("CON.txt"), "_CON.txt");
        assert_eq!(safe_name("老师/课程:一"), "老师_课程_一");
    }
    #[test]
    fn shares_layout_with_legacy_course_and_file_lookup() {
        let root = std::env::temp_dir().join(format!("canvas-layout-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let mut course = Course {
            id: 10,
            name: "数学".into(),
            ..Default::default()
        };
        course.term.name = "2026-2027 第一学期".into();
        let context = DownloadCourse::from(&course);
        let current = directory(&root, "file", Some(&context)).unwrap();
        assert_eq!(current, root.join("2026-2027 秋/数学 [10]/课件"));
        assert_eq!(
            directory(&root, "video", Some(&context)).unwrap(),
            root.join("2026-2027 秋/数学 [10]/视频")
        );
        let legacy = root
            .join(safe_name(&legacy_course_identifier(&course)))
            .join("第一章");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("旧课件.pdf"), "legacy").unwrap();
        assert_eq!(
            course_file_path(&root, &course, "第一章", "旧课件.pdf").unwrap(),
            legacy.join("旧课件.pdf")
        );
        // A newly created course directory must not hide files in either legacy layout.
        let categorized = root
            .join("课程文件")
            .join(safe_name(&legacy_course_identifier(&course)))
            .join("第一章");
        fs::create_dir_all(&categorized).unwrap();
        fs::write(categorized.join("另一份.pdf"), "legacy").unwrap();
        assert_eq!(
            course_file_path(&root, &course, "第一章", "另一份.pdf").unwrap(),
            categorized.join("另一份.pdf")
        );
        fs::write(current.join("新课件.pdf"), "new").unwrap();
        assert_eq!(
            course_file_path(&root, &course, "", "新课件.pdf").unwrap(),
            current.join("新课件.pdf")
        );
        assert!(course_file_path(&root, &course, "../outside", "test").is_err());
        fs::write(root.join("旧字幕.srt"), "legacy").unwrap();
        assert_eq!(
            existing_file(&root, "旧字幕.srt", "video", Some(&context)),
            root.join("旧字幕.srt")
        );
        let attachments = directory(&root, "attachment", None).unwrap();
        let videos = directory(&root, "video", None).unwrap();
        fs::write(attachments.join("同名.mp4"), "attachment").unwrap();
        fs::write(videos.join("同名.mp4"), "video").unwrap();
        assert_eq!(
            existing_file(&root, "同名.mp4", "video", None),
            videos.join("同名.mp4")
        );
        assert_eq!(
            existing_file(&root, "同名.mp4", "attachment", None),
            attachments.join("同名.mp4")
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn term_aliases_and_course_identities_share_one_layout_without_collisions() {
        let root = std::env::temp_dir();
        let course = DownloadCourse {
            id: "10".into(),
            name: "数学".into(),
            term: "2026-2027 秋".into(),
        };
        let canonical = course_directory(&root, &course);
        for alias in [
            "2026-2027学年第一学期",
            "2026/2027-1",
            "2026-2027 Fall",
            "2026-2027 秋季学期",
        ] {
            assert_eq!(
                course_directory(
                    &root,
                    &DownloadCourse {
                        term: alias.into(),
                        ..course.clone()
                    }
                ),
                canonical
            );
        }
        assert_ne!(
            course_directory(
                &root,
                &DownloadCourse {
                    id: "11".into(),
                    ..course.clone()
                }
            ),
            canonical
        );
        assert_ne!(
            course_directory(
                &root,
                &DownloadCourse {
                    term: "2026-2027 春".into(),
                    ..course.clone()
                }
            ),
            canonical
        );
        assert!(course_directory(
            &root,
            &DownloadCourse {
                id: "../a".into(),
                name: "../数学".into(),
                term: "../学期".into()
            }
        )
        .starts_with(&root));
    }
}
