import { taskManager, taskSourceLabels } from "../lib/task_manager";
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

import { DownloadTask } from "../lib/model";

interface PPTDownloadTableProps {
  tasks: DownloadTask[];
}

function stateLabel(state: string) {
  switch (state) {
    case "queued":
      return { text: "等待执行", color: "default" as const };
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

export default function PPTDownloadTable({ tasks }: PPTDownloadTableProps) {
  const theme = useTheme();
  const currentTasks = tasks;
  const handleRemoveTask = (task: DownloadTask) => taskManager.remove(task.key);

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
            const record = taskManager.getSnapshot().find((item) => item.id === task.key);
            const unknownProgress = record?.status === "running" && record.progress === undefined;
            const meta = stateLabel(task.state);
            return (
              <TableRow key={task.key} hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {task.name}
                  </Typography>
                  {record && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{taskSourceLabels[record.source]}</Typography>}
                  {(record?.error || record?.actionError) && <Typography variant="caption" color="error">{record.error ?? record.actionError}</Typography>}
                </TableCell>
                <TableCell>
                  <Stack spacing={0.75}>
                    <LinearProgress
                      variant={task.state === "merging" || unknownProgress ? "indeterminate" : "determinate"}
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
                  <Chip size="small" label={meta.text} color={meta.color} />
                </TableCell>
                <TableCell align="right">
                  {task.state === "fail" && <Button size="small" onClick={() => taskManager.retry(task.key)}>重试</Button>}
                  {task.state === "completed" && <Button size="small" onClick={() => void taskManager.action(task.key, "open")}>打开</Button>}
                  <Button
                    size="small"
                    color="error"
                    startIcon={<DeleteOutlineRoundedIcon />}
                    disabled={task.state !== "completed" && task.state !== "fail"}
                    onClick={() => handleRemoveTask(task)}
                  >
                    清除记录
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
