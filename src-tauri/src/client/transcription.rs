use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use md5::{Digest, Md5};
use reqwest::{cookie::Jar, multipart, redirect::Policy};
use serde::Deserialize;
use serde_json::Value;
use tauri::Url;
use tokio::{io::{AsyncBufReadExt, BufReader}, sync::Mutex};
use tokio_util::io::ReaderStream;

use super::{
    constants::{AUTH_URL, MY_SJTU_URL},
    Client,
};
use crate::error::{AppError, Result};

const SERVICE: &str = "https://translate.sjtu.edu.cn";
const MAX_AUDIO_BYTES: u64 = 524_288_000;

fn failure(message: &str) -> AppError {
    AppError::VideoDownloadError(message.into())
}
fn login_error() -> AppError {
    failure("请先在设置中扫码登录，再重试音频转录")
}

#[derive(Default)]
pub(super) struct TranscriptionRuntime {
    state: Mutex<AuthState>,
}
#[derive(Default)]
struct AuthState {
    cookie: String,
    session: Option<Arc<Session>>,
}
struct Session {
    client: reqwest::Client,
    cancelled: AtomicBool,
    // Serialize extraction/uploads to respect the service's five-file limit and
    // coalesce concurrent summary/player requests for the same recording.
    work: Mutex<Jobs>,
}
#[derive(Default)]
struct Jobs {
    authenticated: bool,
    completed: HashMap<String, String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteJob {
    id: String,
    file_name: String,
    #[serde(default)]
    original_text: Option<String>,
    #[serde(default)]
    deal_mark: String,
    #[serde(default)]
    del_mark: String,
}

impl TranscriptionRuntime {
    pub(super) async fn clear_completed(&self) {
        let mut state = self.state.lock().await;
        if let Some(old) = state.session.take() { old.cancelled.store(true, Ordering::Release); }
    }
    pub(super) async fn configure(&self, cookie: &str, reset: bool) {
        let mut state = self.state.lock().await;
        if reset || state.cookie != cookie {
            if let Some(old) = state.session.take() {
                old.cancelled.store(true, Ordering::Release);
            }
            state.cookie = cookie.into();
        }
    }

    async fn session(&self) -> Result<Arc<Session>> {
        let mut state = self.state.lock().await;
        if state.cookie.trim().is_empty() {
            return Err(login_error());
        }
        if let Some(session) = &state.session {
            return Ok(session.clone());
        }
        let jar = Arc::new(Jar::default());
        for host in [AUTH_URL, MY_SJTU_URL] {
            jar.add_cookie_str(
                &format!("JAAuthCookie={}", state.cookie),
                &Url::parse(host).unwrap(),
            );
        }
        let client = reqwest::Client::builder()
            .cookie_provider(jar)
            .timeout(Duration::from_secs(30))
            .redirect(Policy::custom(|attempt| {
                if attempt.previous().len() >= 16 {
                    return attempt.stop();
                }
                match attempt.url().host_str() {
                    Some("translate.sjtu.edu.cn" | "jaccount.sjtu.edu.cn" | "my.sjtu.edu.cn") => {
                        attempt.follow()
                    }
                    _ => attempt.stop(),
                }
            }))
            .build()
            .map_err(|_| login_error())?;
        let session = Arc::new(Session {
            client,
            cancelled: AtomicBool::new(false),
            work: Default::default(),
        });
        state.session = Some(session.clone());
        Ok(session)
    }
}

impl Session {
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(failure(
                "账号或额外登录态已变更，转录已停止；请在当前账号重试",
            ))
        } else {
            Ok(())
        }
    }
    async fn cancellation(&self) {
        while !self.cancelled.load(Ordering::Acquire) {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
    async fn authenticate(&self, base: &str) -> Result<()> {
        self.check()?;
        let response = self
            .client
            .get(format!("{base}/ai/ui/transcribe"))
            .send()
            .await
            .map_err(|_| login_error())?;
        let expected = Url::parse(base).map_err(|_| login_error())?;
        if !response.status().is_success() || response.url().origin() != expected.origin() {
            return Err(login_error());
        }
        self.check()
    }
    async fn list(&self, base: &str) -> Result<Vec<RemoteJob>> {
        self.check()?;
        let response = self
            .client
            .get(format!("{base}/ai/file/audioVideo/list"))
            .send()
            .await
            .map_err(|_| failure("读取 AI 转录任务失败，请稍后重试"))?;
        let value: Value = response
            .error_for_status()
            .map_err(|_| login_error())?
            .json()
            .await
            .map_err(|_| login_error())?;
        check_response(&value)?;
        let jobs: Vec<RemoteJob> = serde_json::from_value(value["data"].clone())
            .map_err(|_| failure("AI 转录服务返回了无法识别的任务列表"))?;
        Ok(jobs.into_iter().filter(|job| job.del_mark != "Y").collect())
    }
    async fn upload(&self, base: &str, path: &Path, name: &str) -> Result<String> {
        self.check()?;
        let length = tokio::fs::metadata(path).await?.len();
        if length == 0 || length > MAX_AUDIO_BYTES {
            return Err(failure("提取的音频为空或超过转录服务的 500 MB 限制"));
        }
        let file = tokio::fs::File::open(path).await?;
        let part = multipart::Part::stream_with_length(
            reqwest::Body::wrap_stream(ReaderStream::new(file)),
            length,
        )
        .file_name(name.to_owned())
        .mime_str("audio/mpeg")
        .map_err(|_| failure("无法创建音频上传请求"))?;
        // Never retry an ambiguous POST: the next attempt discovers the task by
        // its stable filename before considering another upload.
        let value: Value = self
            .client
            .post(format!("{base}/ai/file/audioVideo/upload"))
            .timeout(Duration::from_secs(120))
            .multipart(multipart::Form::new().part("file", part))
            .send()
            .await
            .map_err(|_| failure("音频上传未确认，请重试以检查已有任务；不会直接重复上传"))?
            .error_for_status()
            .map_err(|_| failure("AI 转录服务拒绝了音频上传"))?
            .json()
            .await
            .map_err(|_| failure("无法确认上传结果，请重试以检查已有任务"))?;
        check_response(&value)?;
        let id = value["data"]
            .as_str()
            .and_then(|name| name.rsplit_once('.').map(|(id, _)| id))
            .filter(|id| !id.is_empty())
            .ok_or_else(|| failure("无法确认转录任务编号，请稍后重试"))?;
        self.check()?;
        Ok(id.into())
    }
    async fn wait(
        &self,
        base: &str,
        id: &str,
        name: &str,
        interval: Duration,
        on_status: &(dyn Fn(String) + Send + Sync),
    ) -> Result<String> {
        let polling = async {
            let mut missing = 0;
            loop {
                self.check()?;
                let jobs = self.list(base).await?;
                let Some(job) = find_job(&jobs, Some(id), name) else {
                    missing += 1;
                    if missing >= 3 {
                        return Err(failure("AI 转录任务已失效或被删除，请重新转录"));
                    }
                    tokio::time::sleep(interval).await;
                    continue;
                };
                missing = 0;
                if let Some(text) = completed_text(job)? {
                    return Ok(text);
                }
                on_status(
                    if job.deal_mark == "1" {
                        "正在转录课堂音频"
                    } else {
                        "音频转录排队中"
                    }
                    .into(),
                );
                tokio::time::sleep(interval).await;
            }
        };
        tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(20 * 60), polling) => result.map_err(|_| failure("转录等待超时，任务保留在校内服务中；重试可继续读取进度"))?,
            _ = self.cancellation() => { self.check()?; unreachable!() },
        }
    }
}

fn check_response(value: &Value) -> Result<()> {
    if value["errno"].as_str() == Some("0") || value["errno"].as_i64() == Some(0) {
        Ok(())
    } else {
        Err(failure("AI 转录服务返回错误，请检查额外登录态和服务可用性"))
    }
}
fn find_job<'a>(jobs: &'a [RemoteJob], id: Option<&str>, name: &str) -> Option<&'a RemoteJob> {
    if let Some(id) = id {
        jobs.iter().find(|job| job.id == id)
    } else {
        jobs.iter().rev().find(|job| job.file_name == name)
    }
}
fn completed_text(job: &RemoteJob) -> Result<Option<String>> {
    if job.deal_mark == "3"
        || job.deal_mark == "6"
        || job.original_text.as_deref() == Some("转录失败")
    {
        return Err(failure(
            "校内 AI 音视频转录失败，请到转录服务页面检查该任务",
        ));
    }
    if job.deal_mark != "2" {
        return Ok(None);
    }
    job.original_text
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| Some(text.to_owned()))
        .ok_or_else(|| failure("AI 转录已结束，但没有识别到有效文字"))
}

struct TemporaryAudio(PathBuf);
impl TemporaryAudio {
    fn new() -> Result<Self> {
        let dir = std::env::temp_dir().join(format!(
            "canvas-helper-transcription-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&dir)?;
        Ok(Self(dir))
    }
    fn path(&self) -> PathBuf {
        self.0.join("audio.mp3")
    }
}
impl Drop for TemporaryAudio {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn media_url(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| failure("录像音频地址无效"))?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(
            url.host_str(),
            Some("videos.sjtu.edu.cn" | "live.sjtu.edu.cn" | "v.sjtu.edu.cn")
        )
    {
        return Err(failure("该录像音频地址暂不支持校内转录"));
    }
    Ok(url)
}
async fn extract_audio(
    session: &Session,
    url: &str,
    path: &Path,
    deadline: tokio::time::Instant,
    on_status: &(dyn Fn(String) + Send + Sync),
) -> Result<()> {
    let url = media_url(url)?;
    let mut command = tokio::process::Command::new("ffmpeg");
    command
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostats",
            "-stats_period",
            "1",
            "-progress",
            "pipe:1",
            "-rw_timeout",
            "30000000",
            "-protocol_whitelist",
            "https,http,tcp,tls,crypto",
            "-headers",
            "Referer: https://v.sjtu.edu.cn/\r\n",
            // Avoid a new HTTP/TLS connection for every short seek between
            // interleaved video and audio packets in MP4 recordings.
            "-multiple_requests",
            "1",
            "-short_seek_size",
            "1048576",
            "-vn",
            "-sn",
            "-dn",
            "-i",
            url.as_str(),
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-y",
        ])
        .arg(path)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command
        .spawn()
        .map_err(|_| failure("无法启动 FFmpeg，请先安装 FFmpeg 并加入 PATH，再重启助手"))?;
    let stdout = child.stdout.take().ok_or_else(|| failure("无法读取音轨提取进度"))?;
    let status = tokio::select! {
        result = tokio::time::timeout_at(deadline, async {
            let mut lines = BufReader::new(stdout).lines();
            while let Some(line) = lines.next_line().await? {
                if let Some(progress) = audio_progress(&line) { on_status(progress); }
            }
            child.wait().await
        }) => {
            match result {
                Ok(result) => result.map_err(|_| failure("提取音频失败，请检查录像是否可播放"))?,
                Err(_) => {
                    let _ = child.kill().await;
                    return Err(failure("提取音频超时，请检查录像是否仍可播放后重试"));
                }
            }
        },
        _ = session.cancellation() => { let _ = child.kill().await; session.check()?; unreachable!() },
    };
    if !status.success() {
        return Err(failure(
            "提取音频失败，录像可能没有音轨或访问已过期，请刷新后重试",
        ));
    }
    session.check()
}

fn audio_progress(line: &str) -> Option<String> {
    let microseconds: u64 = line.strip_prefix("out_time_us=")?.parse().ok()?;
    let seconds = microseconds / 1_000_000;
    Some(format!("正在提取音轨，已处理 {:02}:{:02} 音频（仅一个机位）", seconds / 60, seconds % 60))
}

impl Client {
    pub async fn transcribe_recording_audio(
        &self,
        key: &str,
        url: &str,
        on_status: &(dyn Fn(String) + Send + Sync),
    ) -> Result<String> {
        let session = self.transcription.session().await?;
        on_status("正在准备转录，其他转录任务完成后继续".into());
        let mut jobs = tokio::select! {
            jobs = session.work.lock() => jobs,
            _ = session.cancellation() => return Err(failure("账号已变更，转录已停止")),
        };
        session.check()?;
        if let Some(text) = jobs.completed.get(key) {
            return Ok(text.clone());
        }
        if !jobs.authenticated {
            on_status("正在登录校内 AI 转录服务".into());
            session.authenticate(SERVICE).await?;
            jobs.authenticated = true;
        }
        let remote = match session.list(SERVICE).await {
            Ok(list) => list,
            Err(error) => {
                jobs.authenticated = false;
                return Err(error);
            }
        };
        let name = format!("canvas-helper-{:x}.mp3", Md5::digest(key.as_bytes()));
        let id = if let Some(job) = find_job(&remote, None, &name) {
            if let Some(text) = completed_text(job)? {
                session.check()?;
                jobs.completed.insert(key.into(), text.clone());
                return Ok(text);
            }
            job.id.clone()
        } else {
            if remote.len() >= 5 {
                return Err(failure("校内转录服务最多保留 5 个文件，请先到 translate.sjtu.edu.cn 的音视频转录页面清理文件后重试"));
            }
            let audio = TemporaryAudio::new()?;
            let deadline = tokio::time::Instant::now() + Duration::from_secs(10 * 60);
            on_status("正在提取音轨（仅一个机位，正在连接录像）".into());
            extract_audio(&session, url, &audio.path(), deadline, on_status).await?;
            let size_mb = tokio::fs::metadata(audio.path()).await?.len() as f64 / 1_048_576.0;
            on_status(format!("正在上传音轨至校内 AI 转录服务（{size_mb:.1} MB）"));
            session.upload(SERVICE, &audio.path(), &name).await?
        };
        let text = session
            .wait(SERVICE, &id, &name, Duration::from_secs(10), on_status)
            .await?;
        session.check()?;
        jobs.completed.insert(key.into(), text.clone());
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    #[test]
    fn progress_only_reports_valid_media_time_and_never_remote_output() {
        assert_eq!(audio_progress("out_time_us=125000000").as_deref(), Some("正在提取音轨，已处理 02:05 音频（仅一个机位）"));
        for line in ["out_time_us=N/A", "out_time_us=-1", "url=https://secret", "speed=2.0x"] { assert!(audio_progress(line).is_none()); }
    }

    fn session() -> Session {
        Session {
            client: reqwest::Client::builder().no_proxy().build().unwrap(),
            cancelled: AtomicBool::new(false),
            work: Default::default(),
        }
    }
    fn job(status: &str, text: Option<&str>) -> RemoteJob {
        serde_json::from_value(serde_json::json!({"id":"task", "fileName":"lesson.mp3", "dealMark":status,"originalText":text,"delMark":"N"})).unwrap()
    }
    #[tokio::test]
    async fn upload_and_read_plain_transcript_without_timestamps() {
        let server = MockServer::start();
        let upload = server.mock(|when, then| {
            when.method(POST)
                .path("/ai/file/audioVideo/upload")
                .body_contains("name=\"file\"; filename=\"lesson.mp3\"");
            then.json_body(serde_json::json!({"errno":"0", "data":"task.mp3"}));
        });
        let list = server.mock(|when, then| {
            when.method(GET).path("/ai/file/audioVideo/list");
            then.json_body(serde_json::json!({"errno":"0", "data":[{"id":"task", "fileName":"lesson.mp3", "dealMark":"2", "originalText":"课堂原文", "delMark":"N"}]}));
        });
        let audio = TemporaryAudio::new().unwrap();
        std::fs::write(audio.path(), b"test audio").unwrap();
        let session = session();
        let id = session
            .upload(&server.base_url(), &audio.path(), "lesson.mp3")
            .await
            .unwrap();
        let text = session
            .wait(
                &server.base_url(),
                &id,
                "lesson.mp3",
                Duration::from_millis(1),
                &|_| {},
            )
            .await
            .unwrap();
        assert_eq!(text, "课堂原文");
        upload.assert_hits(1);
        list.assert_hits(1);
    }
    #[test]
    fn task_selection_never_uses_unrelated_or_partial_text() {
        let jobs = vec![job("1", Some("部分结果"))];
        assert!(completed_text(&jobs[0]).unwrap().is_none());
        assert!(find_job(&jobs, Some("another-task"), "lesson.mp3").is_none());
        assert!(completed_text(&job("2", None)).is_err());
        assert!(completed_text(&job("2", Some("转录失败"))).is_err());
        assert!(completed_text(&job("3", Some("错误"))).is_err());
        assert_eq!(
            completed_text(&job("2", Some(" 完成 "))).unwrap(),
            Some("完成".into())
        );
    }
    #[tokio::test]
    async fn credentials_change_cancels_old_work_and_discards_cached_results() {
        let runtime = TranscriptionRuntime::default();
        assert!(runtime.session().await.is_err());
        runtime.configure("first-cookie", false).await;
        let first = runtime.session().await.unwrap();
        first
            .work
            .lock()
            .await
            .completed
            .insert("canvas:1".into(), "旧账号转录".into());
        runtime.configure("second-cookie", false).await;
        assert!(first.check().is_err());
        let second = runtime.session().await.unwrap();
        assert!(second.work.lock().await.completed.is_empty());
        runtime.configure("second-cookie", true).await;
        assert!(second.check().is_err());
    }
    #[test]
    fn media_extraction_only_accepts_supported_remote_video_hosts() {
        for value in [
            "file:///C:/private",
            "https://example.com/a.mp4",
            "http://127.0.0.1/a",
            "https://user:secret@videos.sjtu.edu.cn/a",
        ] {
            assert!(media_url(value).is_err());
        }
        assert!(media_url("https://videos.sjtu.edu.cn/vod/lesson.mp4?ticket=value").is_ok());
    }

    #[tokio::test]
    #[ignore = "requires explicit SJTU_TRANSCRIPTION_TEST_CONFIG and SJTU_TRANSCRIPTION_TEST_AUDIO; uploads one audio sample"]
    async fn live_transcription_contract() {
        let config_path = std::env::var("SJTU_TRANSCRIPTION_TEST_CONFIG").expect("set config path");
        let audio = std::env::var("SJTU_TRANSCRIPTION_TEST_AUDIO").expect("set audio sample path");
        let config: Value = serde_json::from_slice(&std::fs::read(config_path).unwrap()).unwrap();
        let runtime = TranscriptionRuntime::default();
        runtime
            .configure(
                config["ja_auth_cookie"]
                    .as_str()
                    .expect("extra login required"),
                false,
            )
            .await;
        let session = runtime.session().await.unwrap();
        session.authenticate(SERVICE).await.unwrap();
        let remote = session.list(SERVICE).await.unwrap();
        let name = "canvas-helper-contract-check.mp3";
        let id = if let Some(job) = find_job(&remote, None, name) {
            job.id.clone()
        } else {
            assert!(
                remote.len() < 5,
                "free one service slot before running this test"
            );
            session
                .upload(SERVICE, Path::new(&audio), name)
                .await
                .unwrap()
        };
        let text = session
            .wait(SERVICE, &id, name, Duration::from_secs(10), &|_| {})
            .await
            .unwrap();
        assert!(text.chars().count() > 20);
    }
}
