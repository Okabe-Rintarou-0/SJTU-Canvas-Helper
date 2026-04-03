import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import TipsAndUpdatesRoundedIcon from "@mui/icons-material/TipsAndUpdatesRounded";
import VisibilityOffRoundedIcon from "@mui/icons-material/VisibilityOffRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Link as MuiLink,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactJson from "react-json-view-ts";

import BasicLayout from "../components/layout";
import { LoginAlert } from "../components/login_alert";
import LogModal from "../components/log_modal";
import { getConfig, saveConfig, updateConfig } from "../lib/config";
import { useConfigDispatch, useQRCode } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { AccountInfo, AppConfig, LOG_LEVEL_INFO, User } from "../lib/model";
import { consoleLog, savePathValidator } from "../lib/utils";

type AccountMode = "create" | "select";

const SURFACE_RADIUS = 6;
const DEFAULT_PRIMARY = "#00b96b";
const DEFAULT_PROXY_PORT = 3030;
const CANVAS_TOKEN_URL = "https://oc.sjtu.edu.cn/profile/settings";

const cardSx = {
  borderRadius: `${SURFACE_RADIUS * 4}px`,
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
};

const fullWidthChipSx = {
  width: "100%",
  display: "flex",
  minWidth: 0,
  "& .MuiChip-label": {
    width: "100%",
    textAlign: "center",
  },
};

function InlineQRCodePanel({
  onScanSuccess,
}: {
  onScanSuccess: () => void;
}) {
  const theme = useTheme();
  const { qrcode, showQRCode, refreshQRCode, loading, error } = useQRCode({
    onScanSuccess,
  });

  useEffect(() => {
    void showQRCode();
  }, [showQRCode]);

  return (
    <Card
      sx={{
        borderRadius: "28px",
        border: "1px solid",
        borderColor: alpha(theme.palette.primary.main, 0.12),
        boxShadow: "0 24px 64px rgba(15, 23, 42, 0.08)",
        background: `linear-gradient(135deg, ${alpha(
          theme.palette.primary.main,
          0.08
        )} 0%, ${alpha(theme.palette.background.paper, 0.96)} 48%, ${alpha(
          theme.palette.secondary.main,
          0.08
        )} 100%)`,
      }}
    >
      <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                扫码完成额外登录
              </Typography>
              <Typography variant="body2" color="text.secondary">
                打开上海交通大学统一身份认证扫码。成功后会自动保存登录态，无需额外点击开始。
              </Typography>
            </Box>
            <Chip
              label={
                qrcode ? "自动刷新" : error ? "获取失败" : "正在拉取二维码"
              }
              color={error ? "warning" : "primary"}
              variant="outlined"
              sx={{ alignSelf: { xs: "flex-start", md: "center" } }}
            />
          </Stack>

          {qrcode ? (
            <LoginAlert qrcode={qrcode} refreshQRCode={refreshQRCode} />
          ) : (
            <Stack
              spacing={2}
              alignItems="center"
              justifyContent="center"
              sx={{
                minHeight: 260,
                borderRadius: "24px",
                border: "1px dashed",
                borderColor: alpha(theme.palette.primary.main, 0.18),
                bgcolor: alpha(theme.palette.background.paper, 0.62),
              }}
            >
              {loading ? <CircularProgress size={28} /> : null}
              <Typography variant="body2" color="text.secondary">
                {error || "正在获取登录二维码…"}
              </Typography>
              <Button variant="outlined" onClick={() => void showQRCode()}>
                重新获取二维码
              </Button>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const theme = useTheme();
  const dispatch = useConfigDispatch();
  const [messageApi, contextHolder] = useAppMessage();
  const tokenFieldRef = useRef<HTMLDivElement>(null);
  const savePathFieldRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLDivElement>(null);
  const latestFormDataRef = useRef<AppConfig | null>(null);
  const initialSnapshotRef = useRef<string>("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [openTour, setOpenTour] = useState<boolean>(false);
  const [tourStep, setTourStep] = useState(0);
  const [accountMode, setAccountMode] = useState<AccountMode>("select");
  const [currentAccount, setCurrentAccount] = useState<string>("");
  const [rawConfig, setRawConfig] = useState<string>("");
  const [showLogModal, setShowLogModal] = useState<boolean>(false);
  const [formData, setFormData] = useState<AppConfig | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");
  const [createAccountName, setCreateAccountName] = useState<string>("");
  const [showToken, setShowToken] = useState<boolean>(false);
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [tokenError, setTokenError] = useState<string>("");
  const [savePathError, setSavePathError] = useState<string>("");
  const [extraLoginReady, setExtraLoginReady] = useState<boolean | null>(null);
  const [checkingExtraLogin, setCheckingExtraLogin] = useState(false);

  const steps = [
    {
      title: "填写您的 Canvas Token",
      description:
        "请前往 https://oc.sjtu.edu.cn/profile/settings 创建您的 API Token。",
      image: "help.png",
    },
    {
      title: "填写您的下载保存目录",
      description: "请正确填写您的下载保存目录。",
    },
    {
      title: "保存",
      description: "保存您的设置。",
    },
  ];

  const dirty = useMemo(() => {
    if (!formData || !initialSnapshot) {
      return false;
    }
    return JSON.stringify(formData) !== initialSnapshot;
  }, [formData, initialSnapshot]);

  const parsedRawConfig = useMemo(() => {
    if (!rawConfig) {
      return null;
    }

    try {
      return JSON.parse(rawConfig);
    } catch {
      return null;
    }
  }, [rawConfig]);

  const updateField = useCallback(
    <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
      setFormData((prev) => {
        if (!prev) {
          return prev;
        }
        const next = { ...prev, [key]: value };
        if (key === "theme" || key === "color_primary" || key === "compact_mode") {
          dispatch(updateConfig(next));
        }
        return next;
      });
    },
    [dispatch]
  );

  const checkExtraLoginStatus = async (silent = false) => {
    setCheckingExtraLogin(true);
    try {
      const ok = (await invoke("login_canvas_website")) as boolean;
      setExtraLoginReady(ok);
      if (!ok && !silent) {
        messageApi.warning("当前额外登录态不可用，请重新扫码。");
      }
      return ok;
    } catch (error) {
      setExtraLoginReady(false);
      if (!silent) {
        messageApi.warning(`额外登录态检查失败：${error}`);
      }
      return false;
    } finally {
      setCheckingExtraLogin(false);
    }
  };

  const handleClearExtraLogin = async () => {
    const config = await getConfig(true);
    config.ja_auth_cookie = "";
    await saveConfig(config);
    setExtraLoginReady(false);
    messageApi.success("已清除额外扫码登录状态。", 0.6);
  };

  const initAccounts = async () => {
    const nextAccounts = (await invoke("list_accounts")) as string[];
    setAccounts(nextAccounts);
  };

  const initConfig = async () => {
    try {
      await initAccounts();
      const config = await getConfig(true);
      const accountInfo = (await invoke("read_account_info")) as AccountInfo;
      const normalizedConfig: AppConfig = {
        ...config,
        theme: config.theme ?? "light",
        compact_mode: config.compact_mode ?? false,
        proxy_port: config.proxy_port === 0 ? DEFAULT_PROXY_PORT : config.proxy_port,
      };

      setCurrentAccount(accountInfo.current_account);
      setFormData(normalizedConfig);
      setInitialSnapshot(JSON.stringify(normalizedConfig));
      initialSnapshotRef.current = JSON.stringify(normalizedConfig);
      setTokenError("");
      setSavePathError("");
      setExtraLoginReady(config.ja_auth_cookie.length > 0 ? null : false);
      consoleLog(LOG_LEVEL_INFO, "init config: ", normalizedConfig);

      if (config.ja_auth_cookie.length > 0) {
        void checkExtraLoginStatus(true);
      }

      if (normalizedConfig.token.length === 0) {
        setOpenTour(true);
        setTourStep(0);
      }
    } catch (e) {
      messageApi.error(`初始化时发生错误：${e}`);
    }
  };

  useEffect(() => {
    initConfig();
  }, []);

  useEffect(() => {
    latestFormDataRef.current = formData;
  }, [formData]);

  useEffect(() => {
    initialSnapshotRef.current = initialSnapshot;
  }, [initialSnapshot]);

  useEffect(() => {
    return () => {
      if (!initialSnapshotRef.current || !latestFormDataRef.current) {
        return;
      }
      const initialConfig = JSON.parse(initialSnapshotRef.current) as AppConfig;
      const latestConfig = latestFormDataRef.current;
      const visualChanged =
        initialConfig.theme !== latestConfig.theme ||
        initialConfig.color_primary !== latestConfig.color_primary ||
        initialConfig.compact_mode !== latestConfig.compact_mode;

      if (visualChanged) {
        dispatch(updateConfig(initialConfig));
      }
    };
  }, [dispatch]);

  useEffect(() => {
    if (!dirty) {
      return undefined;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const validateForm = useCallback(async () => {
    if (!formData) {
      return false;
    }

    let valid = true;

    if (!formData.token.trim()) {
      setTokenError("请输入有效的 Canvas Token。");
      valid = false;
    } else {
      setTokenError("");
    }

    if (!formData.save_path.trim()) {
      setSavePathError("请选择一个有效的下载保存目录。");
      valid = false;
    } else {
      try {
        await savePathValidator(undefined, formData.save_path);
        setSavePathError("");
      } catch (error) {
        setSavePathError((error as Error).message);
        valid = false;
      }
    }

    return valid;
  }, [formData]);

  const handleSaveConfig = useCallback(async () => {
    if (!formData) {
      return;
    }

    const valid = await validateForm();
    if (!valid) {
      messageApi.error("请先修正表单中的错误，再保存设置。");
      return;
    }

    try {
      await saveConfig(formData);
      setInitialSnapshot(JSON.stringify(formData));
      messageApi.success("保存成功！");
      if (rawConfig) {
        await getRawConfig();
      }
    } catch (e) {
      messageApi.error(e as string);
    }
  }, [formData, messageApi, rawConfig, validateForm]);

  const handleTestToken = async () => {
    const token = formData?.token ?? "";
    if (!token.trim()) {
      setTokenError("请输入有效的 Canvas Token。");
      messageApi.warning("请先填写 Token，再执行测试。");
      return;
    }

    try {
      const me = (await invoke("test_token", { token })) as User;
      messageApi.success(`你好，${me.name}。欢迎使用 SJTU Canvas Helper。`, 2);
    } catch (e) {
      messageApi.error("Token 无效，请检查后重试。");
    }
  };

  const handleTestApiKey = async () => {
    try {
      messageApi.open({
        key: "testing",
        type: "loading",
        content: "正在等待 LLM 答复…",
        duration: 0,
      });
      const resp = await invoke("chat", { prompt: "你好！" });
      messageApi.destroy("testing");
      messageApi.success(`来自 LLM 的回复：${resp}`);
    } catch (e) {
      messageApi.destroy("testing");
      messageApi.error("API Key 无效，请检查后重试。");
    }
  };

  const handleOpenConfigDir = async () => {
    try {
      await invoke("open_config_dir");
    } catch (e) {
      messageApi.error(`打开失败：${e}`);
    }
  };

  const handleCreateAccount = async () => {
    try {
      const accountName = createAccountName.trim();
      if (!accountName) {
        messageApi.warning("账号名不得为空。");
        return;
      }

      await invoke("create_account", { account: accountName });
      await initAccounts();
      setCreateAccountName("");
      setAccountMode("select");
      messageApi.success("创建账号成功！");
    } catch (e) {
      messageApi.error(`创建账号失败：${e}`);
    }
  };

  const handleSwitchAccount = async (account: string) => {
    try {
      await invoke("switch_account", { account });
      await initConfig();
    } catch (e) {
      messageApi.error(`切换账号失败：${e}`);
    }
  };

  const handleDeleteAccount = useCallback(async () => {
    try {
      await invoke("delete_account", { account: currentAccount });
      await initConfig();
      messageApi.success("删除账号成功！");
    } catch (e) {
      messageApi.error(`删除账号失败：${e}`);
    }
  }, [currentAccount, messageApi]);

  const getRawConfig = async () => {
    try {
      const nextRawConfig = (await invoke("get_raw_config")) as string;
      setRawConfig(nextRawConfig);
    } catch (e) {
      messageApi.error(`获取失败：${e}`);
    }
  };

  const handleSelectSavePath = async () => {
    if (!formData) {
      return;
    }

    const selected = await openDialog({
      directory: true,
      defaultPath: formData.save_path || undefined,
    });

    if (!selected) {
      return;
    }

    const savePath = Array.isArray(selected) ? selected[0] : selected;
    if (!savePath) {
      return;
    }

    updateField("save_path", savePath);
    setSavePathError("");
  };

  return (
    <BasicLayout>
      {contextHolder}
      <Box
        sx={{
          minHeight: "100%",
          color: "text.primary",
        }}
      >
        <Stack spacing={3}>
          <Box
            sx={{
              display: "grid",
              gap: 3,
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                xl: "minmax(0, 1.35fr) minmax(320px, 0.9fr)",
              },
            }}
          >
            <Stack spacing={3}>
              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={3}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      justifyContent="space-between"
                      spacing={1.5}
                      sx={{ width: "100%" }}
                    >
                      <Box>
                        <Typography variant="h5">账号设置</Typography>
                      </Box>
                      <Chip
                        color="primary"
                        variant="outlined"
                        label={`当前账号：${currentAccount || "未选择"}`}
                        sx={{
                          ...fullWidthChipSx,
                          width: { xs: "100%", sm: 260 },
                          flexShrink: 0,
                        }}
                      />
                    </Stack>

                    {accountMode === "select" ? (
                      <Box
                        sx={{
                          display: "grid",
                          gap: 2,
                          gridTemplateColumns: {
                            xs: "minmax(0, 1fr)",
                            md: "1.2fr auto auto",
                          },
                          alignItems: "end",
                        }}
                      >
                        <TextField
                          select
                          label="选择账号"
                          name="account_select"
                          value={currentAccount}
                          onChange={(event) =>
                            void handleSwitchAccount(event.target.value)
                          }
                          helperText="切换后会自动加载该账号的完整配置。"
                        >
                          {accounts.map((account) => (
                            <MenuItem key={account} value={account}>
                              {account}
                            </MenuItem>
                          ))}
                        </TextField>
                        <Button
                          variant="outlined"
                          onClick={() => setAccountMode("create")}
                        >
                          新建账号
                        </Button>
                        <Button
                          color="error"
                          variant="outlined"
                          onClick={handleDeleteAccount}
                          disabled={currentAccount === "Default"}
                          startIcon={<DeleteOutlineRoundedIcon />}
                        >
                          删除当前账号
                        </Button>
                      </Box>
                    ) : (
                      <Box
                        sx={{
                          display: "grid",
                          gap: 2,
                          gridTemplateColumns: {
                            xs: "minmax(0, 1fr)",
                            md: "1.2fr auto auto",
                          },
                          alignItems: "end",
                        }}
                      >
                        <TextField
                          label="新账号名称"
                          name="account_name"
                          value={createAccountName}
                          onChange={(event) =>
                            setCreateAccountName(event.target.value)
                          }
                          placeholder='例如：本科账号…'
                          helperText="建议按用途命名，后续切换会更清晰。"
                        />
                        <Button variant="contained" onClick={handleCreateAccount}>
                          创建账号
                        </Button>
                        <Button
                          variant="text"
                          onClick={() => setAccountMode("select")}
                        >
                          取消
                        </Button>
                      </Box>
                    )}

                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        Canvas 连接
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        这是最核心的连接配置。建议先完成 Token 校验，再保存整页设置。
                      </Typography>
                    </Box>

                    <Alert
                      severity="info"
                      icon={<TipsAndUpdatesRoundedIcon />}
                      sx={{ borderRadius: "18px" }}
                    >
                      请前往{" "}
                      <MuiLink
                        href={CANVAS_TOKEN_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Canvas Token 页面
                      </MuiLink>{" "}
                      创建 API Token，并将其粘贴到下方字段。
                    </Alert>
                    <Box
                      sx={{
                        display: "grid",
                        gap: 2,
                        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr 220px" },
                      }}
                    >
                      <Box ref={tokenFieldRef}>
                        <TextField
                          label="Canvas Token"
                          name="token"
                          type={showToken ? "text" : "password"}
                          value={formData?.token ?? ""}
                          onChange={(event) =>
                            updateField("token", event.target.value)
                          }
                          placeholder="请输入 Canvas Token…"
                          error={Boolean(tokenError)}
                          helperText={
                            tokenError ||
                            "Token 仅用于访问你的 Canvas 数据，不会在界面中明文展示。"
                          }
                          autoComplete="off"
                          spellCheck={false}
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start">
                                <KeyRoundedIcon color="action" />
                              </InputAdornment>
                            ),
                            endAdornment: (
                              <InputAdornment position="end">
                                <Tooltip title={showToken ? "隐藏 Token" : "显示 Token"}>
                                  <IconButton
                                    aria-label={showToken ? "隐藏 Token" : "显示 Token"}
                                    onClick={() => setShowToken((prev) => !prev)}
                                    edge="end"
                                  >
                                    {showToken ? (
                                      <VisibilityOffRoundedIcon />
                                    ) : (
                                      <VisibilityRoundedIcon />
                                    )}
                                  </IconButton>
                                </Tooltip>
                              </InputAdornment>
                            ),
                          }}
                        />
                      </Box>

                      <TextField
                        select
                        label="账号类型"
                        name="account_type"
                        value={formData?.account_type ?? "Default"}
                        onChange={(event) =>
                          updateField(
                            "account_type",
                            event.target.value as AppConfig["account_type"]
                          )
                        }
                        helperText="用于区分本部与密院环境。"
                      >
                        <MenuItem value="Default">本部</MenuItem>
                        <MenuItem value="JI">密院</MenuItem>
                      </TextField>
                    </Box>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 2,
                        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr auto" },
                        alignItems: "start",
                      }}
                    >
                      <Box ref={savePathFieldRef}>
                        <TextField
                          label="下载保存目录"
                          name="save_path"
                          value={formData?.save_path ?? ""}
                          onChange={(event) =>
                            updateField("save_path", event.target.value)
                          }
                          placeholder="请选择下载保存目录…"
                          error={Boolean(savePathError)}
                          helperText={
                            savePathError ||
                            "建议使用固定目录，方便文件归档与后续自动化处理。"
                          }
                          autoComplete="off"
                        />
                      </Box>
                      <Button
                        variant="outlined"
                        onClick={handleSelectSavePath}
                        startIcon={<FolderOpenRoundedIcon />}
                        sx={{ minHeight: 56 }}
                      >
                        选择目录
                      </Button>
                    </Box>

                    <Divider />

                    <Stack spacing={2.5}>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          额外扫码登录
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          用于启用视频等依赖额外登录态的功能。只有在你需要这些能力时，才需要手动扫码登录。
                        </Typography>
                      </Box>

                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} useFlexGap flexWrap="wrap">
                        <Chip
                          icon={<LinkRoundedIcon />}
                          color={extraLoginReady ? "success" : "default"}
                          label={
                            checkingExtraLogin
                              ? "登录态检查中"
                              : extraLoginReady
                                ? "额外登录已连接"
                                : "额外登录未连接"
                          }
                          sx={fullWidthChipSx}
                        />
                      </Stack>

                      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} useFlexGap flexWrap="wrap">
                        <Button
                          variant="outlined"
                          onClick={() => void checkExtraLoginStatus()}
                          disabled={checkingExtraLogin}
                        >
                          检查登录状态
                        </Button>
                        <Button
                          variant="text"
                          color="error"
                          onClick={() => void handleClearExtraLogin()}
                          disabled={!extraLoginReady}
                        >
                          清除额外登录
                        </Button>
                      </Stack>

                      {!extraLoginReady ? (
                        <InlineQRCodePanel
                          onScanSuccess={() => {
                            messageApi.success("扫码登录成功，已保存额外登录态。", 0.8);
                            void checkExtraLoginStatus(true);
                          }}
                        />
                      ) : null}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={3}>
                    <Box>
                      <Typography variant="h5">界面偏好</Typography>
                      <Typography variant="body2" color="text.secondary">
                        调整主题、主色和紧凑模式，让工作区更贴近你的使用习惯。
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 2,
                        gridTemplateColumns: {
                          xs: "minmax(0, 1fr)",
                          md: "repeat(3, minmax(0, 1fr))",
                        },
                        alignItems: "start",
                      }}
                    >
                      <TextField
                        select
                        label="界面主题"
                        name="theme"
                        value={formData?.theme ?? "light"}
                        onChange={(event) =>
                          updateField("theme", event.target.value as AppConfig["theme"])
                        }
                        helperText="应用到整个工作区的亮暗风格。"
                      >
                        <MenuItem value="light">明亮主题</MenuItem>
                        <MenuItem value="dark">深色主题</MenuItem>
                      </TextField>

                      <TextField
                        label="主色调"
                        name="color_primary"
                        value={formData?.color_primary ?? DEFAULT_PRIMARY}
                        onChange={(event) =>
                          updateField("color_primary", event.target.value)
                        }
                        placeholder="#00b96b"
                        helperText="支持输入 Hex 颜色值。"
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <Box
                                sx={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: "6px",
                                  bgcolor:
                                    formData?.color_primary || DEFAULT_PRIMARY,
                                  border: "1px solid",
                                  borderColor: "divider",
                                }}
                              />
                            </InputAdornment>
                          ),
                          endAdornment: (
                            <InputAdornment position="end">
                              <input
                                aria-label="选择主色"
                                type="color"
                                value={formData?.color_primary ?? DEFAULT_PRIMARY}
                                onChange={(event) =>
                                  updateField("color_primary", event.target.value)
                                }
                                style={{
                                  width: 28,
                                  height: 28,
                                  padding: 0,
                                  border: "none",
                                  background: "transparent",
                                  cursor: "pointer",
                                }}
                              />
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Box>
                    <Divider />
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={3}>
                    <Box>
                      <Typography variant="h5">高级选项</Typography>
                      <Typography variant="body2" color="text.secondary">
                        这部分用于接入 LLM 功能。
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 2,
                        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr 220px" },
                      }}
                    >
                      <TextField
                        label="DeepSeek API Key"
                        name="llm_api_key"
                        type={showApiKey ? "text" : "password"}
                        value={formData?.llm_api_key ?? ""}
                        onChange={(event) =>
                          updateField("llm_api_key", event.target.value)
                        }
                        placeholder="请输入 DeepSeek API Key…"
                        helperText="用于启用大语言模型相关能力。"
                        autoComplete="off"
                        spellCheck={false}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <Tooltip
                                title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                              >
                                <IconButton
                                  aria-label={
                                    showApiKey ? "隐藏 API Key" : "显示 API Key"
                                  }
                                  onClick={() => setShowApiKey((prev) => !prev)}
                                  edge="end"
                                >
                                  {showApiKey ? (
                                    <VisibilityOffRoundedIcon />
                                  ) : (
                                    <VisibilityRoundedIcon />
                                  )}
                                </IconButton>
                              </Tooltip>
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Box>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 2,
                        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr 1fr" },
                      }}
                    >
                      <TextField
                        label="明文类型白名单"
                        name="serve_as_plaintext"
                        value={formData?.serve_as_plaintext ?? ""}
                        onChange={(event) =>
                          updateField("serve_as_plaintext", event.target.value)
                        }
                        placeholder="例如：md,txt,json…"
                        helperText="用逗号分隔，用于指定以纯文本方式打开的扩展名。"
                        autoComplete="off"
                      />
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>

            <Stack spacing={3}>
              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={2.5}>
                    <Box>
                      <Typography variant="h5">快捷操作</Typography>
                      <Typography variant="body2" color="text.secondary">
                        常用动作集中在这里，方便你在配置和排障之间快速切换。
                      </Typography>
                    </Box>

                    <Box ref={saveButtonRef}>
                      <Button
                        fullWidth
                        size="large"
                        variant="contained"
                        startIcon={<SaveRoundedIcon />}
                        onClick={handleSaveConfig}
                      >
                        保存全部设置
                      </Button>
                    </Box>

                    <Button fullWidth variant="outlined" onClick={handleTestToken}>
                      测试 Canvas Token
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={handleTestApiKey}
                      startIcon={<AutoAwesomeRoundedIcon />}
                    >
                      测试 DeepSeek API Key
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={handleOpenConfigDir}
                      startIcon={<FolderOpenRoundedIcon />}
                    >
                      打开配置目录
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      onClick={() => setShowLogModal(true)}
                    >
                      查看运行日志
                    </Button>
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="h5">配置状态</Typography>
                      <Typography variant="body2" color="text.secondary">
                        帮助你快速判断当前配置是否完整，以及页面是否存在未保存修改。
                      </Typography>
                    </Box>

                    <Stack spacing={1.25} sx={{ width: "100%" }}>
                      <Chip
                        color={dirty ? "warning" : "success"}
                        label={dirty ? "有未保存修改" : "已与本地配置同步"}
                        sx={fullWidthChipSx}
                      />
                      <Chip
                        color={formData?.token ? "success" : "default"}
                        label={formData?.token ? "Token 已填写" : "Token 待填写"}
                        sx={fullWidthChipSx}
                      />
                      <Chip
                        color={formData?.save_path ? "success" : "default"}
                        label={formData?.save_path ? "保存目录已配置" : "保存目录待配置"}
                        sx={fullWidthChipSx}
                      />
                      <Chip
                        color={formData?.llm_api_key ? "info" : "default"}
                        label={formData?.llm_api_key ? "LLM 功能已接入" : "LLM 功能未接入"}
                        sx={fullWidthChipSx}
                      />
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="h5">配置预览</Typography>
                      <Typography variant="body2" color="text.secondary">
                        查看最终写入的原始配置，适合排查异常或确认字段结构。
                      </Typography>
                    </Box>

                    <Button
                      variant="outlined"
                      onClick={() => (rawConfig ? setRawConfig("") : void getRawConfig())}
                      startIcon={<PreviewRoundedIcon />}
                    >
                      {rawConfig ? "隐藏原始配置" : "加载原始配置"}
                    </Button>

                    {rawConfig && parsedRawConfig && (
                      <Box
                        sx={{
                          p: 1,
                          borderRadius: "20px",
                          border: "1px solid",
                          borderColor: "divider",
                          bgcolor: alpha(theme.palette.background.default, 0.72),
                          maxHeight: 420,
                          overflow: "auto",
                        }}
                      >
                        <ReactJson
                          style={{ background: "transparent" }}
                          src={parsedRawConfig}
                          collapsed={1}
                        />
                      </Box>
                    )}

                    {rawConfig && !parsedRawConfig && (
                      <Alert severity="warning" sx={{ borderRadius: "18px" }}>
                        当前配置不是合法 JSON，无法渲染结构化预览。
                      </Alert>
                    )}
                  </Stack>
                </CardContent>
              </Card>

              <Card
                sx={{
                  ...cardSx,
                  borderColor: alpha(theme.palette.error.main, 0.24),
                  bgcolor: alpha(theme.palette.error.main, 0.04),
                }}
              >
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="h5">危险操作</Typography>
                      <Typography variant="body2" color="text.secondary">
                        删除账号会移除当前账户配置。默认账号不允许删除，以避免误操作。
                      </Typography>
                    </Box>

                    <Button
                      color="error"
                      variant="contained"
                      onClick={handleDeleteAccount}
                      disabled={currentAccount === "Default"}
                      startIcon={<DeleteOutlineRoundedIcon />}
                    >
                      删除当前账号
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </Box>
        </Stack>

        {showLogModal && <LogModal onClose={() => setShowLogModal(false)} />}
        <Dialog open={openTour} onClose={() => setOpenTour(false)} fullWidth maxWidth="sm">
          <DialogTitle>{steps[tourStep]?.title}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {steps[tourStep]?.description}
              </Typography>
              {steps[tourStep]?.image ? (
                <Box
                  component="img"
                  src={steps[tourStep].image}
                  alt={steps[tourStep].title}
                  sx={{
                    width: "100%",
                    borderRadius: "20px",
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                />
              ) : null}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setOpenTour(false)}>关闭</Button>
            <Button
              onClick={() => setTourStep((prev) => Math.max(0, prev - 1))}
              disabled={tourStep === 0}
            >
              上一步
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                if (tourStep === steps.length - 1) {
                  setOpenTour(false);
                  return;
                }
                setTourStep((prev) => prev + 1);
              }}
            >
              {tourStep === steps.length - 1 ? "完成" : "下一步"}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </BasicLayout>
  );
}
