import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
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
import VideoTrackDownloads from "../components/video_track_downloads";
import VideoLibraryTasks from "../components/video_library_tasks";
import VideoAggregator from "../components/video_aggregator";
import VideoLibraryPlayer from "../components/video_library_player";
import FileAIChatModal, { type FileAIChatMessage } from "../components/file_ai_chat_modal";
import { useCourses, useConfigSelector } from "../lib/hooks";
import { useTasks } from "../lib/task_hooks";
import { useAppMessage } from "../lib/message";
import { compareVideoCourses, loadVideoCourse, mergeVideoCourses } from "../lib/video_courses";
import { groupVideoSessions, groupSessionsByDate, parseVideoCitation, formatVideoTimestamp, recordingKey, recordingTime, selectedSessionScopes, toggleRecordings, hasVideoMaterial, type VideoExportOptions, type VideoMaterial, type VideoSession } from "../lib/video_library";
import { enqueueVideoExports, recordingRequest, saveRecordingMaterial } from "../lib/video_library_tasks";
import { readSummaryCache, writeSummaryCache, deleteSummaryCache, summaryCacheKey, type VideoSummaryCache } from "../lib/video_summary_cache";
import type { AccountInfo, CanvasVideo, Course, LLMChatMessage } from "../lib/model";
import { surfaceCardSx } from "../lib/styles";

const isPlayable = (video: CanvasVideo) => video.playable || !!video.alternatives?.some((v) => v.playable);
const hasSubtitleSource = (video: CanvasVideo) => [video, ...(video.alternatives ?? [])].some((v) => v.source !== "legacy");
const message = (role: "user" | "assistant", content: string, error = false): FileAIChatMessage => ({
  id: crypto.randomUUID(), role, content, error, createdAt: new Date().toISOString(),
});
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("请求超时，请刷新重试")), 30_000);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export default function VideoPage() {
  const canvas = useCourses();
  const centerOnly = useConfigSelector((state) => state.config.data?.experimental_task_center_only === true);
  const pptCleanupEnabled = useConfigSelector((state) => state.config.data?.experimental_ppt_cleanup === true);
  const [account, setAccount] = useState<string>();
  const model = useConfigSelector((state) => state.config.data?.llm_model ?? "");
  const [cachedSummaries, setCachedSummaries] = useState(readSummaryCache);
  const [cacheListOpen, setCacheListOpen] = useState(false);
  const [cacheNotice, setCacheNotice] = useState("");
  const cacheEntry = useRef<VideoSummaryCache>();
  const chatNamespace = useRef("");
  const [playerMini, setPlayerMini] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => { let cancelled = false; void invoke<AccountInfo>("read_account_info").then((info) => { if (!cancelled) setAccount(info.current_account); }).catch(() => {}); return () => { cancelled = true; }; }, []);
  const [space, setSpace] = useState<Course[]>([]);
  const courses = useMemo(() => mergeVideoCourses(canvas.data, space), [canvas.data, space]);
  const [courseId, setCourseId] = useState<number>();
  const selectedCourse = courses.find((course) => course.id === courseId);
  const cacheNamespace = account && selectedCourse ? `${JSON.stringify([account, selectedCourse.canvasId, selectedCourse.teachingClassId, selectedCourse.name, selectedCourse.term.name, model])}:ppt-cleanup-v3=${Number(pptCleanupEnabled)}` : "";
  const courseSummaries = cachedSummaries.filter((entry) => entry.namespace === cacheNamespace);
  const [login, setLogin] = useState<"checking" | "ready" | "required">("checking");
  const [refresh, setRefresh] = useState(0);
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [videos, setVideos] = useState<CanvasVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(new Set<string>());
  const [expanded, setExpanded] = useState(new Map<string, boolean>());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [downloadActionAnchor, setDownloadActionAnchor] = useState<HTMLElement | null>(null);
  const [toolsAnchor, setToolsAnchor] = useState<HTMLElement | null>(null);
  const [trackDownload, setTrackDownload] = useState<CanvasVideo>();
  const [aggregator, setAggregator] = useState(false);
  const [downloadScopes, setDownloadScopes] = useState<VideoSession[]>();
  const [downloadCourse, setDownloadCourse] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportOptions, setExportOptions] = useState<VideoExportOptions>({ video: true, ppt: false, subtitle: false, pptPerSession: true, tracks: "all" });
  const [player, setPlayer] = useState<{ session: VideoSession; key: string; seconds: number; nonce: string }>();
  const [aiScopes, setAiScopes] = useState<VideoSession[]>();
  const [aiOrganization, setAiOrganization] = useState("sessions");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTitle, setChatTitle] = useState("");
  const [chatScope, setChatScope] = useState<VideoSession[]>([]);
  const [chatMessages, setChatMessages] = useState<FileAIChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatProgress, setChatProgress] = useState("");
  const [coverage, setCoverage] = useState("");
  const chatText = useRef("");
  const chatGeneration = useRef(0);
  const materialCache = useRef(new Map<string, VideoMaterial>());
  const tasks = useTasks();
  const [messageApi, contextHolder] = useAppMessage();
  const sessions = useMemo(() => groupVideoSessions(videos), [videos]);
  const dateGroups = useMemo(() => groupSessionsByDate(sessions.map((session) => ({ session }))), [sessions]);
  const scopes = useMemo(() => selectedSessionScopes(sessions, selected), [sessions, selected]);
  const visible = useMemo(() => sessions.flatMap((session) => {
    const matching = session.videos.filter((video) => {
      const matchesQuery = `${session.title} ${video.videoName} ${video.courseBeginTime}`.toLowerCase().includes(query.trim().toLowerCase());
      return matchesQuery && (status === "all" || (status === "ready" ? isPlayable(video) : !isPlayable(video)));
    });
    return matching.length ? [{ session, matching }] : [];
  }), [sessions, query, status]);
  const visibleDates = useMemo(() => groupSessionsByDate(visible), [visible]);
  const visibleVideos = visible.flatMap((item) => item.matching);
  const visibleKeys = new Set(visibleVideos.map(recordingKey));
  const hiddenSelected = [...selected].filter((key) => !visibleKeys.has(key)).length;

  useEffect(() => {
    let cancelled = false;
    setLogin("checking");
    void withTimeout(invoke("login_canvas_website")).then(() => { if (!cancelled) setLogin("ready"); })
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
  useEffect(() => () => { chatGeneration.current++; }, []);
  useEffect(() => { if (!playerMini || chatOpen) workspaceRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }, [player?.nonce, playerMini, chatOpen, chatSessionId]);

  const changeCourse = (id: number) => {
    setCourseId(id === -1 ? undefined : id); setVideos([]); setSelected(new Set()); setExpanded(new Map());
    setQuery(""); setStatus("all"); setPlayer(undefined); setLoadError(""); materialCache.current.clear();
  };
  const play = (session: VideoSession, key?: string, seconds = 0) => {
    if (!player) setPlayerMini(false);
    const video = key ? session.videos.find((v) => recordingKey(v) === key) : session.videos.find(isPlayable);
    if (!video) { messageApi.info("本堂课暂无可播放录像"); return; }
    setPlayer({ session, key: recordingKey(video), seconds, nonce: crypto.randomUUID() });
  };
  const download = (next: VideoSession[], kind?: "ppt" | "subtitle") => {
    setDownloadScopes(next); setDownloadCourse(selectedCourse?.name ?? "课程");
    if (kind) setExportOptions((previous) => ({ ...previous, video: false, ppt: kind === "ppt", subtitle: kind === "subtitle" }));
  };
  const downloadCount = downloadScopes?.reduce((count, scope) => count + scope.videos.length, 0) ?? 0;
  const singleDownload = downloadCount === 1 ? downloadScopes?.[0].videos[0] : undefined;
  const canMergePpt = downloadScopes?.some((scope) => scope.videos.length > 1) ?? false;
  const submitDownload = async () => {
    if (!downloadScopes || exporting) return;
    setExporting(true);
    try {
      const directory = await open({ directory: true, multiple: false, title: "选择本批资料保存目录" });
      if (!directory || Array.isArray(directory)) return;
      const count = await enqueueVideoExports(downloadScopes, exportOptions, directory, downloadCourse);
      messageApi.success(`已加入 ${count} 个导出任务，可在${centerOnly ? "任务中心" : "下方下载任务列表"}查看进度`); setDownloadScopes(undefined);
    } catch (e) { messageApi.error(`创建任务失败：${e}`); }
    finally { setExporting(false); }
  };
  const saveSingle = async (video: CanvasVideo, kind: "ppt" | "subtitle") => {
    try { if (await saveRecordingMaterial(video, kind)) messageApi.success("已加入下载任务"); }
    catch (e) { messageApi.error(`创建任务失败：${e}`); }
  };
  const singleDownloadActions = singleDownload ? [
    ...(exportOptions.video ? [{ label: "选择机位下载…", run: () => { setTrackDownload(singleDownload); setDownloadScopes(undefined); } }] : []),
    ...(exportOptions.ppt ? [{ label: "PPT 另存为…", run: () => void saveSingle(singleDownload, "ppt") }] : []),
    ...(exportOptions.subtitle ? [{ label: "字幕另存为…", run: () => void saveSingle(singleDownload, "subtitle") }] : []),
  ] : [];
  const restoreSummary = (entry: VideoSummaryCache, currentScopes = entry.scopes) => {
    cacheEntry.current = { ...entry, scopes: currentScopes }; chatNamespace.current = entry.namespace;
    setChatTitle(entry.title); setChatScope(currentScopes); setChatMessages(entry.messages); setAiOrganization(entry.organization);
    chatText.current = entry.text; setCoverage(entry.coverage); setChatOpen(true); setAiScopes(undefined); setCacheListOpen(false);
    setCacheNotice(`已读取本地缓存 · ${new Date(entry.savedAt).toLocaleString("zh-CN")}`);
  };
  const persistSummary = (entry: VideoSummaryCache) => {
    cacheEntry.current = entry;
    const saved = !!entry.namespace && writeSummaryCache(entry);
    setCacheNotice(saved ? `已缓存到本地 · ${new Date(entry.savedAt).toLocaleString("zh-CN")}` : "本次结果保留在当前页面，未能写入本地缓存");
    if (saved) setCachedSummaries(readSummaryCache());
  };
  const summarize = (next: VideoSession[]) => {
    if (chatLoading) { setChatOpen(true); messageApi.info("请等待当前总结完成后再切换范围"); return; }
    const organization = next.length > 1 ? "sessions" : "combined";
    const cached = cacheNamespace && readSummaryCache().find((entry) => entry.key === summaryCacheKey(cacheNamespace, next, organization));
    if (cached) { restoreSummary(cached, next); return; }
    setAiScopes(next); setAiOrganization(organization);
  };
  const requestChat = async (messages: LLMChatMessage[], history: FileAIChatMessage[], generation: number, prefix = "") => {
    const response = message("assistant", prefix);
    let content = "";
    const onChunk = new Channel<string>();
    onChunk.onmessage = (chunk) => {
      if (generation !== chatGeneration.current) return;
      setChatProgress("正在生成正文");
      content += chunk;
      setChatMessages([...history, { ...response, content: prefix + content }]);
    };
    const onStatus = new Channel<string>();
    onStatus.onmessage = (status) => { if (generation === chatGeneration.current) setChatProgress(status); };
    return invoke<string>("chat_video_materials", { text: chatText.current, messages, onChunk, onStatus });
  };
  const startSummary = async (force = false, requested = aiScopes, organization = aiOrganization, namespace = cacheNamespace, titleOverride?: string) => {
    if (!requested || chatLoading) return;
    namespace = namespace.replace(/:ppt-(?:animation|cleanup)(?:-v\d+)?=[01]$/, `:ppt-cleanup-v3=${Number(pptCleanupEnabled)}`);
    const snapshot = requested;
    const key = summaryCacheKey(namespace, snapshot, organization);
    const cached = !force && namespace && readSummaryCache().find((entry) => entry.key === key);
    if (cached) { restoreSummary(cached, snapshot); return; }
    if (force) materialCache.current.clear();
    cacheEntry.current = undefined; chatNamespace.current = namespace; setCacheNotice("");
    const generation = ++chatGeneration.current;
    const prompt = organization === "sessions" ? "请逐堂总结所选课堂，每堂课内综合所有小节的字幕与 PPT OCR。列出主要知识点、作业、测验、考试及通知，每个知识点通常只引用 1 个最相关的资料位置，必要时最多 2 个；引用显示为 HH:MM:SS，不逐句堆叠时间戳。" : "请综合总结全部所选小节的字幕与 PPT OCR，串联主要知识点，并列出作业、测验、考试及通知，每个知识点通常只引用 1 个最相关的资料位置，必要时最多 2 个；引用显示为 HH:MM:SS，不逐句堆叠时间戳。";
    const opening = message("user", prompt);
    const title = titleOverride ?? `${selectedCourse?.name ?? "课程"} · ${snapshot.reduce((n, s) => n + s.videos.length, 0)} 小节`;
    setChatTitle(title);
    setChatScope(snapshot); setChatMessages([opening]); setCoverage(""); chatText.current = "";
    setChatLoading(true); setChatOpen(true); setAiScopes(undefined);
    try {
      const entries = snapshot.flatMap((session) => session.videos.map((video, i) => ({ video, title: `${session.title} · ${video.courseBeginTime || `小节 ${i + 1}`}` })));
      const materials: VideoMaterial[] = [];
      for (const [index, entry] of entries.entries()) {
        if (generation !== chatGeneration.current) return;
        setChatProgress(`正在读取字幕与 PPT OCR ${index + 1}/${entries.length}`);
        const key = `${courseId}:${recordingKey(entry.video)}:cleanup-v3=${pptCleanupEnabled}`;
        let material = materialCache.current.get(key);
        if (!material) {
          try { material = await withTimeout(invoke<VideoMaterial>("prepare_video_material", { request: recordingRequest(entry.video, entry.title), cleanUpPpt: pptCleanupEnabled })); }
          catch (e) { material = { key: recordingKey(entry.video), title: entry.title, text: "", srt: "", subtitleAvailable: false, warnings: [`${entry.title}：${e}`] }; }
          if (hasVideoMaterial(material) && !material.warnings.length) materialCache.current.set(key, material);
        }
        materials.push(material);
      }
      if (generation !== chatGeneration.current) return;
      const available = materials.filter(hasVideoMaterial);
      const warnings = materials.flatMap((item) => item.warnings);
      const report = `${materials.filter((item) => item.subtitleAvailable).length}/${entries.length} 小节字幕可用；${materials.filter((item) => item.ocrAvailable).length}/${entries.length} 小节 PPT OCR 可用${warnings.length ? `；资料提示：${warnings.join("；")}` : ""}${available.length < entries.length ? `；未覆盖小节：${materials.filter((item) => !hasVideoMaterial(item)).map((item) => item.title).join("；")}` : "；覆盖全部所选小节"}`;
      setCoverage(report);
      if (!available.length) throw new Error("所选小节均无可用字幕或 PPT OCR，无法生成总结");
      chatText.current = `${report}\n\n${available.map((item) => item.text).join("\n\n")}`;
      setChatProgress("正在准备总结");
      const result = await requestChat([{ role: "user", content: prompt }], [opening], generation, `${report}\n\n`);
      if (generation === chatGeneration.current) {
        const messages = [opening, message("assistant", `${report}\n\n${result}`)]; setChatMessages(messages);
        persistSummary({ key, namespace, title, scopes: snapshot, organization, messages, text: chatText.current, coverage: report, savedAt: new Date().toISOString() });
      }
    } catch (e) { if (generation === chatGeneration.current) setChatMessages([opening, message("assistant", `总结失败：${e}`, true)]); }
    finally { if (generation === chatGeneration.current) { setChatLoading(false); setChatProgress(""); } }
  };
  const sendMessage = async (content: string) => {
    if (chatLoading) return;
    if (!chatText.current) { messageApi.info("没有可用课堂资料，请重新选择小节并总结"); return; }
    const generation = chatGeneration.current;
    const next = [...chatMessages, message("user", content)];
    setChatMessages(next); setChatLoading(true); setChatProgress("正在准备回答");
    try {
      const messages: LLMChatMessage[] = next.filter((m) => !m.error).map(({ role, content: text }) => ({ role, content: text }));
      const result = await requestChat(messages, next, generation);
      if (generation === chatGeneration.current) {
        const messages = [...next, message("assistant", result)]; setChatMessages(messages);
        if (cacheEntry.current) persistSummary({ ...cacheEntry.current, messages, savedAt: new Date().toISOString() });
      }
    } catch (e) { if (generation === chatGeneration.current) setChatMessages([...next, message("assistant", `回答失败：${e}`, true)]); }
    finally { if (generation === chatGeneration.current) { setChatLoading(false); setChatProgress(""); } }
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
    <Button size="small" sx={{ minWidth: 64 }} onClick={() => summarize([scope])}>AI 总结</Button>
  </Stack></TableCell>;
  const chatPanel = <FileAIChatModal embedded loadingLabel={chatProgress || "等待模型回复"} open={chatOpen} title={`${chatTitle} · ${chatScope.map((scope) => scope.title).join("；")}`} messages={chatMessages} loading={chatLoading} onClose={() => setChatOpen(false)} onSend={sendMessage}
      dialogTitle="AI 课堂总结" dialogDescription={chatProgress || coverage || "围绕所选课堂字幕与 PPT OCR 继续追问。会话范围固定，不受列表勾选变化影响。"}
      contextLabel="会话范围" emptyText="正在读取所选小节资料" inputPlaceholder="继续追问知识点、作业或通知…" footerIdleText="依据本次会话的字幕与 PPT OCR；点击引用可跳转到对应小节和 PPT 时间。"
      markdownComponents={{ a: ({ href, children }) => {
        const citation = parseVideoCitation(href);
        if (!citation || citation.seconds === undefined) return <span>{children}</span>;
        return <a href={href} onClick={(event) => {
          event.preventDefault(); const session = chatScope.find((s) => s.videos.some((v) => recordingKey(v) === citation.key));
          if (session) play(session, citation.key, citation.seconds);
        }} title="跳转到此小节的对应时间">{formatVideoTimestamp(citation.seconds)}</a>;
      } }} />

  return <BasicLayout>
    {contextHolder}
    <Stack spacing={2} sx={{ width: "100%" }}>
      <WorkspaceHero
        chipLabel="视频管理"
        chipIcon={<SmartDisplayRoundedIcon />}
        title="视频中心"
        description="按课堂浏览录像，批量下载视频、PPT 和字幕，或总结课堂内容。"
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
      {(player || chatOpen) && <Box ref={workspaceRef} sx={{ scrollMarginTop: 16, display: "grid", gridTemplateColumns: player && !playerMini && chatOpen ? { xs: "minmax(0, 1fr)", md: "minmax(0, 1.2fr) minmax(340px, 1fr)" } : "minmax(0, 1fr)", gap: 2, alignItems: "start" }}>
        {player && <VideoLibraryPlayer onMiniChange={setPlayerMini} session={player.session} initialKey={player.key} seconds={player.seconds} seekRequest={player.nonce} onClose={() => setPlayer(undefined)} onSummarize={() => summarize([player.session])} />}
        {chatOpen && <Card sx={{ ...surfaceCardSx, minWidth: 0 }}><Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={{ px: 2, pt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{cacheNotice}</Typography>
          <Button disabled={chatLoading || !chatScope.length} onClick={() => void startSummary(true, chatScope, cacheEntry.current?.organization ?? aiOrganization, chatNamespace.current, chatTitle)}>重新生成</Button>
          <Button disabled={chatLoading || !cacheEntry.current} onClick={() => { if (cacheEntry.current && deleteSummaryCache(cacheEntry.current.key)) { setCachedSummaries(readSummaryCache()); cacheEntry.current = undefined; setCacheNotice("本地缓存已删除，当前会话仍可阅读"); } else messageApi.error("删除缓存失败"); }}>删除缓存</Button>
          <Button onClick={() => setChatOpen(false)}>收起总结</Button>
        </Stack>{chatPanel}</Card>}
      </Box>}
      <Card sx={{ ...surfaceCardSx, overflow: "visible" }}>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ sm: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>课堂录像</Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedCourse ? `${sessions.length} 堂课 · ${videos.length} 小节，支持整堂课或跨课堂勾选。` : "选择课程后，展开课堂查看小节录像。"}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {chatMessages.length > 0 && <Button onClick={() => setChatOpen(true)}>{chatLoading ? "AI 处理中" : "上次总结"}</Button>}
                {!!courseSummaries.length && <Button disabled={chatLoading} onClick={() => setCacheListOpen(true)}>已缓存总结 · {courseSummaries.length}</Button>}
                <Button variant="outlined" startIcon={<MoreHorizRoundedIcon />} onClick={(e) => setToolsAnchor(e.currentTarget)}>更多工具</Button>
              </Stack>
            </Stack>
            {login === "checking" && <LinearProgress aria-label="检查视频登录" />}
            {login === "required" && <Alert severity="info" action={<Button component={RouterLink} to="/settings">前往设置</Button>}>视频功能需要额外扫码登录。完成后点击刷新重试。</Alert>}
            {courseLoading && <Typography variant="caption" color="text.secondary">正在同步视频空间课程，已有课程可直接选择。</Typography>}
            {courseError && <Alert severity="warning">视频空间课程读取失败：{courseError}。其他来源仍可使用。</Alert>}
            <Stack direction="row" gap={1} flexWrap="wrap">
              <TextField size="small" placeholder="搜索日期、课堂或小节" inputProps={{ "aria-label": "搜索课堂" }} value={query} onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
              <TextField select size="small" label="录像状态" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 140 }}>
                <MenuItem value="all">全部状态</MenuItem><MenuItem value="ready">可播放</MenuItem><MenuItem value="unavailable">暂不可播放</MenuItem>
              </TextField>
              <Button disabled={loading || courseLoading || login === "checking"} onClick={() => { materialCache.current.clear(); setRefresh((value) => value + 1); void canvas.mutate(); }}>刷新</Button>
            </Stack>
            {loadError && <Alert severity="error">读取录像失败：{loadError}</Alert>}
            <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: "8px", overflow: "auto" }}>
              {loading && <LinearProgress aria-label="正在读取录像" />}
              <Table size="small" sx={{ "& .MuiTableCell-root": { px: { xs: 0.75, sm: 2 } }, "& .MuiTableCell-paddingCheckbox": { px: 0 } }} aria-label="课堂资料库">
                <TableHead><TableRow sx={{ bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05) }}>
                  <TableCell padding="checkbox">{check(visibleVideos, "全选当前筛选结果")}</TableCell>
                  <TableCell>日期 / 小节</TableCell><TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>来源</TableCell><TableCell align="right">操作</TableCell>
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
                        <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}><Typography variant="caption">{sourceNames([video])}</Typography></TableCell>
                        {rowActions({ ...dayScope, title: `${day.title}（第 ${allDayVideos.indexOf(video) + 1} 小节）`, videos: [video] }, dayScope, recordingKey(video))}
                      </TableRow>)}
                    </Fragment>;
                  })}
                  {!visible.length && <TableRow><TableCell colSpan={4} sx={{ textAlign: "center", py: 7, color: "text.secondary" }}>{loading ? "正在读取课堂录像…" : !selectedCourse ? "选择课程，查看课堂录像和资料" : videos.length ? "没有匹配的课堂，请调整搜索或筛选" : "本课程暂无课堂录像"}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
            {!!selected.size && <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "center" }} gap={1} sx={{ position: "sticky", bottom: 0, zIndex: 5, pt: 2, pb: 0.5, bgcolor: "background.paper", borderTop: "1px solid", borderColor: "divider" }}>
              <Box sx={{ flex: 1 }}><Typography variant="body2">已选 {scopes.length} 堂课 · {selected.size} 小节</Typography>{hiddenSelected > 0 && <Typography variant="caption" color="text.secondary">其中 {hiddenSelected} 小节不在当前筛选结果中</Typography>}</Box>
              <Button onClick={() => setSelected(new Set())}>清空选择</Button><Button disabled={!scopes.some((scope) => scope.videos.some(isPlayable))} onClick={() => play({ id: "selected", title: "所选录像", videos: scopes.flatMap((scope) => scope.videos) })}>播放</Button><Button variant="outlined" startIcon={<CloudDownloadRoundedIcon />} onClick={() => download(scopes)}>下载…</Button><Button variant="contained" startIcon={<PsychologyRoundedIcon />} onClick={() => summarize(scopes)}>AI 总结…</Button>
            </Stack>}
          </Stack>
        </CardContent>
      </Card>
      {!centerOnly && <Box><VideoLibraryTasks tasks={tasks.filter((task) => task.source === "video")} /></Box>}
    </Stack>
    <Menu anchorEl={toolsAnchor} open={!!toolsAnchor} onClose={() => setToolsAnchor(null)}><MenuItem onClick={() => { setAggregator(true); setToolsAnchor(null); }}>视频合成工具</MenuItem></Menu>
    <Dialog open={!!downloadScopes} onClose={() => { if (!exporting) setDownloadScopes(undefined); }} fullWidth maxWidth="sm">
      <DialogTitle>{singleDownload ? "下载小节资料" : `下载 ${downloadScopes?.length} 堂课 · ${downloadCount} 小节`}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">{downloadScopes?.map((s) => s.title).join("；")}</Typography>
        <Stack direction="row" flexWrap="wrap">{([ ["video", "视频"], ["ppt", "PPT 切片 PDF"], ["subtitle", "字幕"] ] as const).map(([key, label]) => <FormControlLabel key={key} label={label} control={<Checkbox checked={exportOptions[key]} onChange={(_, checked) => setExportOptions((previous) => ({ ...previous, [key]: checked }))} />} />)}</Stack>
        {exportOptions.video && <Stack spacing={1}>
          <Typography variant="subtitle2">视频</Typography>
          <TextField select label="视频机位" size="small" value={exportOptions.tracks} onChange={(e) => setExportOptions((p) => ({ ...p, tracks: e.target.value as "all" | "first" }))}><MenuItem value="all">全部可用机位</MenuItem><MenuItem value="first">仅首个机位</MenuItem></TextField>
          <Typography variant="caption" color="text.secondary">每个机位保存为独立视频文件。</Typography>
        </Stack>}
        {exportOptions.ppt && <Stack spacing={1}>
          <Typography variant="subtitle2">PPT 切片 PDF</Typography>
          {canMergePpt ? <TextField select label="PPT 输出" size="small" value={exportOptions.pptPerSession ? "session" : "section"} onChange={(e) => setExportOptions((p) => ({ ...p, pptPerSession: e.target.value === "session" }))}><MenuItem value="session">每堂课合并一个 PDF（仅包含所选小节）</MenuItem><MenuItem value="section">每小节一个 PDF</MenuItem></TextField> : <Typography variant="body2">{singleDownload ? "本小节的 PPT 切片保存为一个 PDF。" : "每堂课仅选中一个小节，各自保存为一个 PDF。"}</Typography>}
          {pptCleanupEnabled && <Alert severity="info">已开启“导出 PPT 时去除无用页面”：排除明确的桌面和签到页面，连续重复或增量切片保留完整画面；不合并中途切页后再次出现的页面。此实验性设置也用于 AI 总结与追问，处理记录保存在任务日志中，关闭后可导出全部切片。</Alert>}
        </Stack>}
        {exportOptions.subtitle && <Stack spacing={1}>
          <Typography variant="subtitle2">字幕</Typography>
          <Typography variant="body2">{singleDownload ? "保存本小节的 SRT 字幕和阅读文本。" : "每小节独立 SRT，同时生成每堂课所选小节的阅读文本。"}阅读文本中的时间点属于各自小节。</Typography>
          {singleDownload && <Typography variant="caption" color="text.secondary">另存为仅保存 SRT，可自定义文件名和位置。</Typography>}
        </Stack>}
        <Typography variant="caption" color="text.secondary">{singleDownload ? "“选择目录并下载”保存全部勾选资料，按课程和课堂归档；也可使用底部操作单独下载。" : "下一步为整批选择一次目录，按课程和课堂保存。"}同名文件自动编号；缺失资料在任务结果中列出。</Typography>
        {(exportOptions.ppt || exportOptions.subtitle) && downloadScopes?.some((s) => s.videos.some((v) => !hasSubtitleSource(v))) && <Alert severity="info">部分来源仅提供视频，PPT 和字幕可能不可用；其他资料会继续导出。</Alert>}
      </Stack></DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <Button disabled={exporting} onClick={() => { setDownloadActionAnchor(null); setDownloadScopes(undefined); }}>取消</Button>
        {singleDownloadActions.length === 1 && <Button disabled={exporting} onClick={singleDownloadActions[0].run}>{exportOptions.video ? "选择机位下载…" : "另存为…"}</Button>}
        {singleDownloadActions.length > 1 && <Button disabled={exporting} aria-haspopup="menu" aria-controls={downloadActionAnchor ? "single-download-menu" : undefined} aria-expanded={!!downloadActionAnchor} onClick={(event) => setDownloadActionAnchor(event.currentTarget)}>单独下载 ▾</Button>}
        <Button variant="contained" disabled={exporting || !(exportOptions.video || exportOptions.ppt || exportOptions.subtitle)} onClick={() => void submitDownload()}>{exporting ? "正在加入队列…" : "选择目录并下载"}</Button>
      </DialogActions>
      <Menu id="single-download-menu" anchorEl={downloadActionAnchor} open={!!downloadActionAnchor && !!downloadScopes && singleDownloadActions.length > 1} onClose={() => setDownloadActionAnchor(null)}>
        {singleDownloadActions.map((action) => <MenuItem key={action.label} onClick={() => { setDownloadActionAnchor(null); action.run(); }}>{action.label}</MenuItem>)}
      </Menu>
    </Dialog>
    <Dialog open={!!aiScopes} onClose={() => setAiScopes(undefined)} fullWidth maxWidth="sm">
      <DialogTitle>总结所选 {aiScopes?.reduce((n, s) => n + s.videos.length, 0)} 小节</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">{aiScopes?.map((s) => s.title).join("；")}</Typography>
        <Typography variant="body2" color="text.secondary">结合字幕与 PPT OCR，按各自时间点组织资料；OCR 可能仅含关键词。缺失资料会明确标注，引用可跳转到对应视频时间。成功结果缓存在本机，重新生成会重新读取资料。</Typography>
        <TextField select size="small" label="结果组织" value={aiOrganization} onChange={(e) => setAiOrganization(e.target.value)}><MenuItem value="sessions">逐堂总结，堂内综合各小节</MenuItem><MenuItem value="combined">综合所有所选小节</MenuItem></TextField>
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setAiScopes(undefined)}>取消</Button><Button variant="contained" onClick={() => void startSummary()}>开始总结</Button></DialogActions>
    </Dialog>
    <Dialog open={cacheListOpen} onClose={() => setCacheListOpen(false)} fullWidth maxWidth="sm"><DialogTitle>本课程的已缓存总结</DialogTitle><DialogContent><Stack spacing={1}><Typography variant="caption" color="text.secondary">本机最多保留 12 份会话，总计约 3 MB；超出时移除最早保存的缓存。缓存不会自动检查字幕更新，可在会话中重新生成。</Typography>{courseSummaries.map((entry) => <Button key={entry.key} disabled={chatLoading} sx={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => restoreSummary(entry)}>{entry.scopes.map((scope) => scope.title).join("；")} · {entry.organization === "combined" ? "综合总结" : "逐堂总结"} · {new Date(entry.savedAt).toLocaleString("zh-CN")}</Button>)}</Stack></DialogContent><DialogActions><Button onClick={() => setCacheListOpen(false)}>关闭</Button></DialogActions></Dialog>
    <Dialog open={aggregator} onClose={() => setAggregator(false)} maxWidth="lg" fullWidth><DialogTitle><Stack direction="row" justifyContent="space-between">视频合成工具<Button onClick={() => setAggregator(false)}>关闭</Button></Stack></DialogTitle><DialogContent>{aggregator && <VideoAggregator />}</DialogContent></Dialog>
    {trackDownload && <VideoTrackDownloads video={trackDownload} onClose={() => setTrackDownload(undefined)} />}
    {chatLoading && !chatOpen && <Box sx={{ ...surfaceCardSx, position: "fixed", bottom: 20, right: 24, zIndex: 8, bgcolor: "background.paper", p: 1 }}><Button startIcon={<CircularProgress size={14} />} onClick={() => setChatOpen(true)}>{chatProgress}</Button></Box>}
  </BasicLayout>;
}
