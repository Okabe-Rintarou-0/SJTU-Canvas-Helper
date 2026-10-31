import WorkspaceSelect from "../components/workspace_select";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress, Menu, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import SmartDisplayRoundedIcon from "@mui/icons-material/SmartDisplayRounded";
import { WorkspaceHero } from "../components/workspace_hero";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import { alpha } from "@mui/material/styles";
import BasicLayout from "../components/layout";
import CourseSelect from "../components/course_select";
import { VideoLibraryTaskQueue } from "../components/video_library_tasks";
import VideoAggregator from "../components/video_aggregator";
import VideoLibraryPlayer from "../components/video_library_player";
import VideoLivePanel from "../components/video_live_panel";
import VideoSummarySources from "../components/video_summary_sources";
import VideoSummaryScope from "../components/video_summary_scope";
import FileAIChatModal from "../components/file_ai_chat_modal";
import { useCourses, useConfigSelector } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { compareVideoCourses, loadVideoCourse, mergeVideoCourses } from "../lib/video_courses";
import { canSummarizeRecording, groupVideoSessions, groupSessionsByDate, parseVideoCitation, formatVideoTimestamp, recordingKey, recordingTime, selectedSessionScopes, toggleRecordings, type VideoExportOptions, type VideoSession } from "../lib/video_library";
import { enqueueVideoExports, saveRecordingMaterial } from "../lib/video_library_tasks";
import { readSummaryCache, summaryCacheKey, withSummaryModelIdentity, PPT_CLEANUP_POLICY, type VideoSummaryCache } from "../lib/video_summary_cache";
import type { AccountInfo, CanvasVideo, Course } from "../lib/model";
import { useAISession } from "../lib/ai_session_store";
import { videoSummarySession } from "../lib/video_summary_session";
import { videoSummaryOptions } from "../lib/video_summary_config";
import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from "../lib/llm_config";
import { surfaceCardSx } from "../lib/styles";
import { subscribeAppData } from "../lib/app_data";
import { inspectSummaryScope, type SummaryPreflight } from "../lib/video_summary_preflight";
import { readVideoTopics, recordingTopic, validVideoTopic } from "../lib/video_topics";
import { downloadCourseContext, downloadDirectory, type DownloadCourse } from "../lib/downloads";

const isPlayable = (video: CanvasVideo) => video.playable || !!video.alternatives?.some((v) => v.playable);
const hasSubtitleSource = (video: CanvasVideo) => [video, ...(video.alternatives ?? [])].some((v) => v.source !== "legacy");
function withTimeout<T>(promise: Promise<T>, timeout = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("请求超时，请刷新重试")), timeout);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export default function VideoPage({ active = true }: { active?: boolean }) {
  const canvas = useCourses();
  const centerOnly = useConfigSelector((state) => state.config.data?.experimental_task_center_only === true);
  const pptCleanupEnabled = useConfigSelector((state) => state.config.data?.experimental_ppt_cleanup === true);
  const generateTopics = useConfigSelector((state) => state.config.data?.experimental_video_topics === true);
  const [refresh, setRefresh] = useState(0);
  const [account, setAccount] = useState<string>();
  const [topicState, setTopicState] = useState<{ owner?: string; values: Record<string, string> }>({ values: {} });
  const [topicError, setTopicError] = useState("");
  const topics = useMemo(() => topicState.owner === account ? topicState.values : {}, [topicState, account]);
  const updateTopic = useCallback((key: string, topic: string) => {
    if (account && validVideoTopic(topic)) setTopicState((previous) => ({ owner: account, values: { ...(previous.owner === account ? previous.values : {}), [key]: topic } }));
  }, [account]);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const values = await readVideoTopics(account);
        if (!cancelled && current === revision) { setTopicState({ owner: account, values }); setTopicError(""); }
      } catch { if (!cancelled && current === revision) setTopicError("课程主题读取失败，可刷新重试"); }
    };
    void load();
    const unsubscribe = subscribeAppData((change) => {
      if (change.account === account && (!change.collection || change.collection === "video-recording-topics")) void load();
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [account, refresh]);
  const aiConfig = useConfigSelector((state) => state.config.data);
  const summaryOptions = videoSummaryOptions(aiConfig ?? undefined);
  const activeLlm = aiConfig?.llm_api_keys?.find((entry) => entry.name === aiConfig.llm_active_api_key);
  const modelIdentity = JSON.stringify([activeLlm?.base_url || aiConfig?.llm_base_url || DEFAULT_LLM_BASE_URL,
    activeLlm?.model || aiConfig?.llm_model || DEFAULT_LLM_MODEL, aiConfig?.llm_temperature ?? null]);
  const summary = useAISession(videoSummarySession);
  const { open: chatOpen, title: chatTitle, scopes: chatScope, messages: chatMessages,
    loading: chatLoading, progress: chatProgress, coverage, cacheNotice } = summary;
  const setChatOpen = (open: boolean) => videoSummarySession.update({ open });
  const [cachedSummaries, setCachedSummaries] = useState<VideoSummaryCache[]>([]);
  const [historyError, setHistoryError] = useState("");
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const entries = await readSummaryCache(account);
        if (!cancelled && current === revision) { setCachedSummaries(entries); setHistoryError(""); }
      } catch (error) {
        if (!cancelled && current === revision) { setCachedSummaries([]); setHistoryError(`读取视频总结历史失败：${error}`); }
      }
    };
    void load();
    const unsubscribe = subscribeAppData((change) => {
      if (change.account === account && (!change.collection || change.collection === "video-summaries")) void load();
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [account]);
  const [cacheListOpen, setCacheListOpen] = useState(false);
  const [playerMini, setPlayerMini] = useState(false);
  const [playback, setPlayback] = useState<"live" | "recording">("recording");
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => { let cancelled = false; void invoke<AccountInfo>("read_account_info").then((info) => { if (!cancelled) setAccount(info.current_account); }).catch(() => {}); return () => { cancelled = true; }; }, []);
  const [space, setSpace] = useState<Course[]>([]);
  const courses = useMemo(() => mergeVideoCourses(canvas.data, space), [canvas.data, space]);
  const [courseId, setCourseId] = useState<number>();
  const selectedCourse = courses.find((course) => course.id === courseId);
  const cacheNamespace = account && selectedCourse ? `${JSON.stringify([account, selectedCourse.canvasId, selectedCourse.teachingClassId, selectedCourse.name, selectedCourse.term.name, modelIdentity])}:${PPT_CLEANUP_POLICY}=${Number(pptCleanupEnabled)}` : "";
  const courseSummaries = cachedSummaries.filter((entry) => entry.namespace === cacheNamespace);
  const [login, setLogin] = useState<"checking" | "ready" | "required">("checking");
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [videos, setVideos] = useState<CanvasVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(new Set<string>());
  const [expanded, setExpanded] = useState(new Map<string, boolean>());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [toolsAnchor, setToolsAnchor] = useState<HTMLElement | null>(null);
  const [aggregator, setAggregator] = useState(false);
  const [downloadScopes, setDownloadScopes] = useState<VideoSession[]>();
  const [downloadCourse, setDownloadCourse] = useState<DownloadCourse>();
  const [exporting, setExporting] = useState(false);
  const [exportOptions, setExportOptions] = useState<VideoExportOptions>({ video: true, ppt: false, subtitle: false, pptPerSession: true, tracks: "all" });
  const [player, setPlayer] = useState<{ session: VideoSession; key: string; seconds: number; nonce: string; course?: DownloadCourse }>();
  const [aiScopes, setAiScopes] = useState<VideoSession[]>();
  const [aiOrganization, setAiOrganization] = useState("sessions");
  const [aiTranscribe, setAiTranscribe] = useState(true);
  const [preflight, setPreflight] = useState<SummaryPreflight>();
  const [preflightRevision, setPreflightRevision] = useState(0);
  useEffect(() => {
    if (!aiScopes) return;
    let cancelled = false;
    setPreflight(undefined);
    void inspectSummaryScope(aiScopes).then((status) => { if (!cancelled) setPreflight(status); });
    return () => { cancelled = true; };
  }, [aiScopes, preflightRevision]);
  const offerTranscription = !!preflight?.needsTranscription && !preflight.unknown;

  const summaryDialogCache = aiScopes && cachedSummaries.find((entry) => entry.key === summaryCacheKey(cacheNamespace, aiScopes, aiOrganization, summaryOptions, aiTranscribe));
  useEffect(() => {
    if (!active) {
      setToolsAnchor(null);
      setDownloadScopes(undefined); setAiScopes(undefined);
      setCacheListOpen(false); setAggregator(false);
    }
  }, [active]);
  const [messageApi, contextHolder] = useAppMessage();
  const sessions = useMemo(() => groupVideoSessions(videos), [videos]);
  const dateGroups = useMemo(() => groupSessionsByDate(sessions.map((session) => ({ session }))), [sessions]);
  const scopes = useMemo(() => selectedSessionScopes(sessions, selected), [sessions, selected]);
  const visible = useMemo(() => sessions.flatMap((session) => {
    const matching = session.videos.filter((video) => {
      const matchesQuery = `${session.title} ${video.videoName} ${video.courseBeginTime} ${recordingTopic(video, topics) ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
      return matchesQuery && (status === "all" || (status === "ready" ? isPlayable(video) : !isPlayable(video)));
    });
    return matching.length ? [{ session, matching }] : [];
  }), [sessions, query, status, topics]);
  const visibleDates = useMemo(() => groupSessionsByDate(visible), [visible]);
  const visibleVideos = visible.flatMap((item) => item.matching);
  const visibleKeys = new Set(visibleVideos.map(recordingKey));
  const hiddenSelected = [...selected].filter((key) => !visibleKeys.has(key)).length;

  useEffect(() => {
    let cancelled = false;
    setLogin("checking");
    void withTimeout(invoke("login_canvas_website"), 90_000).then(() => { if (!cancelled) setLogin("ready"); })
      .catch(() => { if (!cancelled) setLogin("required"); });
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    if (login !== "ready") return;
    let cancelled = false;
    setCourseLoading(true); setCourseError("");
    void withTimeout(invoke<Course[]>("list_video_space_courses")).then((next) => { if (!cancelled) setSpace(next); })
      .catch((e) => { if (!cancelled) setCourseError(String(e)); })
      .finally(() => { if (!cancelled) setCourseLoading(false); });
    return () => { cancelled = true; };
  }, [login, refresh]);

  useEffect(() => {
    if (!selectedCourse || login !== "ready") return;
    let cancelled = false;
    setLoading(true); setLoadError("");
    void loadVideoCourse(selectedCourse,
      (id) => withTimeout(invoke("get_canvas_videos", { courseId: id })),
      (id) => withTimeout(invoke("get_video_space_videos", { teachingClassId: id })),
      (id) => withTimeout(invoke("get_legacy_videos", { courseId: id, courseName: selectedCourse.name, termName: selectedCourse.term.name, teacherNames: selectedCourse.teachers.map((t) => t.display_name) })),
    ).then((next) => {
      if (cancelled) return;
      setVideos(next);
      const keys = new Set(next.map(recordingKey));
      setSelected((previous) => new Set([...previous].filter((key) => keys.has(key))));
    }).catch((e) => { if (!cancelled) setLoadError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCourse, login, refresh]);

  const chatSessionId = chatMessages[0]?.id;
  useEffect(() => { if (active && (!playerMini || chatOpen)) workspaceRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [active, player?.nonce, playerMini, chatOpen, chatSessionId]);

  const changeCourse = useCallback((id: number) => {
    setCourseId(id === -1 ? undefined : id); setVideos([]); setSelected(new Set()); setExpanded(new Map());
    setQuery(""); setStatus("all"); setPlayer(undefined); setLoadError(""); videoSummarySession.clearMaterials();
  }, []);
  const play = (session: VideoSession, key?: string, seconds = 0) => {
    if (!player) setPlayerMini(false);
    const video = key ? session.videos.find((v) => recordingKey(v) === key) : session.videos.find(isPlayable);
    if (!video) { messageApi.info("本堂课暂无可播放录像"); return; }
    setPlayback("recording");
    setPlayer({ session, key: recordingKey(video), seconds, nonce: crypto.randomUUID(), course: selectedCourse ? downloadCourseContext(selectedCourse) : undefined });
  };
  const download = (next: VideoSession[], kind?: "ppt" | "subtitle") => {
    setDownloadScopes(next); setDownloadCourse(selectedCourse ? downloadCourseContext(selectedCourse) : undefined);
    if (kind) setExportOptions((previous) => ({ ...previous, video: false, ppt: kind === "ppt", subtitle: kind === "subtitle" }));
  };
  const downloadCount = downloadScopes?.reduce((count, scope) => count + scope.videos.length, 0) ?? 0;
  const singleDownload = downloadCount === 1 ? downloadScopes?.[0].videos[0] : undefined;
  const canMergePpt = downloadScopes?.some((scope) => scope.videos.length > 1) ?? false;
  const submitDownload = async (saveAs = false) => {
    if (!downloadScopes || !downloadCourse || exporting) return;
    setExporting(true);
    try {
      const defaultPath = saveAs ? await downloadDirectory("root").catch(() => undefined) : await downloadDirectory("root");
      const directory = saveAs ? await open({ directory: true, multiple: false, title: "选择本次下载根目录（其下按学期、课程和资料类型归档）", defaultPath }) : defaultPath;
      if (!directory || Array.isArray(directory)) return;
      const count = await enqueueVideoExports(downloadScopes, exportOptions, directory, downloadCourse);
      messageApi.success(`已加入 ${count} 个导出任务，可在${centerOnly ? "任务中心" : "下方下载任务列表"}查看进度`); setDownloadScopes(undefined);
    } catch (e) { messageApi.error(`创建任务失败：${e}`); }
    finally { setExporting(false); }
  };
  const saveSingle = async (video: CanvasVideo, kind: "ppt" | "subtitle") => {
    if (exporting) return;
    setExporting(true);
    try { if (await saveRecordingMaterial(video, kind, downloadCourse)) { messageApi.success("已加入下载任务"); setDownloadScopes(undefined); } }
    catch (e) { messageApi.error(`创建任务失败：${e}`); }
    finally { setExporting(false); }
  };
  const saveAsDownload = () => {
    if (singleDownload && !exportOptions.video && exportOptions.ppt !== exportOptions.subtitle) {
      void saveSingle(singleDownload, exportOptions.ppt ? "ppt" : "subtitle");
    } else void submitDownload(true);
  };
  const restoreSummary = (entry: VideoSummaryCache, currentScopes = entry.scopes) => {
    videoSummarySession.restore(entry, currentScopes, account);
    setAiOrganization(entry.organization); setAiTranscribe(entry.transcribeMissing !== false); setAiScopes(undefined); setCacheListOpen(false);
  };
  const summarize = (next: VideoSession[]) => {
    if (chatLoading) { setChatOpen(true); messageApi.info("请等待当前总结完成后再切换范围"); return; }
    const organization = next.length > 1 ? "sessions" : "combined";
    setAiScopes(next); setAiOrganization(organization); setAiTranscribe(true);
  };
  const startSummary = async (force = false, requested = aiScopes, organization = aiOrganization, namespace = cacheNamespace, titleOverride?: string, transcribeMissing = aiTranscribe) => {
    if (!requested || videoSummarySession.getSnapshot().loading) return;
    setAiScopes(undefined);
    namespace = withSummaryModelIdentity(namespace, modelIdentity);
    await videoSummarySession.start({ scopes: requested, organization, namespace, force, cleanUpPpt: pptCleanupEnabled, summaryOptions, transcribeMissing, generateTopics,
      title: titleOverride ?? `${selectedCourse?.name ?? "课程"} · ${requested.reduce((n, s) => n + s.videos.length, 0)} 小节` });
  };
  const sendMessage = async (content: string) => {
    if (!videoSummarySession.getSnapshot().text) { messageApi.info("没有可用课堂资料，请重新选择小节并总结"); return; }
    await videoSummarySession.send(content);
  };
  const check = (items: CanvasVideo[], label: string) => {
    const count = items.filter((v) => selected.has(recordingKey(v))).length;
    return <Checkbox size="small" inputProps={{ "aria-label": label }} checked={!!items.length && count === items.length} indeterminate={count > 0 && count < items.length}
      disabled={!items.length} onChange={() => setSelected((previous) => toggleRecordings(previous, items))} />;
  };
  const toggleExpanded = (id: string, currentlyExpanded: boolean) => setExpanded((previous) => new Map(previous).set(id, !currentlyExpanded));

  const sourceNames = (items: CanvasVideo[]) => [...new Set(items.flatMap((v) => [v, ...(v.alternatives ?? [])]).map((v) => ({ canvas: "Canvas", videoSpace: "视频空间", legacy: "旧版" })[v.source]))].join(" / ");
  const rowActions = (scope: VideoSession, playbackScope = scope, key?: string) => <TableCell align="right"><Stack direction="row" gap={0.5} justifyContent="flex-end" sx={{ whiteSpace: "nowrap" }}>
    <Button size="small" sx={{ minWidth: 40 }} disabled={!scope.videos.some(isPlayable)} onClick={() => play(playbackScope, key)}>播放</Button>
    <Button size="small" sx={{ minWidth: 40 }} onClick={() => download([scope])}>下载</Button>
    <Button size="small" sx={{ minWidth: 64 }} disabled={!scope.videos.some(canSummarizeRecording)} onClick={() => summarize([scope])}>AI 总结</Button>
  </Stack></TableCell>;
  const chatPanel = <FileAIChatModal embedded loadingLabel={chatProgress || "等待模型回复"} open={chatOpen} title={`${chatTitle} · ${chatScope.map((scope) => scope.title).join("；")}`} messages={chatMessages} loading={chatLoading} onClose={() => setChatOpen(false)} onSend={sendMessage} input={summary.input} onInputChange={(input) => videoSummarySession.update({ input })}
      dialogTitle="AI 课堂总结" dialogDescription={chatProgress || ""}
      contextLabel="会话范围" emptyText="正在读取所选小节资料" inputPlaceholder="继续追问知识点、作业或通知…" footerIdleText="点击时间引用可跳转录像"
      markdownComponents={{ a: ({ href, children }) => {
        const citation = parseVideoCitation(href);
        if (!citation || citation.seconds === undefined) return <span>{children}</span>;
        return <a href={href} onClick={(event) => {
          event.preventDefault(); const session = chatScope.find((s) => s.videos.some((v) => recordingKey(v) === citation.key));
          if (session) play(session, citation.key, citation.seconds);
        }} title="跳转到此小节的对应时间">{formatVideoTimestamp(citation.seconds)}</a>;
      } }} />

  const learningPanels = <Box ref={workspaceRef} sx={{ scrollMarginTop: 16, display: "grid", gridTemplateColumns: player && !playerMini && chatOpen ? { xs: "minmax(0, 1fr)", md: "minmax(0, 1.2fr) minmax(340px, 1fr)" } : "minmax(0, 1fr)", gap: 2, alignItems: "start" }}>
        {player && <VideoLibraryPlayer course={player.course} topics={topics} onTopicChange={updateTopic} onMiniChange={setPlayerMini} session={player.session} initialKey={player.key} seconds={player.seconds} seekRequest={player.nonce} onClose={() => setPlayer(undefined)} onSummarize={(video) => summarize([{ ...player.session, id: recordingKey(video), title: `${player.session.title} · ${video.courseBeginTime?.slice(11, 16) || video.videoName}`, videos: [video] }])} />}
        {chatOpen && <Card sx={{ ...surfaceCardSx, minWidth: 0 }}><Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={{ px: 2, pt: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2">{cacheNotice}</Typography>
            <VideoSummarySources sources={summary.sources} legacyCoverage={coverage} />
          </Box>
          <Button disabled={chatLoading || !chatScope.length} onClick={() => void startSummary(true, chatScope, summary.organization, summary.namespace, chatTitle, summary.transcribeMissing)}>重新生成</Button>
          <Button disabled={chatLoading || !summary.cacheEntry} onClick={() => { void videoSummarySession.deleteCache().then((deleted) => { if (!deleted) messageApi.error("删除历史失败"); }); }}>删除历史</Button>
          <Button onClick={() => setChatOpen(false)}>收起总结</Button>
        </Stack>{chatPanel}</Card>}
      </Box>;

  return <BasicLayout active={active} contentKey="video-workspace">
    {contextHolder}
    <Stack spacing={2} sx={{ width: "100%" }}>
      <WorkspaceHero
        chipLabel="视频管理"
        chipIcon={<SmartDisplayRoundedIcon />}
        title="视频中心"
        description="观看课堂直播，按课堂浏览录像，批量下载视频、PPT 和字幕，或总结课堂内容。"
        aside={
          <Box sx={{ width: { xs: "100%", lg: 640 } }}>
            <CourseSelect
              courses={courses}
              value={courseId}
              onChange={changeCourse}
              compareCourses={compareVideoCourses}
              disabled={login !== "ready"}
            />
          </Box>
        }
      />
      {selectedCourse && login === "ready" && <VideoLivePanel visible={active} key={selectedCourse.id} canvasCourseId={selectedCourse.canvasId} teachingClassId={selectedCourse.teachingClassId} refresh={refresh} playback={playback} onPlay={() => { setPlayer(undefined); setPlayback("live"); }} />}
      {historyError && <Alert severity="warning">{historyError}</Alert>}
          {topicError && <Alert severity="warning">{topicError}</Alert>}
      {(player || chatOpen) && learningPanels}
      <Card sx={{ ...surfaceCardSx, overflow: "visible" }}>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ sm: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>课堂录像</Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedCourse ? `${sessions.length} 堂课 · ${videos.length} 小节` : "选择课程后，展开课堂查看小节录像。"}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {chatMessages.length > 0 && <Button onClick={() => setChatOpen(true)}>{chatLoading ? "AI 处理中" : "上次总结"}</Button>}
                {!!courseSummaries.length && <Button disabled={chatLoading} onClick={() => setCacheListOpen(true)}>已保存总结 · {courseSummaries.length}</Button>}
                <Button variant="outlined" startIcon={<MoreHorizRoundedIcon />} onClick={(e) => setToolsAnchor(e.currentTarget)}>更多工具</Button>
              </Stack>
            </Stack>
            {login === "checking" && <LinearProgress aria-label="检查视频登录" />}
            {login === "required" && <Alert severity="info" action={<Button component={RouterLink} to="/settings">前往设置</Button>}>Canvas Token 登录失败，额外登录态也不可用。请检查 Token，或前往设置扫码登录后刷新重试。</Alert>}
            {courseLoading && <Typography variant="caption" color="text.secondary">正在同步视频空间课程，已有课程可直接选择。</Typography>}
            {courseError && <Alert severity="warning">视频空间课程读取失败：{courseError}。其他来源仍可使用。</Alert>}
            <Stack direction="row" gap={1} flexWrap="wrap">
              <TextField size="small" placeholder="搜索日期或课程主题" inputProps={{ "aria-label": "搜索课堂" }} value={query} onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
              <WorkspaceSelect size="small" label="录像状态" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 140 }}>
                <MenuItem value="all">全部状态</MenuItem><MenuItem value="ready">可播放</MenuItem><MenuItem value="unavailable">暂不可播放</MenuItem>
              </WorkspaceSelect>
              <Button disabled={loading || courseLoading || login === "checking"} onClick={() => { videoSummarySession.clearMaterials(); setRefresh((value) => value + 1); void canvas.mutate(); }}>刷新</Button>
            </Stack>
            {loadError && <Alert severity="error">读取录像失败：{loadError}</Alert>}
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: "8px", overflow: "auto" }}>
              {loading && <LinearProgress aria-label="正在读取录像" />}
              <Table size="small" sx={{ "& .MuiTableCell-root": { px: { xs: 0.75, sm: 2 } }, "& .MuiTableCell-paddingCheckbox": { px: 0 } }} aria-label="课堂资料库">
                <TableHead><TableRow sx={{ bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell padding="checkbox">{check(visibleVideos, "全选当前筛选结果")}</TableCell>
                  <TableCell>日期 / 小节</TableCell>{generateTopics && <TableCell>课堂主题</TableCell>}<TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>来源</TableCell><TableCell align="right">操作</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {visibleDates.map((day) => {
                    const dayVideos = day.items.flatMap(({ matching }) => matching).sort((a, b) => (recordingTime(a.courseBeginTime) ?? Infinity) - (recordingTime(b.courseBeginTime) ?? Infinity));
                    const allDayVideos = dateGroups.find((group) => group.id === day.id)!.items.flatMap(({ session }) => session.videos).sort((a, b) => (recordingTime(a.courseBeginTime) ?? Infinity) - (recordingTime(b.courseBeginTime) ?? Infinity));
                    const [dateLabel, weekday] = day.title.split(" · ");
                    const dayScope: VideoSession = { id: `date:${day.id}`, title: day.title, videos: allDayVideos };
                    const dayExpanded = expanded.get(dayScope.id) ?? (!!query || status !== "all" || day.id === visibleDates[0]?.id);
                    return <Fragment key={day.id}>
                      <TableRow data-level="date" selected={allDayVideos.every((v) => selected.has(recordingKey(v)))} sx={{ bgcolor: "action.hover" }}>
                        <TableCell colSpan={2}>
                          <Stack direction="row" alignItems="center" gap={0.5}>
                            {check(allDayVideos, `选择日期 ${day.title}`)}
                            <IconButton size="small" aria-label={`${dayExpanded ? "收起" : "展开"}日期 ${day.title}`} aria-expanded={dayExpanded} onClick={() => toggleExpanded(dayScope.id, dayExpanded)}>{dayExpanded ? <ExpandMoreRoundedIcon /> : <ChevronRightRoundedIcon />}</IconButton>
                            <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Button color="inherit" size="small" sx={{ p: 0, fontSize: "1rem", fontWeight: 700, color: "text.primary", textAlign: "left" }} onClick={() => toggleExpanded(dayScope.id, dayExpanded)}>{[...new Set(allDayVideos.flatMap((v) => [v, ...(v.alternatives ?? [])]).map((v) => v.weekNumber).filter((week) => week > 0))].map((week) => `第 ${week} 周`).join(" / ") || "周次待确认"}{weekday ? ` · ${weekday}` : ""}</Button><Typography variant="caption" color="text.secondary">{dateLabel}</Typography><Chip size="small" variant="outlined" label={`${allDayVideos.length} 小节`} />{dayVideos.length < allDayVideos.length && <Typography variant="caption" color="text.secondary">筛选命中 {dayVideos.length} 小节</Typography>}</Stack>
                          </Stack>
                        </TableCell>
                        {generateTopics && <TableCell><Typography variant="body2">{dayExpanded ? "" : [...new Set(allDayVideos.map((video) => recordingTopic(video, topics)).filter(Boolean))].join("；") || "—"}</Typography></TableCell>}
                        <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}><Typography variant="caption" color="text.secondary">{sourceNames(allDayVideos)}</Typography></TableCell>
                        {rowActions(dayScope)}
                      </TableRow>
                      {dayExpanded && dayVideos.map((video) => <TableRow data-level="recording" key={recordingKey(video)} hover selected={selected.has(recordingKey(video))}>
                        <TableCell colSpan={2}>
                          <Stack direction="row" alignItems="center" gap={1} sx={{ ml: { xs: 2, sm: 4 }, pl: 1, borderLeft: "2px solid", borderColor: "divider" }}>
                            {check([video], `选择小节 ${video.videoName}`)}
                            <Box><Typography variant="body2">第 {allDayVideos.indexOf(video) + 1} 小节 · {video.courseBeginTime.split(/[ T]/)[1]?.slice(0, 5) || "时间待确认"}{video.courseEndTime.split(/[ T]/)[1] ? `–${video.courseEndTime.split(/[ T]/)[1].slice(0, 5)}` : ""}</Typography>
                              <Tooltip title={video.videoName}><Typography variant="caption" color="text.secondary" sx={{ display: "block", overflowWrap: "anywhere" }}>{[video.userName, video.classroomName].filter(Boolean).join(" · ") || video.videoName}</Typography></Tooltip>
                            </Box>
                          </Stack>
                        </TableCell>
                        {generateTopics && <TableCell><Typography variant="body2">{recordingTopic(video, topics) || "—"}</Typography></TableCell>}
                        <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}><Typography variant="caption">{sourceNames([video])}</Typography></TableCell>
                        {rowActions({ ...dayScope, title: `${day.title}（第 ${allDayVideos.indexOf(video) + 1} 小节）`, videos: [video] }, dayScope, recordingKey(video))}
                      </TableRow>)}
                    </Fragment>;
                  })}
                  {!visible.length && <TableRow><TableCell colSpan={generateTopics ? 5 : 4} sx={{ textAlign: "center", py: 7, color: "text.secondary" }}>{loading ? "正在读取课堂录像…" : !selectedCourse ? "选择课程，查看课堂录像和资料" : videos.length ? "没有匹配的课堂，请调整搜索或筛选" : "本课程暂无课堂录像"}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
            {!!selected.size && <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} gap={1} sx={{ position: "sticky", bottom: 0, zIndex: 5, pt: 2, pb: 0.5, bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider" }}>
              <Box sx={{ flex: 1 }}><Typography variant="body2">已选 {scopes.length} 堂课 · {selected.size} 小节</Typography>{hiddenSelected > 0 && <Typography variant="caption" color="text.secondary">其中 {hiddenSelected} 小节不在当前筛选结果中</Typography>}</Box>
              <Button onClick={() => setSelected(new Set())}>清空选择</Button><Button disabled={!scopes.some((scope) => scope.videos.some(isPlayable))} onClick={() => play({ id: "selected", title: "所选录像", videos: scopes.flatMap((scope) => scope.videos) })}>播放</Button><Button variant="outlined" startIcon={<CloudDownloadRoundedIcon />} onClick={() => download(scopes)}>下载…</Button><Button variant="contained" startIcon={<PsychologyRoundedIcon />} disabled={!scopes.some((scope) => scope.videos.some(canSummarizeRecording))} onClick={() => summarize(scopes)}>AI 总结…</Button>
            </Stack>}
          </Stack>
        </CardContent>
      </Card>
      {!centerOnly && <Box><VideoLibraryTaskQueue /></Box>}
    </Stack>
    <Menu anchorEl={toolsAnchor} open={active && !!toolsAnchor} onClose={() => setToolsAnchor(null)}><MenuItem onClick={() => { setAggregator(true); setToolsAnchor(null); }}>视频合成工具</MenuItem></Menu>
    <Dialog open={active && !!downloadScopes} onClose={() => { if (!exporting) setDownloadScopes(undefined); }} fullWidth maxWidth="sm">
      <DialogTitle>{singleDownload ? "下载小节资料" : `下载 ${downloadScopes?.length} 堂课 · ${downloadCount} 小节`}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">{downloadScopes?.map((s) => s.title).join("；")}</Typography>
        <Stack direction="row" flexWrap="wrap">{([ ["video", "视频"], ["ppt", "PPT PDF"], ["subtitle", "字幕"] ] as const).map(([key, label]) => <FormControlLabel key={key} label={label} control={<Checkbox checked={exportOptions[key]} onChange={(_, checked) => setExportOptions((previous) => ({ ...previous, [key]: checked }))} />} />)}</Stack>
        {exportOptions.video && <Stack spacing={1}>
          <Typography variant="subtitle2">视频</Typography>
          <WorkspaceSelect label="视频机位" size="small" value={exportOptions.tracks} onChange={(e) => setExportOptions((p) => ({ ...p, tracks: e.target.value as "all" | "first" }))}><MenuItem value="all">全部可用机位</MenuItem><MenuItem value="first">仅首个机位</MenuItem></WorkspaceSelect>
          <Typography variant="caption" color="text.secondary">每个机位保存为独立视频文件。</Typography>
        </Stack>}
        {exportOptions.ppt && <Stack spacing={1}>
          <Typography variant="subtitle2">PPT PDF</Typography>
          {canMergePpt ? <WorkspaceSelect label="PPT 输出" size="small" value={exportOptions.pptPerSession ? "session" : "section"} onChange={(e) => setExportOptions((p) => ({ ...p, pptPerSession: e.target.value === "session" }))}><MenuItem value="session">每堂课一个 PDF</MenuItem><MenuItem value="section">每小节一个 PDF</MenuItem></WorkspaceSelect> : <Typography variant="body2">{singleDownload ? "一个 PDF。" : "每小节一个 PDF。"}</Typography>}
          {pptCleanupEnabled && <Alert severity="info">已开启 PPT 页面清理，可在设置中关闭。</Alert>}
        </Stack>}
        {exportOptions.subtitle && <Stack spacing={1}>
          <Typography variant="subtitle2">字幕</Typography>
          <Typography variant="body2">{singleDownload ? "SRT 字幕和阅读文本。" : "每小节一个 SRT，每堂课一份阅读文本。"}</Typography>
          {singleDownload && <Typography variant="caption" color="text.secondary">另存为仅保存 SRT，可自定义文件名和位置。</Typography>}
        </Stack>}
        <Typography variant="caption" color="text.secondary">所选根目录下按“学期 → 课程 → 资料类型 → 课堂”归档，同名文件自动编号。缺失资料见任务结果。</Typography>
        {(exportOptions.ppt || exportOptions.subtitle) && downloadScopes?.some((s) => s.videos.some((v) => !hasSubtitleSource(v))) && <Alert severity="info">部分来源仅提供视频，PPT 和字幕可能不可用；其他资料会继续导出。</Alert>}
      </Stack></DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button disabled={exporting} onClick={() => setDownloadScopes(undefined)}>取消</Button>
        <Button variant="outlined" disabled={exporting || !(exportOptions.video || exportOptions.ppt || exportOptions.subtitle)} onClick={saveAsDownload}>另存为</Button>
        <Button variant="contained" disabled={exporting || !(exportOptions.video || exportOptions.ppt || exportOptions.subtitle)} onClick={() => void submitDownload()}>{exporting ? "正在加入队列…" : "下载"}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={active && !!aiScopes} onClose={() => setAiScopes(undefined)} fullWidth maxWidth="sm">
      <DialogTitle>总结所选 {aiScopes?.reduce((n, s) => n + s.videos.length, 0)} 小节</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">{aiScopes?.map((s) => s.title).join("；")}</Typography>
        {!preflight && <Stack direction="row" gap={1} alignItems="center"><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">正在检查字幕…</Typography></Stack>}
        {preflight && preflight.missing > 0 && <Alert severity="info">
          {preflight.missing} 小节暂无字幕。{offerTranscription ? "可将课堂音频转成文字后总结。" : preflight.savedTranscripts ? "总结将使用已保存的转录文字。" : "将使用已有资料总结。"}
          {offerTranscription && <Typography variant="caption" display="block">转录文字仅用于总结，不添加播放字幕。</Typography>}
        </Alert>}
        {!!preflight?.unknown && <Alert severity="warning" action={<Button onClick={() => setPreflightRevision((value) => value + 1)}>重试</Button>}>{preflight.unknown} 小节的字幕状态检查失败。</Alert>}
        {offerTranscription && <Box component="details" sx={{ fontSize: 13, color: "text.secondary", "& summary": { cursor: "pointer" } }}><summary>音频转录要求</summary>需在设置中扫码登录，并在电脑上安装 FFmpeg。</Box>}
        {(aiScopes?.length ?? 0) > 1 && <WorkspaceSelect size="small" label="结果组织" value={aiOrganization} onChange={(e) => setAiOrganization(e.target.value)}><MenuItem value="sessions">逐堂总结</MenuItem><MenuItem value="combined">合并总结</MenuItem></WorkspaceSelect>}
        {summaryDialogCache && <Typography variant="caption" color="text.secondary">已有总结 · {new Date(summaryDialogCache.savedAt).toLocaleString("zh-CN")}</Typography>}
      </Stack></DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button onClick={() => setAiScopes(undefined)}>取消</Button>
        {summaryDialogCache && <Button disabled={!preflight} onClick={() => void startSummary(true, aiScopes, aiOrganization, cacheNamespace, undefined, offerTranscription || !preflight?.unknown)}>{offerTranscription ? "转录音频后重新总结" : "重新生成"}</Button>}
        {offerTranscription && !summaryDialogCache && <Button onClick={() => void startSummary(false, aiScopes, aiOrganization, cacheNamespace, undefined, false)}>仅用现有资料总结</Button>}
        <Button variant="contained" disabled={!preflight && !summaryDialogCache} onClick={() => void startSummary(false, aiScopes, aiOrganization, cacheNamespace, undefined, summaryDialogCache ? aiTranscribe : !preflight?.unknown)}>{summaryDialogCache ? "查看总结" : offerTranscription ? "转录音频后总结" : "开始总结"}</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={active && cacheListOpen} onClose={() => setCacheListOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>本课程的已保存总结</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Typography variant="caption" color="text.secondary">每条记录列出当时选择的小节；重新生成可采用最新资料。</Typography>
        {courseSummaries.map((entry) => <Box key={entry.key} sx={{ borderBottom: 1, borderColor: "divider", pb: 2 }}>
          <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere" }}>{entry.title}</Typography>
          <Typography variant="caption" color="text.secondary">{entry.organization === "combined" ? "综合总结" : "逐堂总结"} · 保存于 {new Date(entry.savedAt).toLocaleString("zh-CN")}</Typography>
          <VideoSummaryScope scopes={entry.scopes} />
          <Button disabled={chatLoading} onClick={() => restoreSummary(entry)}>查看总结</Button>
        </Box>)}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setCacheListOpen(false)}>关闭</Button></DialogActions>
    </Dialog>
    <Dialog open={active && aggregator} onClose={() => setAggregator(false)} maxWidth="lg" fullWidth><DialogTitle><Stack direction="row" justifyContent="space-between">视频合成工具<Button onClick={() => setAggregator(false)}>关闭</Button></Stack></DialogTitle><DialogContent>{active && aggregator && <VideoAggregator course={selectedCourse ? downloadCourseContext(selectedCourse) : undefined} />}</DialogContent></Dialog>
    {chatLoading && !chatOpen && <Box sx={{ ...surfaceCardSx, position: "fixed", bottom: 20, right: 24, zIndex: 8, bgcolor: "background.paper", p: 1 }}><Button startIcon={<CircularProgress size={14} />} onClick={() => setChatOpen(true)}>{chatProgress}</Button></Box>}
  </BasicLayout>;
}
