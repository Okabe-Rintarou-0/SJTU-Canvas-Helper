import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, Box, Button, Card, CardContent, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import { surfaceCardSx } from "../lib/styles";
import { liveRequest, liveSessionStatus, liveStatusLabels, nextLiveSession } from "../lib/video_live";
import type { CanvasLiveList, CanvasLiveSession } from "../lib/model";
import VideoLivePlayer from "./video_live_player";

export default function VideoLivePanel({ canvasCourseId, teachingClassId, refresh, playback, onPlay, visible = true }: {
  canvasCourseId?: number; teachingClassId?: number; refresh: number; playback: "live" | "recording"; onPlay: () => void; visible?: boolean;
}) {
  const [list, setList] = useState<CanvasLiveList>();
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState<CanvasLiveSession>();
  const nextSession = active ? nextLiveSession(active, list?.sessions ?? [], now) : undefined;
  const followingLive = !!active && playback === "live" && (now < active.finishTime || !!nextSession);
  const shouldPoll = visible || followingLive;

  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true; setLoading(true);
      try {
        const next = await liveRequest(invoke<CanvasLiveList>("get_video_live_sessions", { canvasCourseId, teachingClassId }));
        if (!cancelled) { setList(next); setClockOffset(next.serverTime - Date.now()); setNow(next.serverTime); setError(""); }
      } catch (e) { if (!cancelled) setError(String(e)); }
      finally { inFlight = false; if (!cancelled) setLoading(false); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [canvasCourseId, teachingClassId, refresh, reload, shouldPoll]);

  useEffect(() => {
    if (!shouldPoll) return;
    const updateClock = () => setNow(Date.now() + clockOffset);
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateClock);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", updateClock);
      document.removeEventListener("visibilitychange", updateClock);
    };
  }, [clockOffset, shouldPoll]);

  useEffect(() => {
    if (!followingLive || !active || now < active.finishTime) return;
    if (nextSession && now >= nextSession.startTime) setActive(nextSession);
  }, [followingLive, active, nextSession, now]);

  const sessions = [...(list?.sessions ?? [])].sort((a, b) => a.startTime - b.startTime);
  const liveCount = sessions.filter((session) => liveSessionStatus(session, now) === "live").length;
  return <Card sx={surfaceCardSx}><CardContent sx={{ p: { xs: 2, md: 2.5 } }}><Stack spacing={2}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>课堂直播</Typography>
        <Typography variant="body2" color="text.secondary">{liveCount > 0 ? `${liveCount} 节正在直播 · ` : ""}直播开始后可选择机位观看。</Typography>
      </Box>
      <Button size="small" sx={{ flexShrink: 0 }} disabled={loading} onClick={() => setReload((value) => value + 1)}>刷新直播</Button>
    </Stack>
    {loading && <LinearProgress aria-label="正在读取直播" />}
    {error && <Alert severity={list ? "warning" : "error"}>读取直播失败：{error}。可点击刷新直播重试。</Alert>}
    {active && playback === "live" && <VideoLivePlayer session={active} nextSession={nextSession} canvasCourseId={canvasCourseId} teachingClassId={teachingClassId} onClose={() => setActive(undefined)} />}
    {sessions.map((session) => {
      const status = liveSessionStatus(session, now);
      return <Stack key={session.id} direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} gap={1} sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1.5 }}>
        <Box sx={{ flex: 1 }}><Typography variant="body2">{session.beginTime}–{session.endTime.split(" ")[1]?.slice(0, 5)}</Typography>
          <Typography variant="caption" color="text.secondary">{[session.teacherName, session.classroomName].filter(Boolean).join(" · ")}</Typography></Box>
        <Stack direction="row" alignItems="center" gap={1}>
          <Chip size="small" variant="outlined" color={status === "live" ? "primary" : "default"} label={liveStatusLabels[status]} />
          <Button size="small" disabled={status !== "live"} onClick={() => { onPlay(); setActive(session); }}>观看直播</Button>
        </Stack>
      </Stack>;
    })}
    {!sessions.length && !loading && !error && <Typography variant="body2" color="text.secondary">本课程当前暂无直播安排。</Typography>}
  </Stack></CardContent></Card>;
}
