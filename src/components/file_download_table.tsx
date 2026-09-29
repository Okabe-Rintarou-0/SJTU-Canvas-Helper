import { invoke } from "@tauri-apps/api/core";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
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
  File,
  FileDownloadState,
  FileDownloadTask,
  LOG_LEVEL_ERROR,
} from "../lib/model";
import { useAppMessage } from "../lib/message";
import { useWebviewEvent } from "../lib/events";
import { getOutputFile } from "../lib/file_conversion";
import { consoleLog, sleep } from "../lib/utils";

function taskStateMeta(state: FileDownloadState) {
  switch (state) {
    case "fail":
      return { label: "失败", color: "error" as const };
    case "succeed":
      return { label: "完成", color: "success" as const };
    case "wait_retry":
      return { label: "待重试", color: "warning" as const };
    case "converting":
      return { label: "转换中", color: "secondary" as const };
    default:
      return { label: "下载中", color: "info" as const };
  }
}

export default function FileDownloadTable({
  tasks,
  handleRemoveTask,
  handleDownloadFile,
  handleOpenTaskFile,
}: {
  tasks: FileDownloadTask[];
  handleRemoveTask: (task: FileDownloadTask) => void;
  handleDownloadFile: (
    file: File,
    outputFormat?: "original" | "pdf"
  ) => Promise<void>;
  handleOpenTaskFile: (task: FileDownloadTask) => Promise<void>;
}) {
  const theme = useTheme();
  const [messageApi, contextHolder] = useAppMessage();
  const [currentTasks, setCurrentTasks] = useState<FileDownloadTask[]>([]);
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<string[]>([]);

  const taskSet = useMemo(
    () => new Set<string>(currentTasks.map((task) => task.key)),
    [currentTasks]
  );

  const selectedTasks = currentTasks.filter((task) =>
    selectedTaskKeys.includes(task.key)
  );

  useWebviewEvent("download://progress", (payload) => {
    updateOriginalTaskProgress(
      payload.uuid,
      Math.ceil((payload.processed / payload.total) * 100)
    );
  });

  useEffect(() => {
    setCurrentTasks(tasks);
    for (const task of tasks) {
      if (!taskSet.has(task.key)) {
        taskSet.add(task.key);
        void downloadFile(task);
      } else if (task.state === "wait_retry") {
        void handleRetryTask(task);
      }
    }
  }, [tasks]);

  const downloadFile = async (task: FileDownloadTask) => {
    updateTaskProgress(task.key, 0);

    let retries = 0;
    const maxRetries = (task.outputFormat ?? "original") === "pdf" ? 1 : 5;
    let backoffCoef = 1;
    while (retries < maxRetries) {
      try {
        await handleDownloadFile(task.file, task.outputFormat ?? "original");
        updateTaskProgress(task.key, 100);
        break;
      } catch (error) {
        updateTaskProgress(task.key, undefined, String(error));
        consoleLog(LOG_LEVEL_ERROR, error);
        retries += 1;
      }
      await sleep(1000 * backoffCoef);
      backoffCoef *= 2;
    }
  };

  const handleRetryTask = async (task: FileDownloadTask) => {
    if (task.state === "downloading" || task.state === "converting") {
      messageApi.warning("任务正在处理中，请勿重试。");
      return;
    }
    await downloadFile(task);
  };

  const handleRemoveTasks = () => {
    for (const task of selectedTasks) {
      handleRemoveTask(task);
    }
    setSelectedTaskKeys([]);
  };

  const handleRetryTasks = () => {
    selectedTasks
      .filter((task) => task.state === "fail")
      .forEach((task) => void handleRetryTask(task));
  };

  const updateTaskProgress = (taskKey: string, progress?: number, error?: string) => {
    setCurrentTasks((prevTasks) => {
      return prevTasks.map((task) =>
        task.key === taskKey
          ? {
              ...task,
              progress: progress ?? task.progress,
              state: error
                ? "fail"
                : progress === 100
                  ? "succeed"
                  : (task.outputFormat ?? "original") === "pdf"
                    ? "converting"
                    : "downloading",
            }
          : task
      );
    });
  };

  const updateOriginalTaskProgress = (uuid: string, progress: number) => {
    setCurrentTasks((prevTasks) =>
      prevTasks.map((task) => {
        const isOriginalTask =
          task.file.uuid === uuid && (task.outputFormat ?? "original") === "original";
        if (!isOriginalTask) {
          return task;
        }
        return {
          ...task,
          progress,
          state: progress === 100 ? "succeed" : "downloading",
        };
      })
    );
  };

  const handleOpenSaveDir = async () => {
    try {
      await invoke("open_save_dir");
    } catch (error) {
      messageApi.error(`打开目录失败：${error}`);
    }
  };

  const allSelected =
    currentTasks.length > 0 && selectedTaskKeys.length === currentTasks.length;

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      {contextHolder}

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
            <TableRow
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.05),
              }}
            >
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
              <TableCell>文件名</TableCell>
              <TableCell width="34%">进度</TableCell>
              <TableCell width="14%">状态</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {currentTasks.map((task) => {
              const stateMeta = taskStateMeta(task.state);
              const converting = task.state === "converting";
              const checked = selectedTaskKeys.includes(task.key);
              const outputFile = getOutputFile(
                task.file,
                task.outputFormat ?? "original"
              );

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
                      {outputFile.display_name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.75}>
                      <LinearProgress
                        variant={converting ? "indeterminate" : "determinate"}
                        value={converting ? undefined : task.progress}
                        color={
                          stateMeta.color === "error"
                            ? "error"
                            : converting
                              ? "secondary"
                              : "primary"
                        }
                        sx={{
                          height: 8,
                          borderRadius: 999,
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {converting ? "正在生成 PDF…" : `${task.progress}%`}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={stateMeta.label}
                      color={stateMeta.color}
                      variant={
                        task.state === "downloading" || converting
                          ? "outlined"
                          : "filled"
                      }
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
                        startIcon={<VisibilityRoundedIcon />}
                        onClick={() => void handleOpenTaskFile(task)}
                      >
                        打开
                      </Button>
                      <Button
                        size="small"
                        startIcon={<DeleteOutlineRoundedIcon />}
                        color="error"
                        onClick={() => handleRemoveTask(task)}
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
                      暂无下载任务。
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
        <Button
          variant="outlined"
          startIcon={<ReplayRoundedIcon />}
          onClick={handleRetryTasks}
          disabled={selectedTasks.filter((task) => task.state === "fail").length === 0}
        >
          重试失败任务
        </Button>
      </Stack>
    </Stack>
  );
}
