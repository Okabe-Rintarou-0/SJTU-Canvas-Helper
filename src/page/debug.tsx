import BugReportRoundedIcon from "@mui/icons-material/BugReportRounded";
import ClearAllRoundedIcon from "@mui/icons-material/ClearAllRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useState } from "react";

import BasicLayout from "../components/layout";
import { clearNetworkLogs, listNetworkLogs } from "../lib/config";
import { useConfigSelector } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { DebugHttpHeader, NetworkRequestLog } from "../lib/model";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        overflow: "auto",
        borderRadius: "16px",
        bgcolor: "rgba(15, 23, 42, 0.92)",
        color: "#dbeafe",
        fontSize: "0.78rem",
        lineHeight: 1.65,
        fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
      }}
    >
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}

function formatDuration(duration?: number | null) {
  if (duration == null) return "--";
  return `${duration} ms`;
}

function formatStatus(log: NetworkRequestLog) {
  if (log.error) return "失败";
  if (log.status == null) return "进行中";
  return `${log.status}`;
}



function QueryParamsTable({ url: urlProp }: { url: string }) {
  const params = useMemo(() => {
    const idx = urlProp.indexOf("?");
    if (idx === -1) return null;
    const search = urlProp.slice(idx + 1);
    const result: { name: string; value: string }[] = [];
    for (const part of search.split("&")) {
      const eq = part.indexOf("=");
      if (eq === -1) { result.push({ name: decodeURIComponent(part), value: "" }); continue; }
      result.push({
        name: decodeURIComponent(part.slice(0, eq)),
        value: decodeURIComponent(part.slice(eq + 1)),
      });
    }
    return result;
  }, [urlProp]);

  if (!params || params.length === 0) return null;

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        Query Parameters
      </Typography>
      <TableContainer sx={{ borderRadius: '16px', border: '1px solid', borderColor: 'divider', overflow: 'auto' }}>
        <Table size="small" sx={{ minWidth: 360 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, fontSize: "0.78rem", fontFamily: '"JetBrains Mono", "Cascadia Code", monospace', bgcolor: "action.hover", borderBottom: 2, width: "35%" }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: "0.78rem", fontFamily: '"JetBrains Mono", "Cascadia Code", monospace', bgcolor: "action.hover", borderBottom: 2 }}>Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {params.map((p) => (
              <TableRow key={p.name} sx={{ '&:hover': { bgcolor: 'action.hover' }, '&:last-child td': { border: 0 } }}>
                <TableCell sx={{ fontFamily: '"JetBrains Mono", "Cascadia Code", monospace', fontSize: "0.75rem", whiteSpace: "nowrap", color: "primary.main", fontWeight: 600 }}>{p.name}</TableCell>
                <TableCell sx={{ fontFamily: '"JetBrains Mono", "Cascadia Code", monospace', fontSize: "0.75rem", wordBreak: "break-all" }}>{p.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

function HeadersTable({ headers }: { headers: DebugHttpHeader[] }) {
  const theme = useTheme();
  if (headers.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        无
      </Typography>
    );
  }
  return (
    <TableContainer
      sx={{
        borderRadius: "16px",
        border: "1px solid",
        borderColor: alpha(theme.palette.divider, 0.2),
        overflow: "auto",
      }}
    >
      <Table size="small" sx={{ minWidth: 420 }}>
        <TableHead>
          <TableRow>
            <TableCell
              sx={{
                fontWeight: 700,
                fontSize: "0.78rem",
                fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
                bgcolor: alpha(theme.palette.background.default, 0.86),
                borderBottom: `2px solid ${alpha(theme.palette.divider, 0.3)}`,
                width: "30%",
              }}
            >
              Name
            </TableCell>
            <TableCell
              sx={{
                fontWeight: 700,
                fontSize: "0.78rem",
                fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
                bgcolor: alpha(theme.palette.background.default, 0.86),
                borderBottom: `2px solid ${alpha(theme.palette.divider, 0.3)}`,
              }}
            >
              Value
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {headers.map((header) => (
            <TableRow
              key={header.name}
              sx={{
                "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                "&:last-child td": { border: 0 },
              }}
            >
              <TableCell
                sx={{
                  fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
                  fontSize: "0.75rem",
                  whiteSpace: "nowrap",
                  color: "primary.main",
                  fontWeight: 600,
                  borderColor: alpha(theme.palette.divider, 0.12),
                }}
              >
                {header.name}
              </TableCell>
              <TableCell
                sx={{
                  fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
                  fontSize: "0.75rem",
                  wordBreak: "break-all",
                  borderColor: alpha(theme.palette.divider, 0.12),
                }}
              >
                {header.value}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}


function generateCurl(log: NetworkRequestLog) {
  const parts = [`curl -X ${log.method} \\`];
  parts.push(`  ${JSON.stringify(log.url)} \\`);
  for (const h of log.request_headers) {
    parts.push(`  -H ${JSON.stringify(`${h.name}: ${h.value}`)} \\`);
  }
  if (log.request_body) {
    parts.push(`  -d ${JSON.stringify(log.request_body)}`);
  } else {
    const last = parts.pop() ?? "";
    parts.push(last.replace(/ \\\$/, ""));
  }
  return parts.join("\n");
}
export default function DebugPage() {
  const theme = useTheme();
  const config = useConfigSelector((state) => state.config.data);
  const [messageApi, contextHolder] = useAppMessage();
  const [logs, setLogs] = useState<NetworkRequestLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleExpand = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: prev[id] === undefined ? false : !prev[id] }));
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const nextLogs = await listNetworkLogs();
      setLogs(nextLogs);
      setCollapsed((prev) => {
        const ids = new Set(nextLogs.map((l) => l.id));
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (!ids.has(key)) delete next[key];
        }
        return next;
      });
    } catch (error) {
      messageApi.error(`加载请求日志失败：${error}`);
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) {
      return logs;
    }
    return logs.filter((log) =>
      [
        log.method,
        log.url,
        log.source,
        log.error ?? "",
        log.request_body ?? "",
        ...log.request_headers.map((item) => `${item.name}:${item.value}`),
        ...log.response_headers.map((item) => `${item.name}:${item.value}`),
      ]
        .join("\n")
        .toLowerCase()
        .includes(query)
    );
  }, [keyword, logs]);

  const handleClear = useCallback(async () => {
    try {
      await clearNetworkLogs();
      setLogs([]);
      messageApi.success("已清空请求日志");
    } catch (error) {
      messageApi.error(`清空失败：${error}`);
    }
  }, [messageApi]);

  const handleCopyCurl = useCallback(
    async (log: NetworkRequestLog) => {
      try {
        await navigator.clipboard.writeText(generateCurl(log));
        messageApi.success("已复制 Curl 命令");
      } catch {
        messageApi.error("复制失败");
      }
    },
    [messageApi]
  );

  const handleCopy = useCallback(
    async (log: NetworkRequestLog) => {
      try {
        await navigator.clipboard.writeText(log.url);
        messageApi.success("已复制请求 URL");
      } catch {
        messageApi.error("复制失败");
      }
    },
    [messageApi]
  );

  return (
    <BasicLayout>
      {contextHolder}
      <Stack spacing={3}>
        <Card
          sx={{
            borderRadius: "30px",
            overflow: "hidden",
            border: "1px solid",
            borderColor: alpha(theme.palette.primary.main, 0.14),
            background: `linear-gradient(135deg, ${alpha(
              theme.palette.primary.main,
              0.14
            )} 0%, ${alpha(theme.palette.background.paper, 0.96)} 55%, ${alpha(
              "#0f172a",
              theme.palette.mode === "dark" ? 0.34 : 0.06
            )} 100%)`,
            boxShadow: "0 28px 70px rgba(15, 23, 42, 0.12)",
          }}
        >
          <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
            <Stack spacing={2.5}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                justifyContent="space-between"
                alignItems={{ xs: "flex-start", md: "center" }}
              >
                <Box>
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1 }}>
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: "16px",
                        display: "grid",
                        placeItems: "center",
                        bgcolor: alpha(theme.palette.primary.main, 0.16),
                        color: "primary.main",
                      }}
                    >
                      <BugReportRoundedIcon />
                    </Box>
                    <Box>
                      <Typography variant="h4" sx={{ fontWeight: 800 }}>
                        Debug 控制台
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        查看最近 1000 条网络请求，快速排查请求头、请求体和响应状态。
                      </Typography>
                    </Box>
                  </Stack>
                </Box>

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    color={config?.debug_mode ? "success" : "default"}
                    label={config?.debug_mode ? "Debug 模式已开启" : "Debug 模式未开启"}
                  />
                  <Chip color="primary" variant="outlined" label={`当前 ${logs.length} 条`} />
                </Stack>
              </Stack>

              {!config?.debug_mode ? (
                <Alert severity="info" sx={{ borderRadius: "18px" }}>
                  请先在设置页面开启 Debug 模式，之后新的网络请求才会被记录到这里。
                </Alert>
              ) : null}

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                <TextField
                  fullWidth
                  placeholder="搜索 URL、Header、Body、错误信息"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRoundedIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
                <Button
                  variant="outlined"
                  onClick={() => void loadLogs()}
                  startIcon={<RefreshRoundedIcon />}
                  disabled={loading}
                  sx={{ minWidth: 130, whiteSpace: "nowrap" }}
                >
                  刷新
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => void handleClear()}
                  startIcon={<ClearAllRoundedIcon />}
                  disabled={loading || logs.length === 0}
                  sx={{ minWidth: 180, whiteSpace: "nowrap" }}
                >
                  清空
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Stack spacing={2}>
          {filteredLogs.length === 0 ? (
            <Card
              sx={{
                borderRadius: "28px",
                border: "1px dashed",
                borderColor: alpha(theme.palette.divider, 0.8),
                bgcolor: alpha(theme.palette.background.paper, 0.72),
              }}
            >
              <CardContent sx={{ py: 6 }}>
                <Stack spacing={1.25} alignItems="center">
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    暂无可展示的请求记录
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {keyword.trim()
                      ? "没有匹配到搜索结果，试试换个关键词。"
                      : "开启 Debug 模式后执行一些操作，请求就会出现在这里。"}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          {filteredLogs.map((log) => (
            <Card
              key={log.id}
              sx={{
                borderRadius: "28px",
                border: "1px solid",
                borderColor: alpha(
                  log.error ? theme.palette.error.main : theme.palette.primary.main,
                  0.16
                ),
                boxShadow: "0 18px 44px rgba(15, 23, 42, 0.08)",
              }}
            >
              <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
                <Stack spacing={2}>
                  <Stack
                    direction={{ xs: "column", lg: "row" }}
                    spacing={1.5}
                    justifyContent="space-between"
                  >
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip
                          size="small"
                          label={log.method}
                          sx={{
                            fontWeight: 700,
                            bgcolor: alpha(theme.palette.primary.main, 0.12),
                            color: "primary.main",
                          }}
                        />
                        <Chip
                          size="small"
                          color={log.error ? "error" : log.ok ? "success" : "default"}
                          label={formatStatus(log)}
                        />
                        <Chip size="small" variant="outlined" label={formatDuration(log.duration_ms)} />
                        <Chip size="small" variant="outlined" label={log.source} />
                      </Stack>
                      <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 700, wordBreak: "break-all", lineHeight: 1.5 }}
                      >
                        {log.url}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(log.timestamp).toLocaleString("zh-CN")}
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={1}>
                      <IconButton
                        size="small"
                        onClick={() => void handleCopy(log)}
                        sx={{
                          color: theme.palette.mode === "dark" ? alpha("#e2e8f0", 0.7) : "text.secondary",
                          width: 28,
                          height: 28,
                          borderRadius: "8px",
                          bgcolor: alpha(theme.palette.primary.main, 0.06),
                          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.14) },
                        }}
                      >
                        <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => void handleCopyCurl(log)}
                        sx={{
                          color: theme.palette.mode === "dark" ? alpha("#e2e8f0", 0.6) : "text.secondary",
                          bgcolor: alpha(theme.palette.primary.main, 0.06),
                          borderRadius: "8px",
                          width: 28,
                          height: 28,
                          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.14) },
                        }}
                        title="复制 Curl 命令"
                      >
                        <TerminalRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => toggleExpand(log.id)}
                        sx={{
                          color: theme.palette.mode === "dark" ? alpha("#e2e8f0", 0.7) : "text.secondary",
                          width: 28,
                          height: 28,
                          borderRadius: "8px",
                          bgcolor: alpha(theme.palette.action.hover, 0.4),
                          "&:hover": { bgcolor: alpha(theme.palette.action.hover, 0.8) },
                        }}
                      >
                        {collapsed[log.id] !== false ? <ExpandMoreRoundedIcon sx={{ fontSize: 16 }} /> : <ExpandLessRoundedIcon sx={{ fontSize: 16 }} />}
                      </IconButton>
                    </Stack>
                  </Stack>

                  {collapsed[log.id] !== false ? null : (
                    <>
                  {log.error ? (
                    <Alert severity="error" sx={{ borderRadius: "16px" }}>
                      {log.error}
                    </Alert>
                  ) : null}

                  <Divider />

                  <Box
                    sx={{
                      display: "grid",
                      gap: 2,
                      gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
                    }}
                  >
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        Request Headers
                      </Typography>
                      <HeadersTable headers={log.request_headers} />
                      <Box sx={{ mt: 1 }}>
                        <QueryParamsTable url={log.url} />
                      </Box>
                    </Stack>

                    <Stack spacing={1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        Response Headers
                      </Typography>
                      <HeadersTable headers={log.response_headers} />
                    </Stack>
                  </Box>

                  <Stack spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Request Body
                    </Typography>
                    {log.request_body ? (
                      <>
                       <JsonBlock value={log.request_body} />
                       {log.request_body_truncated ? (
                         <Typography variant="caption" color="warning.main">
                           请求体过长，当前仅展示前 16KB 预览。
                         </Typography>
                       ) : null}
                     </>
                   ) : (
                     <Typography variant="body2" color="text.secondary">
                       无请求体
                     </Typography>
                   )}
                 </Stack>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      Response Body
                    </Typography>
                    {log.response_body ? (
                      <>
                        <JsonBlock value={log.response_body} />
                        {log.response_body_truncated ? (
                          <Typography variant="caption" color="warning.main">
                            响应体过长，当前仅展示前 16KB 预览。
                          </Typography>
                        ) : null}
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        无响应体
                      </Typography>
                    )}
                  </Stack>
                  <Divider />

                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        Curl 命令
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => void handleCopyCurl(log)}
                        sx={{
                          color: theme.palette.mode === "dark" ? alpha("#e2e8f0", 0.7) : "text.secondary",
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                          width: 26,
                          height: 26,
                          borderRadius: "8px",
                          "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.18) },
                        }}
                      >
                        <ContentCopyRoundedIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Stack>
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: "14px",
                        bgcolor: "rgba(15, 23, 42, 0.92)",
                        color: "#dbeafe",
                        fontSize: "0.78rem",
                        lineHeight: 1.65,
                        fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
                        overflow: "auto",
                        maxHeight: 200,
                      }}
                    >
                      <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {generateCurl(log)}
                      </Box>
                    </Box>
                  </Stack>
                    </>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Stack>
    </BasicLayout>
  );
}







