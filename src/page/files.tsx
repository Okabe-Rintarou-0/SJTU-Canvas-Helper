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
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
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
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
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
  formatCompactDate,
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
  files: File[];
}

type FileSortKey = "size" | "modified";
type FileSort = { key: FileSortKey; direction: "asc" | "desc" };

const fileSortColumns = [
  { key: "size", label: "文件大小", width: 118 },
  { key: "modified", label: "修改日期", width: 154 },
] as const;

const entryLinkSx = {
  fontWeight: 600,
  textAlign: "left",
  overflowWrap: "anywhere",
  border: 0,
  background: "transparent",
  cursor: "pointer",
  p: 0,
} as const;

function modificationDate(entry: Entry) {
  if (isFile(entry) && entry.modified_at && Number.isFinite(Date.parse(entry.modified_at))) {
    return entry.modified_at;
  }
  return entry.updated_at;
}

function entrySize(entry: Entry) {
  return isFile(entry) && !entry.external_type && Number.isFinite(entry.size) ? entry.size : undefined;
}

function compareEntries(left: Entry, right: Entry, sort: FileSort) {
  // Keep folders together above files and unavailable values at the end of each group.
  if (isFile(left) !== isFile(right)) return isFile(left) ? 1 : -1;
  const value = sort.key === "size"
    ? entrySize
    : (entry: Entry) => Date.parse(modificationDate(entry) ?? "");
  const a = value(left);
  const b = value(right);
  if (a === undefined || !Number.isFinite(a)) return b !== undefined && Number.isFinite(b) ? 1 : 0;
  if (b === undefined || !Number.isFinite(b)) return -1;
  return sort.direction === "asc" ? a - b : b - a;
}

type SnackSeverity = "success" | "info" | "warning" | "error";

const COURSE_FILES = "course files";
const MY_FILES = "my files";
const EXPLAINABLE_FILE_EXTS = [".pdf", ".docx"];
const fileActionSx = {
  minWidth: { xs: 28, xl: 0 }, px: { xs: 0.25, xl: 1 }, whiteSpace: "nowrap",
  "& .MuiButton-startIcon": { mx: { xs: 0, xl: 0.5 } },
  "& .MuiButton-endIcon": { display: { xs: "none", xl: "inherit" }, ml: 0.25 },
};
const fileActionLabelSx = { display: { xs: "none", xl: "inline" } };
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sort, setSort] = useState<FileSort | null>(null);
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
    setSelectedFiles([]);
    setFileActionMenu(null);
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
    setSelectedFiles([]);
    setFileActionMenu(null);
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

  const handleUploadFile = (
    file: File,
    outputFormat: FileOutputFormat = "original"
  ) => {
    if (section === COURSE_FILES && !selectedDownloadCourse) return;
    const subDir = folderPath[folderPath.length - 1]?.full_name.slice(section.length) ?? "";
    const saveDir = `${selectedDownloadCourse?.name ?? "我的Canvas文件"}${subDir}`;
    enqueueTask(createCloudUploadTask(file, outputFormat, saveDir,
      selectedDownloadCourse?.name ?? "我的 Canvas 文件"));
  };

  const openFileActionMenu = (
    event: ReactMouseEvent<HTMLElement>,
    files: File[],
    action: FileActionMenuState["action"]
  ) => {
    setFileActionMenu({ action, anchorEl: event.currentTarget, files });
  };

  const pdfActionFiles = fileActionMenu?.files.filter(canConvertFileToPdf) ?? [];

  const runFileAction = (outputFormat: FileOutputFormat) => {
    if (!fileActionMenu) {
      return;
    }
    const { action, files } = fileActionMenu;
    setFileActionMenu(null);
    const run = action === "download" ? handleAddDownloadFileTask : handleUploadFile;
    for (const file of outputFormat === "pdf" ? pdfActionFiles : files) {
      run(file, outputFormat);
    }
  };

  const supportedMergeFiles = useMemo(() =>
    selectedFiles.filter((file) => isMergableFileType(file.display_name)), [selectedFiles]);

  const filteredEntries = useMemo(() => {
    const entries: Entry[] = [...folders, ...files, ...externalFiles.data].filter((entry) =>
      entryName(entry).includes(keyword) && (!isFile(entry) || !downloadableOnly || entry.url)
    );
    if (sort) entries.sort((a, b) => compareEntries(a, b, sort));
    return entries;
  }, [folders, files, externalFiles.data, keyword, downloadableOnly, sort]);

  const visibleFiles = useMemo(() => filteredEntries.filter(isFile), [filteredEntries]);
  useEffect(() => { setEntries(visibleFiles); }, [visibleFiles, setEntries]);

  const selectedKeys = new Set(selectedFiles.map((file) => file.key));
  const visibleKeys = new Set(visibleFiles.map((file) => file.key));
  const selectedVisibleCount = visibleFiles.filter((file) => selectedKeys.has(file.key)).length;
  const hiddenSelected = selectedFiles.length - selectedVisibleCount;
  const transferableFiles = selectedFiles.filter((file) => file.url);

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
          disabled={pdfActionFiles.length === 0}
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
              fileActionMenu && pdfActionFiles.length < fileActionMenu.files.length
                ? pdfActionFiles.length
                  ? `仅处理 ${pdfActionFiles.length} 个支持转换的文件`
                  : "仅支持 Word 和 PowerPoint 文件"
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
          description="按目录浏览和预览 Canvas 文件，批量下载或上传云盘。"
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

              <TableContainer sx={{ borderRadius: "8px", border: "1px solid", borderColor: "divider" }}>
                <Table size="small" sx={{
                  minWidth: 560,
                  tableLayout: "fixed",
                  "& .MuiTableCell-root": { px: { xs: 0.75, md: 1.25 } },
                  "& .MuiTableCell-paddingCheckbox": { width: 38, px: 0 },
                }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          inputProps={{ "aria-label": "选择所有可见文件" }}
                          checked={visibleFiles.length > 0 && selectedVisibleCount === visibleFiles.length}
                          indeterminate={selectedVisibleCount > 0 && selectedVisibleCount < visibleFiles.length}
                          disabled={operating || visibleFiles.length === 0}
                          onChange={(_, checked) => setSelectedFiles((previous) => {
                            if (!checked) return previous.filter((file) => !visibleKeys.has(file.key));
                            const previousKeys = new Set(previous.map((file) => file.key));
                            return [...previous, ...visibleFiles.filter((file) => !previousKeys.has(file.key))];
                          })}
                        />
                      </TableCell>
                      <TableCell>文件</TableCell>
                      {fileSortColumns.map(({ key, label, width }) => (
                        <TableCell key={key} align="right" sortDirection={sort?.key === key ? sort.direction : false} sx={{ width, whiteSpace: "nowrap" }}>
                          <TableSortLabel
                            active={sort?.key === key}
                            direction={sort?.key === key ? sort.direction : "asc"}
                            onClick={() => setSort((current) => ({
                              key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
                            }))}
                          >
                            {label}
                          </TableSortLabel>
                        </TableCell>
                      ))}
                      <TableCell align="right" sx={{ width: { xs: 148, xl: 368 } }}>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredEntries.map((entry) => {
                      const date = formatCompactDate(modificationDate(entry)) || "—";
                      if (isFile(entry)) {
                        const file = entry;
                        const checked = selectedKeys.has(file.key);
                        const size = entrySize(file);
                        const opensExternalSource = Boolean(file.external_type && !file.canvas_url);
                        const href = file.external_type
                          ? file.canvas_url || file.url
                          : baseURL.data && (section === MY_FILES
                            ? `${baseURL.data}/files/${file.id}`
                            : selectedDownloadCourse && `${baseURL.data}/courses/${selectedDownloadCourse.id}/files?preview=${file.id}`);
                        const filePrefix = file.external_title ? "[外部文件] " : "";
                        return (
                          <TableRow key={entry.key} hover selected={checked}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={checked}
                                size="small"
                                inputProps={{ "aria-label": `选择 ${file.display_name}` }}
                                onChange={(_, nextChecked) => setSelectedFiles((previous) => nextChecked
                                  ? [...previous, file]
                                  : previous.filter((item) => item.key !== file.key))}
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
                                    component="button"
                                    type="button"
                                    underline="hover"
                                    color="inherit"
                                    onClick={() => setPreviewEntry(file)}
                                    onMouseEnter={() => onHoverEntry(file)}
                                    onMouseLeave={onLeaveEntry}
                                    sx={entryLinkSx}
                                  >
                                    {filePrefix}
                                    {file.display_name}
                                  </MuiLink>
                                </Box>
                              </Stack>
                            </TableCell>
                            <TableCell align="right" sx={{ color: "text.secondary" }}>
                              {size === undefined ? "—" : formatSize(size)}
                            </TableCell>
                            <TableCell align="right" sx={{ color: "text.secondary" }}>{date}</TableCell>
                            <TableCell align="right">
                              <Stack
                                direction="row"
                                spacing={{ xs: 0.25, xl: 0.75 }}
                                justifyContent="flex-end"
                                useFlexGap
                              >
                                {file.url ? (
                                  <Button
                                    size="small"
                                    aria-label="下载" title="下载" sx={fileActionSx}
                                    startIcon={<DownloadRoundedIcon />}
                                    endIcon={<ArrowDropDownRoundedIcon />}
                                    onClick={(event) =>
                                      openFileActionMenu(event, [file], "download")
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
                                      openFileActionMenu(event, [file], "upload")
                                    }
                                  >
                                    <Box component="span" sx={fileActionLabelSx}>上传云盘</Box>
                                  </Button>
                                ) : null}
                                {href && (
                                  <IconButton
                                    component="a"
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    size="small"
                                    color="primary"
                                    aria-label={opensExternalSource ? "打开外部来源" : "在 Canvas 打开"}
                                    title={opensExternalSource ? "打开外部来源" : "在 Canvas 打开"}
                                  >
                                    <OpenInNewRoundedIcon fontSize="small" />
                                  </IconButton>
                                )}
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

                      const folder = entry;
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
                                sx={{ ...entryLinkSx, minWidth: 0 }}
                              >
                                {folder.name}
                              </MuiLink>
                            </Stack>
                          </TableCell>
                          <TableCell align="right" sx={{ color: "text.secondary" }}>—</TableCell>
                          <TableCell align="right" sx={{ color: "text.secondary" }}>{date}</TableCell>
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
                          <TableCell><Skeleton /></TableCell>
                          <TableCell><Skeleton /></TableCell>
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
                        <TableCell colSpan={5}>
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
              </TableContainer>

              {selectedFiles.length > 0 && (
                <Stack
                  direction="row" alignItems="center" gap={1} flexWrap="wrap"
                  sx={{ position: "sticky", bottom: 0, zIndex: 5, pt: 1.5, pb: 0.5, bgcolor: "background.paper", borderTop: 1, borderColor: "divider" }}
                >
                  <Box sx={{ flex: "1 0 auto" }}>
                    <Typography variant="body2">已选 {selectedFiles.length} 个文件</Typography>
                    {hiddenSelected > 0 && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        其中 {hiddenSelected} 个不在当前筛选结果中
                      </Typography>
                    )}
                    {transferableFiles.length < selectedFiles.length && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        可下载或上传 {transferableFiles.length} 个
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" gap={0.5} flexWrap="wrap">
                    <Button size="small" onClick={() => setSelectedFiles([])}>清空选择</Button>
                    <Button
                      size="small"
                      startIcon={<DownloadRoundedIcon />}
                      disabled={operating || transferableFiles.length === 0}
                      onClick={(event) => openFileActionMenu(event, transferableFiles, "download")}
                    >
                      批量下载
                    </Button>
                    <Button
                      size="small"
                      startIcon={<UploadFileRoundedIcon />}
                      disabled={operating || transferableFiles.length === 0}
                      onClick={(event) => openFileActionMenu(event, transferableFiles, "upload")}
                    >
                      批量上传云盘
                    </Button>
                    <Button
                      size="small"
                      disabled={operating || supportedMergeFiles.length < 2}
                      onClick={() => setOpenFileOrderSelectModal(true)}
                    >
                      合并 Word/PDF/PPTX
                    </Button>
                  </Stack>
                </Stack>
              )}
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
