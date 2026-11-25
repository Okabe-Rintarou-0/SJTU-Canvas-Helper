import { useState } from "react";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import SaveAltRoundedIcon from "@mui/icons-material/SaveAltRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import { Box, Button, Collapse, IconButton, LinearProgress, Stack, Tooltip, Typography } from "@mui/material";
import { isTaskActive, taskKindLabels, taskSourceLabels, taskManager, type Task } from "../lib/task_manager";

const statusText = { queued: "等待执行", running: "进行中", succeeded: "已完成", failed: "失败" };

export default function TaskItem({ task, onPreview }: { task: Task; onPreview: (id: string) => void }) {
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
