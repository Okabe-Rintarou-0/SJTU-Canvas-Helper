import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import KeyboardBackspaceRoundedIcon from "@mui/icons-material/KeyboardBackspaceRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
  InputAdornment,
  Link as MuiLink,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useRef, useState } from "react";

import FileAIChatModal, {
  FileAIChatMessage,
} from "../components/file_ai_chat_modal";
import BasicLayout from "../components/layout";
import { WorkspaceHero } from "../components/workspace_hero";
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import FileOrderSelectModal from "../components/file_order_select_modal";
import {
  useBaseURL,
  useCourses,
  useExternalFiles,
  useMerger,
  usePreview,
} from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import {
  Course,
  Entry,
  File,
  FileChatStreamChunkPayload,
  FileChatStreamDonePayload,
  FileChatStreamErrorPayload,
  FileDownloadTask,
  Folder,
  LLMChatMessage,
  LOG_LEVEL_ERROR,
  Option,
  entryName,
  isFile,
} from "../lib/model";
import {
  consoleLog,
  getFileIcon,
  isMergableFileType,
  scrollToTop,
} from "../lib/utils";

interface DownloadInfo {
  course?: Course;
  folderPath: string;
}

type SnackSeverity = "success" | "info" | "warning" | "error";

const COURSE_FILES = "course files";
const MY_FILES = "my files";
const EXPLAINABLE_FILE_EXTS = [".pdf", ".docx"];
const FILE_SUMMARY_OPENING_MESSAGE =
  "请先总结这份文件。若它与作业相关，请额外列出得分点、提交要求、截止时间、文件格式限制和任何容易遗漏的注意事项。";

function isExplainableFile(file: File) {
  const dotPos = file.display_name.lastIndexOf(".");
  if (dotPos === -1) {
    return false;
  }
  const ext = file.display_name.slice(dotPos);
  return EXPLAINABLE_FILE_EXTS.includes(ext);
}

function createConversationMessage(
  role: "user" | "assistant",
  content: string,
  extras?: Partial<FileAIChatMessage>
): FileAIChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

function toLLMChatMessages(messages: FileAIChatMessage[]): LLMChatMessage[] {
  return messages
    .filter((message) => !message.pending)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export default function FilesPage() {
  const theme = useTheme();
  const [section, setSection] = useState<string>(COURSE_FILES);
  const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
  const [selectedEntries, setSelectedEntries] = useState<Entry[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [downloadableOnly, setDownloadableOnly] = useState<boolean>(true);
  const [showExternal, setShowExternal] = useState<boolean>(false);
  const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
  const [operating, setOperating] = useState<boolean>(false);
  const [currentFolderId, setCurrentFolderId] = useState(0);
  const [currentFolderFullName, setCurrentFolderFullName] =
    useState<Option<string>>("");
  const [parentFolderId, setParentFolderId] = useState<Option<number>>(null);
  const [keyword, setKeyword] = useState<string>("");
  const [openFileOrderSelectModal, setOpenFileOrderSelectModal] =
    useState<boolean>(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [chatMessages, setChatMessages] = useState<FileAIChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const activeChatRequestIdRef = useRef<string | null>(null);
  const [messageApi] = useAppMessage();
  const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry, setEntries } =
    usePreview();
  const { merger, mergePDFs } = useMerger({
    setPreviewEntry,
    onHoverEntry,
    onLeaveEntry,
  });
  const courses = useCourses();
  const baseURL = useBaseURL();
  const downloadInfoMap = useMemo(() => new Map<number, DownloadInfo>(), []);
  const externalFiles = useExternalFiles(showExternal ? selectedCourseId : -1);

  const notify = (message: string, severity: SnackSeverity = "info") => {
    if (severity === "success") {
      messageApi.success(message);
      return;
    }
    if (severity === "error") {
      messageApi.error(message);
      return;
    }
    if (severity === "warning") {
      messageApi.warning(message);
      return;
    }
    messageApi.info(message);
  };

  useEffect(() => {
    setEntries(files);
  }, [files]);

  useEffect(() => {
    let unlistenChunk: UnlistenFn | undefined;
    let unlistenDone: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;

    const setupListeners = async () => {
      unlistenChunk = await listen<FileChatStreamChunkPayload>(
        "file_ai_chat://chunk",
        (event) => {
          const payload = event.payload;
          if (payload.request_id !== activeChatRequestIdRef.current) {
            return;
          }
          setChatMessages((prev) => {
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
        }
      );

      unlistenDone = await listen<FileChatStreamDonePayload>(
        "file_ai_chat://done",
        (event) => {
          const payload = event.payload;
          if (payload.request_id !== activeChatRequestIdRef.current) {
            return;
          }
          setChatLoading(false);
          activeChatRequestIdRef.current = null;
          setChatMessages((prev) => {
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
        }
      );

      unlistenError = await listen<FileChatStreamErrorPayload>(
        "file_ai_chat://error",
        (event) => {
          const payload = event.payload;
          if (payload.request_id !== activeChatRequestIdRef.current) {
            return;
          }
          setChatLoading(false);
          activeChatRequestIdRef.current = null;
          notify(`AI 对话出错：${payload.error}`, "error");
          setChatMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i -= 1) {
              if (next[i].role === "assistant") {
                next[i] = {
                  ...next[i],
                  content: next[i].content || `对话出错：${payload.error}`,
                  pending: false,
                  error: true,
                };
                break;
              }
            }
            return next;
          });
        }
      );
    };

    void setupListeners();

    return () => {
      void unlistenChunk?.();
      void unlistenDone?.();
      void unlistenError?.();
    };
  }, []);

  useEffect(() => {
    if (currentFolderId > 0) {
      void handleGetFoldersAndFiles(currentFolderId);
    }
  }, [currentFolderId]);

  useEffect(() => {
    if (section === MY_FILES) {
      void initAllMyFolders();
    } else if (selectedCourseId !== -1) {
      void handleCourseSelect(selectedCourseId);
    } else {
      clearFilesAndFolders();
    }
  }, [section]);

  const handleExplainFile = async (file: File) => {
    const openingUserMessage = createConversationMessage(
      "user",
      FILE_SUMMARY_OPENING_MESSAGE
    );
    const pendingAssistantMessage = createConversationMessage("assistant", "", {
      pending: true,
    });

    setChatFile(file);
    setChatOpen(true);
    setChatLoading(true);
    setChatMessages([openingUserMessage, pendingAssistantMessage]);

    try {
      const requestId = crypto.randomUUID();
      activeChatRequestIdRef.current = requestId;
      await invoke("start_file_chat_stream", {
        requestId,
        file,
        messages: toLLMChatMessages([openingUserMessage]),
      });
    } catch (error) {
      notify(`总结出错：${error}，请前往设置确认 API Key。`, "error");
      activeChatRequestIdRef.current = null;
      setChatLoading(false);
      setChatMessages([
        openingUserMessage,
        {
          ...pendingAssistantMessage,
          content: `总结出错：${error}`,
          pending: false,
          error: true,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendChatMessage = async (content: string) => {
    if (!chatFile || chatLoading) {
      return;
    }

    const userMessage = createConversationMessage("user", content);
    const pendingAssistantMessage = createConversationMessage("assistant", "", {
      pending: true,
    });
    const nextMessages = [...chatMessages, userMessage];

    setChatLoading(true);
    setChatMessages([...nextMessages, pendingAssistantMessage]);

    try {
      const requestId = crypto.randomUUID();
      activeChatRequestIdRef.current = requestId;
      await invoke("start_file_chat_stream", {
        requestId,
        file: chatFile,
        messages: toLLMChatMessages(nextMessages),
      });
    } catch (error) {
      notify(`继续对话出错：${error}`, "error");
      activeChatRequestIdRef.current = null;
      setChatMessages([
        ...nextMessages,
        {
          ...pendingAssistantMessage,
          content: `继续对话出错：${error}`,
          pending: false,
          error: true,
        },
      ]);
    } finally {
      if (!activeChatRequestIdRef.current) {
        setChatLoading(false);
      }
    }
  };

  const getSelectedCourse = () => {
    if (section !== COURSE_FILES) {
      return undefined;
    }
    return courses.data.find((course) => course.id === selectedCourseId);
  };

  const initWithFolders = (nextFolders: Folder[]) => {
    setAllFolders(nextFolders);
    const folder = nextFolders.find((item) => item.name === section)!;
    setCurrentFolderId(folder.id);
    setCurrentFolderFullName(section);
    setParentFolderId(null);
  };

  const clearFilesAndFolders = () => {
    setSelectedEntries([]);
    setAllFolders([]);
    setFiles([]);
    setFolders([]);
    setCurrentFolderId(0);
  };

  const initAllMyFolders = async () => {
    try {
      const myFolders = (await invoke("list_my_folders")) as Folder[];
      initWithFolders(myFolders);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      clearFilesAndFolders();
    }
  };

  const initAllCourseFolders = async (courseId: number) => {
    try {
      const courseFolders = (await invoke("list_course_folders", {
        courseId,
      })) as Folder[];
      initWithFolders(courseFolders);
    } catch {
      clearFilesAndFolders();
    }
  };

  const getParentFolder = async (
    folderId: number
  ): Promise<Folder | undefined> => {
    try {
      return (await invoke("get_folder_by_id", { folderId })) as Folder;
    } catch {
      return undefined;
    }
  };

  const handleGetFolderFiles = async (folderId: number) => {
    try {
      const nextFiles = (await invoke("list_folder_files", { folderId })) as File[];
      if (folderId !== currentFolderId) {
        return;
      }
      nextFiles.forEach((file) => {
        file.key = file.uuid;
      });
      setFiles(nextFiles);
    } catch {
      setFiles([]);
    }
  };

  const handleGetFolderFolders = async (folderId: number) => {
    try {
      const nextFolders = (await invoke("list_folder_folders", {
        folderId,
      })) as Folder[];
      nextFolders.forEach((folder) => {
        folder.key = folder.id.toString();
      });
      setFolders(nextFolders);
    } catch {
      setFolders([]);
    }
  };

  const handleGetFoldersAndFiles = async (folderId: number) => {
    setOperating(true);
    try {
      await Promise.all([
        handleGetFolderFolders(folderId),
        handleGetFolderFiles(folderId),
      ]);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      setFiles([]);
      setFolders([]);
    }
    setOperating(false);
  };

  const handleCourseSelect = async (courseId: number) => {
    if (courses.data.find((course) => course.id === courseId)) {
      setSelectedCourseId(courseId);
      setSelectedEntries([]);
      await initAllCourseFolders(courseId);
    }
  };

  const handleFolderOpen = async (folderId: number) => {
    setSelectedEntries([]);
    setFiles([]);
    setFolders([]);
    setCurrentFolderId(folderId);
    const parentFolder = await getParentFolder(folderId);
    setCurrentFolderFullName(parentFolder?.full_name);
    setParentFolderId(parentFolder?.parent_folder_id);
    scrollToTop();
  };

  const getFolderPath = (file: File) => {
    if (file.external_type) {
      return allFolders
        .find((folder) => folder.name === section)
        ?.full_name.slice(section.length + 1);
    }
    return allFolders
      .find((folder) => folder.id === file.folder_id)
      ?.full_name.slice(section.length + 1);
  };

  const handleOpenTaskFile = async (task: FileDownloadTask) => {
    const name = task.file.display_name;
    const downloadInfo = downloadInfoMap.get(task.file.folder_id)!;
    const course = downloadInfo.course;
    const folderPath = downloadInfo.folderPath;
    try {
      if (course) {
        await invoke("open_course_file", { name, course, folderPath });
      } else {
        await invoke("open_my_file", { name, folderPath });
      }
    } catch (error) {
      notify(String(error), "error");
      consoleLog(LOG_LEVEL_ERROR, error);
    }
  };

  const handleDownloadFile = async (file: File) => {
    const folderPath = getFolderPath(file);
    const course = getSelectedCourse();
    if (!downloadInfoMap.get(file.folder_id) && folderPath !== undefined) {
      downloadInfoMap.set(file.folder_id, {
        course,
        folderPath,
      });
    }
    if (section === COURSE_FILES) {
      await invoke("download_course_file", { file, course, folderPath });
    } else {
      await invoke("download_my_file", { file, folderPath });
    }
  };

  const handleSyncFiles = async () => {
    try {
      const course = getSelectedCourse()!;
      notify("正在计算同步任务…", "info");
      const filesToSync = (await invoke("sync_course_files", {
        course,
      })) as File[];
      if (filesToSync.length > 0) {
        notify(`共 ${filesToSync.length} 个文件需要下载，任务已开始。`, "success");
      } else {
        notify("已同步，无需下载。", "success");
      }
      filesToSync.forEach((file) => void handleAddDownloadFileTask(file));
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      notify(`同步失败：${error}`, "error");
    }
  };

  const handleRemoveTask = async (taskToRemove: FileDownloadTask) => {
    setDownloadTasks((tasks) =>
      tasks.filter((task) => task.file.uuid !== taskToRemove.file.uuid)
    );
    const file = taskToRemove.file;
    const downloadInfo = downloadInfoMap.get(file.folder_id)!;
    const course = downloadInfo.course;
    const folderPath = downloadInfo.folderPath;
    try {
      if (course) {
        await invoke("delete_course_file", { file, course, folderPath });
      } else {
        await invoke("delete_my_file", { file, folderPath });
      }
    } catch (error) {
      if (taskToRemove.state !== "fail") {
        notify(String(error), "error");
      }
    }
  };

  const handleAddDownloadFileTask = async (file: File) => {
    const task = downloadTasks.find((item) => item.file.uuid === file.uuid);
    if (!task) {
      setDownloadTasks((tasks) => [
        ...tasks,
        {
          key: file.uuid,
          file,
          progress: 0,
          state: "downloading",
        } as FileDownloadTask,
      ]);
    } else if (task.state === "fail") {
      task.progress = 0;
      task.state = "wait_retry";
      setDownloadTasks([...downloadTasks]);
    }
  };

  const handleUploadFile = async (file: File) => {
    const subDir = currentFolderFullName?.replace(section, "");
    const saveDir =
      section === COURSE_FILES
        ? `${getSelectedCourse()!.name}${subDir}`
        : `我的Canvas文件${subDir}`;
    const savePath = `${saveDir}/${file.display_name}`;
    let retries = 0;
    const maxRetries = 1;
    let error: unknown;
    let loggedIn = false;

    notify(`正在上传至交大云盘：${savePath}`, "info");
    while (retries <= maxRetries) {
      try {
        await invoke("upload_file", { file, saveDir });
        notify("上传文件成功。", "success");
        break;
      } catch (nextError) {
        error = nextError;
        retries += 1;
        try {
          await invoke("login_jbox");
          loggedIn = true;
        } catch {
          loggedIn = false;
        }
      }
    }

    if (loggedIn && error) {
      notify(`上传失败：${error}。已尝试自动登录交大云盘，但上传仍未成功。`, "error");
      return;
    }

    if (!loggedIn && error) {
      notify(`上传文件出错：${error}。请先登录交大云盘。`, "error");
    }
  };

  const handleEntrySelect = (entry: Entry, checked: boolean) => {
    if (!isFile(entry)) {
      return;
    }
    setSelectedEntries((prev) =>
      checked
        ? [...prev, entry]
        : prev.filter((item) => item.key !== entry.key)
    );
  };

  const handleDownloadSelectedFiles = () => {
    selectedEntries.forEach((entry) => {
      if (isFile(entry)) {
        void handleAddDownloadFileTask(entry as File);
      }
    });
  };

  const backToParentDir = async () => {
    setFiles([]);
    setFolders([]);
    const nextFolderId = parentFolderId as number;
    setCurrentFolderId(nextFolderId);
    const parentFolder = await getParentFolder(nextFolderId);
    setCurrentFolderFullName(parentFolder?.full_name);
    setParentFolderId(parentFolder?.parent_folder_id);
  };

  const backToRootDir = async () => {
    const mainFolder = allFolders.find((folder) => folder.name === section)!;
    setCurrentFolderId(mainFolder.id);
    setCurrentFolderFullName(section);
    setParentFolderId(null);
  };

  const shouldShow = (entry: Entry) => {
    const containsKeyword = entryName(entry).includes(keyword);
    const downloadable = !isFile(entry) || !downloadableOnly || (entry as File).url;
    return containsKeyword && downloadable;
  };

  const noSelectedMergeFiles =
    (selectedEntries.filter(isFile) as File[]).filter((file) =>
      isMergableFileType(file.display_name)
    ).length < 2;

  const getSupportedMergeFiles = () => {
    return (selectedEntries as File[]).filter((file) =>
      isMergableFileType(file.display_name)
    );
  };

  const filteredEntries = useMemo(
    () =>
      ([...(folders as Entry[]), ...(files as Entry[]), ...externalFiles.data] as Entry[]).filter(
        shouldShow
      ),
    [folders, files, externalFiles.data, keyword, downloadableOnly]
  );

  const selectedFileCount = selectedEntries.filter(isFile).length;
  const currentFolderName = currentFolderFullName || "未选择目录";
  const activeCourse = getSelectedCourse();

  const statItems = [
    {
      label: "当前目录",
      value: currentFolderName,
      icon: <FolderOpenRoundedIcon />,
    },
    {
      label: "可见项目",
      value: `${filteredEntries.length}`,
      icon: <Inventory2RoundedIcon />,
    },
    {
      label: "已选文件",
      value: `${selectedFileCount}`,
      icon: <CloudDownloadRoundedIcon />,
    },
    {
      label: "下载任务",
      value: `${downloadTasks.length}`,
      icon: <AutoAwesomeRoundedIcon />,
    },
  ];

  return (
    <BasicLayout>
      {previewer}

      <FileOrderSelectModal
        open={openFileOrderSelectModal}
        handleOk={(items) => {
          setOpenFileOrderSelectModal(false);
          const orderedFiles = items.map((item) => item.data as File);
          mergePDFs(orderedFiles);
        }}
        handleCancel={() => setOpenFileOrderSelectModal(false)}
        files={getSupportedMergeFiles()}
      />

      <FileAIChatModal
        open={chatOpen}
        title={chatFile?.display_name ?? ""}
        messages={chatMessages}
        loading={chatLoading}
        onClose={() => setChatOpen(false)}
        onSend={handleSendChatMessage}
      />

      <Stack spacing={3} sx={{ width: "100%" }}>
        <WorkspaceHero
          chipLabel="File Workspace"
          chipIcon={<FolderOpenRoundedIcon />}
          title="文件浏览与下载工作台"
          description="更适合课程文件筛选、批量下载、目录跳转和下载任务追踪的内容布局。"
          aside={
            <Stack spacing={1} alignItems={{ xs: "flex-start", md: "flex-end" }}>
              <Chip
                label={section === COURSE_FILES ? "课程文件模式" : "我的文件模式"}
                color="primary"
              />
              {activeCourse && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ maxWidth: 320, textAlign: { md: "right" } }}
                >
                  当前课程：{activeCourse.name}
                </Typography>
              )}
            </Stack>
          }
          stats={statItems}
        />

        <Card sx={{ borderRadius: "28px", border: "1px solid", borderColor: "divider" }}>
          <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
            <Stack spacing={2.5}>
              <Tabs
                value={section}
                onChange={(_, value) => setSection(value)}
                variant="scrollable"
                allowScrollButtonsMobile
              >
                <Tab value={COURSE_FILES} label="课程文件" disabled={operating} />
                <Tab value={MY_FILES} label="我的文件" disabled={operating} />
              </Tabs>

              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "1.2fr 1fr" },
                  alignItems: "start",
                }}
              >
                <Box
                  sx={{
                    p: 2,
                    borderRadius: "22px",
                    bgcolor: alpha(theme.palette.background.default, 0.72),
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  {section === COURSE_FILES ? (
                    <CourseSelect
                      onChange={handleCourseSelect}
                      disabled={operating}
                      courses={courses.data}
                      value={selectedCourseId > 0 ? selectedCourseId : undefined}
                    />
                  ) : (
                    <Alert severity="info" sx={{ borderRadius: "16px" }}>
                      当前正在浏览“我的文件”，系统会自动载入你的个人目录结构。
                    </Alert>
                  )}
                </Box>

                <Box
                  sx={{
                    display: "grid",
                    gap: 1.5,
                    gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" },
                  }}
                >
                  <Box
                    sx={{
                      p: 2,
                      borderRadius: "22px",
                      bgcolor: alpha(theme.palette.background.default, 0.72),
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Stack spacing={1.25}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={downloadableOnly}
                            disabled={operating}
                            onChange={(event) => setDownloadableOnly(event.target.checked)}
                          />
                        }
                        label="只显示可下载文件"
                      />
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={showExternal}
                            disabled={operating}
                            onChange={(event) => setShowExternal(event.target.checked)}
                          />
                        }
                        label="显示外部文件"
                      />
                    </Stack>
                  </Box>

                  <Box
                    sx={{
                      p: 2,
                      borderRadius: "22px",
                      bgcolor: alpha(theme.palette.background.default, 0.72),
                      border: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <TextField
                      fullWidth
                      placeholder="输入文件关键词…"
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchRoundedIcon color="action" />
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Box>
                </Box>
              </Box>

              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                spacing={1.5}
              >
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                  <Button
                    variant="outlined"
                    startIcon={<KeyboardBackspaceRoundedIcon />}
                    disabled={typeof parentFolderId !== "number"}
                    onClick={() => void backToParentDir()}
                  >
                    上级目录
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<HomeRoundedIcon />}
                    disabled={!parentFolderId}
                    onClick={() => void backToRootDir()}
                  >
                    根目录
                  </Button>
                  {section === COURSE_FILES && selectedCourseId > 0 && (
                    <Button variant="contained" onClick={() => void handleSyncFiles()}>
                      一键同步
                    </Button>
                  )}
                </Stack>

                <Chip
                  label={`当前目录：${currentFolderName}`}
                  variant="outlined"
                  sx={{
                    maxWidth: "100%",
                    "& .MuiChip-label": {
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                  }}
                />
              </Stack>

              <Box
                sx={{
                  borderRadius: "22px",
                  border: "1px solid",
                  borderColor: "divider",
                  overflow: "hidden",
                }}
              >
                <Table sx={{ minWidth: 860 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                      <TableCell padding="checkbox" />
                      <TableCell>文件</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredEntries.map((entry) => {
                      const checked = selectedEntries.some((item) => item.key === entry.key);
                      if (isFile(entry)) {
                        const file = entry as File;
                        const href = file.external_type
                          ? file.url
                          : `${baseURL.data}/courses/${selectedCourseId}/files?preview=${file.id}`;
                        const filePrefix = file.external_title ? "[外部文件] " : "";
                        return (
                          <TableRow key={entry.key} hover selected={checked}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={checked}
                                onChange={(event) => handleEntrySelect(entry, event.target.checked)}
                              />
                            </TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={1.25} alignItems="center">
                                <Box
                                  sx={{ display: "grid", placeItems: "center", width: 28, height: 28 }}
                                >
                                  {getFileIcon(file)}
                                </Box>
                                <MuiLink
                                  href={href}
                                  target="_blank"
                                  underline="hover"
                                  color="inherit"
                                  onMouseEnter={() => onHoverEntry(entry)}
                                  onMouseLeave={onLeaveEntry}
                                  sx={{ fontWeight: 600 }}
                                >
                                  {filePrefix}
                                  {file.display_name}
                                </MuiLink>
                              </Stack>
                            </TableCell>
                            <TableCell align="right">
                              <Stack
                                direction="row"
                                spacing={1}
                                justifyContent="flex-end"
                                flexWrap="wrap"
                                useFlexGap
                              >
                                {file.url ? (
                                  <Button
                                    size="small"
                                    onClick={() => void handleAddDownloadFileTask(file)}
                                  >
                                    下载
                                  </Button>
                                ) : null}
                                {file.url ? (
                                  <Button
                                    size="small"
                                    startIcon={<UploadFileRoundedIcon />}
                                    onClick={() => void handleUploadFile(file)}
                                  >
                                    上传云盘
                                  </Button>
                                ) : null}
                                <Button
                                  size="small"
                                  startIcon={<PreviewRoundedIcon />}
                                  onClick={() => setPreviewEntry(file)}
                                >
                                  预览
                                </Button>
                                {isExplainableFile(file) ? (
                                  <Button
                                    size="small"
                                    startIcon={<AutoAwesomeRoundedIcon />}
                                    onClick={() => void handleExplainFile(file)}
                                  >
                                    AI 总结
                                  </Button>
                                ) : null}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      const folder = entry as Folder;
                      return (
                        <TableRow key={entry.key} hover>
                          <TableCell padding="checkbox" />
                          <TableCell>
                            <Stack direction="row" spacing={1.25} alignItems="center">
                              <FolderOpenRoundedIcon color="primary" />
                              <MuiLink
                                component="button"
                                type="button"
                                underline="hover"
                                color="inherit"
                                onMouseEnter={() => onHoverEntry(entry)}
                                onMouseLeave={onLeaveEntry}
                                onClick={() => void handleFolderOpen(folder.id)}
                                sx={{
                                  fontWeight: 600,
                                  border: "none",
                                  background: "transparent",
                                  cursor: "pointer",
                                  p: 0,
                                }}
                              >
                                {folder.name}
                              </MuiLink>
                            </Stack>
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      );
                    })}

                    {filteredEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Box sx={{ py: 6, textAlign: "center" }}>
                            <DescriptionRoundedIcon color="disabled" />
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                              当前条件下没有找到可显示的文件或文件夹。
                            </Typography>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </Box>

              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1.25}
                justifyContent="space-between"
              >
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                  <Button
                    variant="contained"
                    disabled={operating || selectedEntries.length === 0}
                    onClick={handleDownloadSelectedFiles}
                  >
                    下载所选文件
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={operating || noSelectedMergeFiles}
                    onClick={() => setOpenFileOrderSelectModal(true)}
                  >
                    合并 Word/PDF/PPTX
                  </Button>
                </Stack>
                <Chip
                  label={selectedFileCount > 0 ? `已选 ${selectedFileCount} 个文件` : "尚未选择文件"}
                  color={selectedFileCount > 0 ? "primary" : "default"}
                  variant={selectedFileCount > 0 ? "filled" : "outlined"}
                />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card sx={{ borderRadius: "28px", border: "1px solid", borderColor: "divider" }}>
          <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h5">文档合并</Typography>
                <Typography variant="body2" color="text.secondary">
                  选中多个可合并文件后，在这里调整顺序并执行 Word / PDF / PPTX 混合合并。
                </Typography>
              </Box>
              {selectedFileCount > 0 && noSelectedMergeFiles ? (
                <Alert severity="info" sx={{ borderRadius: "16px" }}>
                  当前已选文件中，可用于合并的 Word/PDF/PPTX 文件不足 2 个。
                </Alert>
              ) : null}
              {merger}
            </Stack>
          </CardContent>
        </Card>

        <Card sx={{ borderRadius: "28px", border: "1px solid", borderColor: "divider" }}>
          <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h5">下载任务</Typography>
                <Typography variant="body2" color="text.secondary">
                  在这里追踪下载进度、重试失败任务，或直接打开保存后的文件。
                </Typography>
              </Box>
              <FileDownloadTable
                tasks={downloadTasks}
                handleRemoveTask={handleRemoveTask}
                handleDownloadFile={handleDownloadFile}
                handleOpenTaskFile={handleOpenTaskFile}
              />
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </BasicLayout>
  );
}
