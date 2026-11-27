import { useEffect, useMemo, useState } from "react";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { Box, Button, Divider, IconButton, Popover, Stack, Tooltip, Typography } from "@mui/material";
import { useTasks } from "../lib/task_hooks";
import { isTaskActive, taskManager, type Task } from "../lib/task_manager";
import type { File } from "../lib/model";
import PreviewModal from "./preview_modal";
import TaskItem from "./task_item";

export default function TaskPopover({ anchorEl, onClose }: { anchorEl: HTMLElement | null; onClose: () => void }) {
  const tasks = useTasks();
  useEffect(() => {
    if (anchorEl) taskManager.markCompletionsRead();
  }, [anchorEl, tasks]);
  const [previewId, setPreviewId] = useState<string>();
  const preview = tasks.find((task) => task.id === previewId)?.result;
  const previewFiles = useMemo(() => preview ? [{ display_name: preview.name, url: preview.url } as File] : [], [preview]);
  const active = tasks.filter(isTaskActive).length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const completed = tasks.filter((task) => task.status === "succeeded" && !task.result);
  const sorted = [...tasks].sort((a, b) => {
    const priority = (task: Task) => isTaskActive(task) ? 0 : task.status === "failed" ? 1 : 2;
    return priority(a) - priority(b) || b.createdAt - a.createdAt;
  });
  return <>
    <Popover open={!!anchorEl} anchorEl={anchorEl} onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "left" }} transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      marginThreshold={12}
      slotProps={{ paper: { role: "dialog", "aria-label": "任务中心", elevation: 0, sx: {
        width: 360, maxWidth: "calc(100vw - 24px)", mt: "-8px",
        borderRadius: "10px", overflow: "hidden", border: "1px solid", borderColor: "divider",
        boxShadow: (theme) => theme.palette.mode === "dark"
          ? "0 6px 24px rgba(0, 0, 0, 0.32)"
          : "0 4px 20px rgba(31, 42, 36, 0.12), 0 1px 4px rgba(31, 42, 36, 0.06)",
      } } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.75, py: 1.25 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontSize: 14, fontWeight: 600 }}>任务中心</Typography>
          <Typography variant="caption" color="text.secondary">进行中 {active} · 需处理 {failed}</Typography>
        </Box>
        <IconButton size="small" aria-label="关闭任务中心" onClick={onClose} sx={{ width: 24, height: 24, borderRadius: "5px" }}><CloseRoundedIcon sx={{ fontSize: 16 }} /></IconButton>
      </Stack>
      <Divider />
      <Stack divider={<Divider sx={{ mx: 1.75 }} />} sx={{ maxHeight: "min(360px, 55vh)", overflowY: "auto", overscrollBehavior: "contain" }}>
        {sorted.map((task) => <TaskItem key={task.id} task={task} onPreview={setPreviewId} />)}
        {!sorted.length && <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 4, textAlign: "center" }}>暂无任务</Typography>}
      </Stack>
      {!!tasks.length && <><Divider /><Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.75, py: 0.75 }}>
        <Typography variant="caption" color="text.secondary">共 {tasks.length} 项任务</Typography>
        <Tooltip title="保留已保存的文件和未保存的合并预览"><span><Button size="small" color="inherit" sx={{ px: 0.75, py: 0.25, minHeight: 26, fontSize: 12, fontWeight: 400, borderRadius: "5px" }} disabled={!completed.length} onClick={() => completed.forEach((task) => taskManager.remove(task.id))}>清除已完成记录</Button></span></Tooltip>
      </Stack></>}
    </Popover>
    {preview && <PreviewModal open files={previewFiles} title={preview.name} handleCancelPreview={() => setPreviewId(undefined)} />}
  </>;
}
