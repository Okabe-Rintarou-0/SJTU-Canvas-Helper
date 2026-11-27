import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, InputAdornment, MenuItem, Stack, Step, StepLabel, Stepper, TextField, Typography } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import SchoolRoundedIcon from "@mui/icons-material/SchoolRounded";
import { getConfig, saveConfig } from "../lib/config";
import { useQRCode } from "../lib/hooks";
import type { AppConfig, User } from "../lib/model";
import { savePathValidator } from "../lib/utils";
import { CanvasTokenGuideContent } from "./canvas_token_guide";
import { LoginAlert } from "./login_alert";
import { createAiDraft, saveAiDraft } from "../lib/llm_config";
import { FirstRunAiSetup } from "./first_run_ai_setup";

const steps = ["连接 Canvas", "下载目录", "额外登录", "AI 模型", "开始探索"];
const features = [
  ["课程文件", "选择课程后浏览、预览和下载资料，也可以批量下载或同步课程文件。"],
  ["作业与日历", "查看作业要求、截止时间与提交情况，在日历中安排学习进度。"],
  ["课堂视频", "浏览直播与回放。优先使用 Canvas Token 鉴权，必要时使用额外登录态。"],
  ["AI 学习助手", "与课程资料对话、生成课堂总结或使用 Canvas Agent。之后可在「系统设置 → AI 与模型」调整模型服务。"],
];

export default function FirstRunSetupGate({ children }: { children: ReactNode }) {
  const replayRequested = useLocation().pathname === "/setup";
  return <SetupGate key={String(replayRequested)} replayRequested={replayRequested}>{children}</SetupGate>;
}

function SetupGate({ children, replayRequested }: { children: ReactNode; replayRequested: boolean }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState(false);
  const navigate = useNavigate();
  const load = useCallback(async () => {
    setError(false);
    try { setConfig(await getConfig(true)); }
    catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!config) return <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 3 }}>
    {error ? <Alert severity="error" action={<Button onClick={() => void load()}>重试</Button>}>无法读取应用配置，请重试。</Alert>
      : <Stack spacing={2} alignItems="center"><CircularProgress /><Typography role="status">正在读取配置…</Typography></Stack>}
  </Box>;

  if (!config.token.trim() || config.onboarding_completed === false || replayRequested) {
    const replay = replayRequested && Boolean(config.token.trim()) && config.onboarding_completed !== false;
    return <FirstRunSetup initialConfig={config} replay={replay}
      onExit={replay ? () => navigate("/settings?section=tools", { replace: true }) : undefined} onComplete={(next) => {
      setConfig(next);
      navigate(replay ? "/settings?section=tools" : "/files", { replace: true });
    }} />;
  }
  return children;
}

function ExtraLogin({ onReady, onSavingChange }: { onReady: () => void; onSavingChange: (saving: boolean) => void }) {
  const [status, setStatus] = useState<"checking" | "ready" | "scan" | "error">("checking");
  const [showScan, setShowScan] = useState(false);
  const check = useCallback(async () => {
    setStatus("checking");
    try {
      if (await invoke<boolean>("check_extra_login_status")) { setStatus("ready"); onReady(); }
      else setStatus("scan");
    } catch { setStatus("error"); }
  }, [onReady]);
  useEffect(() => { void check(); }, [check]);

  return <Stack spacing={2}>
    {status === "checking" && <Stack direction="row" spacing={2} alignItems="center"><CircularProgress size={22} /><Typography role="status">正在检查已有登录态…</Typography></Stack>}
    {status === "ready" ? <Alert severity="success">额外登录态已连接，可以继续。</Alert> : <>
      {status === "error" && <Alert severity="warning" action={<Button onClick={() => void check()}>重试检查</Button>}>暂时无法检查登录状态。你仍可扫码登录或跳过此步。</Alert>}
      {showScan ? <SetupQRCode onReady={() => { setStatus("ready"); onReady(); }} onSavingChange={onSavingChange} />
        : <Button variant="outlined" disabled={status === "checking"} onClick={() => setShowScan(true)} sx={{ alignSelf: "flex-start" }}>扫码连接额外登录态</Button>}
    </>}
  </Stack>;
}

function SetupQRCode({ onReady, onSavingChange }: { onReady: () => void; onSavingChange: (saving: boolean) => void }) {
  const { qrcode, showQRCode, refreshQRCode, loading, error } = useQRCode({ onScanSuccess: onReady, onSavingChange });
  useEffect(() => { void showQRCode(); }, [showQRCode]);
  return <Stack spacing={2}>
    {error && <Alert severity="warning">{error}</Alert>}
    {qrcode ? <LoginAlert qrcode={qrcode} refreshQRCode={refreshQRCode} /> : <Stack spacing={2} alignItems="center" sx={{ py: 4 }}>
      {loading && <CircularProgress />}
      <Typography role="status">{loading ? "正在获取登录二维码…" : "请重新获取二维码，或稍后在系统设置中连接。"}</Typography>
      <Button onClick={() => void showQRCode()}>重新获取二维码</Button>
    </Stack>}
  </Stack>;
}

export function FirstRunSetup({ initialConfig, onComplete, replay = false, onExit }: {
  initialConfig: AppConfig;
  onComplete: (config: AppConfig) => void;
  replay?: boolean;
  onExit?: () => void;
}) {
  const [draft, setDraft] = useState(initialConfig);
  const [step, setStep] = useState(initialConfig.onboarding_completed === false && initialConfig.token.trim() && initialConfig.save_path.trim() ? 2 : 0);
  const [busy, setBusy] = useState(false);
  const [loginSaving, setLoginSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [aiDraft, setAiDraft] = useState(() => createAiDraft(initialConfig));
  const [aiSaved, setAiSaved] = useState(false);
  const [extraReady, setExtraReady] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [userName, setUserName] = useState("");
  const markExtraReady = useCallback(() => setExtraReady(true), []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, [step]);
  const moveTo = (next: number) => { setError(""); setFieldError(""); setStep(next); };
  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value })); setError(""); setFieldError("");
  };

  const next = async () => {
    setError(""); setFieldError("");
    if (step === 0 && !draft.token.trim()) { setFieldError("请填写 Canvas Token。"); return; }
    if (step === 1 && !draft.save_path.trim()) { setFieldError("请选择一个已存在的下载目录。"); return; }
    setBusy(true);
    try {
      if (step === 0) {
        const me = await invoke<User>("test_token", { token: draft.token.trim(), accountType: draft.account_type });
        setUserName(me.name);
        setDraft((current) => ({ ...current, token: current.token.trim() }));
        moveTo(1);
      } else if (step === 1) {
        try { await savePathValidator(undefined, draft.save_path); }
        catch { setFieldError("请选择一个已存在的下载目录。"); return; }
        const current = await getConfig(true);
        const nextConfig = { ...current, token: draft.token, account_type: draft.account_type, save_path: draft.save_path,
          onboarding_completed: replay ? current.onboarding_completed : false };
        await saveConfig(nextConfig);
        setDraft(nextConfig);
        moveTo(2);
      } else if (step === 2) moveTo(3);
      else if (step === 3) {
        const current = await getConfig(true);
        let nextConfig: AppConfig;
        try { nextConfig = saveAiDraft(current, aiDraft); }
        catch (error) { setError(error instanceof Error ? error.message : "请检查 AI 配置。"); return; }
        await saveConfig(nextConfig);
        setAiDraft(createAiDraft(nextConfig));
        setAiSaved(true);
        moveTo(4);
      } else {
        // The QR login saves its cookie separately. Read the latest config before finishing.
        const current = await getConfig(true);
        const completed = { ...current, onboarding_completed: true };
        await saveConfig(completed);
        onComplete(completed);
      }
    } catch {
      setError(step === 0 ? "连接失败，请检查 Token、所选账号类型及网络后重试。" : "设置未能保存，请重试。你的填写内容仍保留在此页。");
    } finally { setBusy(false); }
  };

  const chooseDirectory = async () => {
    try {
      const selected = await open({ directory: true, defaultPath: draft.save_path || undefined });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) update("save_path", path);
    } catch { setError("无法打开目录选择器，请重试或手动填写目录。"); }
  };

  const titles = ["先连接你的 Canvas", "给课程资料一个固定位置", "按需连接额外登录态", "配置 AI 模型", "准备好了，开始探索吧"];
  const descriptions = [
    "Canvas Token 用于访问你的课程、文件、作业、成绩与日历，是使用应用的必要配置。",
    "下载和同步的课程资料会保存到这个目录。之后可在「系统设置 → 存储与下载」随时修改。",
    "课堂视频优先使用 Canvas Token 完成鉴权；失败时，会尝试使用额外登录态。部分需要统一身份认证的功能也会使用它。",
    "可选配置模型服务，用于课程资料问答、课堂总结和 Canvas Agent。",
    "基础配置已保存。先了解几个常用功能，再从课程文件开始。",
  ];

  return <Box component="main" aria-label="首次配置向导" sx={{ minHeight: "100dvh", display: "flex", flexDirection: { xs: "column", md: "row" } }}>
    <Box component="aside" sx={{ width: { md: 280 }, flexShrink: 0, bgcolor: "action.hover", borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: "divider", p: { xs: 2.5, md: 4 } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 2, md: 7 } }}><SchoolRoundedIcon color="primary" /><Typography fontWeight={700}>Canvas Helper</Typography></Stack>
      <Typography variant="overline" color="primary">欢迎使用</Typography>
      <Typography variant="h4" sx={{ mt: 1, mb: 3 }}>首次配置</Typography>
      <Stepper activeStep={step} orientation="vertical" sx={{ display: { xs: "none", md: "flex" } }}>
        {steps.map((label, index) => <Step key={label} completed={step > index && (index !== 2 || extraReady) && (index !== 3 || aiSaved)}>
          <StepLabel optional={index === 2 ? <Typography variant="caption">{step > 2 && !extraReady ? "已跳过" : "可跳过"}</Typography> : index === 3 ? <Typography variant="caption">{step > 3 && !aiSaved ? "已跳过" : "可跳过"}</Typography> : undefined}>{label}</StepLabel>
        </Step>)}
      </Stepper>
      <Typography variant="body2" color="text.secondary" sx={{ display: { md: "none" } }} aria-live="polite">第 {step + 1} / {steps.length} 步 · {steps[step]}</Typography>
    </Box>
    <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, width: "100%", maxWidth: 920, mx: "auto", p: { xs: 2.5, sm: 4, lg: 6 } }}>
        <Chip size="small" variant="outlined" color="primary" label={`第 ${step + 1} 步 / 共 ${steps.length} 步${step === 2 || step === 3 ? " · 可选" : ""}`} sx={{ mb: 2.5 }} />
        <Typography component="h1" variant="h3" tabIndex={-1} ref={titleRef} sx={{ outline: "none", mb: 1.5 }}>{titles[step]}</Typography>
        <Typography color="text.secondary" sx={{ mb: 4 }}>{descriptions[step]}</Typography>
        <Stack spacing={3}>
          {replay && <Alert severity="info">你正在重新体验配置向导，已有配置已填入。「保存并继续」会保存填写内容；仅查看或返回设置不会修改配置。</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {step === 0 && <>
            <TextField select label="账号类型" value={draft.account_type} disabled={busy} onChange={(event) => update("account_type", event.target.value as AppConfig["account_type"])}>
              <MenuItem value="Default">上海交通大学 Canvas</MenuItem><MenuItem value="JI">密院 Canvas</MenuItem>
            </TextField>
            <TextField fullWidth label="Canvas Token" type={showToken ? "text" : "password"} value={draft.token} disabled={busy} autoComplete="off"
              onChange={(event) => update("token", event.target.value)} error={Boolean(fieldError)} helperText={fieldError || "Token 仅用于连接你的 Canvas 账号，请妥善保管。"}
              slotProps={{ input: { endAdornment: <InputAdornment position="end"><Button disabled={busy} onClick={() => setShowToken(!showToken)} aria-label={showToken ? "隐藏 Token" : "显示 Token"}>{showToken ? "隐藏" : "显示"}</Button></InputAdornment> } }} />
            <Box component="details" sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2.5 }} open>
              <Typography component="summary" fontWeight={700} sx={{ cursor: "pointer", mb: 2 }}>如何获取 Canvas Token</Typography>
              <CanvasTokenGuideContent accountType={draft.account_type} setup />
            </Box>
          </>}
          {step === 1 && <>
            {userName && <Alert severity="success">已连接到 {userName} 的 Canvas。</Alert>}
            <Card variant="outlined"><CardContent><Stack spacing={2.5}>
              <FolderOpenRoundedIcon color="primary" sx={{ fontSize: 40 }} />
              <TextField fullWidth label="下载保存目录" value={draft.save_path} disabled={busy} onChange={(event) => update("save_path", event.target.value)} error={Boolean(fieldError)} helperText={fieldError || "请选择已存在的文件夹，建议使用方便查找的固定目录。"} />
              <Button variant="outlined" startIcon={<FolderOpenRoundedIcon />} disabled={busy} onClick={() => void chooseDirectory()} sx={{ alignSelf: "flex-start" }}>选择目录</Button>
            </Stack></CardContent></Card>
          </>}
          {step === 2 && <>
            <Alert severity="info">此步可跳过，不影响课程文件、作业、成绩和日历等 Canvas 功能。以后可到「系统设置 → 账号与连接」补充登录；登录态失效时也可在那里重新扫码。</Alert>
            <ExtraLogin onReady={markExtraReady} onSavingChange={setLoginSaving} />
          </>}
          {step === 3 && <FirstRunAiSetup draft={aiDraft} onChange={setAiDraft} canImport={extraReady || Boolean(draft.ja_auth_cookie?.trim())}
            busy={busy || importing} onImportingChange={setImporting} />}
          {step === 4 && <>
            <Alert severity="success">Canvas 和下载目录已配置。{extraReady ? "额外登录态已连接。" : "额外登录态可稍后在系统设置中连接。"}</Alert>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
              {features.map(([title, description]) => <Card key={title} variant="outlined"><CardContent>
                <Typography variant="h6" sx={{ mb: 0.5 }}>{title}</Typography><Typography variant="body2" color="text.secondary">{description}</Typography>
              </CardContent></Card>)}
            </Box>
            <Typography variant="body2" color="text.secondary">在左侧导航切换功能，在页面顶部选择课程。更多连接与界面选项都在「系统设置」中。</Typography>
          </>}
        </Stack>
      </Box>
      <Box component="footer" sx={{ position: "sticky", bottom: 0, bgcolor: "background.paper", borderTop: 1, borderColor: "divider", p: { xs: 2, sm: 3 }, zIndex: 1 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2} sx={{ maxWidth: 820, mx: "auto" }}>
          <Stack direction="row" spacing={1}>
            {onExit && <Button disabled={busy || loginSaving || importing} onClick={onExit}>返回设置</Button>}
            <Button disabled={step === 0 || busy || loginSaving || importing} onClick={() => moveTo(step - 1)}>上一步</Button>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end">
            {step === 3 && <Button disabled={busy || importing} onClick={() => moveTo(4)}>跳过 AI 配置</Button>}
            <Button variant="contained" disabled={busy || loginSaving || importing} onClick={() => void next()} endIcon={busy || loginSaving ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardRoundedIcon />}>
              {importing ? "正在导入…" : loginSaving ? "正在保存登录态…" : busy ? (step === 0 ? "正在验证…" : "正在保存…") : ["验证并继续", "保存并继续", extraReady ? "继续" : "跳过，稍后配置", "保存并继续", "开始使用"][step]}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  </Box>;
}
