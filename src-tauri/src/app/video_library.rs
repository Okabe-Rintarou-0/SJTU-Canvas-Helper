use super::App;
use crate::{
    error::{AppError, Result},
    model::{CanvasVideo, CanvasVideoPPT, LLMChatMessage, VideoInfo, VideoSource},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    sync::Arc,
    path::{Path, PathBuf},
};

fn preferred_subtitles(sub: crate::model::CanvasVideoSubTitleResponseBody, prefer_before: bool) -> Vec<crate::model::CanvasVideoSubTitle> {
    let (preferred, fallback) = if prefer_before {
        (sub.before_assembly_list, sub.after_assembly_list)
    } else {
        (sub.after_assembly_list, sub.before_assembly_list)
    };
    let lines: Vec<_> = preferred.into_iter().filter(|line| !line.res.trim().is_empty()).collect();
    if lines.is_empty() {
        fallback.into_iter().filter(|line| !line.res.trim().is_empty()).collect()
    } else {
        lines
    }
}

#[derive(Clone, Serialize)]
pub struct ExportProgress { pub processed: u64, pub total: u64, pub stage: String }

#[derive(Clone, Deserialize)]
pub struct RecordingRequest {
    pub key: String,
    pub title: String,
    pub candidates: Vec<CanvasVideo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMaterial {
    key: String,
    title: String,
    text: String,
    warnings: Vec<String>,
    srt: String,
    subtitle_available: bool,
    ocr_available: bool,
}

#[derive(Serialize)]
pub struct ExportResult {
    pub paths: Vec<String>,
    pub warnings: Vec<String>,
    pub notes: Vec<String>,
}

fn failure(message: impl Into<String>) -> AppError {
    AppError::VideoDownloadError(message.into())
}
fn safe_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let clean = clean.trim_matches([' ', '.']);
    // Prefix also protects Windows device names such as CON and AUX.
    format!("课堂_{}", if clean.is_empty() { "资料" } else { clean })
}
fn reserve_output(directory: &str, name: &str, extension: &str) -> Result<PathBuf> {
    let dir = Path::new(directory);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(failure("请选择有效的绝对目录"));
    }
    for index in 0..10_000 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!(" ({index})")
        };
        let path = dir.join(format!("{}{suffix}.{extension}", safe_name(name)));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(failure("同名文件过多"))
}

pub fn create_export_directory(directory: &str, course: &str) -> Result<String> {
    let root = Path::new(directory);
    if !root.is_absolute() || !root.is_dir() {
        return Err(failure("请选择有效目录"));
    }
    let path = root.join(safe_name(course));
    fs::create_dir_all(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

impl App {
    async fn recording_infos(
        &self,
        request: &RecordingRequest,
        enrichment: bool,
    ) -> Result<Vec<VideoInfo>> {
        let mut infos = Vec::new();
        let mut errors = Vec::new();
        for candidate in &request.candidates {
            if enrichment && candidate.source == VideoSource::Legacy {
                continue;
            }
            match self
                .get_video_play_info(candidate.source, &candidate.video_id)
                .await
            {
                Ok(info) => infos.push(info),
                Err(e) => errors.push(e.to_string()),
            }
        }
        if infos.is_empty() {
            return Err(failure(if errors.is_empty() {
                "该录像来源不提供此资料".into()
            } else {
                errors.join("；")
            }));
        }
        Ok(infos)
    }

    async fn recording_subtitle(
        &self,
        request: &RecordingRequest,
        prefer_before: bool,
    ) -> Result<Vec<crate::model::CanvasVideoSubTitle>> {
        let mut errors = Vec::new();
        for info in self.recording_infos(request, true).await? {
            match self.client.get_subtitle(info.cour_id).await {
                Ok(sub) => {
                    let lines = preferred_subtitles(sub, prefer_before);
                    if !lines.is_empty() {
                        return Ok(lines);
                    }
                }
                Err(e) => errors.push(e.to_string()),
            }
        }
        Err(failure(format!("字幕不可用：{}", errors.join("；"))))
    }

    async fn recording_slides_raw(&self, request: &RecordingRequest) -> Result<Vec<CanvasVideoPPT>> {
        let mut errors = Vec::new();
        for info in self.recording_infos(request, true).await? {
            match self.client.get_ppt(info.cour_id).await {
                Ok(slides) if !slides.is_empty() => return Ok(slides),
                Ok(_) => {}
                Err(e) => errors.push(e.to_string()),
            }
        }
        Err(failure(format!("PPT 不可用：{}", errors.join("；"))))
    }

    pub async fn prepare_video_material(&self, request: RecordingRequest, prefer_before: bool, include_ocr: bool, clean_up_ppt: Option<bool>) -> Result<VideoMaterial> {
        let enabled = clean_up_ppt.unwrap_or(self.config.read().await.experimental_ppt_cleanup);
        let mut material = VideoMaterial {
            key: request.key.clone(),
            title: request.title.clone(),
            text: format!("## {}\n", request.title),
            warnings: vec![],
            srt: String::new(),
            subtitle_available: false,
            ocr_available: false,
        };
        let (subtitles, slides) = tokio::join!(
            self.recording_subtitle(&request, prefer_before),
            async { if include_ocr { self.recording_slides_raw(&request).await } else { Ok(Vec::new()) } }
        );
        let lines = match subtitles {
                Ok(lines) => {
                    material.subtitle_available = true;
                    material.srt = self.client.convert_to_srt(&lines)?;
                    lines
                }
                Err(e) => { material.warnings.push(format!("{}：{e}", request.title)); Vec::new() }
        };
        let slides = match slides {
            Ok(slides) => slides,
            Err(e) => { material.warnings.push(format!("{}：{e}", request.title)); Vec::new() }
        };
        let (slides, _) = super::ppt::clean_up_slides(slides, enabled);
        let (timeline, ocr_available, untimed) = super::ppt::material_timeline(&request.key, &lines, &slides);
        material.ocr_available = ocr_available;
        if include_ocr && !ocr_available && !slides.is_empty() {
            material.warnings.push(format!("{}：PPT 未提供可用 OCR", request.title));
        }
        if untimed > 0 { material.warnings.push(format!("{}：{untimed} 张 PPT OCR 缺少有效时间，无法定位", request.title)); }
        material.text.push_str(&timeline);
        Ok(material)
    }

    pub async fn chat_video_materials(
        &self,
        text: String,
        messages: Vec<LLMChatMessage>,
        on_chunk: Option<&mut (dyn FnMut(String) + Send)>,
        on_status: &mut (dyn FnMut(String) + Send),
    ) -> Result<String> {
        self.client.chat_video_materials(&text, &messages, on_chunk, on_status).await
    }

    pub async fn export_video_materials(
        &self,
        requests: Vec<RecordingRequest>,
        kind: String,
        directory: String,
        name: String,
        all_tracks: bool,
        progress: Arc<dyn Fn(ExportProgress) + Send + Sync>,
    ) -> Result<ExportResult> {
        let mut result = ExportResult {
            paths: vec![],
            warnings: vec![],
            notes: vec![],
        };
        match kind.as_str() {
            "ppt" => {
                let mut slides = Vec::new();
                let enabled = self.config.read().await.experimental_ppt_cleanup;
                for request in &requests {
                    match self.recording_slides_raw(request).await {
                        Ok(next) => {
                            let (mut next, notes) = super::ppt::clean_up_slides(next, enabled);
                            result.notes.extend(notes.into_iter().map(|note| format!("{}：{note}", request.title)));
                            slides.append(&mut next);
                        }
                        Err(e) => result.warnings.push(format!("{}：{e}", request.title)),
                    }
                }
                if !slides.is_empty() {
                    let suffix = if result.warnings.is_empty() {
                        ""
                    } else {
                        "（部分资料）"
                    };
                    let path = reserve_output(&directory, &format!("{name}{suffix}"), "pdf")?;
                    let report = progress.clone();
                    if let Err(e) = self
                        .client
                        .clone()
                        .download_ppt_pdf(&slides, &path.to_string_lossy(), move |p| report(ExportProgress { processed: p.processed + 1, total: p.total, stage: if p.processed + 1 >= p.total { "正在合并 PDF".into() } else { "正在下载 PPT 切片".into() } }))
                        .await
                    {
                        let _ = fs::remove_file(&path);
                        return Err(e);
                    }
                    result.paths.push(path.to_string_lossy().into_owned());
                }
            }
            "subtitle" | "reading" => {
                let mut reading = String::new();
                for request in &requests {
                    match self.recording_subtitle(request, true).await {
                        Ok(lines) => {
                            if kind == "subtitle" {
                                let path = reserve_output(&directory, &request.title, "srt")?;
                                fs::write(&path, self.client.convert_to_srt(&lines)?)?;
                                result.paths.push(path.to_string_lossy().into_owned());
                            } else {
                                reading.push_str(&format!("\n## {}\n", request.title));
                                for line in lines {
                                    reading.push_str(&format!(
                                        "[{}] {}\n",
                                        crate::utils::time::format_time(line.bg),
                                        line.res
                                    ));
                                }
                            }
                        }
                        Err(e) => result.warnings.push(format!("{}：{e}", request.title)),
                    }
                }
                if kind == "reading" && !reading.is_empty() {
                    let path = reserve_output(&directory, &name, "txt")?;
                    fs::write(
                        &path,
                        format!(
                            "{name}\n时间为各小节内时间。\n{}\n{reading}",
                            result.warnings.join("\n")
                        ),
                    )?;
                    result.paths.push(path.to_string_lossy().into_owned());
                }
            }
            "video" => {
                for request in &requests {
                    let infos = self.recording_infos(request, false).await?;
                    let info = infos
                        .into_iter()
                        .find(|i| !i.video_play_response_vo_list.is_empty())
                        .ok_or_else(|| failure("暂无可下载机位"))?;
                    for (index, track) in info.video_play_response_vo_list.iter().enumerate() {
                        if !all_tracks && index > 0 {
                            break;
                        }
                        let path = reserve_output(
                            &directory,
                            &format!("{} 机位{}", request.title, index + 1),
                            "mp4",
                        )?;
                        let report = progress.clone();
                        let track_count = if all_tracks { info.video_play_response_vo_list.len() } else { 1 };
                        match self
                            .client
                            .clone()
                            .download_video(track, &path.to_string_lossy(), move |p| report(ExportProgress { processed: p.processed, total: p.total, stage: format!("正在下载机位 {}/{track_count}", index + 1) }))
                            .await
                        {
                            Ok(_) => result.paths.push(path.to_string_lossy().into_owned()),
                            Err(e) => {
                                let _ = fs::remove_file(&path);
                                result.warnings.push(format!(
                                    "{} 机位{}：{e}",
                                    request.title,
                                    index + 1
                                ));
                            }
                        }
                    }
                }
            }
            _ => return Err(failure("未知资料类型")),
        }
        if result.paths.is_empty() && !result.notes.is_empty() && result.warnings.is_empty() {
            return Err(failure(format!("没有可导出的 PPT 页面。{}；可关闭“导出 PPT 时去除无用页面”后重试", result.notes.join("；"))));
        }
        if result.paths.is_empty() {
            return Err(failure(result.warnings.join("；")));
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn after_assembly_is_preferred_with_before_fallback() {
        use crate::model::{CanvasVideoSubTitle, CanvasVideoSubTitleResponseBody};
        let before = CanvasVideoSubTitle { bg: 1000, ed: 2000, res: "原始字幕".into(), ..Default::default() };
        let after = CanvasVideoSubTitle { bg: 1000, ed: 6000, res: "整理后的字幕".into(), ..Default::default() };
        let response = CanvasVideoSubTitleResponseBody { before_assembly_list: vec![before.clone()], after_assembly_list: vec![after.clone()] };
        assert_eq!(preferred_subtitles(response, false), vec![after]);
        let response = CanvasVideoSubTitleResponseBody { before_assembly_list: vec![before.clone()], after_assembly_list: vec![CanvasVideoSubTitle { res: " \n".into(), ..Default::default() }] };
        assert_eq!(preferred_subtitles(response, false), vec![before]);
        assert!(preferred_subtitles(Default::default(), false).is_empty());
    }
    #[test]
    fn playback_and_exports_prefer_before_assembly_with_after_fallback() {
        use crate::model::{CanvasVideoSubTitle, CanvasVideoSubTitleResponseBody};
        let before = CanvasVideoSubTitle { bg: 1000, ed: 2000, res: "原始字幕".into(), ..Default::default() };
        let after = CanvasVideoSubTitle { bg: 1000, ed: 6000, res: "整理后的字幕".into(), ..Default::default() };
        let response = CanvasVideoSubTitleResponseBody { before_assembly_list: vec![before.clone()], after_assembly_list: vec![after.clone()] };
        assert_eq!(preferred_subtitles(response, true), vec![before]);
        let response = CanvasVideoSubTitleResponseBody { before_assembly_list: vec![CanvasVideoSubTitle { res: " ".into(), ..Default::default() }], after_assembly_list: vec![after.clone()] };
        assert_eq!(preferred_subtitles(response, true), vec![after]);
        assert!(preferred_subtitles(Default::default(), true).is_empty());
    }
    #[test]
    fn citation_labels_use_seconds_without_srt_milliseconds() {
        assert_eq!(super::super::ppt::citation_time(356), "00:05:56");
        assert_eq!(super::super::ppt::citation_time(3723), "01:02:03");
    }
    #[test]
    fn output_names_cannot_escape_directory() {
        assert_eq!(safe_name("../CON:课/堂"), "课堂__CON_课_堂");
        assert!(!safe_name("中文\\文件").contains('\\'));
    }
    #[test]
    fn reserving_an_output_never_overwrites_existing_files() {
        let directory =
            std::env::temp_dir().join(format!("video-export-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let first = reserve_output(directory.to_str().unwrap(), "课程", "txt").unwrap();
        fs::write(&first, "保留原文").unwrap();
        let second = reserve_output(directory.to_str().unwrap(), "课程", "txt").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(&first).unwrap(), "保留原文");
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
