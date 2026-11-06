import AccountSessionBoundary from "../components/account_session_boundary";
import { downloadCourseContext } from "../lib/downloads";
import { DownloadCourseContext } from "../lib/download_context";
import PageTaskLists from "../components/page_task_lists";
import { enqueueTask } from "../lib/task_runtime";
import { createCloudUploadTask } from "../lib/upload_tasks";
import { useLegacyTasks } from "../lib/task_hooks";
import { currentSession, isSessionCurrent } from "../lib/session";
import { captureOperationConfig, isConfigOwnerCurrent } from "../lib/config";
import { invoke } from "@tauri-apps/api/core";
import ArrowDropDownRoundedIcon from "@mui/icons-material/ArrowDropDownRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import KeyboardBackspaceRoundedIcon from "@mui/icons-material/KeyboardBackspaceRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
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
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
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
import {
  MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import FileAIChatModal from "../components/file_ai_chat_modal";
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
  useSelectedCourse,
} from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import {
  canConvertFileToPdf,
  getOutputFile,
} from "../lib/file_conversion";
import type { FileOutputFormat } from "../lib/file_conversion";
import {
  Entry,
  File,
  FileDownloadTask,
  Folder,
  LOG_LEVEL_ERROR,
  Option,
  entryName,
  isFile,
} from "../lib/model";
import {
  consoleLog,
  formatSize,
  getFileIcon,
  isMergableFileType,
  scrollToTop,
} from "../lib/utils";
import { useAISession } from "../lib/ai_session_store";
import { fileAISession } from "../lib/file_ai_session";
import { surfaceCardSx } from "../lib/styles";

interface FileActionMenuState {
  action: "download" | "upload";
  anchorEl: HTMLElement;
  file: File;
}

type SnackSeverity = "success" | "info" | "warning" | "error";

const COURSE_FILES = "course files";
const MY_FILES = "my files";
const EXPLAINABLE_FILE_EXTS = [".pdf", ".docx"];
function isExplainableFile(file: File) {
  const dotPos = file.display_name.lastIndexOf(".");
  if (dotPos === -1) {
    return false;
  }
  const ext = file.display_name.slice(dotPos);
  return EXPLAINABLE_FILE_EXTS.includes(ext);
}

export default function FilesPage() {
  return <AccountSessionBoundary><FilesPageContent /></AccountSessionBoundary>;
}

function FilesPageContent() {
  const theme = useTheme();
  const [section, setSection] = useState<string>(COURSE_FILES);
  const { selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const [selectedEntries, setSelectedEntries] = useState<Entry[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [downloadableOnly, setDownloadableOnly] = useState<boolean>(true);
  const [showExternal, setShowExternal] = useState<boolean>(false);
  const downloadTasks = useLegacyTasks<FileDownloadTask>("files", ["file", "conversion", "upload", "upload-pdf"]);
  const [operating, setOperating] = useState<boolean>(false);
  const [currentFolderFullName, setCurrentFolderFullName] =
    useState<Option<string>>("");
  const [parentFolderId, setParentFolderId] = useState<Option<number>>(null);
  const [keyword, setKeyword] = useState<string>("");
  const [openFileOrderSelectModal, setOpenFileOrderSelectModal] =
    useState<boolean>(false);
  const { open: chatOpen, file: chatFile, messages: chatMessages, loading: chatLoading, input: chatInput } = useAISession(fileAISession);
  const [fileActionMenu, setFileActionMenu] =
    useState<FileActionMenuState | null>(null);
  const [messageApi] = useAppMessage();
  const courses = useCourses();
  const selectedDownloadCourse = section === COURSE_FILES ? courses.data.find((course) => course.id === selectedCourseId) : undefined;
  const downloadCourse = selectedDownloadCourse ? downloadCourseContext(selectedDownloadCourse) : undefined;
  const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry, setEntries } =
    usePreview();
  const { merger, mergePDFs } = useMerger({
    setPreviewEntry,
    onHoverEntry,
    onLeaveEntry,
    course: downloadCourse,
  });
  const baseURL = useBaseURL();
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

  // A folder ID is not a request identity: A -> B -> A must reject the first A.
  // Source ownership is invalidated at commit, before passive loading effects.
  const browseCourseId = section === COURSE_FILES ? selectedCourseId : undefined;
  const courseAvailable = courses.data.some((course) => course.id === browseCourseId);
  const browseSource = useMemo(() => ({ section, courseId: browseCourseId, courseAvailable, session: currentSession() }),
    [section, browseCourseId, courseAvailable]);
  const activeBrowseSource = useRef<typeof browseSource>();
  const browseGeneration = useRef(0);
  useLayoutEffect(() => {
    activeBrowseSource.current = browseSource;
    clearFolderView();
    setAllFolders([]);
    setOperating(false);
    return () => {
      activeBrowseSource.current = undefined;
      browseGeneration.current += 1;
    };
  }, [browseSource]);

  useEffect(() => {
    void initAllFolders();
  }, [browseSource]);

  const handleExplainFile = fileAISession.explain;
  const handleSendChatMessage = fileAISession.send;

  const getSelectedCourse = () => {
    if (section !== COURSE_FILES) {
      return undefined;
    }
    return courses.data.find((course) => course.id === selectedCourseId);
  };

  const beginBrowse = () => {
    if (activeBrowseSource.current !== browseSource || !isSessionCurrent(browseSource.session)) return () => false;
    const generation = ++browseGeneration.current;
    return () => activeBrowseSource.current === browseSource
      && browseGeneration.current === generation
      && isSessionCurrent(browseSource.session);
  };

  const clearFolderView = () => {
    setSelectedEntries([]);
    setFiles([]);
    setFolders([]);
    setCurrentFolderFullName(undefined);
    setParentFolderId(null);
    setFileActionMenu(null);
  };

  const loadFolder = async (folderId: number, isCurrent: () => boolean, knownFolder?: Folder) => {
    if (!isCurrent()) return;
    const loadFiles = async () => {
      try {
        const nextFiles = await invoke<File[]>("list_folder_files", { folderId });
        if (isCurrent()) setFiles(nextFiles.map((file) => ({ ...file, key: file.uuid })));
      } catch {
        if (isCurrent()) setFiles([]);
      }
    };
    const loadFolders = async () => {
      try {
        const nextFolders = await invoke<Folder[]>("list_folder_folders", { folderId });
        if (isCurrent()) setFolders(nextFolders.map((folder) => ({ ...folder, key: folder.id.toString() })));
      } catch {
        if (isCurrent()) setFolders([]);
      }
    };
    const loadPath = async () => {
      try {
        const folder = knownFolder ?? await invoke<Folder>("get_folder_by_id", { folderId });
        if (!isCurrent()) return;
        setCurrentFolderFullName(folder.full_name);
        setParentFolderId(folder.parent_folder_id);
      } catch {
        if (!isCurrent()) return;
        setCurrentFolderFullName(undefined);
        setParentFolderId(null);
      }
    };
    await Promise.all([loadFiles(), loadFolders(), loadPath()]);
    if (isCurrent()) setOperating(false);
  };

  const initAllFolders = async () => {
    const isCurrent = beginBrowse();
    if (!isCurrent()) return;
    clearFolderView();
    setAllFolders([]);
    setOperating(false);
    if (section !== MY_FILES && !courseAvailable) return;
    setOperating(true);
    try {
      const nextFolders = section === MY_FILES
        ? await invoke<Folder[]>("list_my_folders")
        : await invoke<Folder[]>("list_course_folders", { courseId: selectedCourseId });
      if (!isCurrent()) return;
      setAllFolders(nextFolders);
      const root = nextFolders.find((folder) => folder.name === section);
      if (!root) {
        setOperating(false);
        return;
      }
      await loadFolder(root.id, isCurrent, root);
    } catch {
      if (!isCurrent()) return;
      if (section === MY_FILES) consoleLog(LOG_LEVEL_ERROR, "Personal folder loading failed");
      setOperating(false);
    }
  };

  const handleFolderOpen = async (folderId: number, knownFolder?: Folder) => {
    const isCurrent = beginBrowse();
    if (!isCurrent()) return;
    clearFolderView();
    setOperating(true);
    await loadFolder(folderId, isCurrent, knownFolder);
    if (isCurrent()) scrollToTop();
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

  const handleSyncFiles = async () => {
    const course = getSelectedCourse();
    if (!course) return;
    const owner = currentSession();
    const ensureOwner = () => {
      if (!isSessionCurrent(owner)) throw new Error("账号已切换，请重新同步文件。");
    };
    enqueueTask({
      id: `sync:${course.id}:${crypto.randomUUID()}`, name: `${course.name} · 同步检查`,
      source: "files", kind: "sync", context: course.name,
      locks: [`sync:${course.id}`], stage: "正在检查文件差异",
      run: async ({ update }) => {
        ensureOwner();
        const filesToSync = await invoke<File[]>("sync_course_files", { course });
        ensureOwner();
        filesToSync.forEach((file) => handleAddDownloadFileTask(file));
        update({ log: filesToSync.length ? `已创建 ${filesToSync.length} 个文件下载任务。请查看对应下载任务的进度。` : "文件已同步，无需下载。" });
        notify(filesToSync.length ? `共 ${filesToSync.length} 个文件需要下载，已加入队列。` : "已同步，无需下载。", "success");
      },
    });
  };

  const handleAddDownloadFileTask = (
    inputFile: File,
    outputFormat: FileOutputFormat = "original"
  ) => {
    const session = currentSession();
    const config = captureOperationConfig();
    const file = structuredClone(inputFile);
    const selectedCourse = section === COURSE_FILES ? getSelectedCourse() : undefined;
    const course = selectedCourse ? structuredClone(selectedCourse) : undefined;
    const folderPath = getFolderPath(file) ?? "";
    const output = getOutputFile(file, outputFormat);
    const scope = course ? `course:${course.id}` : "my";
    const id = `files:${session}:${scope}:${file.uuid}:${outputFormat}`;
    const name = output.display_name;
    const ensureOwner = () => {
      if (!isSessionCurrent(session) || !isConfigOwnerCurrent(config))
        throw new Error("账号已切换，请在当前账号重新创建下载任务。");
    };
    const event = { channel: "download://progress", id: crypto.randomUUID() };
    enqueueTask({
      id, name, source: "files", kind: outputFormat === "pdf" ? "conversion" : "file",
      context: course?.name ?? "我的 Canvas 文件",
      outputPath: `${course?.name ?? "我的Canvas文件"}/${folderPath}/${name}`,
      // Keep physical-destination serialization independent of account identity.
      locks: [`output:${scope}:${folderPath}:${name}`],
      event: outputFormat === "original" ? event : undefined,
      stage: outputFormat === "pdf" ? "正在转换 PDF" : "正在下载",
      data: { file: structuredClone(file), outputFormat },
      run: async () => {
        ensureOwner();
        event.id = crypto.randomUUID();
        try {
          await invoke(course
            ? outputFormat === "pdf" ? "download_course_file_as_pdf" : "download_course_file"
            : outputFormat === "pdf" ? "download_my_file_as_pdf" : "download_my_file",
            course
              ? { file, course, folderPath, expectedOwner: config.__config_owner, operationId: event.id }
              : { file, folderPath, expectedOwner: config.__config_owner, operationId: event.id });
        } catch (error) {
          ensureOwner();
          throw error;
        }
        ensureOwner();
      },
      // Do not open a same-named file through a different current account.
      open: async () => {
        ensureOwner();
        return invoke(course ? "open_course_file" : "open_my_file",
          course ? { name, course, folderPath, expectedOwner: config.__config_owner, expectedSavePath: config.save_path } : { name, folderPath, expectedOwner: config.__config_owner, expectedSavePath: config.save_path });
      },
    });
  };

  const handleUploadFile = async (
    file: File,
    outputFormat: FileOutputFormat = "original"
  ) => {
    // Child file rows may arrive before their path, or path lookup may fail.
    // Never silently upload them into the root directory.
    if (!currentFolderFullName) return;
    const subDir = currentFolderFullName.replace(section, "");
    const course = getSelectedCourse();
    if (section === COURSE_FILES && !course) return;
    const saveDir =
      section === COURSE_FILES
        ? `${course!.name}${subDir}`
        : `我的Canvas文件${subDir}`;
    enqueueTask(createCloudUploadTask(file, outputFormat, saveDir,
      section === COURSE_FILES ? course!.name : "我的 Canvas 文件"));
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

  const openFileActionMenu = (
    event: ReactMouseEvent<HTMLElement>,
    file: File,
    action: FileActionMenuState["action"]
  ) => {
    setFileActionMenu({ action, anchorEl: event.currentTarget, file });
  };

  const runFileAction = (outputFormat: FileOutputFormat) => {
    if (!fileActionMenu) {
      return;
    }
    const { action, file } = fileActionMenu;
    setFileActionMenu(null);
    if (action === "download") {
      handleAddDownloadFileTask(file, outputFormat);
      return;
    }
    void handleUploadFile(file, outputFormat);
  };

  const backToParentDir = async () => {
    if (typeof parentFolderId === "number") await handleFolderOpen(parentFolderId);
  };

  const backToRootDir = async () => {
    const root = allFolders.find((folder) => folder.name === section);
    if (root) await handleFolderOpen(root.id, root);
  };

  const shouldShow = (entry: Entry) => {
    const containsKeyword = entryName(entry).includes(keyword);
    const downloadable = !isFile(entry) || !downloadableOnly || (entry as File).url;
    return containsKeyword && downloadable;
  };

  const supportedMergeFiles = useMemo(() =>
    (selectedEntries.filter(isFile) as File[]).filter((file) =>
      isMergableFileType(file.display_name)
    ), [selectedEntries]);
  const noSelectedMergeFiles = supportedMergeFiles.length < 2;

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
      label: "已选文件",
      value: `${selectedFileCount}`,
      icon: <CloudDownloadRoundedIcon />,
    },
    {
      label: "下载/上传任务",
      value: `${downloadTasks.length}`,
      icon: <AutoAwesomeRoundedIcon />,
    },
  ];

  return (
    <BasicLayout>
      <DownloadCourseContext.Provider value={downloadCourse}>{previewer}</DownloadCourseContext.Provider>

      <FileOrderSelectModal
        open={openFileOrderSelectModal}
        handleOk={(items) => {
          setOpenFileOrderSelectModal(false);
          const orderedFiles = items.map((item) => item.data as File);
          mergePDFs(orderedFiles);
        }}
        handleCancel={() => setOpenFileOrderSelectModal(false)}
        files={supportedMergeFiles}
      />

      <FileAIChatModal
        open={chatOpen}
        title={chatFile?.display_name ?? ""}
        messages={chatMessages}
        loading={chatLoading}
        onClose={() => fileAISession.update({ open: false })}
        input={chatInput}
        onInputChange={(input) => fileAISession.update({ input })}
        onSend={handleSendChatMessage}
      />

      <Menu
        anchorEl={fileActionMenu?.anchorEl}
        open={Boolean(fileActionMenu)}
        onClose={() => setFileActionMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={() => runFileAction("original")}>
          <ListItemIcon>
            <DescriptionRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              fileActionMenu?.action === "upload" ? "上传原文件" : "下载原文件"
            }
          />
        </MenuItem>
        <MenuItem
          disabled={
            !fileActionMenu || !canConvertFileToPdf(fileActionMenu.file)
          }
          onClick={() => runFileAction("pdf")}
        >
          <ListItemIcon>
            <PictureAsPdfRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              fileActionMenu?.action === "upload"
                ? "转换为 PDF 后上传"
                : "转换为 PDF 后下载"
            }
            secondary={
              fileActionMenu && !canConvertFileToPdf(fileActionMenu.file)
                ? "仅支持 Word 和 PowerPoint 文件"
                : undefined
            }
          />
        </MenuItem>
      </Menu>

      <Stack spacing={2} sx={{ width: "100%" }}>
        <WorkspaceHero
          chipLabel="文件管理"
          chipIcon={<FolderOpenRoundedIcon />}
          title="文件浏览与下载"
          description="课程文件筛选、批量下载。"
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

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
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
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "1.1fr 1.4fr" },
                  alignItems: "center",
                }}
              >
                {section === COURSE_FILES ? (
                  <CourseSelect
                    onChange={setSelectedCourseId}
                    disabled={operating}
                    courses={courses.data}
                    value={selectedCourseId > 0 ? selectedCourseId : undefined}
                  />
                ) : (
                  <Alert severity="info" sx={{ borderRadius: "10px" }}>
                    当前正在浏览“我的文件”，系统会自动载入你的个人目录结构。
                  </Alert>
                )}

                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  alignItems={{ xs: "stretch", sm: "center" }}
                >
                  <Stack direction="row" spacing={2.5} sx={{ flexShrink: 0 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={downloadableOnly}
                          disabled={operating}
                          onChange={(event) => setDownloadableOnly(event.target.checked)}
                        />
                      }
                      label="只显示可下载"
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
                </Stack>
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
                  borderRadius: "8px",
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
                                <Box>
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
                                  <Typography variant="caption" display="block" color="text.secondary">
                                    {formatSize(file.size)}
                                  </Typography>
                                </Box>
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
                                    startIcon={<DownloadRoundedIcon />}
                                    endIcon={<ArrowDropDownRoundedIcon />}
                                    onClick={(event) =>
                                      openFileActionMenu(event, file, "download")
                                    }
                                  >
                                    下载
                                  </Button>
                                ) : null}
                                {file.url ? (
                                  <Button
                                    size="small"
                                    startIcon={<UploadFileRoundedIcon />}
                                    disabled={!currentFolderFullName}
                                    endIcon={<ArrowDropDownRoundedIcon />}
                                    onClick={(event) =>
                                      openFileActionMenu(event, file, "upload")
                                    }
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
                                    disabled={chatLoading && chatFile?.id !== file.id}
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

                    {operating && filteredEntries.length === 0 ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={`skeleton-${i}`}>
                          <TableCell padding="checkbox">
                            <Skeleton variant="circular" width={18} height={18} />
                          </TableCell>
                          <TableCell>
                            <Skeleton variant="text" width="55%" sx={{ fontSize: 20 }} />
                          </TableCell>
                          <TableCell align="right">
                            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                              <Skeleton variant="rounded" width={56} height={30} />
                              <Skeleton variant="rounded" width={80} height={30} />
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : null}

                    {!operating && filteredEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Stack alignItems="center" spacing={1.5} sx={{ py: 8, textAlign: "center" }}>
                            <Box
                              sx={{
                                width: 56,
                                height: 56,
                                borderRadius: "18px",
                                display: "grid",
                                placeItems: "center",
                                color: "text.secondary",
                                bgcolor: alpha(theme.palette.primary.main, 0.06),
                                "& svg": { fontSize: 28 },
                              }}
                            >
                              <DescriptionRoundedIcon />
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                              当前条件下没有找到可显示的文件或文件夹。
                            </Typography>
                            <Typography variant="caption" color="text.disabled">
                              可尝试切换目录、关闭「只显示可下载文件」或更换搜索关键词。
                            </Typography>
                          </Stack>
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
                    startIcon={<DownloadRoundedIcon />}
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

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">文档合并</Typography>
              {selectedFileCount > 0 && noSelectedMergeFiles ? (
                <Alert severity="info" sx={{ borderRadius: "8px" }}>
                  当前已选文件中，可用于合并的 Word/PDF/PPTX 文件不足 2 个。
                </Alert>
              ) : null}
              {merger}
            </Stack>
          </CardContent>
        </Card>

        <PageTaskLists>
          <Card sx={surfaceCardSx}>
            <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack spacing={2}>
                <Typography variant="h6">下载/上传任务</Typography>
                <FileDownloadTable tasks={downloadTasks} />
              </Stack>
            </CardContent>
          </Card>
        </PageTaskLists>
      </Stack>
    </BasicLayout>
  );
}
