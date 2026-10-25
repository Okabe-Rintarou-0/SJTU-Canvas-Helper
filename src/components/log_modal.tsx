import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";

const issueUrl = "https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/new";
const reportSeparator = "\n近期运行日志\n";

export default function LogModal({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState("");
  const [environment, setEnvironment] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [notice, setNotice] = useState<{ severity: "success" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const report = await invoke<string>("read_diagnostic_report");
      const separator = report.indexOf(reportSeparator);
      // Never use an unrecognised report as environment data in an Issue URL.
      setEnvironment(separator < 0 ? "" : report.slice(0, separator).trim());
      setLog(separator < 0 ? report : report.slice(separator + reportSeparator.length));
    } catch {
      setLog("");
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getEnvironment = async () => {
    if (environment) return environment;
    let version = "未知";
    try {
      version = await getVersion();
    } catch {
      // The feedback form remains usable even if the app bridge is unavailable.
    }
    return `应用版本：${version}\n运行平台：${navigator.platform || "未知"}\n请补充系统版本及安装方式。`;
  };

  const exportReport = async () => {
    setExporting(true);
    setNotice(null);
    setSavedPath("");
    try {
      const path = await save({
        title: "保存诊断信息",
        defaultPath: `SJTU-Canvas-Helper-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
        filters: [{ name: "文本文件", extensions: ["txt"] }],
      });
      if (!path) return;
      await invoke("save_diagnostic_report", { path });
      setSavedPath(path);
    } catch {
      setNotice({ severity: "error", text: "导出失败。可复制环境信息后直接反馈问题，或稍后重试。" });
    } finally {
      setExporting(false);
    }
  };

  const copyEnvironment = async () => {
    setNotice(null);
    try {
      await navigator.clipboard.writeText(await getEnvironment());
      setNotice({ severity: "success", text: "环境信息已复制。" });
    } catch {
      setNotice({ severity: "error", text: "复制失败。仍可打开反馈表单，手动填写应用版本和系统。" });
    }
  };

  const reportIssue = async () => {
    setNotice(null);
    try {
      const query = new URLSearchParams({ template: "01-bug.yml", environment: (await getEnvironment()).slice(0, 1500) });
      await openExternal(`${issueUrl}?${query.toString()}`);
    } catch {
      setNotice({ severity: "error", text: "未能打开 GitHub，请在浏览器中访问项目的 Issues 页面，或使用邮件反馈。" });
    }
  };

  const openDirectory = async () => {
    setNotice(null);
    try {
      await invoke("open_log_directory");
    } catch {
      setNotice({ severity: "error", text: "无法打开日志目录。没有日志也可以直接反馈问题。" });
    }
  };

  const openMail = async () => {
    setNotice(null);
    try {
      await openExternal("mailto:923048992@sjtu.edu.cn");
    } catch {
      setNotice({ severity: "error", text: "未能打开邮件客户端，可发送邮件至 923048992@sjtu.edu.cn。" });
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="log-feedback-title">
      <DialogTitle id="log-feedback-title">日志与反馈</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            遇到问题时，可导出包含环境信息和近期日志的 .txt 文件，检查内容后手动附到 GitHub Issue。没有日志也可以提交。
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button size="small" onClick={() => void refresh()} disabled={loading}>刷新</Button>
            <Button size="small" onClick={() => void copyEnvironment()}>复制环境信息</Button>
            <Button size="small" onClick={() => void openDirectory()}>打开日志目录</Button>
            <Button size="small" onClick={() => void openMail()}>邮件反馈</Button>
          </Stack>
          {loading ? (
            <Stack direction="row" spacing={1} alignItems="center" role="status">
              <CircularProgress size={20} />
              <Typography variant="body2">正在读取近期日志…</Typography>
            </Stack>
          ) : loadError ? (
            <Alert severity="warning">无法读取日志。可以刷新重试，或复制环境信息后直接反馈问题。</Alert>
          ) : log.trim() ? (
            <Box component="pre" role="region" aria-label="近期运行日志" sx={{
              m: 0, p: 1.5, maxHeight: "45vh", minHeight: 160, overflow: "auto",
              whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12,
              bgcolor: "action.hover", borderRadius: 1,
            }}>{log}</Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              暂无运行日志。可以直接反馈问题，或复现后点击“刷新”。
            </Typography>
          )}
          {savedPath && (
            <Alert severity="success" sx={{ overflowWrap: "anywhere" }}>
              已保存到：{savedPath}<br />
              请在 GitHub 表单中手动附加此 .txt 文件；应用不会自动上传。
            </Alert>
          )}
          {notice && <Alert severity={notice.severity}>{notice.text}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, flexWrap: "wrap", gap: 1 }}>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="outlined" onClick={() => void reportIssue()}>在 GitHub 反馈</Button>
        <Button variant="contained" onClick={() => void exportReport()} disabled={exporting}>
          {exporting ? "正在导出…" : "导出诊断信息"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
