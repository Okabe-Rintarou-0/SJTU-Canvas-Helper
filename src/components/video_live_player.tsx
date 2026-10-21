import WorkspaceSelect from "./workspace_select";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Hls from "hls.js";
import { Alert, Box, Button, LinearProgress, MenuItem, Stack, Typography } from "@mui/material";
import { getConfig } from "../lib/config";
import { livePlaybackURL, liveRequest } from "../lib/video_live";
import type { CanvasLiveInfo, CanvasLiveSession } from "../lib/model";

const LIVE_BUFFER_SECONDS = 30;

export default function VideoLivePlayer({ session, canvasCourseId, teachingClassId, onClose }: {
  session: CanvasLiveSession; canvasCourseId?: number; teachingClassId?: number; onClose: () => void;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls>();
  const [info, setInfo] = useState<CanvasLiveInfo>();
  const [port, setPort] = useState(0);
  const [track, setTrack] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setEnded(false); setInfo(undefined); setTrack(0);
    void (async () => {
      try {
        const [next, config] = await liveRequest(Promise.all([
          invoke<CanvasLiveInfo>("get_video_live_info", { courseId: session.id, canvasCourseId, teachingClassId }), getConfig(),
        ]));
        if (cancelled) return;
        // Validate all media origins before starting the proxy.
        next.tracks.forEach((item) => livePlaybackURL(item.url, config.proxy_port));
        if (!next.tracks.length) throw new Error("当前教室暂无可用直播机位");
        if (!await liveRequest(invoke<boolean>("prepare_proxy"))) throw new Error("直播播放代理未能启动，请重试");
        if (!cancelled) { setPort(config.proxy_port); setInfo(next); }
      } catch (e) { if (!cancelled) { setError(String(e)); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [session.id, canvasCourseId, teachingClassId, retry]);

  useEffect(() => {
    const element = media.current;
    if (!element || !info || ended) return;
    let hls: Hls | undefined;
    const url = livePlaybackURL(info.tracks[track].url, port);
    setError(""); setLoading(true);
    if (Hls.isSupported()) {
      // Cap forward loading as well as played media; maxBufferSize alone is not a hard limit.
      // Eviction works in segment units. Native HLS below uses the browser's buffer policy.
      hls = new Hls({
        lowLatencyMode: true,
        maxBufferLength: LIVE_BUFFER_SECONDS,
        maxMaxBufferLength: LIVE_BUFFER_SECONDS,
        backBufferLength: LIVE_BUFFER_SECONDS,
        frontBufferFlushThreshold: LIVE_BUFFER_SECONDS,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_, event) => {
        if (event.fatal) {
          setError("直播连接中断或播放地址已过期，请重新连接。"); setLoading(false); hls?.destroy();
        }
      });
      hls.loadSource(url); hls.attachMedia(element);
    } else if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = url;
    } else {
      setError("当前系统的浏览器内核不支持 HLS 直播播放"); setLoading(false);
    }
    return () => {
      hls?.destroy(); hlsRef.current = undefined;
      element.pause(); element.removeAttribute("src"); element.load();
    };
  }, [info, track, port, ended]);

  useEffect(() => {
    if (!info) return;
    // Keep the service deadline independent of camera switches and the system clock.
    const timer = window.setTimeout(() => setEnded(true), Math.max(0, info.finishTime - info.serverTime));
    return () => clearTimeout(timer);
  }, [info]);

  const goLive = () => {
    const element = media.current;
    const edge = hlsRef.current?.liveSyncPosition;
    if (!element) return;
    if (edge !== null && edge !== undefined) element.currentTime = edge;
    else if (element.seekable.length) element.currentTime = Math.max(0, element.seekable.end(element.seekable.length - 1) - 2);
    void element.play().catch(() => {});
  };

  return <Stack spacing={1.5}>
    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
      <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 700 }}>{session.title} · {session.beginTime}</Typography>
      <Button size="small" onClick={onClose}>关闭直播</Button>
    </Stack>
    {ended ? <Alert severity="info">本节直播已结束，可刷新录像列表查看回放。</Alert> : <>
      {error && <Alert severity="error">{error}</Alert>}
      {loading && <LinearProgress aria-label="正在连接直播" />}
      <Box sx={{ bgcolor: "#000", borderRadius: "8px", overflow: "hidden" }}>
        <video ref={media} controls autoPlay playsInline aria-label="课堂直播播放器"
          onCanPlay={() => setLoading(false)} onPlaying={() => setLoading(false)}
          onError={() => { setError("直播无法播放，请重新连接或切换机位。"); setLoading(false); }}
          style={{ width: "100%", maxHeight: "65vh", display: "block", aspectRatio: "16 / 9" }} />
      </Box>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        {!!info?.tracks.length && <WorkspaceSelect size="small" label="直播机位" value={track} onChange={(e) => setTrack(Number(e.target.value))} sx={{ minWidth: 120 }}>
          {info.tracks.map((item, index) => <MenuItem key={index} value={index}>{item.name}</MenuItem>)}
        </WorkspaceSelect>}
        <Button size="small" disabled={!info || !!error} onClick={goLive}>回到直播</Button>
        <Button size="small" onClick={() => setRetry((value) => value + 1)}>重新连接</Button>
      </Stack>
    </>}
  </Stack>;
}
