import { downloadCourseContext } from "../lib/downloads";
import { DownloadCourseContext } from "../lib/download_context";
import PageTaskLists from "../components/page_task_lists";
import { enqueueTask } from "../lib/task_runtime";
import { createCloudUploadTask } from "../lib/upload_tasks";
import { useLegacyTasks, useTasks } from "../lib/task_hooks";
import { isTaskActive } from "../lib/task_manager";
import { enqueuePDFMerge } from "../lib/pdf_tasks";
import TaskItem from "../components/task_item";
import { invoke } from "@tauri-apps/api/core";
import ArrowDropDownRoundedIcon from "@mui/icons-material/ArrowDropDownRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  Link as MuiLink,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import {
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
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
  Course,
  Entry,
  File,
  FileDownloadTask,
  Folder,
  LOG_LEVEL_ERROR,
  entryName,
  isFile,
} from "../lib/model";
import {
  consoleLog,
  formatSize,
  getFileIcon,
  isMergableFileType,
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
const fileActionSx = {
  minWidth: { xs: 28, md: 0 }, px: { xs: 0.25, md: 1 }, whiteSpace: "nowrap",
  "& .MuiButton-startIcon": { mx: { xs: 0, md: 0.5 } },
  "& .MuiButton-endIcon": { display: { xs: "none", md: "inherit" }, ml: 0.25 },
};
const fileActionLabelSx = { display: { xs: "none", md: "inline" } };
function isExplainableFile(file: File) {
  const dotPos = file.display_name.lastIndexOf(".");
  if (dotPos === -1) {
    return false;
  }
  const ext = file.display_name.slice(dotPos);
  return EXPLAINABLE_FILE_EXTS.includes(ext);
}

export default function FilesPage() {
  const theme = useTheme();
  const [section, setSection] = useState<typeof COURSE_FILES | typeof MY_FILES>(COURSE_FILES);
  const { selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const [selectedEntries, setSelectedEntries] = useState<Entry[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [downloadableOnly, setDownloadableOnly] = useState<boolean>(true);
  const [showExternal, setShowExternal] = useState<boolean>(false);
  const downloadTasks = useLegacyTasks<FileDownloadTask>("files", ["file", "conversion", "upload", "upload-pdf"]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const operating = loadingFolders || loadingEntries;
  const [currentFolderId, setCurrentFolderId] = useState(0);
  const [syncCourse, setSyncCourse] = useState<Course>();
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
  const tasks = useTasks();
  const mergeTasks = tasks.filter((task) => task.kind === "pdf-merge" || task.kind === "pdf-save");
  const isSyncing = (courseId: number) => tasks.some((task) =>
    task.kind === "sync" && task.id.startsWith(`sync:${courseId}:`) && isTaskActive(task));
  const courseSyncing = selectedDownloadCourse ? isSyncing(selectedDownloadCourse.id) : false;
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

  useEffect(() => {
    if (!currentFolderId) {
      setLoadingEntries(false);
      return;
    }
    let active = true;
    setLoadingEntries(true);
    void Promise.allSettled([
      invoke<File[]>("list_folder_files", { folderId: currentFolderId }),
      invoke<Folder[]>("list_folder_folders", { folderId: currentFolderId }),
    ]).then(([nextFiles, nextFolders]) => {
      if (!active) return;
      setFiles(nextFiles.status === "fulfilled" ? nextFiles.value.map((file) => ({ ...file, key: file.uuid })) : []);
      const children = nextFolders.status === "fulfilled" ? nextFolders.value.map((folder) => ({ ...folder, key: String(folder.id) })) : [];
      setFolders(children);
      setAllFolders((known) => {
        const byId = new Map(known.map((folder) => [folder.id, folder]));
        for (const folder of children) byId.set(folder.id, folder);
        return [...byId.values()];
      });
      setLoadingEntries(false);
    });
    return () => { active = false; };
  }, [currentFolderId]);

  const courseForFolders = selectedDownloadCourse?.id;
  useEffect(() => {
    setSelectedEntries([]);
    setAllFolders([]);
    setFiles([]);
    setFolders([]);
    setCurrentFolderId(0);
    if (section === COURSE_FILES && !courseForFolders) {
      setLoadingFolders(false);
      return;
    }
    let active = true;
    setLoadingFolders(true);
    const request = section === MY_FILES
      ? invoke<Folder[]>("list_my_folders")
      : invoke<Folder[]>("list_course_folders", { courseId: courseForFolders });
    void request.then((nextFolders) => {
      if (!active) return;
      const root = nextFolders.find((folder) => folder.parent_folder_id == null && folder.name === section)
        ?? nextFolders.find((folder) => folder.name === section);
      if (root) {
        setAllFolders(nextFolders);
        setLoadingEntries(true);
        setCurrentFolderId(root.id);
      }
    }).catch((error) => {
      if (active) consoleLog(LOG_LEVEL_ERROR, error);
    }).finally(() => {
      if (active) setLoadingFolders(false);
    });
    return () => { active = false; };
  }, [section, courseForFolders]);

  const handleExplainFile = fileAISession.explain;
  const handleSendChatMessage = fileAISession.send;

  const handleFolderOpen = (folderId: number) => {
    if (folderId === currentFolderId) return;
    setSelectedEntries([]);
    setFiles([]);
    setFolders([]);
    setLoadingEntries(true);
    setCurrentFolderId(folderId);
  };

  const folderPath = useMemo(() => {
    const byId = new Map(allFolders.map((folder) => [folder.id, folder]));
    const path: Folder[] = [];
    const visited = new Set<number>();
    let folder = byId.get(currentFolderId);
    while (folder && !visited.has(folder.id)) {
      path.push(folder);
      visited.add(folder.id);
      folder = folder.parent_folder_id == null ? undefined : byId.get(folder.parent_folder_id);
    }
    return path.reverse();
  }, [allFolders, currentFolderId]);

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

  const handleConfirmSync = () => {
    const course = syncCourse;
    setSyncCourse(undefined);
    if (!course || isSyncing(course.id)) return;
    enqueueTask({
      id: `sync:${course.id}:${crypto.randomUUID()}`, name: `${course.name} · 同步检查`,
      source: "files", kind: "sync", context: course.name,
      locks: [`sync:${course.id}`], stage: "正在检查文件差异",
      run: async ({ update }) => {
        const filesToSync = await invoke<File[]>("sync_course_files", { course });
        filesToSync.forEach((file) => handleAddDownloadFileTask(file, "original", course));
        update({ log: filesToSync.length ? `已创建 ${filesToSync.length} 个文件下载任务。请查看对应下载任务的进度。` : "文件已同步，无需下载。" });
        notify(filesToSync.length ? `共 ${filesToSync.length} 个文件需要下载，已加入队列。` : "已同步，无需下载。", "success");
      },
    });
  };

  const handleAddDownloadFileTask = (
    file: File,
    outputFormat: FileOutputFormat = "original",
    course = selectedDownloadCourse,
  ) => {
    const folderPath = getFolderPath(file) ?? "";
    const output = getOutputFile(file, outputFormat);
    const scope = course ? `course:${course.id}` : "my";
    const id = `files:${scope}:${file.uuid}:${outputFormat}`;
    const name = output.display_name;
    enqueueTask({
      id, name, source: "files", kind: outputFormat === "pdf" ? "conversion" : "file",
      context: course?.name ?? "我的 Canvas 文件",
      outputPath: `${course?.name ?? "我的Canvas文件"}/${folderPath}/${name}`,
      locks: [`output:${scope}:${folderPath}:${name}`],
      event: outputFormat === "original" ? { channel: "download://progress", id: file.uuid } : undefined,
      stage: outputFormat === "pdf" ? "正在转换 PDF" : "正在下载",
      data: { file, outputFormat },
      run: () => invoke(course
        ? outputFormat === "pdf" ? "download_course_file_as_pdf" : "download_course_file"
        : outputFormat === "pdf" ? "download_my_file_as_pdf" : "download_my_file",
        course ? { file, course, folderPath } : { file, folderPath }),
      open: () => invoke(course ? "open_course_file" : "open_my_file",
        course ? { name, course, folderPath } : { name, folderPath }),
    });
  };

  const handleUploadFile = async (
    file: File,
    outputFormat: FileOutputFormat = "original"
  ) => {
    const subDir = folderPath[folderPath.length - 1]?.full_name.slice(section.length) ?? "";
    const course = selectedDownloadCourse;
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

  return (
    <BasicLayout>
      <DownloadCourseContext.Provider value={downloadCourse}>{previewer}</DownloadCourseContext.Provider>

      <Dialog open={!!syncCourse} onClose={() => setSyncCourse(undefined)} fullWidth maxWidth="xs">
        <DialogTitle>同步课程文件</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography fontWeight={600} sx={{ overflowWrap: "anywhere" }}>{syncCourse?.name}</Typography>
            <DialogContentText>
              将检查整门课程的 Canvas 文件（包括所有子目录），并把本地缺少的文件加入下载队列。本次同步可能下载大量文件。
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setSyncCourse(undefined)}>取消</Button>
          <Button variant="contained" onClick={handleConfirmSync}>确认同步</Button>
        </DialogActions>
      </Dialog>

      <FileOrderSelectModal
        open={openFileOrderSelectModal}
        handleOk={(orderedFiles, name) => {
          setOpenFileOrderSelectModal(false);
          enqueuePDFMerge(orderedFiles, name, downloadCourse);
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
          description="浏览 Canvas 文件，按目录查找和批量下载。"
          aside={
            <Stack spacing={1} alignItems={{ xs: "stretch", sm: "flex-start", lg: "flex-end" }}
              sx={{ width: { xs: "100%", lg: 440 } }}>
              <ToggleButtonGroup
                exclusive value={section} aria-label="文件来源" size="small" disabled={operating}
                onChange={(_, value: typeof section | null) => { if (value) setSection(value); }}
                sx={{
                  alignSelf: { xs: "stretch", sm: "auto" }, p: 0.375, gap: 0.25,
                  border: "1px solid", borderColor: "divider", borderRadius: "12px", bgcolor: "action.hover",
                  "& .MuiToggleButtonGroup-grouped.MuiToggleButton-root": {
                    flex: { xs: 1, sm: "initial" }, m: 0, border: 0, borderRadius: "8px",
                    px: 1.5, py: 0.375, minHeight: 30, textTransform: "none", color: "text.secondary",
                    "&.Mui-selected": { color: "primary.main", bgcolor: "background.paper", fontWeight: 600, boxShadow: 1 },
                  },
                }}
              >
                <ToggleButton value={COURSE_FILES}>课程文件</ToggleButton>
                <ToggleButton value={MY_FILES}>我的文件</ToggleButton>
              </ToggleButtonGroup>
              {section === COURSE_FILES && (
                <CourseSelect
                  onChange={setSelectedCourseId}
                  disabled={operating}
                  courses={courses.data}
                  value={selectedCourseId > 0 ? selectedCourseId : undefined}
                />
              )}
            </Stack>
          }
        />

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", md: "row" }} gap={1.5} alignItems={{ md: "center" }}>
                <TextField
                  fullWidth size="small"
                  placeholder="输入文件关键词…"
                  inputProps={{ "aria-label": "搜索文件" }}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start"><SearchRoundedIcon color="action" /></InputAdornment>
                    ),
                  }}
                />
                <Stack direction="row" gap={1.25} flexWrap="wrap" sx={{ flexShrink: 0 }}>
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={<Checkbox size="small" checked={downloadableOnly} disabled={operating}
                      onChange={(event) => setDownloadableOnly(event.target.checked)} />}
                    label="只显示可下载"
                  />
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={<Checkbox size="small" checked={showExternal} disabled={operating}
                      onChange={(event) => setShowExternal(event.target.checked)} />}
                    label="显示外部文件"
                  />
                </Stack>
              </Stack>

              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
                <Breadcrumbs aria-label="目录路径" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {folderPath.length ? folderPath.map((folder, index) => {
                    const name = index === 0 && folder.name === section ? (section === COURSE_FILES ? "课程文件" : "我的文件") : folder.name;
                    return index === folderPath.length - 1 ? (
                      <Typography key={folder.id} variant="body2" color="text.primary" fontWeight={600} aria-current="page">{name}</Typography>
                    ) : (
                      <MuiLink key={folder.id} component="button" type="button" variant="body2" underline="hover" onClick={() => handleFolderOpen(folder.id)}>{name}</MuiLink>
                    );
                  }) : <Typography variant="body2" color="text.secondary">未选择目录</Typography>}
                </Breadcrumbs>
                {selectedDownloadCourse && (
                  <Button size="small" disabled={operating || courseSyncing}
                    onClick={() => setSyncCourse(selectedDownloadCourse)}>
                    {courseSyncing ? "正在检查同步" : "一键同步"}
                  </Button>
                )}
              </Stack>

              <Box
                sx={{
                  borderRadius: "8px",
                  border: "1px solid",
                  borderColor: "divider",
                  overflow: "hidden",
                }}
              >
                <Table size="small" sx={{
                  tableLayout: "fixed",
                  "& .MuiTableCell-root": { px: { xs: 0.75, md: 2 } },
                  "& .MuiTableCell-paddingCheckbox": { width: 38, px: 0 },
                }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                      <TableCell padding="checkbox" />
                      <TableCell>文件</TableCell>
                      <TableCell align="right" sx={{ width: { xs: 126, md: 376 } }}>操作</TableCell>
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
                                size="small"
                                onChange={(event) => handleEntrySelect(entry, event.target.checked)}
                              />
                            </TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={1.25} alignItems="center">
                                <Box
                                  sx={{ display: { xs: "none", sm: "grid" }, placeItems: "center", width: 28, height: 28, flexShrink: 0 }}
                                >
                                  {getFileIcon(file)}
                                </Box>
                                <Box sx={{ minWidth: 0 }}>
                                  <MuiLink
                                    href={href}
                                    target="_blank"
                                    underline="hover"
                                    color="inherit"
                                    onMouseEnter={() => onHoverEntry(entry)}
                                    onMouseLeave={onLeaveEntry}
                                    sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
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
                                spacing={{ xs: 0.25, md: 0.75 }}
                                justifyContent="flex-end"
                                flexWrap="wrap"
                                useFlexGap
                              >
                                {file.url ? (
                                  <Button
                                    size="small"
                                    aria-label="下载" title="下载" sx={fileActionSx}
                                    startIcon={<DownloadRoundedIcon />}
                                    endIcon={<ArrowDropDownRoundedIcon />}
                                    onClick={(event) =>
                                      openFileActionMenu(event, file, "download")
                                    }
                                  >
                                    <Box component="span" sx={fileActionLabelSx}>下载</Box>
                                  </Button>
                                ) : null}
                                {file.url ? (
                                  <Button
                                    size="small"
                                    aria-label="上传云盘" title="上传云盘" sx={fileActionSx}
                                    startIcon={<UploadFileRoundedIcon />}
                                    endIcon={<ArrowDropDownRoundedIcon />}
                                    onClick={(event) =>
                                      openFileActionMenu(event, file, "upload")
                                    }
                                  >
                                    <Box component="span" sx={fileActionLabelSx}>上传云盘</Box>
                                  </Button>
                                ) : null}
                                <Button
                                  size="small"
                                  aria-label="预览" title="预览" sx={fileActionSx}
                                  startIcon={<PreviewRoundedIcon />}
                                  onClick={() => setPreviewEntry(file)}
                                >
                                  <Box component="span" sx={fileActionLabelSx}>预览</Box>
                                </Button>
                                {isExplainableFile(file) ? (
                                  <Button
                                    size="small"
                                    disabled={chatLoading && chatFile?.id !== file.id}
                                    aria-label="AI 总结" title="AI 总结" sx={fileActionSx}
                                    startIcon={<AutoAwesomeRoundedIcon />}
                                    onClick={() => void handleExplainFile(file)}
                                  >
                                    <Box component="span" sx={fileActionLabelSx}>AI 总结</Box>
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
                              <FolderOpenRoundedIcon color="primary" sx={{ display: { xs: "none", sm: "block" }, flexShrink: 0 }} />
                              <MuiLink
                                component="button"
                                type="button"
                                underline="hover"
                                color="inherit"
                                onMouseEnter={() => onHoverEntry(entry)}
                                onMouseLeave={onLeaveEntry}
                                onClick={() => handleFolderOpen(folder.id)}
                                sx={{
                                  fontWeight: 600,
                                  minWidth: 0,
                                  overflowWrap: "anywhere",
                                  textAlign: "left",
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
                            <Stack direction="row" spacing={{ xs: 0.5, md: 1.5 }} justifyContent="flex-end">
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

        <PageTaskLists>
          <Card sx={surfaceCardSx}>
            <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
              <Stack spacing={2}>
                <Typography variant="h6">文件任务</Typography>
                {(downloadTasks.length > 0 || mergeTasks.length === 0) && <FileDownloadTable tasks={downloadTasks} />}
                {mergeTasks.map((task) => (
                  <TaskItem key={task.id} task={task} onPreview={() => {
                    if (task.result) setPreviewEntry({ url: task.result.url, display_name: task.result.name } as File);
                  }} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        </PageTaskLists>
      </Stack>
    </BasicLayout>
  );
}
