import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, Box, Button, CircularProgress, Collapse, Card, CardContent, FormControlLabel, MenuItem, Slider, Stack, Switch, TextField, Typography } from "@mui/material";
import Draggable from "react-draggable";
import { surfaceCardSx } from "../lib/styles";
import { getConfig } from "../lib/config";
import { srtToVtt } from "../lib/utils";
import { recordingKey, type VideoMaterial, type VideoSession } from "../lib/video_library";
import { recordingRequest, resolveRecording, enqueueVideoTrack } from "../lib/video_library_tasks";
import type { CanvasVideo, VideoPlayInfo } from "../lib/model";

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

export default function VideoLibraryPlayer({ session, initialKey, seconds = 0, seekRequest, onMiniChange, onClose, onSummarize }: {
  session: VideoSession; initialKey: string; seconds?: number; seekRequest?: string; onMiniChange?: (mini: boolean) => void; onClose: () => void; onSummarize: () => void;
}) {
  const [mini, setMini] = useState(false);
  const [active, setActive] = useState(initialKey);
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const mainRef = useRef<HTMLVideoElement>(null);
  const subRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const seek = useRef(seconds);
  const proxy = useRef<Promise<boolean>>();
  const video = session.videos.find((v) => recordingKey(v) === active)!;

  useEffect(() => {
    seek.current = seconds;
    playbackStates.current.clear();
    setActive(initialKey);
    if (mainRef.current && active === initialKey) mainRef.current.currentTime = seconds;
    // A new citation may target the current recording at a different timestamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey, seconds, seekRequest]);

  useEffect(() => {
    let cancelled = false;
    let objectURL: string | undefined;
    setLoading(true); setError(""); setDownloadNotice(""); setTracks([]); setUrls([]); setSubtitle(undefined); setMain(0); setSecondary(-1);
    void (async () => {
      try {
        const [{ info, source }, config] = await Promise.all([resolveRecording(video), getConfig()]);
        const next = info.videoPlayResponseVoList.map((track) => playbackURL(track.rtmpUrlHdv, config.proxy_port, source));
        if (next.some((url) => url.startsWith(`http://localhost:${config.proxy_port}/`))) {
          proxy.current ??= invoke<boolean>("prepare_proxy");
          if (!await proxy.current) { proxy.current = undefined; throw new Error("播放代理未能启动，请重试"); }
        }
        if (cancelled) return;
        setUrls(next); setTracks(info.videoPlayResponseVoList); setLoading(false);
        try {
          const material = await invoke<VideoMaterial>("prepare_video_material", { request: recordingRequest(video) });
          if (!cancelled && material.srt) {
            objectURL = URL.createObjectURL(new Blob([srtToVtt(material.srt)], { type: "text/vtt" }));
            setSubtitle(objectURL);
          }
        } catch { /* Subtitle availability does not prevent playback. */ }
      } catch (e) { if (!cancelled) { setError(String(e)); setLoading(false); proxy.current = undefined; } }
    })();
    return () => { cancelled = true; if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [video, retry]);

  useEffect(() => () => { if (proxy.current) void proxy.current.then(() => invoke("stop_proxy")).catch(() => {}); }, []);

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
  }, [main, secondary, urls, sync]);

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
        <Stack spacing={1.5}>
          {error && <Alert severity="error" action={<Button onClick={() => setRetry((v) => v + 1)}>重试</Button>}>{error}</Alert>}
          <Box sx={{ bgcolor: "#000", aspectRatio: "16/9", position: "relative", overflow: "hidden", borderRadius: "8px" }}>
            {loading && <CircularProgress sx={{ position: "absolute", top: "45%", left: "48%" }} />}
            {urls[main] && <video key={`${active}:${main}`} ref={mainRef} src={urls[main]} controls autoPlay
              onLoadedMetadata={() => restore(mainRef.current, main)}
              onEnded={nextVideo} onError={() => setError("视频加载失败，请重试或切换机位")}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}>
              {subtitle && <track key={subtitle} kind="subtitles" label="中文字幕" srcLang="zh" src={subtitle} default />}
            </video>}
            {secondary >= 0 && urls[secondary] && <Draggable nodeRef={overlayRef} bounds="parent" handle=".video-drag-handle">
              <div ref={overlayRef} style={{ position: "absolute", top: 12, left: 12, width: `${size}%`, opacity, visibility: size === 0 ? "hidden" : "visible" }}>
                <div className="video-drag-handle" style={{ background: "#222", color: "white", fontSize: 12, cursor: "move", padding: 3 }}>拖动副屏</div>
                <video key={`${active}:${secondary}`} ref={subRef} src={urls[secondary]} onLoadedMetadata={() => restore(subRef.current, secondary)} muted controls style={{ width: "100%", display: "block" }} />
              </div>
            </Draggable>}
          </Box>
          <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center" sx={{ display: mini ? "none" : "flex" }}>
            {urls.length > 0 && <TextField select size="small" label="主机位" value={main} sx={{ minWidth: 120 }} onChange={(e) => changeMain(+e.target.value)}>{urls.map((_, i) => <MenuItem key={i} value={i}>机位 {i + 1}</MenuItem>)}</TextField>}
            {urls.length > 1 && <TextField select size="small" label="副屏" value={secondary} sx={{ minWidth: 120 }} onChange={(e) => { remember(); setSecondary(+e.target.value); }}>
              <MenuItem value={-1}>关闭</MenuItem>{urls.map((_, i) => i !== main && <MenuItem key={i} value={i}>机位 {i + 1}</MenuItem>)}
            </TextField>}
            {secondary >= 0 && <Button onClick={() => changeMain(secondary)}>交换主副屏</Button>}
            {tracks[main] && <Button onClick={() => { enqueueVideoTrack(video, tracks[main], main); setDownloadNotice(`机位 ${main + 1} 已加入下载任务，可返回资料库查看进度`); }}>下载当前机位</Button>}
            <Button onClick={() => setSettings(!settings)}>播放设置</Button>
            <Button onClick={onSummarize}>总结本堂课</Button>
          </Stack>
          {downloadNotice && <Alert severity="success" onClose={() => setDownloadNotice("")}>{downloadNotice}</Alert>}
          <Collapse in={settings && !mini}><Stack spacing={1}>
            <FormControlLabel label="连续播放本堂课" control={<Switch checked={continuous} onChange={(_, value) => setContinuous(value)} />} />
            {secondary >= 0 && <>
              <FormControlLabel label="双屏同步" control={<Switch checked={sync} onChange={(_, value) => setSync(value)} />} />
              <Typography variant="caption">副屏大小 {size}%</Typography><Slider aria-label="副屏大小" value={size} min={0} max={50} onChange={(_, v) => setSize(v as number)} />
              <Typography variant="caption">副屏透明度</Typography><Slider aria-label="副屏透明度" value={opacity} min={0.1} max={1} step={0.05} onChange={(_, v) => setOpacity(v as number)} />
            </>}
          </Stack></Collapse>
        </Stack>
        <Stack spacing={0.5} sx={{ display: mini ? "none" : "flex" }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>本堂课 · {session.videos.length} 小节</Typography>
          {session.videos.map((item, i) => <Button key={recordingKey(item)} variant={recordingKey(item) === active ? "contained" : "text"}
            disabled={!playable(item)} onClick={() => switchVideo(recordingKey(item))} sx={{ justifyContent: "flex-start", textAlign: "left" }}>
            第 {i + 1} 小节 · {item.courseBeginTime.split(/[ T]/)[1]?.slice(0, 5) || item.videoName}
          </Button>)}
        </Stack>
      </Box>
    </CardContent>
  </Card>;
}
