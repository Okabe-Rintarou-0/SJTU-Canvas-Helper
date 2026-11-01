use futures::{stream, StreamExt};
use std::time::Duration;

use super::App;
use crate::{
    error::Result,
    model::{File, QRCodeScanReport, QRCodeScanResult},
    utils::qrcode::decode_image,
};

const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;

fn is_image_file(file: &File) -> bool {
    file.content_type.to_ascii_lowercase().starts_with("image/")
        || [&file.filename, &file.display_name].iter().any(|name| {
            matches!(
                name.rsplit('.')
                    .next()
                    .unwrap_or_default()
                    .to_ascii_lowercase()
                    .as_str(),
                "jpg"
                    | "jpeg"
                    | "png"
                    | "gif"
                    | "webp"
                    | "bmp"
                    | "tif"
                    | "tiff"
                    | "ico"
                    | "pnm"
                    | "tga"
                    | "qoi"
            )
        })
}

async fn scan_file(client: reqwest::Client, file: File) -> Result<QRCodeScanResult> {
    let too_large = || std::io::Error::other("QR image exceeds the 32 MiB scan limit");
    if file.size > MAX_IMAGE_BYTES as u64 {
        return Err(too_large().into());
    }
    // Canvas file URLs include their own download verifier. Do not send the account token to a CDN.
    let mut response = client.get(&file.url).send().await?.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_IMAGE_BYTES as u64)
    {
        return Err(too_large().into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > MAX_IMAGE_BYTES - bytes.len() {
            return Err(too_large().into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let contents = tokio::task::spawn_blocking(move || decode_image(&bytes)).await??;
    Ok(QRCodeScanResult { file, contents })
}

impl App {
    pub async fn scan_course_qrcodes(&self, course_id: i64) -> Result<QRCodeScanReport> {
        // MIME filters can miss files uploaded with an incorrect content type.
        let files = self.list_course_files(course_id).await?;
        let mut report = QRCodeScanReport {
            total_files: files.len(),
            ..Default::default()
        };
        let images: Vec<_> = files.into_iter().filter(is_image_file).collect();
        report.image_files = images.len();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;
        let mut scans = stream::iter(images)
            .map(|file| {
                let client = client.clone();
                async move {
                    let id = file.id;
                    (id, scan_file(client, file).await)
                }
            })
            .buffer_unordered(4);
        while let Some((file_id, scan)) = scans.next().await {
            match scan {
                Ok(result) => {
                    report.scanned_images += 1;
                    if !result.contents.is_empty() {
                        report.results.push(result);
                    }
                }
                Err(_) => {
                    report.failed_images += 1;
                    tracing::warn!(
                        file_id,
                        "Course QR image could not be downloaded or decoded"
                    );
                }
            }
        }
        report.results.sort_by(|a, b| {
            a.file
                .display_name
                .cmp(&b.file.display_name)
                .then(a.file.id.cmp(&b.file.id))
        });
        Ok(report)
    }

    // Keep the original command usable for existing callers.
    pub async fn filter_course_qrcode_images(
        &self,
        course_id: i64,
    ) -> Result<Vec<QRCodeScanResult>> {
        Ok(self.scan_course_qrcodes(course_id).await?.results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_uppercase_extensions_and_image_mime_types() {
        assert!(is_image_file(&File {
            display_name: "QR.JPG".into(),
            ..Default::default()
        }));
        assert!(is_image_file(&File {
            content_type: "image/webp".into(),
            ..Default::default()
        }));
        assert!(is_image_file(&File {
            filename: "qr.PNG".into(),
            content_type: "application/octet-stream".into(),
            ..Default::default()
        }));
        assert!(!is_image_file(&File {
            display_name: "lecture.pdf".into(),
            ..Default::default()
        }));
    }
}
