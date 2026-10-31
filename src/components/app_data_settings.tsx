import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { appDataRequest, currentDataAccount, type DataOverview } from "../lib/app_data";
import { displayLocalPath } from "../lib/downloads";
import { deleteSummaryCache, readSummaryCache, type VideoSummaryCache } from "../lib/video_summary_cache";
import { videoSummarySession } from "../lib/video_summary_session";
import { useAISession } from "../lib/ai_session_store";
import { surfaceCardSx } from "../lib/styles";
import VideoSummaryScope from "./video_summary_scope";

function dataSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
type Action = { category: "cache" | "history" } | { entry: VideoSummaryCache } | { directory: string };

export default function AppDataSettings({ active }: { active: boolean }) {
  const [account, setAccount] = useState("");
  const [overview, setOverview] = useState<DataOverview>();
  const [directory, setDirectory] = useState<string>();
  const [histories, setHistories] = useState<VideoSummaryCache[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [action, setAction] = useState<Action>();
  const [preview, setPreview] = useState<VideoSummaryCache>();
  const summary = useAISession(videoSummarySession);
  const blocked = working || summary.loading;
  const currentDirectory = overview ? displayLocalPath(overview.directory) : "";
  const targetDirectory = (directory ?? currentDirectory).trim();
  const directoryChanged = targetDirectory !== currentDirectory;

  const refresh = useCallback(async () => {
    const current = await currentDataAccount();
    setAccount(current);
    const [history] = await Promise.allSettled([readSummaryCache(current)]);
    // Measure after migration completes, including when migration reports an error.
    const [usage] = await Promise.allSettled([appDataRequest<DataOverview>(current, { op: "overview" })]);
    setHistories(history.status === "fulfilled" ? history.value : []);
    setOverview(usage.status === "fulfilled" ? usage.value : undefined);
    setError([history, usage].flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []).join("；"));
  }, []);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void refresh().catch((e) => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [active, refresh, summary.loading, summary.cacheEntry]);

  const run = async (operation: () => Promise<void>) => {
    setWorking(true); setError(""); setNotice("");
    try { await operation(); await refresh(); }
    catch (e) { setError(String(e)); }
    finally { setWorking(false); }
  };
  const confirm = async () => {
    if (!action || blocked) return;
    const confirmed = action;
    setAction(undefined);
    await run(async () => {
      if ("directory" in confirmed) {
        const result = await appDataRequest<{ previousDirectory: string }>(account, { op: "relocate", directory: confirmed.directory });
        setDirectory(undefined);
        setNotice(`应用数据已迁移并立即生效。原目录保留为副本，可确认后自行删除：${displayLocalPath(result.previousDirectory)}`);
      } else {
        if ("entry" in confirmed) {
          if (!await deleteSummaryCache(confirmed.entry.key, account)) throw new Error("删除总结历史失败");
        } else {
          if (confirmed.category === "history") await readSummaryCache(account);
          await appDataRequest(account, { op: "clear", category: confirmed.category });
        }
        if (("entry" in confirmed && summary.cacheEntry?.key === confirmed.entry.key) || ("category" in confirmed && confirmed.category === "history")) {
          videoSummarySession.update({ cacheEntry: undefined, cacheNotice: "已删除保存的历史，当前会话仍可阅读" });
        }
        if ("category" in confirmed && (confirmed.category === "cache" || confirmed.category === "history")) videoSummarySession.clearMaterials();
        setNotice("操作已完成。");
      }
    });
  };
  const choose = async (backup: boolean) => {
    try {
      const selected = await open({ directory: true, multiple: false, title: backup ? "选择空文件夹保存备份" : "选择新的空应用数据文件夹", defaultPath: backup ? undefined : currentDirectory });
      if (typeof selected !== "string") return;
      if (backup) await run(async () => {
        await appDataRequest(account, { op: "backup", directory: selected });
        setNotice(`全部账号的应用数据已备份到：${selected}`);
      });
      else setDirectory(displayLocalPath(selected));
    } catch (e) { setError(String(e)); }
  };

  return <Stack spacing={2}>
    <Card sx={surfaceCardSx}><CardContent><Stack spacing={2}>
      <Box><Typography variant="h5">应用数据</Typography>
        <Typography variant="body2" color="text.secondary">自动保存 AI 总结、精校字幕等内容与应用记录。清理缓存会保留这些内容。</Typography></Box>
      {error && <Alert severity="error" action={<Button color="inherit" onClick={() => void run(async () => {})}>重试</Button>}>{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {!overview && !error && <CircularProgress size={24} aria-label="读取应用数据" />}
      {overview && <>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto auto" }, alignItems: "start" }}>
          <TextField size="small" fullWidth label="应用数据保存目录" value={directory ?? currentDirectory}
            onChange={(event) => setDirectory(event.target.value)} disabled={blocked} autoComplete="off"
            helperText="全部账号共用。选择现有空文件夹，点击“应用并迁移”后立即生效，无需另行保存全部设置。" />
          <Button variant="outlined" disabled={blocked} startIcon={<FolderOpenRoundedIcon />} sx={{ minHeight: 40 }} onClick={() => void choose(false)}>选择应用数据目录</Button>
          <Button variant="contained" disabled={blocked || !targetDirectory || !directoryChanged} sx={{ minHeight: 40 }} onClick={() => setAction({ directory: targetDirectory })}>应用并迁移</Button>
        </Box>
        {directoryChanged && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>当前使用：{currentDirectory}</Typography>}
        <Typography variant="body2">全部账号磁盘占用：{dataSize(overview.totalBytes)}；当前账号：{account}</Typography>
        <Stack direction="row" gap={1} useFlexGap flexWrap="wrap">
          <Button variant="outlined" disabled={working} onClick={() => void run(async () => { await appDataRequest(account, { op: "open" }); })}>打开应用数据目录</Button>
          <Button variant="outlined" disabled={blocked} onClick={() => void choose(true)}>导出数据备份</Button>
          <Button disabled={blocked} onClick={() => setAction({ category: "cache" })}>清理缓存</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">缓存占用 {dataSize(overview.categories.find((c) => c.category === "cache")?.bytes ?? 0)}。清理仅影响当前账号；目录迁移和备份包含全部账号，目标需为空文件夹。</Typography>
        {summary.loading && <Alert severity="info">视频 AI 正在处理，请等待完成后再迁移、备份或删除数据。</Alert>}
      </>}
      <Accordion disableGutters elevation={0} sx={{ borderTop: 1, borderColor: "divider" }}>
      <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography>管理已保存的 AI 内容</Typography></AccordionSummary>
      <AccordionDetails><Stack spacing={2}>
      <Typography variant="subtitle1">视频总结历史</Typography>
      <Typography variant="body2" color="text.secondary">总结包含原始资料和完整追问上下文。</Typography>
      {!histories.length && <Typography color="text.secondary">当前账号暂无已保存的视频总结。</Typography>}
      {histories.map((entry) => <Stack key={entry.key} direction="row" spacing={1} alignItems="center">
        <Box sx={{ flex: 1, minWidth: 0 }}><Typography sx={{ overflowWrap: "anywhere" }}>{entry.title}</Typography>
          <Typography variant="caption" color="text.secondary">{entry.organization === "combined" ? "综合总结" : "逐堂总结"} · 保存于 {new Date(entry.savedAt).toLocaleString("zh-CN")} · {entry.messages.length} 条消息</Typography>
          <VideoSummaryScope scopes={entry.scopes} /></Box>
        <Button onClick={() => setPreview(entry)}>查看</Button>
        <Button color="error" disabled={blocked} onClick={() => setAction({ entry })}>删除</Button>
      </Stack>)}
      <Box><Button color="error" disabled={blocked || !overview?.categories.some((c) => c.category === "history" && c.files > 0)} onClick={() => setAction({ category: "history" })}>删除全部 AI 内容</Button>
        <Typography variant="caption" display="block" color="text.secondary">删除当前账号的全部总结等保存内容，无法撤销。</Typography></Box>
      </Stack></AccordionDetails></Accordion>
    </Stack></CardContent></Card>
    <Dialog open={!!action} onClose={() => setAction(undefined)} maxWidth="sm" fullWidth>
      <DialogTitle>{action && "directory" in action ? "迁移应用数据" : "确认删除数据"}</DialogTitle>
      <DialogContent><Typography sx={{ overflowWrap: "anywhere" }}>
        {action && ("directory" in action ? `将全部账号的应用数据迁移到 ${action.directory}。完成后立即使用新目录，原目录保留为副本。`
          : "entry" in action ? `删除“${action.entry.title}”的总结和追问上下文？此操作无法撤销。`
            : action.category === "cache" ? "清理当前账号的缓存？所需资料将重新获取，AI 总结和应用记录会保留。" : "删除当前账号的全部 AI 总结等保存内容？此操作无法撤销。")}
      </Typography></DialogContent>
      <DialogActions><Button onClick={() => setAction(undefined)}>取消</Button><Button color={action && "directory" in action ? "primary" : "error"} disabled={blocked} onClick={() => void confirm()}>确认操作</Button></DialogActions>
    </Dialog>
    <Dialog open={!!preview} onClose={() => setPreview(undefined)} fullWidth maxWidth="md">
      <DialogTitle>{preview?.title}</DialogTitle>
      <DialogContent><Stack spacing={2}>{preview && <VideoSummaryScope scopes={preview.scopes} />}{preview?.messages.map((message) => <Box key={message.id}>
        <Typography variant="subtitle2">{message.role === "user" ? "你" : "AI"}</Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.content}</Typography>
      </Box>)}</Stack></DialogContent>
      <DialogActions><Button onClick={() => setPreview(undefined)}>关闭</Button></DialogActions>
    </Dialog>
  </Stack>;
}
