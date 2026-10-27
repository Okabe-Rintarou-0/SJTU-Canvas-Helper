import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import KeyboardBackspaceRoundedIcon from "@mui/icons-material/KeyboardBackspaceRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";

import {
  useCourseFolders,
  useFolderFiles,
  useFolderFolders,
  usePreview,
} from "../lib/hooks";
import { Entry, File, Folder, isFile } from "../lib/model";

export default function CourseFileSelectModal({
  courseId,
  open,
  onOk,
  onCancel,
}: {
  courseId: number;
  open: boolean;
  onOk: (files: File[]) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [currentFolder, setCurrentFolder] = useState<Folder | undefined>();
  const [folderMap, setFolderMap] = useState<Map<number, Folder>>(
    new Map<number, Folder>()
  );
  const [rootFolder, setRootFolder] = useState<Folder | undefined>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const allFolders = useCourseFolders(courseId);
  const folders = useFolderFolders(currentFolder?.id);
  const files = useFolderFiles(currentFolder?.id);
  const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry } =
    usePreview();

  useEffect(() => {
    if (!allFolders.data) {
      return;
    }
    const nextFolderMap = new Map<number, Folder>();
    allFolders.data.forEach((folder) => {
      nextFolderMap.set(folder.id, folder);
      if (folder.name === "course files") {
        setCurrentFolder(folder);
        setRootFolder(folder);
      }
    });
    setFolderMap(nextFolderMap);
  }, [allFolders.data]);

  useEffect(() => {
    if (folders.isLoading || files.isLoading) {
      return;
    }
    if (folders.data && files.data) {
      setEntries([...folders.data, ...files.data]);
    }
  }, [folders.data, folders.isLoading, files.data, files.isLoading]);

  useEffect(() => {
    if (!open) {
      setSelectedFiles([]);
    }
  }, [open]);

  const handleSelect = (entry: Entry) => {
    if (!isFile(entry)) {
      return;
    }
    const file = entry as File;
    setSelectedFiles((prev) =>
      prev.find((item) => item.id === entry.id)
        ? prev.filter((item) => item.id !== entry.id)
        : [...prev, file]
    );
  };

  const handleEnter = (entry: Entry) => {
    if (isFile(entry)) {
      return;
    }
    setEntries([]);
    setSelectedFiles([]);
    setCurrentFolder(entry as Folder);
  };

  const backToParentDir = () => {
    const parentId = currentFolder?.parent_folder_id;
    if (!parentId) {
      return;
    }
    setCurrentFolder(folderMap.get(parentId));
  };

  const backToRootDir = () => {
    setCurrentFolder(rootFolder);
  };

  const folderPath = useMemo(() => {
    if (!currentFolder) {
      return "course files";
    }
    const names: string[] = [];
    let cursor: Folder | undefined = currentFolder;
    while (cursor) {
      names.unshift(cursor.name);
      if (!cursor.parent_folder_id) {
        break;
      }
      cursor = folderMap.get(cursor.parent_folder_id);
    }
    return names.join(" / ");
  }, [currentFolder, folderMap]);

  const loading = folders.isLoading || files.isLoading;

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="lg">
      {previewer}
      <DialogTitle sx={{ pb: 1 }}>
        <Stack spacing={0.75}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            选择课程文件
          </Typography>
          <Typography variant="body2" color="text.secondary">
            双击文件夹进入目录，勾选文件后确认绑定。
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            spacing={1.5}
          >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                variant="outlined"
                startIcon={<KeyboardBackspaceRoundedIcon />}
                disabled={!currentFolder?.parent_folder_id}
                onClick={backToParentDir}
              >
                上级目录
              </Button>
              <Button
                variant="outlined"
                startIcon={<HomeRoundedIcon />}
                disabled={!currentFolder?.parent_folder_id}
                onClick={backToRootDir}
              >
                根目录
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={folderPath} variant="outlined" />
              <Chip
                label={`已选择 ${selectedFiles.length} 个文件`}
                color="primary"
                variant="outlined"
              />
            </Stack>
          </Stack>

          {loading ? <LinearProgress /> : null}

          <Box
            sx={{
              display: "grid",
              gap: 1.5,
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(3, minmax(0, 1fr))",
                xl: "repeat(4, minmax(0, 1fr))",
              },
            }}
          >
            {entries.map((entry) => {
              const fileSelected =
                isFile(entry) &&
                selectedFiles.find((file) => file.id === entry.id) !== undefined;

              return (
                <Card
                  key={entry.id}
                  sx={{
                    borderRadius: "18px",
                    border: "1px solid",
                    borderColor: fileSelected
                      ? alpha(theme.palette.primary.main, 0.4)
                      : alpha(theme.palette.divider, 0.6),
                    boxShadow: "none",
                    cursor: "pointer",
                    bgcolor: fileSelected
                      ? alpha(theme.palette.primary.main, 0.06)
                      : alpha(theme.palette.background.paper, 0.72),
                  }}
                  onClick={() => handleSelect(entry)}
                  onDoubleClick={() => handleEnter(entry)}
                  onMouseEnter={() => onHoverEntry(entry)}
                  onMouseLeave={() => onLeaveEntry()}
                >
                  <CardContent sx={{ p: 1.75 }}>
                    <Stack spacing={1.5}>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        spacing={1}
                        alignItems="flex-start"
                      >
                        <Box
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: "14px",
                            display: "grid",
                            placeItems: "center",
                            bgcolor: alpha(theme.palette.primary.main, 0.12),
                            color: "primary.main",
                            flexShrink: 0,
                          }}
                        >
                          {isFile(entry) ? (
                            <InsertDriveFileRoundedIcon />
                          ) : (
                            <FolderRoundedIcon />
                          )}
                        </Box>
                        {isFile(entry) ? (
                          <Checkbox checked={fileSelected} />
                        ) : null}
                      </Stack>

                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 700, wordBreak: "break-word" }}
                        >
                          {isFile(entry)
                            ? (entry as File).display_name
                            : (entry as Folder).name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {isFile(entry) ? "单击选择，双击无操作" : "双击进入文件夹"}
                        </Typography>
                      </Box>

                      {isFile(entry) ? (
                        <Button
                          variant="text"
                          size="small"
                          sx={{ alignSelf: "flex-start" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPreviewEntry(entry as File);
                          }}
                        >
                          预览
                        </Button>
                      ) : null}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Box>

          {!loading && entries.length === 0 ? (
            <Box
              sx={{
                px: 2,
                py: 5,
                borderRadius: "18px",
                border: "1px dashed",
                borderColor: alpha(theme.palette.divider, 0.7),
                textAlign: "center",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                当前目录为空。
              </Typography>
            </Box>
          ) : null}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="contained" onClick={() => onOk(selectedFiles)}>
          绑定所选文件
        </Button>
      </DialogActions>
    </Dialog>
  );
}
