import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";

import {
  DownloadState,
  ProgressPayload,
  VideoDownloadTask,
} from "../lib/model";
import { appMessage } from "../lib/message";
import { sleep } from "../lib/utils";

const appWindow = getCurrentWebviewWindow();

function stateMeta(state: DownloadState) {
  switch (state) {
    case "fail":
      return { label: "失败", color: "error" as const };
    case "succeed":
      return { label: "完成", color: "success" as const };
    default:
      return { label: "下载中", color: "info" as const };
  }
}

export default function VideoDownloadTable({
  tasks,
  handleRemoveTask,
}: {
  tasks: VideoDownloadTask[];
  handleRemoveTask?: (task: VideoDownloadTask) => void;
}) {
  const theme = useTheme();
  const [currentTasks, setCurrentTasks] = useState<VideoDownloadTask[]>([]);
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<string[]>([]);
  const taskSet = useMemo(
    () => new Set<string>(currentTasks.map((task) => task.key)),
    [currentTasks]
  );

  const selectedTasks = currentTasks.filter((task) =>
    selectedTaskKeys.includes(task.key)
  );

  useEffect(() => {
    const unlisten = appWindow.listen<ProgressPayload>(
      "video_download://progress",
      ({ payload }) => {
        updateTaskProgress(
          payload.uuid,
          (payload.processed / payload.total) * 100
        );
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    setCurrentTasks(tasks);
    for (const task of tasks) {
      if (!taskSet.has(task.key)) {
        taskSet.add(task.key);
        void handleDownloadVideo(task);
      }
    }
  }, [tasks]);

  const handleDownloadVideo = async (task: VideoDownloadTask) => {
    const video = task.video;
    const uuid = `${video.id}`;
    updateTaskProgress(uuid, 0);

    let retries = 0;
    const maxRetries = 3;
    while (retries < maxRetries) {
      try {
        await invoke("download_video", { video, saveName: task.video.name });
        updateTaskProgress(uuid, 100);
        break;
      } catch (error) {
        appMessage().error(error as string);
        updateTaskProgress(uuid, undefined, error as string);
        retries += 1;
      }
      await sleep(1000);
    }
  };

  const handleRetryTask = async (task: VideoDownloadTask) => {
    if (task.progress < 100 && task.state !== "fail") {
      appMessage().warning("任务正在下载中，请勿重试。");
      return;
    }
    await handleDownloadVideo(task);
  };

  const handleRemoveTasks = () => {
    selectedTasks.forEach((task) => handleRemoveTask?.(task));
    setSelectedTaskKeys([]);
  };

  const updateTaskProgress = (
    id: string,
    progress?: number,
    error?: string
  ) => {
    setCurrentTasks((prevTasks) => {
      const nextTasks = [...prevTasks];
      const task = nextTasks.find((item) => item.key === id);
      const state: DownloadState = error
        ? "fail"
        : progress === 100
          ? "succeed"
          : "downloading";

      if (task) {
        if (progress !== undefined) {
          task.progress = Math.ceil(progress);
        }
        task.state = state;
      }
      return nextTasks;
    });
  };

  const handleOpenSaveDir = async () => {
    try {
      await invoke("open_save_dir");
    } catch (error) {
      appMessage().error(`打开目录失败：${error}`);
    }
  };

  const allSelected =
    currentTasks.length > 0 && selectedTaskKeys.length === currentTasks.length;

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Box
        sx={{
          borderRadius: "22px",
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        <Table sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={
                    selectedTaskKeys.length > 0 &&
                    selectedTaskKeys.length < currentTasks.length
                  }
                  onChange={(event) =>
                    setSelectedTaskKeys(
                      event.target.checked
                        ? currentTasks.map((task) => task.key)
                        : []
                    )
                  }
                />
              </TableCell>
              <TableCell>视频</TableCell>
              <TableCell width="34%">进度</TableCell>
              <TableCell width="14%">状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {currentTasks.map((task) => {
              const checked = selectedTaskKeys.includes(task.key);
              const meta = stateMeta(task.state);

              return (
                <TableRow key={task.key} hover selected={checked}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={checked}
                      onChange={(event) =>
                        setSelectedTaskKeys((prev) =>
                          event.target.checked
                            ? [...prev, task.key]
                            : prev.filter((key) => key !== task.key)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {task.video.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.75}>
                      <LinearProgress
                        variant="determinate"
                        value={task.progress}
                        color={meta.color === "error" ? "error" : "primary"}
                        sx={{
                          height: 8,
                          borderRadius: 999,
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {task.progress}%
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={meta.label}
                      color={meta.color}
                      variant={task.state === "downloading" ? "outlined" : "filled"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      justifyContent="flex-end"
                      spacing={1}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteOutlineRoundedIcon />}
                        onClick={() => handleRemoveTask?.(task)}
                      >
                        删除
                      </Button>
                      <Button
                        size="small"
                        startIcon={<ReplayRoundedIcon />}
                        onClick={() => void handleRetryTask(task)}
                        disabled={task.state !== "fail"}
                      >
                        重试
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}

            {currentTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Box sx={{ py: 5, textAlign: "center" }}>
                    <Typography variant="body2" color="text.secondary">
                      暂无视频下载任务。
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} useFlexGap>
        <Button
          variant="outlined"
          startIcon={<FolderOpenRoundedIcon />}
          onClick={handleOpenSaveDir}
        >
          打开保存目录
        </Button>
        <Button
          variant="contained"
          color="error"
          startIcon={<DeleteOutlineRoundedIcon />}
          onClick={handleRemoveTasks}
          disabled={selectedTasks.length === 0}
        >
          删除所选
        </Button>
      </Stack>
    </Stack>
  );
}
