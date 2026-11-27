import DocViewer, { type DocRenderer, type DocRendererProps, type IDocument } from "@cyntler/react-doc-viewer";
import { invoke } from "@tauri-apps/api/core";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import { Alert, Box, Button, CircularProgress, Divider, List, ListItemButton, Stack, Typography } from "@mui/material";
import { Archive } from "libarchive.js";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DownloadCourseContext } from "../lib/download_context";
import { useAppMessage } from "../lib/message";
import { LOG_LEVEL_ERROR } from "../lib/model";
import { consoleLog, formatSize, getFileType } from "../lib/utils";
import { PreviewErrorContext } from "./preview_error";
import { createPreviewRenderers, isPreviewText, knownPreviewType, PREVIEW_SAMPLE_BYTES } from "./preview_file_loader";
import PreviewUnavailable from "./preview_unavailable";
import { ArchiveSupportedRenderers } from "./renderers";

type EntryReader = { size: number; extract: () => Promise<File> };
type ArchiveNode = { name: string; path: string; children?: ArchiveNode[]; size?: number };

const archiveWorkerUrl = new URL("libarchive.js/dist/worker-bundle.js", import.meta.url).toString();

function buildTree(root: object) {
  const readers = new Map<string, EntryReader>();
  const tree: ArchiveNode[] = [];
  const queue = [{ source: root, nodes: tree, parent: "" }];
  for (let i = 0; i < queue.length; i += 1) {
    const { source, nodes, parent } = queue[i];
    for (const [name, entry] of Object.entries(source)) {
      const path = parent + "/" + name;
      if (typeof entry.extract === "function") {
        readers.set(path, entry);
        nodes.push({ name, path, size: entry.size });
      } else if (name !== "node_modules") {
        const children: ArchiveNode[] = [];
        nodes.push({ name, path, children });
        queue.push({ source: entry, nodes: children, parent: path });
      }
    }
  }
  return { tree, readers };
}

const ArchiveRow = memo(function ArchiveRow({ node, depth, expanded, selected, onSelect, onToggle }: {
  node: ArchiveNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const directory = Boolean(node.children);
  const size = node.size == null ? null : formatSize(node.size);
  const Icon = directory ? FolderRoundedIcon : InsertDriveFileRoundedIcon;
  const Disclosure = expanded ? ExpandMoreRoundedIcon : ChevronRightRoundedIcon;
  return (
    <ListItemButton dense disableRipple selected={selected}
      aria-expanded={directory ? expanded : undefined}
      onClick={() => directory ? onToggle(node.path) : onSelect(node.path)}
      sx={{
        height: 29, minHeight: 29, py: 0, pr: 0.75, pl: 0.5 + Math.min(depth, 8) * 1.35,
        gap: 0.5, borderRadius: 1, contentVisibility: "auto", containIntrinsicSize: "auto 29px",
        "& svg": { fontSize: 16, flexShrink: 0 },
      }}>
      {directory ? <Disclosure color="action" /> : <Box sx={{ width: 16, flexShrink: 0 }} />}
      <Icon color={directory ? "primary" : "action"} />
      <Typography variant="caption" noWrap title={node.name} sx={{ flex: 1, minWidth: 0 }}
        fontWeight={directory || selected ? 650 : 400}>
        {node.name}
      </Typography>
      {size && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, flexShrink: 0 }}>{size}</Typography>}
    </ListItemButton>
  );
});

export default function ArchiveRenderer({ mainState }: DocRendererProps) {
  const { currentDocument, requestHeaders } = mainState;
  const uri = currentDocument?.uri;
  const archiveName = currentDocument?.fileName;
  const course = useContext(DownloadCourseContext);
  const [messageApi, contextHolder] = useAppMessage();
  const [tree, setTree] = useState<ArchiveNode[]>([]);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [selection, setSelection] = useState<{ path: string; file: File; doc: IDocument }>();
  const [pendingPath, setPendingPath] = useState<string>();
  const [failedUri, setFailedUri] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const readers = useRef(new Map<string, EntryReader>());
  const activePath = useRef<string | undefined>(undefined);
  const requestId = useRef(0);
  const chosenUri = useRef<string | undefined>(undefined);
  const selectedDoc = selection?.doc;

  useEffect(() => {
    if (!uri) return;
    const controller = new AbortController();
    let archive: Awaited<ReturnType<typeof Archive.open>> | undefined;
    setLoading(true);
    setError(undefined);
    setTree([]);
    setExpanded(new Set());
    setSelection(undefined);
    setPendingPath(undefined);
    activePath.current = undefined;
    Archive.init({ workerUrl: archiveWorkerUrl });
    void (async () => {
      try {
        // Keep the compressed bytes as a Blob instead of converting to and from a data URL.
        const response = await fetch(uri, { signal: controller.signal, headers: requestHeaders });
        if (!response.ok) throw new Error("无法载入压缩包");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        archive = await Archive.open(new File([blob], archiveName ?? "archive"));
        if (controller.signal.aborted) {
          await archive.close();
          return;
        }
        const contents = await archive.getFilesObject();
        if (controller.signal.aborted) return;
        const result = buildTree(contents);
        readers.current = result.readers;
        setTree(result.tree);
      } catch (failure) {
        if (!controller.signal.aborted) {
          consoleLog(LOG_LEVEL_ERROR, failure);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
      requestId.current += 1;
      readers.current.clear();
      if (archive) void archive.close();
      if (chosenUri.current) URL.revokeObjectURL(chosenUri.current);
      chosenUri.current = undefined;
    };
  }, [uri, archiveName, requestHeaders]);

  const select = useCallback(async (path: string) => {
    const reader = readers.current.get(path);
    if (!reader || activePath.current === path) return;
    activePath.current = path;
    const id = ++requestId.current;
    setPendingPath(path);
    try {
      const file = await reader.extract();
      const extension = await getFileType(file.name);
      let fileType = knownPreviewType(extension, file.type, ArchiveSupportedRenderers);
      if (!fileType && isPreviewText(new Uint8Array(await file.slice(0, PREVIEW_SAMPLE_BYTES).arrayBuffer()))) {
        fileType = "txt";
      }
      if (id !== requestId.current) return;
      if (chosenUri.current) URL.revokeObjectURL(chosenUri.current);
      chosenUri.current = URL.createObjectURL(file);
      setFailedUri(undefined);
      setSelection({ path, file, doc: { uri: chosenUri.current, fileName: file.name, fileType: fileType ?? extension } });
    } catch (failure) {
      if (id !== requestId.current) return;
      activePath.current = undefined;
      consoleLog(LOG_LEVEL_ERROR, failure);
      messageApi.error("文件解压失败：" + (failure instanceof Error ? failure.message : String(failure)));
    } finally {
      if (id === requestId.current) setPendingPath(undefined);
    }
  }, [messageApi]);

  const download = async () => {
    if (!selection || downloading) return;
    setDownloading(true);
    try {
      const { file } = selection;
      const content = Array.from(new Uint8Array(await file.arrayBuffer()));
      await invoke("save_file_content", { content, fileName: file.name, ...(course ? { course } : {}) });
      messageApi.success("下载成功", 0.5);
    } catch (failure) {
      messageApi.error("下载失败：" + String(failure));
    } finally {
      setDownloading(false);
    }
  };

  const toggleExpanded = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const visibleRows = useMemo(() => {
    const rows: { node: ArchiveNode; depth: number }[] = [];
    const append = (nodes: ArchiveNode[], depth: number) => {
      for (const node of nodes) {
        rows.push({ node, depth });
        if (node.children && expanded.has(node.path)) append(node.children, depth + 1);
      }
    };
    append(tree, 0);
    return rows;
  }, [tree, expanded]);
  const selectedPath = pendingPath ?? selection?.path;
  const selectedName = pendingPath?.split("/").pop() ?? selection?.file.name;
  const extracting = pendingPath !== undefined;

  const previewFailed = useCallback(() => setFailedUri(selectedDoc?.uri), [selectedDoc?.uri]);
  const renderers = useMemo(() => createPreviewRenderers(ArchiveSupportedRenderers, previewFailed), [previewFailed]);
  const selectedViewer = useMemo(() => {
    if (!selectedDoc) return null;
    if (failedUri === selectedDoc.uri) {
      return <PreviewUnavailable document={selectedDoc} fileName={selectedDoc.fileName ?? ""} failed />;
    }
    return (
      <PreviewErrorContext.Provider value={previewFailed}>
        <DocViewer key={selectedDoc.uri}
          config={{ header: { disableHeader: true }, noRenderer: { overrideComponent: PreviewUnavailable } }}
          pluginRenderers={renderers} documents={[selectedDoc]}
          style={{ height: "100%", backgroundColor: "transparent" }}
        />
      </PreviewErrorContext.Provider>
    );
  }, [selectedDoc, failedUri, previewFailed, renderers]);

  if (!currentDocument) return null;

  return (
    <>
      {contextHolder}
      <Stack sx={{ width: "100%", height: "100%", minHeight: 0,
        "& [data-preview-surface]": { border: 0, borderRadius: 0 },
      }}>
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
          <Alert severity="error" sx={{ m: 2 }}>
            解析失败：{error}
          </Alert>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "clamp(166px, 23%, 260px) minmax(0, 1fr)" },
              gridTemplateRows: { xs: "minmax(104px, 34%) minmax(0, 1fr)", sm: "minmax(0, 1fr)" },
              height: "100%",
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                minWidth: 0,
                borderRight: { xs: 0, sm: 1 },
                borderBottom: { xs: 1, sm: 0 },
                borderColor: "divider",
                bgcolor: "action.hover",
              }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ px: 1.25, py: 0.75, flexShrink: 0 }}
              >
                <Typography variant="subtitle2" fontWeight={700}>
                  压缩包目录
                </Typography>
              </Stack>
              <Divider />
              {tree.length > 0 ? (
                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 0.5, py: 0.5 }}>
                  <List disablePadding>
                    {visibleRows.map(({ node, depth }) => (
                      <ArchiveRow
                        key={node.path}
                        node={node}
                        depth={depth}
                        expanded={expanded.has(node.path)}
                        selected={selectedPath === node.path}
                        onSelect={select}
                        onToggle={toggleExpanded}
                      />
                    ))}
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
            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ px: 1.5, py: 0.5, gap: 1, minHeight: 38, flexShrink: 0 }}
              >
                <Typography variant="subtitle2" noWrap title={selectedName}>
                  {selectedName ?? "文件预览"}
                </Typography>
                {selection && !extracting && (
                  <Button size="small" startIcon={<DownloadRoundedIcon />}
                    disabled={downloading} onClick={() => void download()}>
                    下载文件
                  </Button>
                )}
              </Stack>
              <Divider />
              <Box sx={{ flex: 1, minHeight: 0 }}>
                {extracting ? (
                  <Stack alignItems="center" spacing={1} sx={{ p: 3 }} role="status">
                    <CircularProgress size={20} />
                    <Typography variant="body2" color="text.secondary">正在解压文件…</Typography>
                  </Stack>
                ) : selection ? (
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
            </Box>
          </Box>
        )}
      </Stack>
    </>
  );
}

ArchiveRenderer.fileTypes = ["zip", "rar", "tar", "7z", "gz"];
ArchiveRenderer.weight = 1;
ArchiveRenderer.fileLoader = ({ fileLoaderComplete }: Parameters<NonNullable<DocRenderer["fileLoader"]>>[0]) => fileLoaderComplete();
