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
import { Archive } from "libarchive.js";
import { Fragment, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DownloadCourseContext } from "../lib/download_context";

import { useAppMessage } from "../lib/message";
import { LOG_LEVEL_ERROR } from "../lib/model";
import { consoleLog, dataURLtoFile, formatSize, getFileType } from "../lib/utils";
import { PreviewErrorContext } from "./preview_error";
import {
  createPreviewRenderers,
  isPreviewText,
  knownPreviewType,
  PREVIEW_SAMPLE_BYTES,
} from "./preview_file_loader";
import PreviewUnavailable from "./preview_unavailable";
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

export default function ArchiveRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();
  const course = useContext(DownloadCourseContext);
  const [selectedPath, setSelectedPath] = useState("");
  const [messageApi, contextHolder] = useAppMessage();
  const [treeData, setTreeData] = useState<ArchiveTreeNode | undefined>();
  const [fileMap, setFileMap] = useState<Map<string, any> | undefined>();
  const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>();
  const [failedUri, setFailedUri] = useState<string>();
  const previewFailed = useCallback(() => setFailedUri(selectedDoc?.uri), [selectedDoc?.uri]);
  const renderers = useMemo(() => createPreviewRenderers(ArchiveSupportedRenderers, previewFailed), [previewFailed]);
  const selectedViewer = useMemo(() => {
    if (!selectedDoc) return null;
    if (failedUri === selectedDoc.uri) {
      return <PreviewUnavailable document={selectedDoc} fileName={selectedDoc.fileName ?? ""} failed />;
    }
    return (
      <PreviewErrorContext.Provider value={previewFailed}>
        <DocViewer
          key={selectedDoc.uri}
          config={{
            header: { disableHeader: true },
            noRenderer: { overrideComponent: PreviewUnavailable },
          }}
          pluginRenderers={renderers}
          documents={[selectedDoc]}
          style={{ height: "100%", backgroundColor: "transparent" }}
        />
      </PreviewErrorContext.Provider>
    );
  }, [selectedDoc, failedUri, previewFailed, renderers]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const archiveInitializedRef = useRef(false);

  const archiveWorkerUrl = new URL(
    "libarchive.js/dist/worker-bundle.js",
    import.meta.url
  ).toString();

  useEffect(() => {
    if (!currentDocument || !currentDocument.fileData) {
      return;
    }
    if (!archiveInitializedRef.current) {
      Archive.init({ workerUrl: archiveWorkerUrl });
      archiveInitializedRef.current = true;
    }
    void parse();
  }, [currentDocument]);

  useEffect(() => {
    return () => {
      if (selectedDoc) {
        URL.revokeObjectURL(selectedDoc.uri);
      }
    };
  }, [selectedDoc]);

  const checkIsBanned = (fileName: string, isDir: boolean) => {
    if (
      BLACK_LIST.find(
        (banned) => banned.name === fileName && banned.dir === isDir
      )
    ) {
      messageApi.warning(`文件或目录 "${fileName}" 已被屏蔽`, 2);
      return true;
    }
    return false;
  };

  const parseArchiveStructureBFS = async (root: any) => {
    const nextTreeData: ArchiveTreeNode = {
      title: "",
      key: "",
      children: [],
      isDir: true,
    };
    const nextFileMap = new Map<string, File | null>();
    const queue: [any, ArchiveTreeNode][] = [[root, nextTreeData]];

    while (queue.length > 0) {
      const [currentNode, currentTreeData] = queue.shift()!;
      const currentDir = currentTreeData.key;
      for (const fileName in currentNode) {
        const entry = currentNode[fileName];
        const path = `${currentDir}/${fileName}`;
        const isDir = !entry.name;
        if (checkIsBanned(fileName, isDir)) {
          continue;
        }

        const nextNode: ArchiveTreeNode = {
          title: fileName,
          key: path,
          children: [],
          isDir,
          size: isDir ? undefined : entry.size,
        };

        if (isDir) {
          queue.push([entry, nextNode]);
        } else {
          try {
            nextFileMap.set(path, entry);
          } catch (e) {
            nextFileMap.set(path, null);
            messageApi.error(`文件 ${path} 解压失败`);
          }
        }
        currentTreeData.children.push(nextNode);
      }
    }

    setFileMap(nextFileMap);
    return nextTreeData;
  };

  const setDocAndGC = (
    oldDoc: IDocument | undefined,
    newDoc: IDocument | undefined
  ) => {
    if (oldDoc) {
      URL.revokeObjectURL(oldDoc.uri);
    }
    return newDoc;
  };

  async function parse() {
    if (!currentDocument || !currentDocument.fileData) return;
    setLoading(true);
    setError(undefined);
    setSelectedDoc((oldDoc) => setDocAndGC(oldDoc, undefined));
    setSelectedPath("");
    setTreeData(undefined);
    setFileMap(undefined);
    setExpandedKeys(new Set());
    try {
      const base64Content = currentDocument.fileData as string;
      const file = dataURLtoFile(
        base64Content,
        currentDocument.fileName ?? "tmp"
      );
      const archive = await Archive.open(file);
      const files = await archive.getFilesObject();
      const nextTreeData = await parseArchiveStructureBFS(files);
      setTreeData(nextTreeData);
      setExpandedKeys(new Set([""]));
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      consoleLog(LOG_LEVEL_ERROR, e);
      messageApi.error(errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const onSelect = async (path: string) => {
    const fileReader = fileMap?.get(path);
    if (fileReader) {
      try {
        const file = await fileReader.extract();
        const extension = await getFileType(file.name);
        let fileType = knownPreviewType(extension, file.type, ArchiveSupportedRenderers);
        if (!fileType) {
          const sample = await file.slice(0, PREVIEW_SAMPLE_BYTES).arrayBuffer();
          if (isPreviewText(new Uint8Array(sample))) fileType = "txt";
        }
        const doc = {
          uri: URL.createObjectURL(file),
          fileName: file.name,
          fileType: fileType ?? extension,
        } as IDocument;
        setSelectedDoc((oldDoc) => setDocAndGC(oldDoc, doc));
        setSelectedPath(path);
      } catch (e) {
        consoleLog(LOG_LEVEL_ERROR, e);
        messageApi.error(`文件 "${path}" 加载失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      setSelectedDoc((oldDoc) => setDocAndGC(oldDoc, undefined));
      if (fileReader === null) {
        messageApi.warning(`当前文件 ${path} 解压失败，无法预览`);
      }
    }
  };

  const handleDownloadSubFile = async () => {
    if (!selectedDoc) {
      return;
    }
    const fileReader = fileMap?.get(selectedPath);
    if (!fileReader) {
      return;
    }
    try {
      const file = await fileReader.extract();
      const buffer = await file.arrayBuffer();
      const content = Array.from<number>(new Uint8Array(buffer));
      const fileName = selectedDoc.fileName ?? "downloaded";
      await invoke("save_file_content", { content, fileName, ...(course ? { course } : {}) });
      messageApi.success("下载成功", 0.5);
    } catch (e) {
      messageApi.error(`下载失败：${e}`);
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

  const treeContent = useMemo(() => {
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
  }, [treeData, expandedKeys, selectedPath, theme.palette.mode]);

  if (!currentDocument || !currentDocument.fileData) return null;

  return (
    <>
      {contextHolder}
      <Stack sx={{ width: "100%", height: "100%", minHeight: 0 }}>
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
              gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(180px, 28%) minmax(0, 1fr)" },
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
                sx={{ px: 2, py: 1, flexShrink: 0 }}
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
            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
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
            </Box>
          </Box>
        )}
      </Stack>
    </>
  );
}

ArchiveRenderer.fileTypes = ["zip", "rar", "tar", "7z", "gz"];
ArchiveRenderer.weight = 1;
