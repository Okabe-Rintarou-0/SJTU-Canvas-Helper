import DocViewer, { DocRendererProps, IDocument } from "@cyntler/react-doc-viewer";
import { invoke } from "@tauri-apps/api/core";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { Fragment, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DownloadCourseContext } from "../lib/download_context";
import { openArchive, type ArchiveFile, type ArchiveTree, type OpenArchive } from "../lib/archive_open";
import { currentSession, isSessionCurrent, subscribeSession } from "../lib/session";
import { PreviewSessionContext } from "../lib/preview_session";

import { useAppMessage } from "../lib/message";
import { LOG_LEVEL_ERROR } from "../lib/model";
import { consoleLog, dataURLtoFile, formatSize, getFileType } from "../lib/utils";
import { ArchiveSupportedRenderers } from "./renderers";

interface BlackListEntry {
  name: string;
  dir: boolean;
}

interface ArchiveTreeNode {
  title: string;
  key: string;
  children: ArchiveTreeNode[];
  isDir: boolean;
  size?: number;
}
const BLACK_LIST: BlackListEntry[] = [{ name: "node_modules", dir: true }];

interface ArchiveLifetime {
  active: boolean;
  session: number;
  controller: AbortController;
  archive?: OpenArchive;
  files: Map<string, ArchiveFile>;
  selection: number;
  cancelRead?: () => void;
  previewUrl?: string;
}

function releaseArchive(lifetime: ArchiveLifetime) {
  if (!lifetime.active) return;
  lifetime.active = false;
  lifetime.selection += 1;
  lifetime.cancelRead?.();
  lifetime.controller.abort();
  lifetime.archive?.close();
  lifetime.archive = undefined;
  lifetime.files.clear();
  if (lifetime.previewUrl) URL.revokeObjectURL(lifetime.previewUrl);
  lifetime.previewUrl = undefined;
}

function readArchiveFile(file: File, lifetime: ArchiveLifetime): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.onload = reader.onerror = reader.onabort = null;
      lifetime.cancelRead = undefined;
      if (error) {
        reject(error);
        if (reader.readyState === FileReader.LOADING) reader.abort();
      } else resolve(String(reader.result ?? ""));
    };
    const timer = setTimeout(() => finish(new Error("读取压缩包子文件超时")), 10000);
    lifetime.cancelRead = () => finish(new Error("Archive selection cancelled"));
    reader.onload = () => finish();
    reader.onerror = () => finish(reader.error ?? new Error("读取压缩包子文件失败"));
    reader.onabort = () => finish(new Error("Archive selection cancelled"));
    try { reader.readAsDataURL(file); }
    catch (error: unknown) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

function parseArchiveTree(root: ArchiveTree, banned: (name: string) => void) {
  const tree: ArchiveTreeNode = { title: "", key: "", children: [], isDir: true };
  const fileMap = new Map<string, ArchiveFile>();
  const queue: [ArchiveTree, ArchiveTreeNode][] = [[root, tree]];
  for (let index = 0; index < queue.length; index += 1) {
    const [source, parent] = queue[index];
    for (const [name, entry] of Object.entries(source)) {
      const isDir = typeof entry.extract !== "function";
      if (BLACK_LIST.some((value) => value.name === name && value.dir === isDir)) {
        banned(name);
        continue;
      }
      const key = `${parent.key}/${name}`;
      const node: ArchiveTreeNode = { title: name, key, children: [], isDir,
        size: isDir ? undefined : (entry as ArchiveFile).size };
      parent.children.push(node);
      if (isDir) queue.push([entry as ArchiveTree, node]);
      else fileMap.set(key, entry as ArchiveFile);
    }
  }
  return { tree, fileMap };
}

export default function ArchiveRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();
  const course = useContext(DownloadCourseContext);
  const inheritedSession = useContext(PreviewSessionContext);
  const [mountSession] = useState(currentSession);
  const ownerSession = inheritedSession ?? mountSession;
  const [selectedPath, setSelectedPath] = useState("");
  const [messageApi, contextHolder] = useAppMessage();
  const [treeData, setTreeData] = useState<ArchiveTreeNode | undefined>();
  const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>();
  const selectedViewer = useMemo(() => selectedDoc ? (
    <DocViewer
      key={selectedDoc.uri}
      config={{ header: { disableHeader: true, disableFileName: true, retainURLParams: true } }}
      pluginRenderers={ArchiveSupportedRenderers}
      documents={[selectedDoc]}
      style={{ height: "100%" }}
    />
  ) : null, [selectedDoc]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const lifetimeRef = useRef<ArchiveLifetime>();

  useEffect(() => {
    const lifetime: ArchiveLifetime = {
      active: true, session: ownerSession, controller: new AbortController(),
      selection: 0, files: new Map(),
    };
    lifetimeRef.current = lifetime;
    const owns = () => lifetime.active && isSessionCurrent(lifetime.session);
    const clearPreview = () => {
      setSelectedDoc(undefined);
      setSelectedPath("");
      setTreeData(undefined);
      setExpandedKeys(new Set());
    };
    clearPreview();
    setError(undefined);
    setLoading(Boolean(currentDocument?.fileData));
    const unsubscribe = subscribeSession(() => {
      if (!lifetime.active || isSessionCurrent(lifetime.session)) return;
      releaseArchive(lifetime);
      clearPreview();
      setLoading(false);
      setError("账号会话已变更，请重新打开压缩包");
    });
    if (!isSessionCurrent(lifetime.session)) {
      releaseArchive(lifetime);
      setLoading(false);
      setError("账号会话已变更，请重新打开压缩包");
    } else if (currentDocument?.fileData) {
      void (async () => {
        try {
          const file = dataURLtoFile(currentDocument.fileData as string, currentDocument.fileName ?? "tmp");
          const archive = await openArchive(file, lifetime.controller.signal);
          if (!owns()) { archive.close(); return; }
          lifetime.archive = archive;
          const files = await archive.getFilesObject();
          if (!owns()) return;
          const { tree, fileMap } = parseArchiveTree(files, (name) => {
            messageApi.warning(`文件或目录 "${name}" 已被屏蔽`, 2);
          });
          lifetime.files = fileMap;
          setTreeData(tree);
          setExpandedKeys(new Set([""]));
        } catch (error: unknown) {
          if (!owns()) return;
          releaseArchive(lifetime);
          const errorMsg = error instanceof Error ? error.message : String(error);
          consoleLog(LOG_LEVEL_ERROR, "Archive parsing failed");
          messageApi.error(errorMsg);
          setError(errorMsg);
        } finally {
          if (lifetimeRef.current === lifetime && isSessionCurrent(lifetime.session)) setLoading(false);
        }
      })();
    }
    return () => {
      unsubscribe();
      releaseArchive(lifetime);
      if (lifetimeRef.current === lifetime) lifetimeRef.current = undefined;
    };
  }, [currentDocument, messageApi, ownerSession]);

  const onSelect = async (path: string) => {
    const lifetime = lifetimeRef.current;
    if (!lifetime || !lifetime.active || !isSessionCurrent(lifetime.session)) return;
    const selection = ++lifetime.selection;
    lifetime.cancelRead?.();
    const owns = () => lifetime.active && isSessionCurrent(lifetime.session) && lifetime.selection === selection;
    const entry = lifetime.files.get(path);
    if (!entry) return;
    try {
      const file = await entry.extract();
      if (!owns()) return;
      const fileData = await readArchiveFile(file, lifetime);
      if (!owns()) return;
      const fileType = await getFileType(file.name);
      if (!owns()) return;
      const uri = URL.createObjectURL(file);
      if (lifetime.previewUrl) URL.revokeObjectURL(lifetime.previewUrl);
      lifetime.previewUrl = uri;
      setSelectedDoc({ uri, fileName: file.name, fileType, fileData });
      setSelectedPath(path);
    } catch (error: unknown) {
      if (!owns()) return;
      consoleLog(LOG_LEVEL_ERROR, "Archive entry loading failed");
      messageApi.error(`文件 "${path}" 加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDownloadSubFile = async () => {
    const lifetime = lifetimeRef.current;
    if (!lifetime || !selectedDoc) return;
    const selection = lifetime.selection;
    const owns = () => lifetime.active && isSessionCurrent(lifetime.session) && lifetime.selection === selection;
    const entry = lifetime.files.get(selectedPath);
    if (!entry || !owns()) return;
    try {
      const file = await entry.extract();
      if (!owns()) return;
      const buffer = await file.arrayBuffer();
      if (!owns()) return;
      const content = Array.from(new Uint8Array(buffer));
      const fileName = selectedDoc.fileName ?? "downloaded";
      await invoke("save_file_content", { content, fileName, ...(course ? { course } : {}) });
      if (owns()) messageApi.success("下载成功", 0.5);
    } catch (error: unknown) {
      if (owns()) messageApi.error(`下载失败：${error}`);
    }
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const treeContent = (() => {
    const renderTree = (nodes: ArchiveTreeNode[], depth = 0): ReactNode =>
      nodes.map((node) => {
        const expanded = expandedKeys.has(node.key);
        const selected = selectedPath === node.key;

        if (node.isDir) {
          return (
            <Fragment key={node.key}>
              <ListItemButton
                onClick={() => toggleExpanded(node.key)}
                sx={{
                  pl: 1.5 + depth * 2,
                  borderRadius: "16px",
                  mb: 0.5,
                }}
              >
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <FolderRoundedIcon color="primary" />
                </ListItemIcon>
                <ListItemText
                  primary={node.title}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
                />
                {expanded ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
              </ListItemButton>
              {expanded ? renderTree(node.children, depth + 1) : null}
            </Fragment>
          );
        }

        return (
          <ListItemButton
            key={node.key}
            selected={selected}
            onClick={() => void onSelect(node.key)}
            sx={{
              pl: 1.5 + depth * 2,
              borderRadius: "16px",
              mb: 0.5,
              "&.Mui-selected": {
                bgcolor: alpha(theme.palette.primary.main, 0.12),
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 34 }}>
              <InsertDriveFileRoundedIcon color="action" />
            </ListItemIcon>
            <ListItemText
              primary={node.title}
              secondary={node.size != null ? formatSize(node.size) : undefined}
              primaryTypographyProps={{ fontSize: 14, fontWeight: selected ? 700 : 500 }}
              secondaryTypographyProps={{ fontSize: 11 }}
            />
          </ListItemButton>
        );
      });

    return treeData ? renderTree(treeData.children) : null;
  })();

  if (!currentDocument || !currentDocument.fileData) return null;

  return (
    <>
      {contextHolder}
      <Stack spacing={2} sx={{ width: "100%", height: "100%" }}>
        {loading ? (
          <Box
            sx={{
              minHeight: 280,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Stack spacing={1.5} alignItems="center">
              <CircularProgress />
              <Typography variant="body2" color="text.secondary">
                正在解析压缩包...
              </Typography>
            </Stack>
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ borderRadius: "18px" }}>
            解析失败：{error}
          </Alert>
        ) : (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                lg: "320px minmax(0, 1fr)",
              },
              height: "100%",
              minHeight: 520,
            }}
          >
            <Card
              sx={{
                borderRadius: "24px",
                border: "1px solid",
                borderColor: "divider",
                boxShadow: "none",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ px: 2, pt: 0.25, pb: 1.75, flexShrink: 0 }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  压缩包目录
                </Typography>
                {selectedDoc ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<DownloadRoundedIcon />}
                    onClick={() => void handleDownloadSubFile()}
                  >
                    下载
                  </Button>
                ) : null}
              </Stack>
              <Divider />
              {treeData?.children && treeData.children.length > 0 ? (
                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1, py: 1 }}>
                  <List disablePadding>
                    {treeContent}
                  </List>
                </Box>
                ) : (
                  <Box
                    sx={{
                      minHeight: 220,
                      display: "grid",
                      placeItems: "center",
                      p: 3,
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      压缩包为空
                    </Typography>
                  </Box>
                )}
            </Card>

            <Card
              sx={{
                borderRadius: "24px",
                border: "1px solid",
                borderColor: "divider",
                boxShadow: "none",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ px: 2, py: 1.75, flexShrink: 0 }}
              >
                <Stack spacing={0.35}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    文件预览
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedDoc?.fileName || "选择左侧文件开始预览"}
                  </Typography>
                </Stack>
                <ArticleRoundedIcon color="action" />
              </Stack>
              <Divider />
              <Box sx={{ flex: 1, minHeight: 0 }}>
                {selectedDoc ? (
                  selectedViewer
                ) : (
                  <Box
                    sx={{
                      minHeight: 320,
                      display: "grid",
                      placeItems: "center",
                      p: 3,
                    }}
                  >
                    <Stack spacing={1.25} alignItems="center">
                      <ArticleRoundedIcon
                        sx={{ fontSize: 40, color: "text.secondary" }}
                      />
                      <Typography variant="body1" sx={{ fontWeight: 700 }}>
                        暂无预览内容
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        从左侧目录选择一个文件后，这里会显示对应内容。
                      </Typography>
                    </Stack>
                  </Box>
                )}
              </Box>
            </Card>
          </Box>
        )}
      </Stack>
    </>
  );
}

ArchiveRenderer.fileTypes = ["zip", "rar", "tar", "7z", "gz"];
ArchiveRenderer.weight = 1;
