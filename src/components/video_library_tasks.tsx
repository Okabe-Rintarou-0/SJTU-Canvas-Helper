import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Alert, Box, Button, Card, CardContent, Checkbox, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { taskManager, taskKindLabels, isTaskActive, type Task } from "../lib/task_manager";
import { surfaceCardSx } from "../lib/styles";

/** Page-local view of the same queue, including exports without legacy task data. */
export default function VideoLibraryTasks({ tasks }: { tasks: Task[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const chosen = tasks.filter((task) => selected.includes(task.id));
  const attempt = async (action: () => Promise<unknown>) => {
    try { setError(""); await action(); } catch (e) { setError(String(e)); }
  };
  return <Card sx={surfaceCardSx}>
    <CardContent><Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Typography variant="h6" fontWeight={700}>下载任务</Typography>
        <Button onClick={() => void attempt(() => invoke("open_save_dir"))}>打开默认下载目录</Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: "8px" }}>
        <Table size="small" aria-label="视频下载任务" sx={{ minWidth: 600 }}>
          <TableHead><TableRow>
            <TableCell padding="checkbox"><Checkbox size="small" inputProps={{ "aria-label": "全选下载任务" }} checked={tasks.length > 0 && chosen.length === tasks.length} indeterminate={chosen.length > 0 && chosen.length < tasks.length} onChange={(_, checked) => setSelected(checked ? tasks.map((t) => t.id) : [])} /></TableCell>
            <TableCell>任务</TableCell><TableCell sx={{ minWidth: 140 }}>进度</TableCell><TableCell align="right">操作</TableCell>
          </TableRow></TableHead>
          <TableBody>{tasks.map((task) => <TableRow key={task.id} selected={selected.includes(task.id)}>
            <TableCell padding="checkbox"><Checkbox size="small" inputProps={{ "aria-label": `选择任务 ${task.name}` }} checked={selected.includes(task.id)} onChange={(_, checked) => setSelected((prev) => checked ? [...prev, task.id] : prev.filter((id) => id !== task.id))} /></TableCell>
            <TableCell sx={{ overflowWrap: "anywhere" }}><Typography variant="body2">{task.name}</Typography><Typography variant="caption" color="text.secondary">{task.context} · {taskKindLabels[task.kind]}</Typography>
              {(task.error || task.actionError) && <Typography variant="caption" color="error" display="block">{task.error || task.actionError}</Typography>}
              {task.log && <Box component="details"><Typography component="summary" variant="caption">任务详情</Typography><Typography component="pre" variant="caption" sx={{ whiteSpace: "pre-wrap" }}>{task.log}</Typography></Box>}
            </TableCell>
            <TableCell><Stack spacing={0.5}><LinearProgress variant={task.status === "running" && task.progress === undefined ? "indeterminate" : "determinate"} value={task.progress ?? 0} color={task.status === "failed" ? "error" : "primary"} /><Typography variant="caption">{task.stage}{task.progress === undefined ? "" : ` · ${task.progress}%`}</Typography></Stack></TableCell>
            <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
              {task.status === "failed" && <Button size="small" onClick={() => taskManager.retry(task.id)}>重试</Button>}
              {task.status === "succeeded" && task.canOpen && <Button size="small" onClick={() => void taskManager.action(task.id, "open")}>打开</Button>}
              {(task.outputDirectory || task.outputPath) && <Button size="small" onClick={() => void attempt(() => open(task.outputDirectory || task.outputPath!.replace(/[/\\][^/\\]+$/, "")))}>目录</Button>}
              <Button size="small" disabled={isTaskActive(task)} onClick={() => taskManager.remove(task.id)}>清除</Button>
            </TableCell>
          </TableRow>)}{!tasks.length && <TableRow><TableCell colSpan={4} align="center">暂无下载任务</TableCell></TableRow>}</TableBody>
        </Table>
      </Box>
      <Stack direction="row" gap={1}>
        <Button disabled={!chosen.some((t) => t.status === "failed")} onClick={() => chosen.forEach((t) => taskManager.retry(t.id))}>重试所选失败任务</Button>
        <Button disabled={!chosen.some((t) => !isTaskActive(t))} onClick={() => { chosen.forEach((t) => taskManager.remove(t.id)); setSelected([]); }}>清除所选已结束任务</Button>
      </Stack>
    </Stack></CardContent>
  </Card>;
}
