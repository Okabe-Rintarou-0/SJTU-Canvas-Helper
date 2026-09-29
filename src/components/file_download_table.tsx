import { taskManager, taskKindLabels, taskSourceLabels } from "../lib/task_manager";
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
import { useState } from "react";

import {
  FileDownloadState,
  FileDownloadTask,
} from "../lib/model";
import { getOutputFile } from "../lib/file_conversion";

function taskStateMeta(state: FileDownloadState) {
  switch (state) {
    case "uploading":
      return { label: "上传中", color: "info" as const };
    case "queued":
      return { label: "等待执行", color: "default" as const };
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

export default function FileDownloadTable({ tasks }: { tasks: FileDownloadTask[] }) {
  const theme = useTheme();
  const currentTasks = tasks;
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<string[]>([]);
  const selectedTasks = tasks.filter((task) => selectedTaskKeys.includes(task.key));
  const handleRemoveTask = (task: FileDownloadTask) => taskManager.remove(task.key);
  const handleOpenTaskFile = (task: FileDownloadTask) => taskManager.action(task.key, "open");
  const handleRetryTask = (task: FileDownloadTask) => taskManager.retry(task.key);
  const handleOpenSaveDir = () => invoke("open_save_dir");
  const handleRemoveTasks = () => {
    selectedTasks.forEach(handleRemoveTask);
    setSelectedTaskKeys([]);
  };
  const handleRetryTasks = () => selectedTasks.filter((task) => task.state === "fail").forEach(handleRetryTask);

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
              const record = taskManager.getSnapshot().find((item) => item.id === task.key);
              const unknownProgress = record?.status === "running" && record.progress === undefined;
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
                    {record && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{taskSourceLabels[record.source]} · {taskKindLabels[record.kind]}</Typography>}
                    {(record?.error || record?.actionError) && <Typography variant="caption" color="error" sx={{ overflowWrap: "anywhere" }}>{record.error ?? record.actionError}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.75}>
                      <LinearProgress
                        variant={converting || unknownProgress ? "indeterminate" : "determinate"}
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
                        {converting ? "正在生成 PDF…" : unknownProgress || task.state === "queued" ? record?.stage : `${task.progress}%`}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={stateMeta.label}
                      color={stateMeta.color}
                      variant={
                        task.state === "downloading" || task.state === "uploading" || converting
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
                      {record?.canOpen && <Button
                        size="small"
                        startIcon={<VisibilityRoundedIcon />}
                        disabled={task.state !== "succeed"}
                        onClick={() => void handleOpenTaskFile(task)}
                      >
                        打开
                      </Button>}
                      <Button
                        size="small"
                        startIcon={<DeleteOutlineRoundedIcon />}
                        color="error"
                        disabled={task.state !== "succeed" && task.state !== "fail"}
                        onClick={() => handleRemoveTask(task)}
                      >
                        清除记录
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
                      暂无传输任务。
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
          disabled={!selectedTasks.some((task) => task.state === "succeed" || task.state === "fail")}
        >
          清除所选记录
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
