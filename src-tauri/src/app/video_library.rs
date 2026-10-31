use super::App;
use crate::{
    error::{AppError, Result},
    model::{
        CanvasVideo, CanvasVideoPPT, LLMChatMessage, VideoChatResponse, VideoInfo,
        VideoPreparedContext, VideoSource, VideoSummaryOptions,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

fn preferred_subtitles(
    sub: crate::model::CanvasVideoSubTitleResponseBody,
    prefer_before: bool,
) -> Vec<crate::model::CanvasVideoSubTitle> {
    let (preferred, fallback) = if prefer_before {
        (sub.before_assembly_list, sub.after_assembly_list)
    } else {
        (sub.after_assembly_list, sub.before_assembly_list)
    };
    let usable =
        |line: &crate::model::CanvasVideoSubTitle| !line.res.trim().is_empty() && line.ed > line.bg;
    let lines: Vec<_> = preferred.into_iter().filter(usable).collect();
    if lines.is_empty() {
        fallback.into_iter().filter(usable).collect()
    } else {
        lines
    }
}

#[derive(Clone, Serialize)]
pub struct ExportProgress {
    pub processed: u64,
    pub total: u64,
    pub stage: String,
}

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
    summary_subtitle_available: bool,
    ocr_available: bool,
    transcript_available: bool,
    proofread_available: bool,
    subtitle_source: Option<&'static str>,
}

#[derive(Serialize)]
pub struct ProofreadVideoResult {
    material: VideoMaterial,
    report: crate::client::subtitle_proofread::ProofreadResult,
    track: VideoSubtitleTrack,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSubtitleTrack {
    source: &'static str,
    srt: String,
    full_srt: String,
    chatter_count: usize,
}

#[derive(Serialize)]
pub struct VideoSubtitleVersions {
    tracks: Vec<VideoSubtitleTrack>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoRecordingStatus {
    subtitle_available: bool,
    transcript_available: bool,
}

struct SelectedSubtitles {
    lines: Vec<crate::model::CanvasVideoSubTitle>,
    summary: Vec<crate::model::CanvasVideoSubTitle>,
    display: Vec<crate::model::CanvasVideoSubTitle>,
    warnings: Vec<String>,
    proofread: bool,
    canvas_optimized: bool,
}

impl SelectedSubtitles {
    fn refined(
        report: crate::client::subtitle_proofread::ProofreadResult,
        warnings: Vec<String>,
    ) -> Self {
        Self {
            display: crate::client::subtitle_proofread::playback_subtitles(&report, false),
            summary: crate::client::subtitle_proofread::summary_subtitles(
                &report.lines,
                &report.exclude_from_summary,
            ),
            lines: report.lines,
            warnings,
            proofread: true,
            canvas_optimized: false,
        }
    }
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
    pub async fn get_video_subtitle_versions(
        &self,
        request: RecordingRequest,
    ) -> Result<VideoSubtitleVersions> {
        use crate::client::subtitle_proofread::{display_subtitles, playback_subtitles};
        let account = self.video_data_account().await?;
        let mut errors = Vec::new();
        let mut warnings = Vec::new();
        for id in recording_material_ids(&request) {
            let (subtitles, optimized) = match self.client.get_subtitle_with_source(id).await {
                Ok(value) => value,
                Err(error) => {
                    errors.push(error.to_string());
                    continue;
                }
            };
            let selected = preferred_subtitles(subtitles.clone(), true);
            let original = if optimized {
                match self.client.get_original_subtitle(id).await {
                    Ok(original) => preferred_subtitles(original, true),
                    Err(error) => {
                        warnings.push(format!("原始字幕读取失败：{error}"));
                        Vec::new()
                    }
                }
            } else {
                selected.clone()
            };
            let mut tracks = Vec::new();
            if optimized && !selected.is_empty() {
                let srt = self.client.convert_to_srt(&selected)?;
                tracks.push(VideoSubtitleTrack {
                    source: "canvasAi",
                    full_srt: srt.clone(),
                    srt,
                    chatter_count: 0,
                });
            }
            if !original.is_empty() {
                let report = match self
                    .saved_video_proofread(&account, &request.key, &original)
                    .await
                {
                    Ok(Some(report)) => Some(report),
                    Ok(None) => self.client.cached_proofread_subtitles(&original).await,
                    Err(error) => {
                        warnings.push(format!("本地精校读取失败：{error}"));
                        None
                    }
                };
                if let Some(report) = report {
                    tracks.push(VideoSubtitleTrack {
                        source: "local",
                        srt: self
                            .client
                            .convert_to_srt(&playback_subtitles(&report, false))?,
                        full_srt: self
                            .client
                            .convert_to_srt(&display_subtitles(&report.lines, &report.join_next))?,
                        chatter_count: report.exclude_from_summary.len(),
                    });
                }
                let srt = self.client.convert_to_srt(&original)?;
                tracks.push(VideoSubtitleTrack {
                    source: "canvas",
                    full_srt: srt.clone(),
                    srt,
                    chatter_count: 0,
                });
            }
            if !tracks.is_empty() {
                return Ok(VideoSubtitleVersions { tracks, warnings });
            }
        }
        if !errors.is_empty() {
            return Err(failure(errors.join("；")));
        }
        Ok(VideoSubtitleVersions {
            tracks: Vec::new(),
            warnings,
        })
    }

    pub async fn inspect_video_recording(
        &self,
        request: RecordingRequest,
    ) -> Result<VideoRecordingStatus> {
        let versions = self.get_video_subtitle_versions(request.clone()).await?;
        let account = self.video_data_account().await?;
        Ok(VideoRecordingStatus {
            subtitle_available: !versions.tracks.is_empty(),
            transcript_available: self
                .saved_video_transcript(&account, &request)
                .await?
                .is_some(),
        })
    }
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
    ) -> Result<SelectedSubtitles> {
        self.recording_subtitle_version(request, prefer_before, true)
            .await
    }

    async fn recording_subtitle_version(
        &self,
        request: &RecordingRequest,
        prefer_before: bool,
        use_local: bool,
    ) -> Result<SelectedSubtitles> {
        if request.candidates.is_empty() {
            return Err(failure("该录像来源不提供此资料"));
        }
        let account = self.video_data_account().await?;
        let mut errors = Vec::new();
        for id in recording_material_ids(request) {
            match self.client.get_subtitle_with_source(id).await {
                Ok((sub, canvas_optimized)) => {
                    let mut warnings = Vec::new();
                    if use_local && !canvas_optimized {
                        let fine = preferred_subtitles(sub.clone(), true);
                        match self
                            .saved_video_proofread(&account, &request.key, &fine)
                            .await
                        {
                            Ok(Some(report)) => {
                                return Ok(SelectedSubtitles::refined(report, warnings))
                            }
                            Ok(None) => {
                                if let Some(report) =
                                    self.client.cached_proofread_subtitles(&fine).await
                                {
                                    warnings.push("精校成果目前仅保留在内存，本地尚未保存".into());
                                    return Ok(SelectedSubtitles::refined(report, warnings));
                                }
                            }
                            Err(error) => warnings
                                .push(format!("本地精校读取失败：{error}；继续使用Canvas字幕")),
                        }
                    }
                    let lines = preferred_subtitles(sub, prefer_before);
                    if !lines.is_empty() {
                        return Ok(SelectedSubtitles {
                            display: lines.clone(),
                            summary: lines.clone(),
                            lines,
                            warnings,
                            proofread: false,
                            canvas_optimized,
                        });
                    }
                }
                Err(e) => errors.push(e.to_string()),
            }
        }
        if !errors.is_empty() {
            return Err(failure(format!("字幕读取失败：{}", errors.join("；"))));
        }
        Ok(SelectedSubtitles {
            lines: vec![],
            summary: vec![],
            display: vec![],
            warnings: vec![],
            proofread: false,
            canvas_optimized: false,
        })
    }

    async fn recording_slides_raw(
        &self,
        request: &RecordingRequest,
    ) -> Result<Vec<CanvasVideoPPT>> {
        if request.candidates.is_empty() {
            return Err(failure("该录像来源不提供此资料"));
        }
        let mut errors = Vec::new();
        for id in recording_material_ids(request) {
            match self.client.get_ppt(id).await {
                Ok(slides) if !slides.is_empty() => return Ok(slides),
                Ok(_) => {}
                Err(e) => errors.push(e.to_string()),
            }
        }
        if !errors.is_empty() {
            return Err(failure(format!("课件读取失败：{}", errors.join("；"))));
        }
        Ok(Vec::new())
    }

    pub async fn prepare_video_material(
        &self,
        request: RecordingRequest,
        prefer_before: bool,
        include_ocr: bool,
        clean_up_ppt: Option<bool>,
    ) -> Result<VideoMaterial> {
        let enabled = clean_up_ppt.unwrap_or(self.config.read().await.experimental_ppt_cleanup);
        let mut material = VideoMaterial {
            key: request.key.clone(),
            title: request.title.clone(),
            text: format!("## {}\n", request.title),
            warnings: vec![],
            srt: String::new(),
            subtitle_available: false,
            summary_subtitle_available: false,
            ocr_available: false,
            transcript_available: false,
            proofread_available: false,
            subtitle_source: None,
        };
        let (subtitles, slides) =
            tokio::join!(self.recording_subtitle(&request, prefer_before), async {
                if include_ocr {
                    self.recording_slides_raw(&request).await
                } else {
                    Ok(Vec::new())
                }
            });
        let lines = match subtitles {
            Ok(selected) => {
                material.proofread_available = selected.proofread;
                material.subtitle_source = Some(if selected.canvas_optimized {
                    "canvasAi"
                } else if selected.proofread {
                    "local"
                } else {
                    "canvas"
                });
                material.subtitle_available = !selected.lines.is_empty();
                material.summary_subtitle_available = !selected.summary.is_empty();
                material.srt = self.client.convert_to_srt(&selected.display)?;
                material.warnings.extend(selected.warnings);
                selected.summary
            }
            Err(e) => {
                material.warnings.push(format!("{}：{e}", request.title));
                Vec::new()
            }
        };
        let slides = match slides {
            Ok(slides) => slides,
            Err(e) => {
                material.warnings.push(format!("{}：{e}", request.title));
                Vec::new()
            }
        };
        let (slides, _) = super::ppt::clean_up_slides(slides, enabled);
        let (timeline, ocr_available, untimed) =
            super::ppt::material_timeline(&request.key, &lines, &slides);
        material.ocr_available = ocr_available;
        if include_ocr && !ocr_available && !slides.is_empty() {
            material
                .warnings
                .push(format!("{}：PPT 未提供可用 OCR", request.title));
        }
        if untimed > 0 {
            material.warnings.push(format!(
                "{}：{untimed} 张 PPT OCR 缺少有效时间，无法定位",
                request.title
            ));
        }
        material.text.push_str(&timeline);
        if include_ocr && !material.subtitle_available {
            let account = self.video_data_account().await?;
            match self.saved_video_transcript(&account, &request).await {
                Ok(Some(text)) => {
                    material
                        .text
                        .push_str(&untimed_transcript_material(&request, &text).text);
                    material.transcript_available = true;
                }
                Ok(None) => {}
                Err(error) => material.warnings.push(format!("本地转录读取失败：{error}")),
            }
        }
        Ok(material)
    }

    pub async fn transcribe_video_material(
        &self,
        request: RecordingRequest,
        on_status: &(dyn Fn(String) + Send + Sync),
    ) -> Result<VideoMaterial> {
        let account = self.video_data_account().await?;
        if let Some(text) = self.saved_video_transcript(&account, &request).await? {
            on_status("已读取本地保存的音视频转录".into());
            return Ok(untimed_transcript_material(&request, &text));
        }
        // Camera angles share the same audio. Resolve only until one usable
        // angle is found, then extract it once; do not retry entire other angles.
        let mut audio_url = None;
        let mut errors = Vec::new();
        for candidate in &request.candidates {
            match self
                .get_video_play_info(candidate.source, &candidate.video_id)
                .await
            {
                Ok(info) => {
                    audio_url = first_audio_url(&info);
                    if audio_url.is_some() {
                        break;
                    }
                }
                Err(error) => errors.push(error.to_string()),
            }
        }
        let audio_url = audio_url.ok_or_else(|| {
            failure(if errors.is_empty() {
                "播放信息未返回可用媒体地址，请刷新录像后重试".into()
            } else {
                format!("读取录像播放信息失败：{}", errors.join("；"))
            })
        })?;
        let text = self
            .client
            .transcribe_recording_audio(&request.key, &audio_url, on_status)
            .await?;
        let mut material = untimed_transcript_material(&request, &text);
        if let Err(error) = self.save_video_transcript(&account, &request, text).await {
            material
                .warnings
                .push(format!("转录已完成，但本地保存失败：{error}"));
        }
        Ok(material)
    }

    pub async fn proofread_video_subtitles(
        &self,
        request: RecordingRequest,
        on_status: &(dyn Fn(String) + Send + Sync),
    ) -> Result<ProofreadVideoResult> {
        let generation = self.client.subtitle_proofread_generation().await;
        let account = self.video_data_account().await?;
        on_status("正在读取 Canvas 优先版本字幕".into());
        let selected = self
            .recording_subtitle_version(&request, true, false)
            .await?;
        if selected.canvas_optimized {
            return Err(failure("已采用 Canvas AI+ 字幕，无需再次精校"));
        }
        let lines = selected.lines;
        if lines.is_empty() {
            return Err(failure("暂无可精校的字幕"));
        }
        let options = crate::model::VideoProofreadOptions::from(&*self.config.read().await);
        let identity = crate::client::subtitle_proofread::config_hash(
            &self.client.llm_snapshot().await?,
            &options,
        );
        let saved = self
            .saved_video_proofread(&account, &request.key, &lines)
            .await?;
        let (report, from_disk) = if let Some(report) = saved.filter(|r| r.config_hash == identity)
        {
            (report, true)
        } else {
            (
                self.client
                    .proofread_subtitles(&request.title, &lines, on_status, generation, &options)
                    .await?,
                false,
            )
        };
        let mut warnings = Vec::new();
        if !from_disk {
            if let Err(error) = self
                .save_video_proofread(&account, &request.key, lines, &report)
                .await
            {
                warnings.push(format!("精校已完成，但本地保存失败：{error}"));
            }
        }
        let summary = crate::client::subtitle_proofread::summary_subtitles(
            &report.lines,
            &report.exclude_from_summary,
        );
        let (timeline, _, _) = super::ppt::material_timeline(&request.key, &summary, &[]);
        let track = VideoSubtitleTrack {
            source: "local",
            srt: self.client.convert_to_srt(
                &crate::client::subtitle_proofread::playback_subtitles(&report, false),
            )?,
            full_srt: self.client.convert_to_srt(
                &crate::client::subtitle_proofread::display_subtitles(
                    &report.lines,
                    &report.join_next,
                ),
            )?,
            chatter_count: report.exclude_from_summary.len(),
        };
        let material = VideoMaterial {
            key: request.key,
            title: request.title.clone(),
            text: format!("## {}\n{timeline}", request.title),
            warnings,
            srt: track.srt.clone(),
            subtitle_available: true,
            summary_subtitle_available: !summary.is_empty(),
            ocr_available: false,
            transcript_available: false,
            proofread_available: true,
            subtitle_source: Some("local"),
        };
        Ok(ProofreadVideoResult {
            material,
            report,
            track,
        })
    }

    pub async fn reset_video_subtitle_proofread(
        &self,
        request: RecordingRequest,
    ) -> Result<VideoMaterial> {
        let account = self.video_data_account().await?;
        let selected = self
            .recording_subtitle_version(&request, true, false)
            .await?;
        let canvas_optimized = selected.canvas_optimized;
        let lines = selected.lines;
        self.remove_video_proofread(&account, &request.key, &lines)
            .await?;
        let (timeline, _, _) = super::ppt::material_timeline(&request.key, &lines, &[]);
        Ok(VideoMaterial {
            key: request.key,
            title: request.title.clone(),
            text: format!("## {}\n{timeline}", request.title),
            warnings: vec![],
            srt: self.client.convert_to_srt(&lines)?,
            subtitle_available: true,
            summary_subtitle_available: !lines.is_empty(),
            ocr_available: false,
            transcript_available: false,
            proofread_available: false,
            subtitle_source: Some(if canvas_optimized {
                "canvasAi"
            } else {
                "canvas"
            }),
        })
    }

    pub async fn chat_video_materials(
        &self,
        text: String,
        messages: Vec<LLMChatMessage>,
        options: Option<VideoSummaryOptions>,
        prepared_context: Option<VideoPreparedContext>,
        on_chunk: Option<&mut (dyn FnMut(String) + Send)>,
        on_status: &mut (dyn FnMut(String) + Send),
    ) -> Result<VideoChatResponse> {
        let options = match options {
            Some(options) => options,
            None => {
                let config = self.config.read().await;
                VideoSummaryOptions {
                    prompt: config.video_summary_prompt.clone(),
                    context_tokens: config.video_summary_context_tokens,
                    output_tokens: config.video_summary_output_tokens,
                }
            }
        };
        self.client
            .chat_video_materials(
                &text,
                &messages,
                &options,
                prepared_context,
                on_chunk,
                on_status,
            )
            .await
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
        let output = self.download_output().await?;
        let mut result = ExportResult {
            paths: vec![],
            warnings: vec![],
            notes: vec![],
        };
        // Errors are logged when serialized; keep recording titles in user-facing exports only.
        let mut error_notes = Vec::new();
        let mut error_warnings = Vec::new();
        match kind.as_str() {
            "ppt" => {
                let mut slides = Vec::new();
                let enabled = self.config.read().await.experimental_ppt_cleanup;
                for (request_index, request) in requests.iter().enumerate() {
                    match self.recording_slides_raw(request).await {
                        Ok(next) if next.is_empty() => {
                            error_warnings.push(format!("第 {} 小节：暂无课件", request_index + 1));
                            result.warnings.push(format!("{}：暂无课件", request.title));
                        }
                        Ok(next) => {
                            let (mut next, notes) = super::ppt::clean_up_slides(next, enabled);
                            error_notes.extend(
                                notes
                                    .iter()
                                    .map(|note| format!("第 {} 小节：{note}", request_index + 1)),
                            );
                            result.notes.extend(
                                notes
                                    .into_iter()
                                    .map(|note| format!("{}：{note}", request.title)),
                            );
                            slides.append(&mut next);
                        }
                        Err(e) => {
                            error_warnings.push(format!("第 {} 小节：{e}", request_index + 1));
                            result.warnings.push(format!("{}：{e}", request.title));
                        }
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
                        .download_ppt_pdf(&slides, &path.to_string_lossy(), move |p| {
                            report(ExportProgress {
                                processed: p.processed + 1,
                                total: p.total,
                                stage: if p.processed + 1 >= p.total {
                                    "正在合并 PDF".into()
                                } else {
                                    "正在下载 PPT 切片".into()
                                },
                            })
                        })
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
                for (request_index, request) in requests.iter().enumerate() {
                    match self.recording_subtitle(request, true).await {
                        Ok(selected) if selected.lines.is_empty() => {
                            error_warnings.push(format!("第 {} 小节：暂无字幕", request_index + 1));
                            result.warnings.push(format!("{}：暂无字幕", request.title));
                        }
                        Ok(selected) => {
                            result.warnings.extend(selected.warnings);
                            if kind == "subtitle" {
                                let path = reserve_output(&directory, &request.title, "srt")?;
                                fs::write(&path, self.client.convert_to_srt(&selected.display)?)?;
                                result.paths.push(path.to_string_lossy().into_owned());
                            } else {
                                reading.push_str(&format!("\n## {}\n", request.title));
                                for line in selected.lines {
                                    reading.push_str(&format!(
                                        "[{}] {}\n",
                                        crate::utils::time::format_time(line.bg),
                                        line.res
                                    ));
                                }
                            }
                        }
                        Err(e) => {
                            error_warnings.push(format!("第 {} 小节：{e}", request_index + 1));
                            result.warnings.push(format!("{}：{e}", request.title));
                        }
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
                for (request_index, request) in requests.iter().enumerate() {
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
                        let track_count = if all_tracks {
                            info.video_play_response_vo_list.len()
                        } else {
                            1
                        };
                        match self
                            .client
                            .clone()
                            .download_video(track, &path.to_string_lossy(), move |p| {
                                report(ExportProgress {
                                    processed: p.processed,
                                    total: p.total,
                                    stage: format!("正在下载机位 {}/{track_count}", index + 1),
                                })
                            })
                            .await
                        {
                            Ok(_) => result.paths.push(path.to_string_lossy().into_owned()),
                            Err(e) => {
                                let _ = fs::remove_file(&path);
                                error_warnings.push(format!(
                                    "第 {} 小节 机位{}：{e}",
                                    request_index + 1,
                                    index + 1
                                ));
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
            return Err(failure(format!(
                "没有可导出的 PPT 页面。{}；可关闭“导出 PPT 时去除无用页面”后重试",
                error_notes.join("；")
            )));
        }
        if result.paths.is_empty() {
            return Err(failure(error_warnings.join("；")));
        }
        for path in &result.paths {
            output.register(Path::new(path)).await?;
        }
        Ok(result)
    }
}

fn first_audio_url(info: &VideoInfo) -> Option<String> {
    info.video_play_response_vo_list
        .iter()
        .map(|track| track.rtmp_url_hdv.trim())
        .find(|url| !url.is_empty())
        .map(str::to_owned)
}

// Transcript/PPT APIs use the recording id from the modern list. Their
// availability does not depend on the VOD playback-details endpoint.
fn recording_material_ids(request: &RecordingRequest) -> Vec<i64> {
    let mut ids = Vec::new();
    for candidate in &request.candidates {
        if candidate.source == VideoSource::Legacy {
            continue;
        }
        if let Ok(id) = candidate.video_id.parse::<i64>() {
            if id > 0 && !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

fn untimed_transcript_material(request: &RecordingRequest, text: &str) -> VideoMaterial {
    VideoMaterial {
        key: request.key.clone(),
        title: request.title.clone(),
        text: format!(
            "## {}\n### 校内 AI 音视频转录（无时间戳，仅供总结；不能据此生成视频跳转引用）\n{}\n",
            request.title, text
        ),
        warnings: vec![],
        srt: String::new(),
        subtitle_available: false,
        ocr_available: false,
        summary_subtitle_available: false,
        transcript_available: !text.trim().is_empty(),
        proofread_available: false,
        subtitle_source: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn material_ids_are_independent_of_playability_and_deduplicated_across_modern_sources() {
        let request = RecordingRequest {
            key: "recording".into(),
            title: "class".into(),
            candidates: vec![
                CanvasVideo {
                    source: VideoSource::Canvas,
                    video_id: "123".into(),
                    playable: false,
                    ..Default::default()
                },
                CanvasVideo {
                    source: VideoSource::VideoSpace,
                    video_id: "123".into(),
                    ..Default::default()
                },
                CanvasVideo {
                    source: VideoSource::Legacy,
                    video_id: "456".into(),
                    playable: true,
                    ..Default::default()
                },
                CanvasVideo {
                    source: VideoSource::Canvas,
                    video_id: "789".into(),
                    ..Default::default()
                },
            ],
        };
        assert_eq!(recording_material_ids(&request), vec![123, 789]);
    }

    #[test]
    fn transcription_uses_only_the_first_nonempty_camera_url() {
        let info = VideoInfo {
            video_play_response_vo_list: vec![
                crate::model::VideoPlayInfo {
                    rtmp_url_hdv: " ".into(),
                    ..Default::default()
                },
                crate::model::VideoPlayInfo {
                    rtmp_url_hdv: "https://videos.sjtu.edu.cn/vod/one.mp4".into(),
                    ..Default::default()
                },
                crate::model::VideoPlayInfo {
                    rtmp_url_hdv: "https://videos.sjtu.edu.cn/vod/two.mp4".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert_eq!(
            first_audio_url(&info).as_deref(),
            Some("https://videos.sjtu.edu.cn/vod/one.mp4")
        );
        assert!(first_audio_url(&VideoInfo::default()).is_none());
    }

    #[test]
    fn excluded_chatter_is_hidden_from_playback_and_summary_evidence() {
        let lines = vec![
            crate::model::CanvasVideoSubTitle {
                bg: 100,
                ed: 200,
                res: "周末私事闲聊".into(),
                ..Default::default()
            },
            crate::model::CanvasVideoSubTitle {
                bg: 1000,
                ed: 2000,
                res: "本周作业与考试安排".into(),
                ..Default::default()
            },
        ];
        let mut report: crate::client::subtitle_proofread::ProofreadResult = serde_json::from_value(serde_json::json!({"model":"test","sourceHash":"test","configHash":"test","policy":crate::client::subtitle_proofread::POLICY,"joinNext":[],"excludeFromSummary":[{"id":0,"reason":"chatter"}],"displayCues":2,"lineCount":2,"changedLines":0,"batches":1,"elapsedMs":1,"promptTokens":1,"completionTokens":1,"cached":false,"mode":"test","batchMetrics":[]})).unwrap();
        report.lines = lines.clone();
        let selected = SelectedSubtitles::refined(report, vec![]);
        assert_eq!(selected.lines, lines);
        let srt = crate::client::Client::default()
            .convert_to_srt(&selected.display)
            .unwrap();
        assert!(!srt.contains("周末私事闲聊"));
        let (timeline, _, _) =
            super::super::ppt::material_timeline("canvas:test", &selected.summary, &[]);
        assert!(!timeline.contains("周末私事闲聊"));
        assert!(timeline.contains("本周作业与考试安排"));
        assert!(timeline.contains("&t=1"));
    }

    #[test]
    fn untimed_transcript_is_summary_material_never_srt() {
        let request = RecordingRequest {
            key: "canvas:1".into(),
            title: "课堂".into(),
            candidates: vec![],
        };
        let material = untimed_transcript_material(&request, "教师讲解原文");
        assert!(material.transcript_available);
        assert!(!material.subtitle_available);
        assert!(material.srt.is_empty());
        assert!(material.text.contains("无时间戳"));
        assert!(material.text.contains("教师讲解原文"));
        assert!(!material.text.contains("#video="));
        let invalid = crate::model::CanvasVideoSubTitle {
            res: "无时间戳内容".into(),
            ..Default::default()
        };
        assert!(preferred_subtitles(
            crate::model::CanvasVideoSubTitleResponseBody {
                before_assembly_list: vec![invalid],
                ..Default::default()
            },
            true
        )
        .is_empty());
    }

    fn offline_app() -> App {
        App {
            client: Arc::new(crate::client::Client::new_without_proxy(
                "http://127.0.0.1",
                "",
                "",
                "",
                None,
            )),
            current_account: Default::default(),
            config: Default::default(),
            handle: Default::default(),
            mcp_handle: Default::default(),
            cache: Default::default(),
        }
    }

    #[tokio::test]
    async fn office_conversion_error_omits_filename() {
        let file = crate::model::File {
            display_name: "张同学_202612345_私人课程作业".into(),
            ..Default::default()
        };
        let error = offline_app()
            .convert_office_file_to_pdf(&file)
            .await
            .unwrap_err();
        assert!(
            matches!(&error, AppError::UnsupportedFileExtensionError(extension) if extension == "(missing)")
        );
        assert!(!error.to_string().contains(&file.display_name));
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains(&file.display_name));
    }

    #[tokio::test]
    async fn failed_exports_identify_sections_without_recording_titles() {
        let app = offline_app();
        let titles = ["张老师的私人课程", "李同学的私人课堂"];
        for kind in ["ppt", "subtitle", "reading"] {
            let requests = titles
                .iter()
                .map(|title| RecordingRequest {
                    key: String::new(),
                    title: (*title).into(),
                    candidates: vec![],
                })
                .collect();
            let error = app
                .export_video_materials(
                    requests,
                    kind.into(),
                    String::new(),
                    "私人导出标题".into(),
                    false,
                    Arc::new(|_| {}),
                )
                .await
                .err()
                .expect("recordings without candidates must fail");
            let raw = error.to_string();
            let serialized = serde_json::to_string(&error).unwrap();
            assert!(raw.contains("第 1 小节"));
            assert!(raw.contains("第 2 小节"));
            assert!(raw.contains("该录像来源不提供此资料"));
            for title in titles {
                assert!(!raw.contains(title));
                assert!(!serialized.contains(title));
            }
        }
    }

    #[test]
    fn after_assembly_is_preferred_with_before_fallback() {
        use crate::model::{CanvasVideoSubTitle, CanvasVideoSubTitleResponseBody};
        let before = CanvasVideoSubTitle {
            bg: 1000,
            ed: 2000,
            res: "原始字幕".into(),
            ..Default::default()
        };
        let after = CanvasVideoSubTitle {
            bg: 1000,
            ed: 6000,
            res: "整理后的字幕".into(),
            ..Default::default()
        };
        let response = CanvasVideoSubTitleResponseBody {
            before_assembly_list: vec![before.clone()],
            after_assembly_list: vec![after.clone()],
        };
        assert_eq!(preferred_subtitles(response, false), vec![after]);
        let response = CanvasVideoSubTitleResponseBody {
            before_assembly_list: vec![before.clone()],
            after_assembly_list: vec![CanvasVideoSubTitle {
                res: " \n".into(),
                ..Default::default()
            }],
        };
        assert_eq!(preferred_subtitles(response, false), vec![before]);
        assert!(preferred_subtitles(Default::default(), false).is_empty());
    }
    #[test]
    fn playback_and_exports_prefer_before_assembly_with_after_fallback() {
        use crate::model::{CanvasVideoSubTitle, CanvasVideoSubTitleResponseBody};
        let before = CanvasVideoSubTitle {
            bg: 1000,
            ed: 2000,
            res: "原始字幕".into(),
            ..Default::default()
        };
        let after = CanvasVideoSubTitle {
            bg: 1000,
            ed: 6000,
            res: "整理后的字幕".into(),
            ..Default::default()
        };
        let response = CanvasVideoSubTitleResponseBody {
            before_assembly_list: vec![before.clone()],
            after_assembly_list: vec![after.clone()],
        };
        assert_eq!(preferred_subtitles(response, true), vec![before]);
        let response = CanvasVideoSubTitleResponseBody {
            before_assembly_list: vec![CanvasVideoSubTitle {
                res: " ".into(),
                ..Default::default()
            }],
            after_assembly_list: vec![after.clone()],
        };
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
