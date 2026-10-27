import { taskManager, taskSourceLabels } from "../lib/task_manager";
import { invoke } from "@tauri-apps/api/core";
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
import { useState } from "react";

import {
  DownloadState,
  VideoDownloadTask,
} from "../lib/model";

function stateMeta(state: DownloadState) {
  switch (state) {
    case "queued":
      return { label: "等待执行", color: "default" as const };
    case "fail":
      return { label: "失败", color: "error" as const };
    case "succeed":
      return { label: "完成", color: "success" as const };
    default:
      return { label: "下载中", color: "info" as const };
  }
}

export default function VideoDownloadTable({ tasks }: { tasks: VideoDownloadTask[] }) {
  const theme = useTheme();
  const currentTasks = tasks;
  const [selectedTaskKeys, setSelectedTaskKeys] = useState<string[]>([]);
  const selectedTasks = tasks.filter((task) => selectedTaskKeys.includes(task.key));
  const handleRemoveTask = (task: VideoDownloadTask) => taskManager.remove(task.key);
  const handleRetryTask = (task: VideoDownloadTask) => taskManager.retry(task.key);
  const handleOpenSaveDir = () => invoke("open_save_dir");
  const handleRemoveTasks = () => {
    selectedTasks.forEach(handleRemoveTask);
    setSelectedTaskKeys([]);
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
              const record = taskManager.getSnapshot().find((item) => item.id === task.key);
              const unknownProgress = record?.status === "running" && record.progress === undefined;
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
                    {record && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{taskSourceLabels[record.source]}</Typography>}
                    {record?.error && <Typography variant="caption" color="error" sx={{ overflowWrap: "anywhere" }}>{record.error}</Typography>}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.75}>
                      <LinearProgress
                        variant={unknownProgress ? "indeterminate" : "determinate"}
                        value={task.progress}
                        color={meta.color === "error" ? "error" : "primary"}
                        sx={{
                          height: 8,
                          borderRadius: 999,
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {unknownProgress || task.state === "queued" ? record?.stage : `${task.progress}%`}
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
          disabled={!selectedTasks.some((task) => task.state === "succeed" || task.state === "fail")}
        >
          清除所选记录
        </Button>
      </Stack>
    </Stack>
  );
}
