import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentDataAccount } from "../lib/app_data";
import { downloadType, fileSize, type DownloadedFile, type DownloadOverview, type DownloadType } from "../lib/downloads";
import { isTaskActive } from "../lib/task_manager";
import { useTasks } from "../lib/task_hooks";

export default function DownloadedFilesSettings({ active, refreshKey }: { active: boolean; refreshKey?: string }) {
  const [overview, setOverview] = useState<DownloadOverview>();
  const [account, setAccount] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DownloadType>("all");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<DownloadedFile[]>();
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const tasks = useTasks();
  const taskStatuses = tasks.map((t) => `${t.id}:${t.status}`).join("|");
  const busy = tasks.some(isTaskActive) || overview?.busy === true;
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const current = await currentDataAccount();
      const data = await invoke<DownloadOverview>("downloaded_files", { account: current, request: { op: "list" } });
      if (request !== generation.current) return;
      setAccount(current); setOverview(data); setSelected(new Set()); setPage(0); setError("");
    } catch (e) { if (request === generation.current) setError(String(e)); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!active) { setDeleting(undefined); setSelected(new Set()); return; }
    void refresh();
    return () => { generation.current = generation.current + 1; };
  }, [active, refresh, taskStatuses, refreshKey]);
  useEffect(() => {
    if (!active || !overview?.busy || loading || working) return;
    const timer = window.setTimeout(() => void refresh(), 5000);
    return () => window.clearTimeout(timer);
  }, [active, overview, loading, working, refresh]);

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (overview?.files ?? []).filter((f) => (!search || f.relativePath.toLocaleLowerCase().includes(search)) && (type === "all" || downloadType(f.name) === type))
      .sort((a, b) => sort === "size" ? b.size - a.size : sort === "name" ? a.relativePath.localeCompare(b.relativePath, "zh-CN") : b.modifiedAt - a.modifiedAt);
  }, [overview, query, type, sort]);
  const visible = filtered.slice(page * 50, (page + 1) * 50);
  const changeSelection = (path: string, checked: boolean) => setSelected((old) => { const next = new Set(old); if (checked) next.add(path); else next.delete(path); return next; });
  const open = async (file: DownloadedFile, folder: boolean) => {
    try { await invoke("downloaded_files", { account, request: { op: "open", path: file.path, folder } }); }
    catch (e) { setError(String(e)); }
  };
  const remove = async () => {
    if (!deleting?.length || busy || working || loading) return;
    const files = deleting; setDeleting(undefined); setWorking(true); setNotice(""); setError("");
    try {
      const result = await invoke<{ deleted: string[]; errors: string[] }>("downloaded_files", { account, request: { op: "delete", files } });
      await refresh();
      setNotice(`已删除 ${result.deleted.length} 个文件。`);
      if (result.errors.length) setError(result.errors.join("；"));
    } catch (e) { setError(String(e)); }
    finally { setWorking(false); }
  };
  const blocked = working || loading || busy;
  if (!active) return null;
  return <><Stack spacing={2}>
    <Stack direction="row" gap={1} useFlexGap flexWrap="wrap" alignItems="center" justifyContent="space-between">
      <Box><Typography variant="subtitle1">文件列表</Typography><Typography variant="body2" color="text.secondary">包含当前下载目录中的文件，以及本应用另存到其他位置的文件。</Typography></Box>
      <Stack direction="row" gap={1}><Button disabled={loading || working} onClick={() => void refresh()}>{loading ? "正在读取…" : "刷新"}</Button><Button onClick={() => void invoke("open_save_dir").catch((e) => setError(String(e)))}>打开下载目录</Button></Stack>
    </Stack>
    {overview && <Box><Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>当前使用：{overview.directory}</Typography><Typography variant="body2" color="text.secondary">{overview.files.length} 个文件 · {fileSize(overview.totalBytes)}</Typography></Box>}
    <Typography variant="caption" color="text.secondary">课程资料统一按“学期 → 课程 → 资料类型”归档，视频批量导出再按课堂分目录。旧文件保留原位并继续显示；个人文件和无课程归属的文件单独存放。</Typography>
    {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {!!overview?.warnings.length && <Alert severity="warning">{overview.warnings.join("；")}</Alert>}
    {busy && <Alert severity="info">下载或导出任务进行中，完成后可删除文件；列表会自动刷新。</Alert>}
    <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
      <TextField size="small" label="搜索文件名或路径" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} sx={{ flex: 1 }} />
      <TextField select size="small" label="文件类型" value={type} onChange={(e) => { setType(e.target.value as DownloadType); setPage(0); }} sx={{ minWidth: 130 }}>{Object.entries({ all: "全部类型", document: "文档", video: "视频", subtitle: "字幕", other: "其他" }).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
      <TextField select size="small" label="排序" value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} sx={{ minWidth: 140 }}><MenuItem value="newest">最近修改</MenuItem><MenuItem value="size">文件从大到小</MenuItem><MenuItem value="name">按名称</MenuItem></TextField>
      <Button color="error" disabled={blocked || !selected.size} onClick={() => setDeleting(overview?.files.filter((f) => selected.has(f.path)))}>删除所选{selected.size ? `（${selected.size}）` : ""}</Button>
    </Stack>
    <TableContainer><Table size="small" aria-label="已下载文件列表"><TableHead><TableRow>
      <TableCell padding="checkbox"><Checkbox inputProps={{ "aria-label": "全选本页" }} checked={visible.length > 0 && visible.every((f) => selected.has(f.path))} indeterminate={visible.some((f) => selected.has(f.path)) && !visible.every((f) => selected.has(f.path))} disabled={blocked || !visible.length} onChange={(_, checked) => setSelected((old) => { const next = new Set(old); visible.forEach((f) => checked ? next.add(f.path) : next.delete(f.path)); return next; })} /></TableCell>
      <TableCell>文件</TableCell><TableCell align="right">大小</TableCell><TableCell>修改时间</TableCell><TableCell align="right">操作</TableCell>
    </TableRow></TableHead><TableBody>
      {visible.map((file) => <TableRow key={file.path} selected={selected.has(file.path)}>
        <TableCell padding="checkbox"><Checkbox inputProps={{ "aria-label": `选择 ${file.name}` }} checked={selected.has(file.path)} disabled={blocked} onChange={(_, checked) => changeSelection(file.path, checked)} /></TableCell>
        <TableCell sx={{ minWidth: 180, maxWidth: 420, overflowWrap: "anywhere" }}><Typography variant="body2">{file.name}</Typography><Typography variant="caption" color="text.secondary">{file.external ? "其他位置 · " : ""}{file.relativePath}</Typography></TableCell>
        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>{fileSize(file.size)}</TableCell><TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(file.modifiedAt).toLocaleString("zh-CN")}</TableCell>
        <TableCell align="right"><Stack direction="row" justifyContent="flex-end"><Button size="small" onClick={() => void open(file, false)}>打开</Button><Button size="small" onClick={() => void open(file, true)}>所在目录</Button><Button size="small" color="error" disabled={blocked} onClick={() => setDeleting([file])}>删除</Button></Stack></TableCell>
      </TableRow>)}
      {!visible.length && <TableRow><TableCell colSpan={5}>{loading ? "正在扫描本地文件…" : filtered.length ? "请选择上一页" : query || type !== "all" ? "没有匹配的文件" : "暂无已下载文件"}</TableCell></TableRow>}
    </TableBody></Table></TableContainer>
    <TablePagination component="div" count={filtered.length} page={page} onPageChange={(_, next) => setPage(next)} rowsPerPage={50} rowsPerPageOptions={[50]} labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`} />
  </Stack>
  <Dialog open={!!deleting} onClose={() => setDeleting(undefined)} fullWidth maxWidth="sm"><DialogTitle>删除本地文件</DialogTitle><DialogContent><Stack spacing={1}>
    <Typography>确定永久删除所选的 {deleting?.length ?? 0} 个文件（{fileSize(deleting?.reduce((sum, f) => sum + f.size, 0) ?? 0)}）？此操作无法撤销。</Typography>
    {deleting?.slice(0, 8).map((f) => <Typography key={f.path} variant="body2" sx={{ overflowWrap: "anywhere" }}>{f.path}</Typography>)}
    {(deleting?.length ?? 0) > 8 && <Typography variant="body2">以及其他 {(deleting?.length ?? 0) - 8} 个文件。</Typography>}
    <Typography variant="body2" color="text.secondary">仅删除所选文件，保留目录。应用数据中的 AI 总结等保存内容仍会保留。</Typography>
  </Stack></DialogContent><DialogActions><Button onClick={() => setDeleting(undefined)}>取消</Button><Button color="error" disabled={blocked} onClick={() => void remove()}>确认删除</Button></DialogActions></Dialog>
  </>;
}
