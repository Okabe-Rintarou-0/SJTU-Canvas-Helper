//! Download arithmetic and publication guards without runtime dependencies.
pub(super) fn content_range(value: &str) -> Option<(u64, u64, u64)> {
    fn number(s: &str) -> Option<u64> {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            None
        } else {
            s.parse().ok()
        }
    }
    let (span, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (first, last) = span.split_once('-')?;
    let (first, last, total) = (number(first)?, number(last)?, number(total)?);
    (first <= last && last < total).then_some((first, last, total))
}
pub(super) fn is_strong_etag(value: &[u8]) -> bool {
    value.len() >= 2
        && value[0] == b'"'
        && value[value.len() - 1] == b'"'
        && value[1..value.len() - 1]
            .iter()
            .all(|&b| b == 0x21 || (0x23..=0x7e).contains(&b) || b >= 0x80)
}
pub(super) fn partitions(size: u64, workers: usize) -> Vec<(u64, u64)> {
    if size == 0 {
        return vec![];
    }
    let workers = (workers.clamp(1, 8) as u64).min(size);
    let width = size / workers;
    (0..workers)
        .map(|i| {
            (
                i * width,
                if i + 1 == workers {
                    size - 1
                } else {
                    (i + 1) * width - 1
                },
            )
        })
        .collect()
}
pub(super) fn request_end(start: u64, end: u64, limit: u64) -> Option<u64> {
    if start > end || limit == 0 {
        None
    } else {
        Some(start.saturating_add(limit - 1).min(end))
    }
}
pub(super) struct StagedDownload {
    path: std::path::PathBuf,
    destination: std::path::PathBuf,
}
impl StagedDownload {
    pub(super) fn create(
        destination: &std::path::Path,
        nonce: &str,
    ) -> std::io::Result<(Self, std::fs::File)> {
        if destination.file_name().is_none() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "missing destination filename",
            ));
        }
        let path = destination.with_file_name(format!(".canvas-{nonce}.part"));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok((
            Self {
                path,
                destination: destination.to_owned(),
            },
            file,
        ))
    }
    pub(super) fn publish(self) -> std::io::Result<()> {
        std::fs::rename(&self.path, &self.destination)
    }
}
impl Drop for StagedDownload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn range_grammar() {
        assert_eq!(content_range("bytes 0-0/1"), Some((0, 0, 1)));
        for s in [
            "bytes */9",
            "bytes 1-0/9",
            "bytes 0-9/9",
            "bytes 0-0/0",
            "bytes 0-0/*",
            "bytes +0-0/1",
            "bytes 0-0/1/2",
            "bytes 0-0/1 ",
            "bytes 0-0/18446744073709551616",
        ] {
            assert_eq!(content_range(s), None);
        }
    }
    #[test]
    fn strong_etag_grammar() {
        for s in [b"\"v1\"".as_slice(), b"\"\"", b"\"!#~\""] {
            assert!(is_strong_etag(s));
        }
        for s in [
            b"W/\"v1\"".as_slice(),
            b"\"v1\", \"v2\"",
            b"\"has space\"",
            b"v1",
            b"\"a\n\"",
        ] {
            assert!(!is_strong_etag(s));
        }
    }
    #[test]
    fn partitions_cover_bytes_once() {
        for size in 0..300 {
            for workers in [0, 1, 2, 8, 64, usize::MAX] {
                let p = partitions(size, workers);
                assert!(p.len() <= 8);
                let mut cursor = 0;
                for (start, end) in p {
                    assert_eq!(start, cursor);
                    assert!(end >= start);
                    cursor = end + 1;
                }
                assert_eq!(cursor, size);
            }
        }
    }
    #[test]
    fn overflow_and_tail() {
        assert_eq!(partitions(u64::MAX, 8).last().unwrap().1, u64::MAX - 1);
        assert_eq!(request_end(9, 9, 4), Some(9));
        assert_eq!(request_end(4, 10, 4), Some(7));
        assert_eq!(
            request_end(u64::MAX - 1, u64::MAX - 1, 4),
            Some(u64::MAX - 1)
        );
        assert_eq!(request_end(0, 1, 0), None);
        assert_eq!(request_end(1, 0, 4), None);
    }
    #[test]
    fn stage_preserves_existing_destination() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!(
            "canvas-stage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let target = dir.join(format!("{}.mp4", "v".repeat(220)));
        std::fs::write(&target, b"original").unwrap();
        let (stage, mut file) = StagedDownload::create(&target, "abort").unwrap();
        file.write_all(b"partial").unwrap();
        drop(file);
        drop(stage);
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        let target2 = dir.join("complete.mp4");
        let (stage, mut file) = StagedDownload::create(&target2, "complete").unwrap();
        file.write_all(b"complete").unwrap();
        file.sync_all().unwrap();
        drop(file);
        assert!(!target2.exists());
        stage.publish().unwrap();
        assert_eq!(std::fs::read(target2).unwrap(), b"complete");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
