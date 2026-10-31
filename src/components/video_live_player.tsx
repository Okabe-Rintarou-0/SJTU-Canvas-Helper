import WorkspaceSelect from "./workspace_select";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Hls from "hls.js";
import { Alert, Box, Button, LinearProgress, MenuItem, Stack, Typography } from "@mui/material";
import { getConfig } from "../lib/config";
import { livePlaybackURL, liveRequest } from "../lib/video_live";
import { exitVideoPictureInPicture, isVideoInPictureInPicture, restoreVideoPictureInPicture } from "../lib/video_picture_in_picture";
import type { CanvasLiveInfo, CanvasLiveSession } from "../lib/model";
import { PlaybackProxyError, preparePlaybackProxy } from "../lib/playback_proxy";
import PlaybackProxyAlert from "./playback_proxy_alert";

const LIVE_BUFFER_SECONDS = 30;

export default function VideoLivePlayer({ session, nextSession, canvasCourseId, teachingClassId, onClose }: {
  session: CanvasLiveSession; nextSession?: CanvasLiveSession; canvasCourseId?: number; teachingClassId?: number; onClose: () => void;
}) {
  const media = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls>();
  const releaseSource = useRef<() => void>();
  const selectedCamera = useRef("");
  const wantsPlayback = useRef(true);
  const sourceChanging = useRef(false);
  const restorePip = useRef(false);
  const pipAttempted = useRef(false);
  const mounted = useRef(false);
  const activeSession = useRef(session.id);
  const [source, setSource] = useState<{ info: CanvasLiveInfo; sessionId: string; deadline: number; port: number }>();
  const [track, setTrack] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [proxyError, setProxyError] = useState<PlaybackProxyError>();
  const [retrying, setRetrying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [needsPip, setNeedsPip] = useState(false);
  const info = source?.info;

  const rememberPip = (element: HTMLVideoElement) => {
    if (isVideoInPictureInPicture(element)) restorePip.current = true;
    sourceChanging.current = true;
    pipAttempted.current = false;
  };

  const restorePictureInPicture = () => {
    const element = media.current;
    if (!element || !restorePip.current) return;
    pipAttempted.current = true;
    void restoreVideoPictureInPicture(element).then(() => {
      if (!mounted.current) { void exitVideoPictureInPicture(element).catch(() => {}); return; }
      restorePip.current = false;
      setNeedsPip(false);
    }).catch(() => { if (mounted.current && restorePip.current) setNeedsPip(true); });
  };

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    mounted.current = true;
    const entered = () => { restorePip.current = false; setNeedsPip(false); };
    const left = () => {
      // Explicit exits stay exited; resetting the source can also force an exit.
      if (!sourceChanging.current) { restorePip.current = false; setNeedsPip(false); }
    };
    const presentationChanged = () => isVideoInPictureInPicture(element) ? entered() : left();
    element.addEventListener("enterpictureinpicture", entered);
    element.addEventListener("leavepictureinpicture", left);
    element.addEventListener("webkitpresentationmodechanged", presentationChanged);
    return () => {
      mounted.current = false;
      element.removeEventListener("enterpictureinpicture", entered);
      element.removeEventListener("leavepictureinpicture", left);
      element.removeEventListener("webkitpresentationmodechanged", presentationChanged);
      void exitVideoPictureInPicture(element).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const continuing = activeSession.current !== session.id;
    activeSession.current = session.id;
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    setLoading(true); setError(""); setProxyError(undefined); setRetrying(false); setEnded(false); setNeedsPlay(false); setNeedsPip(false);
    // Retain the media element while the next lesson is loading.
    const load = async () => {
      try {
        const [next, config] = await liveRequest(Promise.all([
          invoke<CanvasLiveInfo>("get_video_live_info", { courseId: session.id, canvasCourseId, teachingClassId }), getConfig(),
        ]));
        const receivedAt = performance.now();
        if (cancelled) return;
        // Validate all media origins before starting the proxy.
        next.tracks.forEach((item) => livePlaybackURL(item.url, config.proxy_port));
        if (!next.tracks.length) throw new Error("当前教室暂无可用直播机位");
        await liveRequest(preparePlaybackProxy(config.proxy_port));
        if (cancelled) return;
        const camera = Math.max(0, next.tracks.findIndex((item) => item.name === selectedCamera.current));
        setTrack(camera); selectedCamera.current = next.tracks[camera].name;
        setSource({ info: next, sessionId: session.id, deadline: receivedAt + next.finishTime - next.serverTime, port: config.proxy_port });
        setError(""); setRetrying(false);
      } catch (e) {
        if (cancelled) return;
        // The service may open the next stream a little after its scheduled start.
        if (continuing && attempts < 5 && !(e instanceof PlaybackProxyError)) {
          setError("下一节直播暂未就绪，正在自动重试。"); setRetrying(true);
          timer = window.setTimeout(() => void load(), Math.min(30_000, 2000 * 2 ** attempts++));
        } else { setError(String(e)); setProxyError(e instanceof PlaybackProxyError ? e : undefined); setRetrying(false); setLoading(false); }
      }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session.id, canvasCourseId, teachingClassId, retry]);

  useEffect(() => {
    const element = media.current;
    if (!element || !source) return;
    const video = element;
    let hls: Hls | undefined;
    let released = false;
    const url = livePlaybackURL(source.info.tracks[track].url, source.port);
    setError(""); setLoading(true);
    sourceChanging.current = true;
    pipAttempted.current = false;
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
          setError("直播连接中断或播放地址已过期，请重新连接。"); setLoading(false); release();
        }
      });
      hls.loadSource(url); hls.attachMedia(element);
    } else if (element.canPlayType("application/vnd.apple.mpegurl")) {
      element.src = url;
    } else {
      setError("当前系统的浏览器内核不支持 HLS 直播播放"); setLoading(false);
    }
    function release() {
      if (released) return;
      released = true;
      rememberPip(video);
      hls?.destroy(); hlsRef.current = undefined;
      video.pause(); video.removeAttribute("src"); video.load();
    }
    releaseSource.current = release;
    return release;
  }, [source, track]);

  useEffect(() => {
    if (!source) return;
    // Keep the service deadline independent of camera switches and the system clock.
    const timer = window.setTimeout(() => {
      if (activeSession.current === source.sessionId) setEnded(true);
    }, Math.max(0, source.deadline - performance.now()));
    return () => clearTimeout(timer);
  }, [source]);

  useEffect(() => {
    if (!ended || source?.sessionId !== session.id) return;
    hlsRef.current?.stopLoad();
    // Keep the media attached for PiP during the break before a following lesson.
    if (!nextSession) {
      const element = media.current;
      if (element) void exitVideoPictureInPicture(element).catch(() => {});
      releaseSource.current?.(); restorePip.current = false;
    }
  }, [ended, source, session.id, nextSession]);

  const play = () => {
    const element = media.current;
    if (!element) return;
    void element.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (mounted.current && wantsPlayback.current && activeSession.current === source?.sessionId) {
        setNeedsPlay(true); setLoading(false);
      }
    });
  };
  const ready = () => {
    if (ended || source?.sessionId !== session.id) return;
    sourceChanging.current = false;
    setLoading(false);
    if (wantsPlayback.current) play();
    if (restorePip.current && !pipAttempted.current) restorePictureInPicture();
  };

  const goLive = () => {
    const element = media.current;
    const edge = hlsRef.current?.liveSyncPosition;
    if (!element) return;
    if (edge !== null && edge !== undefined) element.currentTime = edge;
    else if (element.seekable.length) element.currentTime = Math.max(0, element.seekable.end(element.seekable.length - 1) - 2);
    wantsPlayback.current = true;
    play();
  };

  return <Stack spacing={1.5}>
    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
      <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 700 }}>{session.title} · {session.beginTime}</Typography>
      <Button size="small" onClick={onClose}>关闭直播</Button>
    </Stack>
    {ended && <Alert severity="info">{nextSession ? "本节直播已结束，等待下一节自动接续。" : "本节直播已结束，可刷新录像列表查看回放。"}</Alert>}
    {!ended && error && (proxyError
      ? <PlaybackProxyAlert error={proxyError} onRetry={() => setRetry((value) => value + 1)} retryLabel="重新连接" />
      : <Alert severity={retrying ? "warning" : "error"}>{error}</Alert>)}
    {!ended && loading && <LinearProgress aria-label="正在连接直播" />}
    <Box hidden={ended && !nextSession} sx={{ bgcolor: "#000", borderRadius: "8px", overflow: "hidden" }}>
      <video ref={media} controls playsInline aria-label="课堂直播播放器"
        onCanPlay={ready} onPlaying={() => { setLoading(false); setNeedsPlay(false); }}
        onPlay={() => { wantsPlayback.current = true; setNeedsPlay(false); }}
        onPause={(event) => {
          if (!sourceChanging.current && !event.currentTarget.ended && !event.currentTarget.error) wantsPlayback.current = false;
        }}
        onError={() => { setProxyError(undefined); setError("直播无法播放，请重新连接或切换机位。"); setLoading(false); }}
        style={{ width: "100%", maxHeight: "65vh", display: "block", aspectRatio: "16 / 9" }} />
    </Box>
    {!ended && <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
      {!!info?.tracks.length && <WorkspaceSelect size="small" label="直播机位" value={track} onChange={(e) => {
        const index = Number(e.target.value);
        selectedCamera.current = info.tracks[index].name;
        setTrack(index);
      }} sx={{ minWidth: 120 }}>
        {info.tracks.map((item, index) => <MenuItem key={index} value={index}>{item.name}</MenuItem>)}
      </WorkspaceSelect>}
      <Button size="small" disabled={!info || !!error} onClick={goLive}>回到直播</Button>
      {!proxyError && <Button size="small" onClick={() => setRetry((value) => value + 1)}>重新连接</Button>}
      {needsPlay && <Button size="small" onClick={() => { wantsPlayback.current = true; play(); }}>继续播放</Button>}
      {needsPip && <Button size="small" onClick={restorePictureInPicture}>恢复画中画</Button>}
    </Stack>}
    {nextSession && <Typography variant="caption" color="text.secondary">下一节：{nextSession.beginTime}，开始后自动接续。</Typography>}
  </Stack>;
}
