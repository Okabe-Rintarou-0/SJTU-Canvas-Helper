import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import {
  Box,
  Button,
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
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";

import { DownloadTask, ProgressPayload } from "../lib/model";

const appWindow = getCurrentWebviewWindow();

interface PPTDownloadTableProps {
  tasks: DownloadTask[];
  handleRemoveTask: (task: DownloadTask) => void;
}

function stateLabel(state: string) {
  switch (state) {
    case "downloading":
      return { text: "下载中", color: "info" as const };
    case "completed":
      return { text: "已完成", color: "success" as const };
    case "fail":
      return { text: "失败", color: "error" as const };
    case "merging":
      return { text: "合并中", color: "warning" as const };
    default:
      return { text: "未知", color: "default" as const };
  }
}

export default function PPTDownloadTable({
  tasks,
  handleRemoveTask,
}: PPTDownloadTableProps) {
  const theme = useTheme();
  const [currentTasks, setCurrentTasks] = useState<DownloadTask[]>([]);

  useEffect(() => {
    const unlisten = appWindow.listen<ProgressPayload>(
      "ppt_download://progress",
      ({ payload }) => {
        updateTaskProgress(payload.uuid, payload.processed, payload.total);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    setCurrentTasks(tasks);
  }, [tasks]);

  const updateTaskProgress = (id: string, processed: number, total: number) => {
    setCurrentTasks((prevTasks) => {
      const nextTasks = [...prevTasks];
      const task = nextTasks.find((item) => item.key === id);
      if (!task) {
        return prevTasks;
      }
      task.progress = Math.ceil((processed / total) * 100);
      task.state = task.progress === 100 ? "merging" : "downloading";
      return nextTasks;
    });
  };

  return (
    <Box
      sx={{
        borderRadius: "22px",
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
      }}
    >
      <Table sx={{ minWidth: 680 }}>
        <TableHead>
          <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
            <TableCell>任务名</TableCell>
            <TableCell width="34%">进度</TableCell>
            <TableCell width="16%">状态</TableCell>
            <TableCell align="right">操作</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {currentTasks.map((task) => {
            const meta = stateLabel(task.state);
            return (
              <TableRow key={task.key} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {task.name}
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
                  <Chip size="small" label={meta.text} color={meta.color} />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteOutlineRoundedIcon />}
                    onClick={() => handleRemoveTask(task)}
                  >
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}

          {currentTasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <Box sx={{ py: 5, textAlign: "center" }}>
                  <Typography variant="body2" color="text.secondary">
                    暂无合并任务。
                  </Typography>
                </Box>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </Box>
  );
}
