import { useEffect, useMemo, useState } from "react";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import SaveAltRoundedIcon from "@mui/icons-material/SaveAltRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { Box, Button, Collapse, Divider, IconButton, LinearProgress, Popover, Stack, Tooltip, Typography } from "@mui/material";
import { useTasks } from "../lib/task_hooks";
import { isTaskActive, taskKindLabels, taskSourceLabels, taskManager, type Task } from "../lib/task_manager";
import type { File } from "../lib/model";
import PreviewModal from "./preview_modal";

const statusText = { queued: "等待执行", running: "进行中", succeeded: "已完成", failed: "失败" };

function TaskItem({ task, onPreview }: { task: Task; onPreview: (id: string) => void }) {
  const [showLog, setShowLog] = useState(false);
  const active = isTaskActive(task);
  return (
    <Box sx={{ px: 1.75, py: 1.25 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Tooltip title={task.name} placement="top-start">
            <Typography variant="body2" sx={{ fontSize: 13, lineHeight: "20px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</Typography>
          </Tooltip>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            {taskSourceLabels[task.source]} · {taskKindLabels[task.kind]}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            <Box component="span" sx={{ color: task.status === "failed" ? "error.main" : task.status === "succeeded" ? "success.main" : "text.secondary" }}>{active ? task.stage : statusText[task.status]}</Box>
            {task.status === "running" && task.progress !== undefined ? ` ${task.progress}%` : ""}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0, mt: "-2px", "& .MuiIconButton-root": { width: 24, height: 24, borderRadius: "5px" }, "& .MuiSvgIcon-root": { fontSize: 16 } }}>
          {task.status === "failed" && <Tooltip title="重试"><IconButton size="small" aria-label={`重试 ${task.name}`} onClick={() => taskManager.retry(task.id)}><ReplayRoundedIcon fontSize="small" /></IconButton></Tooltip>}
          {task.status === "succeeded" && task.result && <Tooltip title="预览"><IconButton size="small" aria-label={`预览 ${task.name}`} onClick={() => onPreview(task.id)}><VisibilityRoundedIcon fontSize="small" /></IconButton></Tooltip>}
          {task.status === "succeeded" && task.canOpen && <Tooltip title="打开文件"><IconButton size="small" aria-label={`打开 ${task.name}`} onClick={() => void taskManager.action(task.id, "open")}><OpenInNewRoundedIcon fontSize="small" /></IconButton></Tooltip>}
          {task.status === "succeeded" && task.canSave && <Tooltip title="保存结果"><IconButton size="small" aria-label={`保存 ${task.name}`} onClick={() => void taskManager.action(task.id, "save")}><SaveAltRoundedIcon fontSize="small" /></IconButton></Tooltip>}
          {!active && <Tooltip title={task.result ? "清除记录与未保存预览" : "清除记录，保留文件"}><IconButton size="small" aria-label={`清除记录 ${task.name}`} onClick={() => taskManager.remove(task.id)}><CloseRoundedIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
        </Stack>
      </Stack>
      {task.status === "running" && <LinearProgress
        aria-label={`${task.name}进度`} variant={task.progress === undefined ? "indeterminate" : "determinate"}
        value={task.progress} sx={{ mt: 0.75, height: 3, borderRadius: "2px" }}
      />}
      {(task.error || task.actionError) && <Typography variant="caption" color="error" sx={{ mt: 0.75, display: "block", overflowWrap: "anywhere" }}>{task.error ?? task.actionError}</Typography>}
      {task.log && <>
        <Button size="small" sx={{ p: 0, mt: 0.5, minWidth: 0, fontSize: 12, borderRadius: "4px" }} onClick={() => setShowLog(!showLog)}>{showLog ? "收起日志" : "查看日志"}</Button>
        <Collapse in={showLog}><Box component="pre" sx={{ m: 0, mt: 1, p: 1, fontSize: 11, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", bgcolor: "action.hover", borderRadius: "4px" }}>{task.log}</Box></Collapse>
      </>}
    </Box>
  );
}

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
