import { enqueueTask } from "../lib/task_runtime";
import { useLegacyTasks } from "../lib/task_hooks";
import { open as openOutput } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import ClosedCaptionRoundedIcon from "@mui/icons-material/ClosedCaptionRounded";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import SmartDisplayRoundedIcon from "@mui/icons-material/SmartDisplayRounded";
import SwapHorizRoundedIcon from "@mui/icons-material/SwapHorizRounded";
import VideoLibraryRoundedIcon from "@mui/icons-material/VideoLibraryRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Slider,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DraggableData, DraggableEvent } from "react-draggable";
import Draggable from "react-draggable";
import { Link as RouterLink } from "react-router-dom";

import ClosableAlert from "../components/closable_alert";
import CourseSelect from "../components/course_select";
import FileAIChatModal, {
  FileAIChatMessage,
} from "../components/file_ai_chat_modal";
import BasicLayout from "../components/layout";
import PPTDownloadTable from "../components/ppt_download_table";
import VideoAggregator from "../components/video_aggregator";
import VideoDownloadTable from "../components/video_download_table";
import { WorkspaceHero } from "../components/workspace_hero";
import videoStyles from "../css/video_player.module.css";
import { getConfig, saveConfig } from "../lib/config";
import { VIDEO_PAGE_HINT_ALERT_KEY } from "../lib/constants";
import { useCourses } from "../lib/hooks";
import { compareVideoCourses, loadVideoCourse, mergeVideoCourses } from "../lib/video_courses";
import { useAppMessage } from "../lib/message";
import { useTauriEvent } from "../lib/events";
import {
  CanvasVideo,
  Course,
  DownloadTask,
  LLMChatMessage,
  LOG_LEVEL_ERROR,
  VideoDownloadTask,
  VideoInfo,
  VideoPlayInfo,
} from "../lib/model";
import { consoleLog, srtToVtt } from "../lib/utils";

import { surfaceCardSx } from "../lib/styles";

function timestampToSeconds(timestamp: string): number {
  const match = timestamp.match(/^\[(\d{2}):(\d{2}):(\d{2}),(\d{1,3})\]$/);
  if (!match) {
    return 0;
  }

  const [, hh, mm, ss] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function isSubtitleUnavailableError(error: unknown): boolean {
  return String(error).includes("Subtitle unavailable");
}

function isVideoUnavailableError(error: unknown): boolean {
  return String(error).includes("No playable video source");
}

function videoSourceLabel(source: CanvasVideo["source"]): string {
  return {
    canvas: "Canvas",
    videoSpace: "视频空间",
    legacy: "旧版课堂视频",
  }[source];
}

const videoOptionId = (video: CanvasVideo) => `${video.source}:${video.videoId}`;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label}请求超时（${timeoutMs / 1000} 秒）`)),
      timeoutMs
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export default function VideoPage() {
  const videoDownloadTasks = useLegacyTasks<VideoDownloadTask>("video", ["video"]);
  const pptDownloadTasks = useLegacyTasks<DownloadTask>("video", ["ppt"]);
  const [operating, setOperating] = useState(false);
  const [videosLoading, setVideosLoading] = useState(false);
  const canvasCourses = useCourses();
  const [spaceCourses, setSpaceCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState("");
  const [courseRefresh, setCourseRefresh] = useState(0);
  const mergedCourses = useMemo(
    () => mergeVideoCourses(canvasCourses.data, spaceCourses),
    [canvasCourses.data, spaceCourses]
  );
  const courses = { data: mergedCourses };
  const [messageApi, contextHolder] = useAppMessage();
  const [plays, setPlays] = useState<VideoPlayInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<CanvasVideo | undefined>();
  const [selectedCourseId, setSelectedCourseId] = useState(-1);
  const [videos, setVideos] = useState<CanvasVideo[]>([]);
  const [notLogin, setNotLogin] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded || notLogin) return;
    let cancelled = false;
    setCoursesLoading(true);
    setCoursesError("");
    setSpaceCourses([]);
    void (async () => {
      const spaceTask = withTimeout(
        invoke<Course[]>("list_video_space_courses"),
        30_000,
        "视频空间"
      ).then((result) => {
        if (!cancelled) setSpaceCourses(result);
        return result;
      });
      const [spaceResult] = await Promise.allSettled([spaceTask]);
      if (!cancelled) {
        const errors: string[] = [];
        if (spaceResult.status === "rejected") {
          errors.push(`视频空间：${String(spaceResult.reason)}`);
        }
        setCoursesError(errors.join("；"));
        setCoursesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loaded, notLogin, courseRefresh]);
  const [playURLs, setPlayURLs] = useState<string[]>([]);
  const [mainPlayURL, setMainPlayURL] = useState("");
  const [mutedPlayURL, setMutedPlayURL] = useState("");
  const [syncPlay, setSyncPlay] = useState(true);
  const [subVideoSize, setSubVideoSize] = useState<number>(25);
  const [subVideoOpacity, setSubVideoOpacity] = useState(0.8);
  const [subVideoPos, setSubVideoPos] = useState({ x: 100, y: 100 });
  const [subtitleUrl, setSubtitleUrl] = useState<string | undefined>(undefined);
  const [summaryChatOpen, setSummaryChatOpen] = useState(false);
  const [summaryChatTitle, setSummaryChatTitle] = useState("");
  const [summaryChatCourseId, setSummaryChatCourseId] = useState<number | null>(null);
  const [summaryChatMessages, setSummaryChatMessages] = useState<FileAIChatMessage[]>([]);
  const [summaryChatLoading, setSummaryChatLoading] = useState(false);
  const [showLoginRequiredDialog, setShowLoginRequiredDialog] = useState(false);
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const subVideoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const firstPlay = useRef(true);
  const activeSummaryRequestIdRef = useRef<string | null>(null);

  const LinkRenderer = (props: any) => (
    <a
      target="_blank"
      rel="noreferrer"
      onClick={() => handleMainVideoJump(timestampToSeconds(props.children))}
    >
      {props.children}
    </a>
  );

  const createConversationMessage = (
    role: "user" | "assistant",
    content: string,
    extras?: Partial<FileAIChatMessage>
  ): FileAIChatMessage => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extras,
  });

  const toLLMChatMessages = (messages: FileAIChatMessage[]): LLMChatMessage[] =>
    messages
      .filter((message) => !message.pending)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

  const handleLoginWebsite = async () => {
    try {
      await invoke("login_canvas_website");
      return true;
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      return false;
    }
  };

  useEffect(() => {
    void loginAndCheck();
    return () => {
      if (!firstPlay.current) {
        void invoke("stop_proxy");
      }
    };
  }, []);

  useEffect(() => {
    if (loaded && notLogin) {
      setShowLoginRequiredDialog(true);
    }
  }, [loaded, notLogin]);

  useTauriEvent("video_ai_chat://chunk", (payload) => {
    if (payload.request_id !== activeSummaryRequestIdRef.current) {
      return;
    }
    setSummaryChatMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === "assistant") {
          next[i] = {
            ...next[i],
            content: `${next[i].content}${payload.chunk}`,
          };
          break;
        }
      }
      return next;
    });
  });

  useTauriEvent("video_ai_chat://done", (payload) => {
    if (payload.request_id !== activeSummaryRequestIdRef.current) {
      return;
    }
    activeSummaryRequestIdRef.current = null;
    setSummaryChatLoading(false);
    setSummaryChatMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === "assistant") {
          next[i] = {
            ...next[i],
            content: payload.content || next[i].content,
            pending: false,
          };
          break;
        }
      }
      return next;
    });
  });

  useTauriEvent("video_ai_chat://error", (payload) => {
    if (payload.request_id !== activeSummaryRequestIdRef.current) {
      return;
    }
    activeSummaryRequestIdRef.current = null;
    setSummaryChatLoading(false);
    messageApi.error(`AI 总结时发生错误：${payload.error}`);
    setSummaryChatMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === "assistant") {
          next[i] = {
            ...next[i],
            content: next[i].content || `AI 总结时发生错误：${payload.error}`,
            pending: false,
            error: true,
          };
          break;
        }
      }
      return next;
    });
  });

  const loginAndCheck = async (retry = false) => {
    const config = await getConfig(true);
    const success = await handleLoginWebsite();
    if (!success) {
      config.ja_auth_cookie = "";
      await saveConfig(config);
    } else if (!retry) {
      messageApi.success("检测到登录会话，登录成功", 0.5);
    } else {
      messageApi.success("登录成功", 0.5);
    }
    setNotLogin(!success);
    setLoaded(true);
    return success;
  };

  const handleSelectCourse = async (selected: number) => {
    setOperating(true);
    setVideosLoading(selected !== -1);
    setSelectedCourseId(selected);
    setVideos([]);
    setSelectedVideo(undefined);
    setPlayURLs([]);
    setPlays([]);
    setMainPlayURL("");
    setMutedPlayURL("");
    try {
      if (selected !== -1) await handleGetVideos(selected);
    } finally {
      setVideosLoading(false);
      setOperating(false);
    }
  };

  const getVideoInfo = (video: CanvasVideo) => invoke<VideoInfo>("get_video_play_info", {
    source: video.source,
    videoId: video.videoId,
  });

  const handleGetVideoInfo = async (video: CanvasVideo) => {
    if (!video.playable) {
      messageApi.info(`该录像${video.availabilityLabel}，暂时无法播放`);
      return;
    }
    try {
      const videoInfo = await getVideoInfo(video);
      const nextPlays = videoInfo.videoPlayResponseVoList;
      nextPlays.forEach((play, index) => {
        play.key = play.id;
        play.index = index;
        const part = index === 0 ? "" : `_录屏`;
        const suffix = index > 2 ? `_${index}.mp4` : ".mp4";
        play.name = `${video.videoName}${part}${suffix}`;
      });
      setPlays(nextPlays);
    } catch (error) {
      if (isVideoUnavailableError(error)) {
        messageApi.info("该录像暂时没有可播放的视频源");
      } else {
        messageApi.error(`获取视频信息时出现错误：${error}`);
      }
    }
  };

  const handleSelectVideo = async (selected: string) => {
    const video = videos.find((item) => videoOptionId(item) === selected);
    if (video) {
      setPlays([]);
      setPlayURLs([]);
      setMainPlayURL("");
      setMutedPlayURL("");
      setSelectedVideo(video);
      await handleGetVideoInfo(video);
    }
  };

  const handleGetVideos = async (courseId: number) => {
    try {
      const course = mergedCourses.find((item) => item.id === courseId);
      if (!course) return;
      const nextVideos = await loadVideoCourse(
        course,
        (id) => invoke<CanvasVideo[]>("get_canvas_videos", { courseId: id }),
        (id) => invoke<CanvasVideo[]>("get_video_space_videos", { teachingClassId: id }),
        (id) => invoke<CanvasVideo[]>("get_legacy_videos", {
          courseId: id,
          courseName: course.name,
          termName: course.term.name,
          teacherNames: course.teachers.map((teacher) => teacher.display_name),
        }),
      );
      setVideos(nextVideos);
    } catch (error) {
      messageApi.error(`获取录像时发生了错误：${error}`);
    }
  };

  const handleDownloadVideo = (video: VideoPlayInfo) => {
    enqueueTask({
      id: `video:${video.id}:${video.name}`, name: video.name, source: "video", kind: "video",
      context: courses.data.find((course) => course.id === selectedCourseId)?.name,
      data: { video }, event: { channel: "video_download://progress", id: `${video.id}` },
      locks: [`save:${video.name}`], stage: "正在下载",
      run: () => invoke("download_video", { video, saveName: video.name }),
      open: () => invoke("open_file", { name: video.name }),
    });
  };

  const handleDownloadSubtitle = async () => {
    if (!selectedVideo) {
      messageApi.warning("请先选择一个视频");
      return;
    }
    if (selectedVideo.source === "legacy") {
      messageApi.info("旧版课堂视频不提供字幕");
      return;
    }
    try {
      const outputPath = await save({
        defaultPath: `${selectedVideo.videoName}.srt`,
        filters: [{ name: "Subtitle", extensions: ["srt"] }],
      });
      if (!outputPath) {
        return;
      }
      const videoInfo = await getVideoInfo(selectedVideo);
      await invoke("download_subtitle", {
        canvasCourseId: videoInfo.courId,
        savePath: outputPath,
      });
      messageApi.success("字幕下载成功", 0.5);
    } catch (error) {
      if (isSubtitleUnavailableError(error)) {
        messageApi.info("该录像暂无字幕，无法下载");
      } else {
        messageApi.error(`下载字幕时发生错误：${error}`);
      }
    }
  };

  const handleSummarizeSubtitle = async () => {
    if (!selectedVideo) {
      messageApi.warning("请先选择一个视频");
      return;
    }
    if (selectedVideo.source === "legacy") {
      messageApi.info("旧版课堂视频不提供字幕，暂时无法进行 AI 总结");
      return;
    }
    try {
      const videoInfo = await getVideoInfo(selectedVideo);
      const openingUserMessage = createConversationMessage(
        "user",
        "请先总结这节课的核心内容。重点关注课程活动与通知、作业/小测/考试/签到提醒，以及主要知识点与框架；如果合适，请引用对应的字幕时间点。"
      );
      const pendingAssistantMessage = createConversationMessage("assistant", "", {
        pending: true,
      });

      setSummaryChatTitle(selectedVideo.videoName);
      setSummaryChatCourseId(videoInfo.courId);
      setSummaryChatOpen(true);
      setSummaryChatLoading(true);
      setSummaryChatMessages([openingUserMessage, pendingAssistantMessage]);

      const requestId = crypto.randomUUID();
      activeSummaryRequestIdRef.current = requestId;
      await invoke("start_subtitle_chat_stream", {
        requestId,
        canvasCourseId: videoInfo.courId,
        messages: toLLMChatMessages([openingUserMessage]),
      });
    } catch (error) {
      activeSummaryRequestIdRef.current = null;
      setSummaryChatLoading(false);
      if (isSubtitleUnavailableError(error)) {
        setSummaryChatOpen(false);
        messageApi.info("该录像暂无字幕，暂时无法进行 AI 总结");
      } else {
        messageApi.error(`AI 总结时发生错误：${error}`);
      }
    }
  };

  const handleSendSummaryMessage = async (content: string) => {
    if (!summaryChatCourseId || summaryChatLoading) {
      return;
    }

    const userMessage = createConversationMessage("user", content);
    const pendingAssistantMessage = createConversationMessage("assistant", "", {
      pending: true,
    });
    const nextMessages = [...summaryChatMessages, userMessage];

    setSummaryChatLoading(true);
    setSummaryChatMessages([...nextMessages, pendingAssistantMessage]);

    try {
      const requestId = crypto.randomUUID();
      activeSummaryRequestIdRef.current = requestId;
      await invoke("start_subtitle_chat_stream", {
        requestId,
        canvasCourseId: summaryChatCourseId,
        messages: toLLMChatMessages(nextMessages),
      });
    } catch (error) {
      activeSummaryRequestIdRef.current = null;
      setSummaryChatLoading(false);
      messageApi.error(`继续对话时发生错误：${error}`);
      setSummaryChatMessages([
        ...nextMessages,
        {
          ...pendingAssistantMessage,
          content: `继续对话时发生错误：${error}`,
          pending: false,
          error: true,
        },
      ]);
    }
  };

  const handleDownloadPPT = async (videoId: string, saveName: string) => {
    if (!selectedVideo) return;
    if (selectedVideo.source === "legacy") {
      messageApi.info("旧版课堂视频不提供 PPT 切片");
      return;
    }
    const videoInfo = await getVideoInfo({ ...selectedVideo, videoId });
    const courseId = videoInfo.courId;
    const outputPath = await save({
      defaultPath: saveName,
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    if (!outputPath) {
      return;
    }

    const displayName = outputPath.split(/[/\\\\]/).pop() || saveName;
    const taskKey = `ppt_${outputPath}`;

    enqueueTask({
      id: taskKey, name: displayName, outputPath, source: "video", kind: "ppt",
      context: courses.data.find((course) => course.id === selectedCourseId)?.name,
      data: { name: displayName, outputPath }, stage: "正在下载 PPT 切片",
      event: { channel: "ppt_download://progress", id: `ppt_${displayName}` },
      locks: [`path:${outputPath.toLowerCase()}`],
      run: () => invoke("download_ppt", { courseId, savePath: outputPath }),
      open: () => openOutput(outputPath),
    });
  };

  const getVidePlayURL = (
    play: VideoPlayInfo,
    proxyPort: number,
    source?: CanvasVideo["source"],
  ) => {
    try {
      const upstream = new URL(play.rtmpUrlHdv);
      if (upstream.hostname === "videos.sjtu.edu.cn" && upstream.pathname.startsWith("/vod/")) {
        const route = source === "legacy" ? "legacy-vod" : "canvas-vod";
        return `http://localhost:${proxyPort}/${route}/${upstream.pathname.slice(5)}${upstream.search}`;
      }
      if (upstream.hostname === "live.sjtu.edu.cn" && upstream.pathname.startsWith("/vod/")) {
        return `http://localhost:${proxyPort}${upstream.pathname}${upstream.search}`;
      }
      if (upstream.hostname === "live.sjtu.edu.cn") {
        return `http://localhost:${proxyPort}/canvas-live${upstream.pathname}${upstream.search}`;
      }
    } catch {
      // Keep the original URL so the player can surface a useful media error.
    }
    return play.rtmpUrlHdv;
  };

  const checkOrStartProxy = async (): Promise<boolean> => {
    if (!firstPlay.current) return true;
    messageApi.open({
      key: "proxy_preparing",
      type: "loading",
      content: "正在启动反向代理...",
      duration: 0,
    });
    try {
      const succeed = await invoke<boolean>("prepare_proxy");
      messageApi.destroy("proxy_preparing");
      if (!succeed) {
        messageApi.error("反向代理启动超时");
        void invoke("stop_proxy");
        return false;
      }
      firstPlay.current = false;
      messageApi.success("反向代理启动成功", 0.5);
      return true;
    } catch (error) {
      messageApi.destroy("proxy_preparing");
      messageApi.error(`反向代理启动失败：${error}`);
      return false;
    }
  };

  const handlePlay = async (play: VideoPlayInfo) => {
    const config = await getConfig();
    const playURL = getVidePlayURL(play, config.proxy_port, selectedVideo?.source);
    const needsProxy = playURL.startsWith(`http://localhost:${config.proxy_port}/`);
    if (playURL === mainPlayURL || playURL === mutedPlayURL) {
      messageApi.warning("已经在播放啦");
      return;
    }
    if (mainPlayURL && mutedPlayURL) {
      messageApi.error("目前只支持双屏观看");
      return;
    }
    if (needsProxy && !(await checkOrStartProxy())) return;

    if (!mainPlayURL) {
      setMainPlayURL(playURL);
      setMutedPlayURL("");
      setPlayURLs([playURL]);
      return;
    }

    if (!mutedPlayURL) {
      if (play.index === 0) {
        setMutedPlayURL(mainPlayURL);
        setMainPlayURL(playURL);
        setPlayURLs([playURL, mainPlayURL]);
      } else {
        setMutedPlayURL(playURL);
        setPlayURLs([mainPlayURL, playURL]);
      }
      return;
    }

    if (play.index !== 0 || playURL !== mainPlayURL) {
      setMutedPlayURL(playURL);
    }
    setPlayURLs((urls) => [...urls, playURL]);
  };

  const handleSwapVideo = () => {
    if (playURLs.length === 2 && mainPlayURL && mutedPlayURL) {
      const mainVideo = mainVideoRef.current;
      const subVideo = subVideoRef.current;
      if (!mainVideo || !subVideo) {
        return;
      }

      const mainState = {
        currentTime: mainVideo.currentTime,
        paused: mainVideo.paused,
        playbackRate: mainVideo.playbackRate,
      };
      const subState = {
        currentTime: subVideo.currentTime,
        paused: subVideo.paused,
        playbackRate: subVideo.playbackRate,
      };

      setMainPlayURL(mutedPlayURL);
      setMutedPlayURL(mainPlayURL);

      setTimeout(() => {
        const newMain = mainVideoRef.current;
        const newSub = subVideoRef.current;
        if (newMain && newSub) {
          newMain.currentTime = subState.currentTime;
          newMain.playbackRate = subState.playbackRate;
          newSub.currentTime = mainState.currentTime;
          newSub.playbackRate = mainState.playbackRate;
          if (!subState.paused) {
            void newMain.play();
          } else {
            newMain.pause();
          }
          if (!mainState.paused) {
            void newSub.play();
          } else {
            newSub.pause();
          }
        }
      }, 200);
    }
  };

  const handleMainVideoJump = (time: number) => {
    if (!mainVideoRef.current) {
      messageApi.warning("当前未播放视频");
      return;
    }
    mainVideoRef.current.currentTime = time;
  };

  const noSubVideo = !mutedPlayURL;
  const subVideoSizes = [0, 10, 20, 25, 33, 40, 50];

  const positionSubVideo = () => {
    const container = playerContainerRef.current;
    if (!container || !mutedPlayURL) {
      return;
    }

    const padding = 24;
    const containerWidth = container.clientWidth;
    const overlayWidth = (containerWidth * subVideoSize) / 100;
    const maxX = Math.max(padding, containerWidth - overlayWidth - padding);
    setSubVideoPos({ x: maxX, y: padding });
  };

  const hookVideoHandlers = (swap: boolean) => {
    const mainVideo = mainVideoRef.current;
    const subVideo = subVideoRef.current;
    if (!mainVideo || !subVideo) {
      return;
    }

    if (!swap) {
      subVideo.currentTime = mainVideo.currentTime;
      if (!mainVideo.paused) {
        void subVideo.play();
      }
    }

    subVideo.onplay = null;
    mainVideo.onplay = () => void subVideo?.play();

    subVideo.onpause = null;
    mainVideo.onpause = () => subVideo?.pause();

    subVideo.onratechange = null;
    mainVideo.onratechange = () => {
      if (subVideo && mainVideo) {
        subVideo.playbackRate = mainVideo.playbackRate;
      }
    };

    subVideo.onseeked = null;
    mainVideo.onseeked = () => {
      if (subVideo && mainVideo) {
        subVideo.currentTime = mainVideo.currentTime;
      }
    };
  };

  useEffect(() => {
    if (!noSubVideo && syncPlay) {
      hookVideoHandlers(false);
    }
  }, [playURLs, noSubVideo, syncPlay]);

  useEffect(() => {
    if (!noSubVideo && syncPlay) {
      hookVideoHandlers(true);
    }
  }, [mainPlayURL, noSubVideo, syncPlay]);

  useEffect(() => {
    if (!mutedPlayURL) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      positionSubVideo();
    });

    const handleResize = () => positionSubVideo();
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, [mutedPlayURL, subVideoSize]);

  useEffect(() => {
    const fetchSubtitle = async () => {
      if (!selectedVideo || !mainPlayURL) {
        setSubtitleUrl(undefined);
        return;
      }
      if (selectedVideo.source === "legacy") {
        setSubtitleUrl(undefined);
        return;
      }
      try {
        const videoInfo = await getVideoInfo(selectedVideo);
        const srt = (await invoke("get_subtitle", {
          canvasCourseId: videoInfo.courId,
        })) as string;
        const vtt = srtToVtt(srt);
        const blob = new Blob([vtt], { type: "text/vtt" });
        const url = URL.createObjectURL(blob);
        setSubtitleUrl(url);
      } catch {
        setSubtitleUrl(undefined);
      }
    };
    void fetchSubtitle();
  }, [mainPlayURL, selectedVideo]);

  const selectedCourse = courses.data.find((course) =>
    course.id === selectedCourseId
  );
  const supportsEnrichment = selectedVideo?.source !== "legacy";

  return (
    <BasicLayout>
      {contextHolder}
      <Stack spacing={3}>
        <ClosableAlert
          alertType="info"
          message="提示"
          configKey={VIDEO_PAGE_HINT_ALERT_KEY}
          description="依次点击主屏幕和副屏幕的播放按钮即可开启双窗口模式。"
        />

        {loaded && notLogin ? (
          <Alert
            severity="info"
            sx={{ borderRadius: "8px" }}
            action={
              <Button component={RouterLink} to="/settings" color="inherit" size="small">
                前往设置
              </Button>
            }
          >
            视频功能依赖额外扫码登录。你可以前往设置页，在“额外扫码登录”区域完成登录后再回来使用。
          </Alert>
        ) : null}

        <Dialog
          open={showLoginRequiredDialog && loaded && notLogin}
          onClose={() => setShowLoginRequiredDialog(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>需要额外登录</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <Typography variant="body1">
                视频相关功能需要额外扫码登录后才能使用。
              </Typography>
              <Typography variant="body2" color="text.secondary">
                登录入口已经放到设置页，你可以在那里主动完成扫码并保存登录态。
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setShowLoginRequiredDialog(false)}>稍后再说</Button>
            <Button
              component={RouterLink}
              to="/settings"
              variant="contained"
              onClick={() => setShowLoginRequiredDialog(false)}
            >
              前往设置页
            </Button>
          </DialogActions>
        </Dialog>

        <WorkspaceHero
          chipLabel="视频管理"
          chipIcon={<SmartDisplayRoundedIcon />}
          title="视频中心"
          description="选择课程录像，下载视频、字幕、PPT，并支持双屏同步播放。"
          aside={
            !notLogin ? (
              <Box
                sx={{
                width: { xs: "100%", lg: 680 },
                alignSelf: { xs: "stretch", lg: "flex-start" },
                }}
              >
                <Stack spacing={1.5}>
                  <CourseSelect
                    courses={courses.data}
                    compareCourses={compareVideoCourses}
                    disabled={operating || canvasCourses.isLoading}
                    onChange={(courseId) => void handleSelectCourse(courseId)}
                    value={selectedCourseId !== -1 ? selectedCourseId : undefined}
                    getSourceLabel={(course) => mergedCourses.find((item) => item.id === course.id)?.sourceLabel}
                  />
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      alignItems={{ xs: "stretch", sm: "center" }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {coursesLoading && (
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.5 }}>
                            <CircularProgress size={16} thickness={5} />
                            <Typography variant="caption" color="text.secondary">
                              正在同步视频空间课程，Canvas 课程已可直接选择
                            </Typography>
                          </Stack>
                        )}
                        {coursesError && <Alert severity="warning">部分视频来源读取失败：{coursesError}。仍可选择其他来源，或刷新重试。</Alert>}
                        {!coursesLoading && !coursesError && courses.data.length === 0 && (
                          <Alert severity="info">暂无可用课程。</Alert>
                        )}
                      </Box>
                      <Button disabled={operating || canvasCourses.isLoading} onClick={() => {
                        void handleSelectCourse(-1);
                        setCourseRefresh((value) => value + 1);
                        void canvasCourses.mutate();
                      }}>刷新课程</Button>
                    </Stack>
                </Stack>
              </Box>
            ) : undefined
          }
          stats={[
            {
              label: "课程视频",
              value: videos.length,
              icon: <VideoLibraryRoundedIcon />,
            },
            {
              label: "播放片段",
              value: plays.length,
              icon: <ClosedCaptionRoundedIcon />,
            },
            {
              label: "视频任务",
              value: videoDownloadTasks.length,
              icon: <CloudDownloadRoundedIcon />,
            },
            {
              label: "PPT 任务",
              value: pptDownloadTasks.length,
              icon: <PictureAsPdfRoundedIcon />,
            },
          ]}
          footer={
            <Stack spacing={1.5}>
              {!notLogin ? (
                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: {
                      xs: "minmax(0, 1fr)",
                      xl: "minmax(0, 1.1fr) auto",
                    },
                    alignItems: "start",
                  }}
                >
                  <Stack spacing={0.75}>
                    <TextField
                      select
                      label="选择视频"
                      disabled={operating || videosLoading || videos.length === 0}
                      value={selectedVideo ? videoOptionId(selectedVideo) : ""}
                      onChange={(event) =>
                        void handleSelectVideo(String(event.target.value))
                      }
                      helperText={
                        videosLoading
                          ? "正在汇总当前课程的录像…"
                          : selectedVideo
                            ? `当前视频：${selectedVideo.videoName}`
                            : selectedCourse && videos.length === 0
                              ? "该课程暂无可用录像"
                              : "选择一个课程后，这里会展示该课程的视频列表。"
                      }
                    >
                      {videos.map((video) => (
                      <MenuItem
                        key={videoOptionId(video)}
                        value={videoOptionId(video)}
                        disabled={!video.playable}
                      >
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          sx={{ width: "100%" }}
                        >
                          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                            {`${video.videoName} ${video.courseBeginTime}`}
                          </Typography>
                          <Stack
                            direction="row"
                            spacing={0.75}
                            sx={{ ml: "auto", flexShrink: 0 }}
                          >
                            <Chip
                              size="small"
                              label={videoSourceLabel(video.source)}
                              variant="outlined"
                            />
                            {!video.playable && (
                              <Chip
                                size="small"
                                label={video.availabilityLabel}
                                color={
                                  video.availability === "repairing"
                                    ? "warning"
                                    : "default"
                                }
                                variant="outlined"
                              />
                            )}
                          </Stack>
                        </Stack>
                      </MenuItem>
                      ))}
                    </TextField>
                    {videosLoading && (
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.5 }}>
                        <CircularProgress size={16} thickness={5} />
                        <Typography variant="caption" color="text.secondary">
                          正在读取新版课堂、视频空间和旧版课堂视频
                        </Typography>
                      </Stack>
                    )}
                  </Stack>

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} useFlexGap flexWrap="wrap">
                    <Button
                      variant="outlined"
                      startIcon={<ClosedCaptionRoundedIcon />}
                      onClick={() => void handleDownloadSubtitle()}
                      disabled={!selectedVideo || !supportsEnrichment}
                    >
                      下载字幕
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<PictureAsPdfRoundedIcon />}
                      onClick={() =>
                        void handleDownloadPPT(
                          selectedVideo?.videoId || "",
                          `${selectedVideo?.videoName}.pdf`
                        )
                      }
                      disabled={!selectedVideo || !supportsEnrichment}
                    >
                      下载 PPT
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={<PsychologyRoundedIcon />}
                      onClick={() => void handleSummarizeSubtitle()}
                      disabled={!selectedVideo || !supportsEnrichment}
                    >
                      AI 总结
                    </Button>
                  </Stack>
                </Box>
              ) : null}

              {selectedCourse ? (
                <Chip label={selectedCourse.name} color="primary" variant="outlined" />
              ) : null}
            </Stack>
          }
        />

        {!notLogin ? (
          <>
            <Card sx={surfaceCardSx}>
              <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                <Stack spacing={2}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      播放片段
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      主屏一般是黑板视角，录屏轨道可作为副屏或下载对象。
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      borderRadius: "8px",
                      border: "1px solid",
                      borderColor: "divider",
                      overflow: "auto",
                    }}
                  >
                    <Table sx={{ minWidth: 720 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>视频名</TableCell>
                          <TableCell align="right">操作</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {plays.map((play) => (
                          <TableRow key={play.id} hover>
                            <TableCell>{play.name}</TableCell>
                            <TableCell align="right">
                              <Stack
                                direction="row"
                                spacing={1}
                                justifyContent="flex-end"
                                flexWrap="wrap"
                                useFlexGap
                              >
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => handleDownloadVideo(play)}
                                >
                                  下载
                                </Button>
                                <Button
                                  size="small"
                                  variant="contained"
                                  onClick={() => void handlePlay(play)}
                                >
                                  播放
                                </Button>
                              </Stack>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Card sx={surfaceCardSx}>
              <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      播放控制
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      可调节副屏尺寸、透明度，并在双轨播放时切换主副屏。
                    </Typography>
                  </Box>

                  <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ xs: "stretch", md: "center" }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={syncPlay}
                          onChange={(event) => setSyncPlay(event.target.checked)}
                          disabled={noSubVideo}
                        />
                      }
                      label="同步播放"
                    />
                    <Button
                      variant="outlined"
                      startIcon={<SwapHorizRoundedIcon />}
                      disabled={noSubVideo}
                      onClick={handleSwapVideo}
                    >
                      主副屏切换
                    </Button>
                    <TextField
                      select
                      label="副屏尺寸"
                      value={subVideoSize}
                      onChange={(event) => setSubVideoSize(Number(event.target.value))}
                      disabled={noSubVideo}
                      sx={{ width: { xs: "100%", md: 180 } }}
                    >
                      {subVideoSizes.map((size) => (
                        <MenuItem key={size} value={size}>
                          副屏：{size}%
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>

                  {!noSubVideo ? (
                    <Box sx={{ width: { xs: "100%", md: 360 } }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        副屏透明度
                      </Typography>
                      <Slider
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={subVideoOpacity}
                        onChange={(_, value) => setSubVideoOpacity(value as number)}
                      />
                    </Box>
                  ) : null}
                </Stack>
              </CardContent>
            </Card>

            <Card sx={surfaceCardSx}>
              <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
                <Stack spacing={2}>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    播放器
                  </Typography>
                  <Box
                    className={videoStyles.videoPlayerContainer}
                    sx={{
                      borderRadius: "8px",
                      overflow: "hidden",
                      bgcolor: "#000",
                    }}
                  >
                    <Box
                      ref={playerContainerRef}
                      sx={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "16 / 9",
                        minHeight: 360,
                        bgcolor: "#000",
                      }}
                    >
                      {mainPlayURL ? (
                        <video
                          ref={mainVideoRef}
                          controls
                          autoPlay={false}
                          src={mainPlayURL}
                          muted={false}
                          width="100%"
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "block",
                            objectFit: "contain",
                            background: "#000",
                          }}
                        >
                          {subtitleUrl ? (
                            <track
                              label="字幕"
                              kind="subtitles"
                              src={subtitleUrl}
                              srcLang="zh"
                              default
                            />
                          ) : null}
                        </video>
                      ) : (
                        <Box
                          sx={{
                            position: "absolute",
                            inset: 0,
                            display: "grid",
                            placeItems: "center",
                            color: "#fff",
                          }}
                        >
                          <Stack spacing={1.25} alignItems="center">
                            <VideoLibraryRoundedIcon sx={{ fontSize: 44, opacity: 0.8 }} />
                            <Typography variant="body1">选择片段后在这里开始播放</Typography>
                          </Stack>
                        </Box>
                      )}

                      {!noSubVideo && mutedPlayURL ? (
                        <Draggable
                          bounds="parent"
                          position={subVideoPos}
                          onStop={(_: DraggableEvent, data: DraggableData) =>
                            setSubVideoPos({ x: data.x, y: data.y })
                          }
                          disabled={noSubVideo}
                        >
                          <div
                            style={{
                              position: "absolute",
                              zIndex: 1000,
                              opacity: subVideoOpacity,
                              pointerEvents: noSubVideo ? "none" : "auto",
                              width: `${subVideoSize}%`,
                              left: 0,
                              top: 0,
                              display: mutedPlayURL ? "block" : "block",
                              boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                              borderRadius: 12,
                              background: "#000",
                              overflow: "hidden",
                            }}
                          >
                            <video
                              ref={subVideoRef}
                              controls
                              autoPlay={false}
                              src={mutedPlayURL}
                              muted
                              style={{
                                width: "100%",
                                height: "100%",
                                display: "block",
                                objectFit: "contain",
                                background: "#000",
                              }}
                            />
                          </div>
                        </Draggable>
                      ) : null}
                    </Box>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <VideoDownloadTable tasks={videoDownloadTasks} />
            <PPTDownloadTable tasks={pptDownloadTasks} />
          </>
        ) : null}

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={2}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                视频合并
              </Typography>
              <VideoAggregator />
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <FileAIChatModal
        open={summaryChatOpen}
        title={summaryChatTitle}
        messages={summaryChatMessages}
        loading={summaryChatLoading}
        onClose={() => setSummaryChatOpen(false)}
        onSend={handleSendSummaryMessage}
        dialogTitle="AI 视频会话"
        dialogDescription="围绕当前视频字幕持续追问，AI 会结合字幕内容和时间点继续回答。"
        contextLabel="当前视频"
        emptyText="正在为当前视频创建第一条 AI 总结消息。"
        inputPlaceholder="继续追问这节课，例如：老师提到的作业要求是什么？考试范围出现在哪些时间点？"
        footerIdleText="提问会保留在当前会话中，后续回答会继续参考这段视频字幕。"
        markdownComponents={{ code: LinkRenderer as any }}
      />
    </BasicLayout>
  );
}
