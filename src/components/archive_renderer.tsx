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
  CardContent,
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
import { Fragment, ReactNode, useEffect, useRef, useState } from "react";

import { useAppMessage } from "../lib/message";
import { LOG_LEVEL_ERROR } from "../lib/model";
import { consoleLog, dataURLtoFile, getFileType } from "../lib/utils";
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
}

const BLACK_LIST: BlackListEntry[] = [{ name: "node_modules", dir: true }];

export default function ArchiveRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();
  if (!currentDocument || !currentDocument.fileData) {
    return null;
  }

  const [selectedPath, setSelectedPath] = useState("");
  const [messageApi, contextHolder] = useAppMessage();
  const [treeData, setTreeData] = useState<ArchiveTreeNode | undefined>();
  const [fileMap, setFileMap] = useState<Map<string, any> | undefined>();
  const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const archiveInitializedRef = useRef(false);

  const archiveWorkerUrl = new URL(
    "libarchive.js/dist/worker-bundle.js",
    import.meta.url
  ).toString();

  useEffect(() => {
    if (!archiveInitializedRef.current) {
      Archive.init({ workerUrl: archiveWorkerUrl });
      archiveInitializedRef.current = true;
    }
    void parse();
  }, [currentDocument]);

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

  const parse = async () => {
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
      const file = await fileReader.extract();
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("读取压缩包子文件失败"));
        reader.readAsDataURL(file);
      });
      const doc = {
        uri: URL.createObjectURL(file),
        fileName: file.name,
        fileType: await getFileType(file.name),
        fileData,
      } as IDocument;
      setSelectedDoc((oldDoc) => setDocAndGC(oldDoc, doc));
      setSelectedPath(path);
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
      await invoke("save_file_content", { content, fileName });
      messageApi.success("下载成功", 0.5);
    } catch (e) {
      messageApi.error(`下载失败：${e}`);
    }
  };

  useEffect(() => {
    return () => {
      if (selectedDoc) {
        URL.revokeObjectURL(selectedDoc.uri);
      }
    };
  }, [selectedDoc]);

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
            primaryTypographyProps={{ fontSize: 14, fontWeight: selected ? 700 : 500 }}
          />
        </ListItemButton>
      );
    });

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
                overflow: "hidden",
              }}
            >
              <CardContent sx={{ p: 0, height: "100%" }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ px: 2, py: 1.75 }}
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
                  <List
                    disablePadding
                    sx={{
                      px: 1,
                      py: 1,
                      maxHeight: { lg: 620 },
                      overflow: "auto",
                    }}
                  >
                    {renderTree(treeData.children)}
                  </List>
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
              </CardContent>
            </Card>

            <Card
              sx={{
                borderRadius: "24px",
                border: "1px solid",
                borderColor: "divider",
                boxShadow: "none",
                overflow: "hidden",
              }}
            >
              <CardContent sx={{ p: 0, height: "100%" }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ px: 2, py: 1.75 }}
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
                {selectedDoc ? (
                  <DocViewer
                    key={selectedDoc.uri}
                    config={{
                      header: {
                        disableHeader: true,
                        disableFileName: true,
                        retainURLParams: true,
                      },
                    }}
                    pluginRenderers={ArchiveSupportedRenderers}
                    documents={[selectedDoc]}
                    style={{ height: "100%" }}
                  />
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
              </CardContent>
            </Card>
          </Box>
        )}
      </Stack>
    </>
  );
}

ArchiveRenderer.fileTypes = ["zip", "rar", "tar", "7z", "gz"];
ArchiveRenderer.weight = 1;
