import { invoke } from "@tauri-apps/api/core";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import LiveTvRoundedIcon from "@mui/icons-material/LiveTvRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import mpegts from "mpegts.js";
import { useEffect, useRef, useState } from "react";
import liveStyles from "../css/live_panel.module.css";

import { getConfig } from "../lib/config";
import { appMessage } from "../lib/message";
import { LiveChannel, LiveInfo } from "../lib/model";
import { surfaceCardSx } from "../lib/styles";

function buildLiveProxyUrl(
  fullUrl: string,
  proxyPort: number,
  traceId: string
): string {
  try {
    const raw = fullUrl.trim();
    const source = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (source.hostname.toLowerCase() !== "mss2.sjtu.edu.cn") {
      return "";
    }
    return `http://127.0.0.1:${proxyPort}/mss-live/${traceId}${source.pathname}${source.search}`;
  } catch {
    return "";
  }
}

export default function LivePanel({ courseId }: { courseId: number }) {
  const [loading, setLoading] = useState(false);
  const [queried, setQueried] = useState(false);
  const [info, setInfo] = useState<LiveInfo | null>(null);
  const [activeChannel, setActiveChannel] = useState<LiveChannel | null>(null);
  const [playbackError, setPlaybackError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<mpegts.Player | null>(null);

  const destroyPlayer = () => {
    const player = playerRef.current;
    playerRef.current = null;
    if (player) {
      try {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      } catch {
        // 播放器销毁失败不影响后续重新播放
      }
    }
  };

  useEffect(() => {
    destroyPlayer();
    setInfo(null);
    setQueried(false);
    setActiveChannel(null);
    setPlaybackError("");
  }, [courseId]);

  useEffect(() => {
    return () => destroyPlayer();
  }, []);

  const handleQuery = async () => {
    if (courseId <= 0) {
      appMessage().warning("请先选择一个课程");
      return;
    }
    destroyPlayer();
    setActiveChannel(null);
    setPlaybackError("");
    setLoading(true);
    try {
      const liveInfo = (await invoke("get_canvas_live_info", {
        courseId,
      })) as LiveInfo;
      setInfo(liveInfo);
      setQueried(true);
      if (liveInfo.channels.length === 0) {
        appMessage().info("检测到直播场次，但没有可用的直播通道");
      }
    } catch (error) {
      setInfo(null);
      setQueried(true);
      if (String(error).includes("No live session found")) {
        appMessage().info("当前课程暂无进行中的直播");
      } else {
        appMessage().error(`获取直播信息时发生错误：${error}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = async (channel: LiveChannel) => {
    const traceId = `live_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const config = await getConfig();
    const playUrl = buildLiveProxyUrl(channel.fullUrl, config.proxy_port, traceId);
    if (!playUrl) {
      appMessage().error("学校返回的直播地址无效或来源暂不受支持，已取消播放");
      return;
    }
    if (!mpegts.isSupported()) {
      appMessage().error("当前环境不支持 MSE 播放，请复制直链使用外部播放器观看");
      return;
    }
    try {
      const ready = (await invoke("prepare_proxy", { traceId })) as boolean;
      if (!ready) {
        appMessage().error("反向代理启动超时，已取消播放");
        return;
      }
    } catch (error) {
      appMessage().error(`反向代理启动失败：${error}`);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }
    destroyPlayer();
    setPlaybackError("");

    const player = mpegts.createPlayer(
      { type: "flv", isLive: true, url: playUrl },
      { enableStashBuffer: false, liveBufferLatencyChasing: true }
    );
    player.on(mpegts.Events.ERROR, (_type, detail) => {
      setPlaybackError(`直播流加载失败（${detail}），请重试或复制直链观看`);
    });
    player.attachMediaElement(video);
    player.load();
    playerRef.current = player;
    setActiveChannel(channel);
    try {
      await player.play();
    } catch {
      // 自动播放带声音被拦截时降级为静音播放，用户可通过控件取消静音
      video.muted = true;
      try {
        await player.play();
        appMessage().info("浏览器拦截了有声自动播放，已静音开始，可在播放器中取消静音");
      } catch (error) {
        setPlaybackError(`直播播放失败：${error}`);
      }
    }
  };

  const handleStop = () => {
    destroyPlayer();
    setActiveChannel(null);
    setPlaybackError("");
  };

  const handleCopyUrl = async (channel: LiveChannel) => {
    try {
      await navigator.clipboard.writeText(channel.fullUrl);
      appMessage().success("直播直链已复制，可粘贴到支持 FLV 的播放器观看", 0.5);
    } catch (error) {
      appMessage().error(`复制失败：${error}`);
    }
  };

  const expired = info ? info.liveEndTime > 0 && Date.now() > info.liveEndTime : false;

  return (
    <Card sx={surfaceCardSx}>
      <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ xs: "stretch", sm: "flex-start" }}
            justifyContent="space-between"
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <LiveTvRoundedIcon color={info && !expired ? "error" : "inherit"} />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  课堂直播
                </Typography>
                {info && !expired ? (
                  <Chip size="small" color="error" label="直播中" />
                ) : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                查询所选课程正在进行的课堂直播，支持双通道（教师 / 课件）在线观看。
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={
                loading ? (
                  <CircularProgress size={16} />
                ) : queried ? (
                  <RefreshRoundedIcon />
                ) : (
                  <LiveTvRoundedIcon />
                )
              }
              disabled={loading || courseId <= 0}
              onClick={() => void handleQuery()}
            >
              {loading ? "查询中..." : queried ? "刷新直播" : "查询直播"}
            </Button>
          </Stack>

          {queried && !info ? (
            <Alert severity="info" sx={{ borderRadius: "8px" }}>
              当前课程暂无进行中的直播。
            </Alert>
          ) : null}

          {info ? (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {info.subjName ? (
                  <Chip size="small" color="primary" variant="outlined" label={info.subjName} />
                ) : null}
                {info.classroom ? (
                  <Chip size="small" variant="outlined" label={`教室：${info.classroom}`} />
                ) : null}
                <Chip
                  size="small"
                  variant="outlined"
                  color={expired ? "warning" : "default"}
                  label={`预计结束：${info.liveEndTime > 0 ? new Date(info.liveEndTime).toLocaleString() : "未知"}`}
                />
              </Stack>
              {expired ? (
                <Alert severity="warning" sx={{ borderRadius: "8px" }}>
                  直播可能已结束，直链可能失效；可点击“刷新直播”获取最新场次。
                </Alert>
              ) : null}

              <Stack spacing={1}>
                {info.channels.map((channel, index) => (
                  <Stack
                    key={`${channel.name}-${index}`}
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    alignItems={{ xs: "stretch", sm: "center" }}
                    justifyContent="space-between"
                    sx={{
                      p: 1.25,
                      borderRadius: "8px",
                      border: "1px solid",
                      borderColor:
                        activeChannel === channel ? "primary.main" : "divider",
                    }}
                  >
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      {channel.name || `通道 ${index + 1}`}
                    </Typography>
                    <Stack direction="row" spacing={1} flexShrink={0}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopyRoundedIcon />}
                        onClick={() => void handleCopyUrl(channel)}
                      >
                        复制直链
                      </Button>
                      {activeChannel === channel ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<StopRoundedIcon />}
                          onClick={handleStop}
                        >
                          停止
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PlayArrowRoundedIcon />}
                          onClick={() => void handlePlay(channel)}
                        >
                          播放
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          ) : null}

          {/* video 必须常驻挂载：handlePlay 在设置 activeChannel 之前就要拿到 videoRef */}
          <Box
            sx={{
              display: activeChannel ? "block" : "none",
              position: "relative",
              borderRadius: "8px",
              overflow: "hidden",
              bgcolor: "#000",
            }}
          >
            <video
              className={liveStyles.liveVideo}
              ref={videoRef}
              controls
              autoPlay
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                display: "block",
                objectFit: "contain",
                background: "#000",
              }}
            />
            {playbackError ? (
              <Alert
                severity="warning"
                sx={{
                  position: "absolute",
                  left: 16,
                  right: 16,
                  bottom: 52,
                  zIndex: 3,
                }}
              >
                {playbackError}
              </Alert>
            ) : null}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
