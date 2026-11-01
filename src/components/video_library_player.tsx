import WorkspaceSelect from "./workspace_select";
import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Card, CardContent, FormControlLabel, MenuItem, Slider, Stack, Switch, Typography } from "@mui/material";
import Draggable from "react-draggable";
import { surfaceCardSx } from "../lib/styles";
import { getConfig } from "../lib/config";
import { srtToVtt } from "../lib/utils";
import { canSummarizeRecording, recordingKey, type SubtitleProofreadResult, type VideoMaterial, type VideoSession, type VideoSubtitleTrack, type VideoSubtitleVersions } from "../lib/video_library";
import { videoSummarySession } from "../lib/video_summary_session";
import { recordingRequest, resolveRecording, enqueueVideoTrack } from "../lib/video_library_tasks";
import type { CanvasVideo, VideoPlayInfo } from "../lib/model";
import { useMediaElement } from "../lib/media_element";
import { PlaybackProxyError, preparePlaybackProxy } from "../lib/playback_proxy";
import PlaybackProxyAlert from "./playback_proxy_alert";
import { recordingTopic, validVideoTopic } from "../lib/video_topics";
import type { DownloadCourse } from "../lib/downloads";

function playbackURL(url: string, port: number, source: CanvasVideo["source"]): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "videos.sjtu.edu.cn" && parsed.pathname.startsWith("/vod/")) {
      return `http://localhost:${port}/${source === "legacy" ? "legacy-vod" : "canvas-vod"}/${parsed.pathname.slice(5)}${parsed.search}`;
    }
    if (parsed.hostname === "live.sjtu.edu.cn") {
      return `http://localhost:${port}${parsed.pathname.startsWith("/vod/") ? "" : "/canvas-live"}${parsed.pathname}${parsed.search}`;
    }
  } catch { /* Media element reports an invalid source. */ }
  return url;
}

export default function VideoLibraryPlayer({ session, course, initialKey, seconds = 0, seekRequest, onMiniChange, topics = {}, onTopicChange, onClose, onSummarize }: {
  course?: DownloadCourse;
  session: VideoSession; initialKey: string; seconds?: number; seekRequest?: string; onMiniChange?: (mini: boolean) => void; topics?: Record<string, string>; onTopicChange?: (key: string, topic: string) => void; onClose: () => void; onSummarize: (video: CanvasVideo) => void;
}) {
  // Replacing the playlist can invalidate the previous selection before effects
  // run. Mount a fresh selection for that range, while preserving playback on
  // ordinary parent renders and same-range citation seeks.
  if (!session.videos.length) return <Alert severity="info">此播放范围内没有录像。<Button onClick={onClose}>关闭播放</Button></Alert>;
  return <PlayerSession key={JSON.stringify([course?.id, session.id, session.videos.map(recordingKey)])} {...{ session, course, initialKey, seconds, seekRequest, onMiniChange, topics, onTopicChange, onClose, onSummarize }} />;
}

function PlayerSession({ session, course, initialKey, seconds = 0, seekRequest, onMiniChange, topics = {}, onTopicChange, onClose, onSummarize }: {
  course?: DownloadCourse;
  session: VideoSession; initialKey: string; seconds?: number; seekRequest?: string; onMiniChange?: (mini: boolean) => void; topics?: Record<string, string>; onTopicChange?: (key: string, topic: string) => void; onClose: () => void; onSummarize: (video: CanvasVideo) => void;
}) {
  const [mini, setMini] = useState(false);
  const [active, setActive] = useState(() => session.videos.some((v) => recordingKey(v) === initialKey) ? initialKey : recordingKey(session.videos.find((v) => v.playable || v.alternatives?.some((a) => a.playable)) ?? session.videos[0]));
  const [tracks, setTracks] = useState<VideoPlayInfo[]>([]);
  const [downloadNotice, setDownloadNotice] = useState("");
  const playbackStates = useRef(new Map<number, { time: number; rate: number; paused: boolean }>());
  const [urls, setUrls] = useState<string[]>([]);
  const [main, setMain] = useState(0);
  const [secondary, setSecondary] = useState(-1);
  const [sync, setSync] = useState(true);
  const [continuous, setContinuous] = useState(true);
  const [settings, setSettings] = useState(false);
  const [size, setSize] = useState(25);
  const [opacity, setOpacity] = useState(0.9);
  const [subtitle, setSubtitle] = useState<string>();
  const [subtitleSrt, setSubtitleSrt] = useState("");
  const [subtitleVersions, setSubtitleVersions] = useState<VideoSubtitleTrack[]>([]);
  const [showChatter, setShowChatter] = useState(false);
  const subtitleChoices = useRef(new Map<string, VideoSubtitleTrack["source"]>());
  const [subtitleSource, setSubtitleSource] = useState<VideoMaterial["subtitleSource"]>();
  const localProofread = subtitleSource === "local";
  const selectedSubtitle = subtitleVersions.find((track) => track.source === subtitleSource);
  const [subtitleLoading, setSubtitleLoading] = useState(true);
  const [subtitleError, setSubtitleError] = useState(false);
  const [proofreading, setProofreading] = useState<{ key: string; running: boolean; message: string; error?: boolean }>();
  const activeRef = useRef(active);
  activeRef.current = active;
  const mounted = useRef(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [proxyError, setProxyError] = useState<PlaybackProxyError>();
  const [retry, setRetry] = useState(0);
  const { ref: mainRef, attach: attachMain } = useMediaElement();
  const { ref: subRef, attach: attachSub } = useMediaElement();
  const overlayRef = useRef<HTMLDivElement>(null);
  const seek = useRef(seconds);
  const video = session.videos.find((v) => recordingKey(v) === active)!;

  useEffect(() => { onMiniChange?.(false); }, [onMiniChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const proofread = async () => {
    if (proofreading?.running) return;
    const key = recordingKey(video);
    setProofreading({ key, running: true, message: "正在准备字幕精校" });
    const onStatus = new Channel<string>();
    onStatus.onmessage = (message) => { if (mounted.current) setProofreading({ key, running: true, message }); };
    try {
      const { material, report, track } = await invoke<SubtitleProofreadResult>("proofread_video_subtitles", { request: recordingRequest(video), onStatus });
      videoSummarySession.clearMaterials();
      if (mounted.current) {
        if (validVideoTopic(report.topic)) onTopicChange?.(key, report.topic);
        if (activeRef.current === key) { setSubtitleSrt(material.srt); setSubtitleSource("local"); setShowChatter(false);
          setSubtitleVersions((previous) => [track ?? { source: "local", srt: material.srt, fullSrt: material.srt, chatterCount: 0 }, ...previous.filter((item) => item.source !== "local")]);
          subtitleChoices.current.set(key, "local"); }
        setProofreading({ key, running: false, message: `${report.cached ? "已复用精校结果" : `精校完成 · ${(report.elapsedMs / 1000).toFixed(1)} 秒`} · 修改 ${report.changedLines} 句${report.topic ? ` · ${report.topic}` : ""}${material.warnings?.length ? `；${material.warnings.join("；")}` : " · 已保存"}` });
      }
    } catch (error) {
      if (mounted.current) setProofreading({ key, running: false, message: `字幕精校失败：${error}；继续使用原字幕。`, error: true });
    }
  };

  const chooseSubtitle = (source: VideoSubtitleTrack["source"]) => {
    const track = subtitleVersions.find((item) => item.source === source);
    if (!track) return;
    subtitleChoices.current.set(active, source);
    setSubtitleSource(source);
    setSubtitleSrt(showChatter ? track.fullSrt : track.srt);
  };

  useEffect(() => {
    if (!subtitleSrt) { setSubtitle(undefined); return; }
    const url = URL.createObjectURL(new Blob([srtToVtt(subtitleSrt)], { type: "text/vtt" }));
    setSubtitle(url);
    return () => URL.revokeObjectURL(url);
  }, [subtitleSrt]);

  useEffect(() => {
    seek.current = seconds;
    playbackStates.current.clear();
    if (session.videos.some((v) => recordingKey(v) === initialKey)) setActive(initialKey);
    if (mainRef.current && active === initialKey) mainRef.current.currentTime = seconds;
    if (sync && subRef.current && active === initialKey) subRef.current.currentTime = seconds;
    // A new citation may target the current recording at a different timestamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey, seconds, seekRequest]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setSubtitleLoading(true); setSubtitleError(false); setSubtitleSource(undefined); setError(""); setProxyError(undefined); setDownloadNotice(""); setTracks([]); setUrls([]); setSubtitle(undefined); setSubtitleSrt(""); setSubtitleVersions([]); setShowChatter(false); setMain(0); setSecondary(-1);
    void (async () => {
      try {
        const [{ info, source }, config] = await Promise.all([resolveRecording(video), getConfig()]);
        if (cancelled) return;
        const next = info.videoPlayResponseVoList.map((track) => playbackURL(track.rtmpUrlHdv, config.proxy_port, source));
        if (next.some((url) => url.startsWith(`http://localhost:${config.proxy_port}/`))) {
          await preparePlaybackProxy(config.proxy_port);
        }
        if (cancelled) return;
        setUrls(next); setTracks(info.videoPlayResponseVoList); setLoading(false);
        try {
          const versions = await invoke<VideoSubtitleVersions>("get_video_subtitle_versions", { request: recordingRequest(video) });
          if (!Array.isArray(versions.tracks)) throw new Error("字幕版本响应无效");
          if (!cancelled) {
            setSubtitleVersions(versions.tracks);
            const selected = versions.tracks.find((track) => track.source === subtitleChoices.current.get(recordingKey(video))) ?? versions.tracks[0];
            if (selected) { setSubtitleSrt(selected.srt); setSubtitleSource(selected.source); }
          }
        } catch { if (!cancelled) setSubtitleError(true); }
        finally { if (!cancelled) setSubtitleLoading(false); }
      } catch (e) { if (!cancelled) { setError(String(e)); setProxyError(e instanceof PlaybackProxyError ? e : undefined); setLoading(false); setSubtitleLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [video, retry]);

  // The proxy is shared with classroom live playback; App stops it when exiting.
  // Closing a recording must not stop a live player that is starting on the same port.

  useEffect(() => {
    const primary = mainRef.current;
    const sub = subRef.current;
    if (!primary || !sub || !sync) return;
    const play = () => { void sub.play().catch(() => {}); };
    const pause = () => sub.pause();
    const synchronize = () => { sub.currentTime = primary.currentTime; sub.playbackRate = primary.playbackRate; };
    const loaded = () => { synchronize(); if (!primary.paused) play(); };
    primary.addEventListener("play", play); primary.addEventListener("pause", pause);
    primary.addEventListener("seeked", synchronize); primary.addEventListener("ratechange", synchronize);
    sub.addEventListener("loadedmetadata", loaded);
    if (sub.readyState >= 1) loaded();
    return () => {
      primary.removeEventListener("play", play); primary.removeEventListener("pause", pause);
      primary.removeEventListener("seeked", synchronize); primary.removeEventListener("ratechange", synchronize);
      sub.removeEventListener("loadedmetadata", loaded);
    };
  }, [main, secondary, urls, sync, mainRef, subRef]);

  const remember = () => {
    for (const [index, element] of [[main, mainRef.current], [secondary, subRef.current]] as const) {
      if (element && index >= 0) playbackStates.current.set(index, { time: element.currentTime, rate: element.playbackRate, paused: element.paused });
    }
  };
  const restore = (element: HTMLVideoElement | null, index: number) => {
    if (!element) return;
    const saved = playbackStates.current.get(index);
    element.currentTime = saved?.time ?? seek.current;
    element.playbackRate = saved?.rate ?? 1;
    if (saved?.paused) element.pause();
    else void element.play().catch(() => {});
  };
  const changeMain = (next: number) => {
    remember(); seek.current = mainRef.current?.currentTime ?? 0;
    if (next === secondary) setSecondary(main);
    setMain(next);
  };
  const switchVideo = (key: string) => { if (key === active) return; playbackStates.current.clear(); seek.current = 0; setActive(key); };
  const playable = (v: CanvasVideo) => v.playable || v.alternatives?.some((a) => a.playable);
  const nextVideo = () => {
    const index = session.videos.findIndex((v) => recordingKey(v) === active);
    const next = session.videos.slice(index + 1).find(playable);
    if (continuous && next) switchVideo(recordingKey(next));
  };
  return <Card sx={{ ...surfaceCardSx, minWidth: 0, ...(mini ? { position: "fixed", bottom: 16, right: 16, width: { xs: "calc(100vw - 32px)", sm: 380 }, zIndex: 1100, boxShadow: 8 } : {}) }}>
    <Box sx={{ p: 1.5 }}><Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
      <Typography fontWeight={700} noWrap title={session.title} sx={{ minWidth: 0, flex: 1 }}>{session.title}</Typography><Stack direction="row"><Button onClick={() => { setMini(!mini); onMiniChange?.(!mini); }}>{mini ? "展开" : "迷你播放"}</Button><Button onClick={onClose}>关闭播放</Button></Stack>
    </Stack></Box>
    <CardContent sx={{ pt: 0, p: mini ? 1 : 2 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2 }}>
        <Stack spacing={1.5} sx={{ minWidth: 0 }}>
          {error && (proxyError
            ? <PlaybackProxyAlert error={proxyError} onRetry={() => setRetry((v) => v + 1)} />
            : <Alert severity="error" action={<Button onClick={() => setRetry((v) => v + 1)}>重试</Button>}>{error}</Alert>)}
          <Box sx={{ bgcolor: "#000", aspectRatio: "16/9", position: "relative", overflow: "hidden", borderRadius: "8px" }}>
            {loading && <CircularProgress sx={{ position: "absolute", top: "45%", left: "48%" }} />}
            {urls[main] && <video key={`${active}:${main}`} ref={attachMain} src={urls[main]} controls autoPlay
              onLoadedMetadata={() => restore(mainRef.current, main)}
              onEnded={nextVideo} onError={() => { setProxyError(undefined); setError("视频加载失败，请重试或切换机位"); }}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}>
              {subtitle && <track key={subtitle} kind="subtitles" label="中文字幕" srcLang="zh" src={subtitle} default />}
            </video>}
            {secondary >= 0 && urls[secondary] && <Draggable nodeRef={overlayRef} bounds="parent" handle=".video-drag-handle">
              <div ref={overlayRef} style={{ position: "absolute", top: 12, left: 12, width: `${size}%`, opacity, visibility: size === 0 ? "hidden" : "visible" }}>
                <div className="video-drag-handle" style={{ background: "#222", color: "white", fontSize: 12, cursor: "move", padding: 3 }}>拖动副屏</div>
                <video key={`${active}:${secondary}`} ref={attachSub} src={urls[secondary]} onLoadedMetadata={() => restore(subRef.current, secondary)} muted controls style={{ width: "100%", display: "block" }} />
              </div>
            </Draggable>}
          </Box>
          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ display: mini ? "none" : "flex" }}>
            {urls.length > 0 && <WorkspaceSelect size="small" label="主机位" value={main} sx={{ minWidth: 120 }} onChange={(e) => changeMain(+e.target.value)}>{urls.map((_, i) => <MenuItem key={i} value={i}>机位 {i + 1}</MenuItem>)}</WorkspaceSelect>}
            {urls.length > 1 && <WorkspaceSelect size="small" label="副屏" value={secondary} sx={{ minWidth: 120 }} onChange={(e) => { remember(); setSecondary(+e.target.value); }}>
              <MenuItem value={-1}>关闭</MenuItem>{urls.map((_, i) => i !== main && <MenuItem key={i} value={i}>机位 {i + 1}</MenuItem>)}
            </WorkspaceSelect>}
            {secondary >= 0 && <Button onClick={() => changeMain(secondary)}>交换主副屏</Button>}
            {tracks[main] && <Button onClick={() => { enqueueVideoTrack(video, tracks[main], main, course); setDownloadNotice(`机位 ${main + 1} 已加入下载任务`); }}>下载当前机位</Button>}
            <Button onClick={() => setSettings(!settings)}>播放设置</Button>
            <Button variant="contained" disabled={!canSummarizeRecording(video)} onClick={() => onSummarize(video)}>总结当前小节</Button>
          </Stack>
          {!mini && <Stack spacing={1} sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}>
            <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
              <Typography variant="body2">当前小节 · {video.courseBeginTime.split(/[ T]/)[1]?.slice(0, 5) || video.videoName}</Typography>
              {subtitleVersions.length < 2 && <Chip size="small" color={localProofread || subtitleSource === "canvasAi" ? "success" : "default"} label={subtitleLoading ? "正在读取字幕" : localProofread ? "本地 AI 精校" : subtitleSource === "canvasAi" ? "Canvas AI+" : subtitleSrt ? "Canvas 字幕" : subtitleError ? "字幕读取失败" : "暂无播放字幕"} />}
              {subtitleSrt && !subtitleVersions.some((track) => track.source === "canvasAi") && <Button size="small" title="将当前小节字幕发送至设置中的模型服务，精校后更新播放字幕并生成课程主题。" disabled={loading || !!proofreading?.running} onClick={() => void proofread()}>{proofreading?.key === active && proofreading.running ? "精校中…" : "AI 精校字幕"}</Button>}
              {subtitleVersions.length > 1 && <WorkspaceSelect size="small" label="播放字幕" value={subtitleSource ?? ""} disabled={!!proofreading?.running} onChange={(event) => chooseSubtitle(event.target.value as VideoSubtitleTrack["source"])}>
                {subtitleVersions.map((track) => <MenuItem key={track.source} value={track.source}>{{ canvas: "Canvas 原始字幕", canvasAi: "Canvas AI+", local: "AI 精校字幕" }[track.source]}</MenuItem>)}
              </WorkspaceSelect>}
            </Stack>
            {recordingTopic(video, topics) && <Typography variant="body2">{recordingTopic(video, topics)}</Typography>}
          </Stack>}
          {downloadNotice && <Alert severity="success" onClose={() => setDownloadNotice("")}>{downloadNotice}</Alert>}
          {proofreading?.key === active && <Alert severity={proofreading.error ? "error" : proofreading.running ? "info" : "success"} icon={proofreading.running ? <CircularProgress size={18} /> : undefined}>{proofreading.message}</Alert>}
          <Collapse in={settings && !mini}><Stack spacing={1}>
            {!!selectedSubtitle?.chatterCount && <FormControlLabel label="显示片头片尾闲聊" control={<Switch checked={showChatter} onChange={(_, checked) => { setShowChatter(checked); setSubtitleSrt(checked ? selectedSubtitle.fullSrt : selectedSubtitle.srt); }} />} />}
            <FormControlLabel label="连续播放列表" control={<Switch checked={continuous} onChange={(_, value) => setContinuous(value)} />} />
            {secondary >= 0 && <>
              <FormControlLabel label="双屏同步" control={<Switch checked={sync} onChange={(_, value) => setSync(value)} />} />
              <Typography variant="caption">副屏大小 {size}%</Typography><Slider aria-label="副屏大小" value={size} min={0} max={50} onChange={(_, v) => setSize(v as number)} />
              <Typography variant="caption">副屏透明度</Typography><Slider aria-label="副屏透明度" value={opacity} min={0.1} max={1} step={0.05} onChange={(_, v) => setOpacity(v as number)} />
            </>}
          </Stack></Collapse>
        </Stack>
        <Stack spacing={0.5} sx={{ display: mini ? "none" : "flex", gridColumn: "1 / -1" }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>播放列表 · {session.videos.length} 小节</Typography>
          {session.videos.map((item, i) => <Button key={recordingKey(item)} variant={recordingKey(item) === active ? "contained" : "text"}
            disabled={!playable(item)} onClick={() => switchVideo(recordingKey(item))} sx={{ justifyContent: "flex-start", textAlign: "left" }}>
            第 {i + 1} 小节 · {item.courseBeginTime.split(/[ T]/)[1]?.slice(0, 5) || item.videoName}
          </Button>)}
        </Stack>
      </Box>
    </CardContent>
  </Card>;
}
