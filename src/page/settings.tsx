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
import LogModal from "../components/log_modal";
import { LoginAlert } from "../components/login_alert";
import { getConfig, saveConfig, updateConfig } from "../lib/config";
import { useConfigDispatch, useQRCode } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { AccountInfo, AppConfig, LOG_LEVEL_INFO, User } from "../lib/model";
import { consoleLog, savePathValidator } from "../lib/utils";

type AccountMode = "create" | "select";

const SURFACE_RADIUS = 6;
const DEFAULT_PRIMARY = "#00b96b";
const DEFAULT_PROXY_PORT = 3030;
const MIN_LLM_TEMPERATURE = 0;
const MAX_LLM_TEMPERATURE = 2;
const LLM_TEMPERATURE_STEP = 0.1;
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
  const [checkingExtraLogin, setCheckingExtraLogin] = useState(true);

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

  const handleLlmTemperatureChange = useCallback(
    (rawValue: string) => {
      if (!formData) {
        return;
      }
      if (!rawValue.trim()) {
        updateField("llm_temperature", null);
        return;
      }
      const parsedValue = Number(rawValue);
      if (Number.isNaN(parsedValue)) {
        return;
      }
      const clampedValue = Math.min(
        MAX_LLM_TEMPERATURE,
        Math.max(MIN_LLM_TEMPERATURE, parsedValue)
      );
      updateField("llm_temperature", Number(clampedValue.toFixed(1)));
    },
    [formData, updateField]
  );

  const checkExtraLoginStatus = useCallback(
    async (silent = false) => {
      setCheckingExtraLogin(true);
      consoleLog(LOG_LEVEL_INFO, "check_extra_login_status");
      try {
        const ok = (await invoke("check_extra_login_status")) as boolean;
        setExtraLoginReady(ok);
        if (!ok && !silent) {
          messageApi.warning("当前额外登录态不可用，请重新扫码。");
        }
        consoleLog(LOG_LEVEL_INFO, "check_extra_login_status", ok);
        return ok;
      } catch (error) {
        consoleLog(LOG_LEVEL_INFO, "check_extra_login_status", error);
        setExtraLoginReady(false);
        if (!silent) {
          messageApi.warning(`额外登录态检查失败：${error}`);
        }
        return false;
      } finally {
        setCheckingExtraLogin(false);
      }
    },
    [messageApi]
  );

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
      consoleLog(LOG_LEVEL_INFO, "init config: ", normalizedConfig);

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
    setExtraLoginReady(null);
    checkExtraLoginStatus(true);
  }, [checkExtraLoginStatus]);

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
        content: "正在测试 LLM 连接…",
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

  const renderCardSaveAction = (label: string) => (
    <>
      <Divider />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.25}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <Typography variant="body2" color="text.secondary">
          {dirty ? "当前修改尚未写入本地配置。" : "当前卡片内容已与本地配置同步。"}
        </Typography>
        <Button
          variant="contained"
          onClick={handleSaveConfig}
          startIcon={<SaveRoundedIcon />}
          sx={{ minWidth: { xs: "100%", sm: 164 } }}
        >
          {label}
        </Button>
      </Stack>
    </>
  );

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

                    {renderCardSaveAction("保存账号设置")}

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
                              : extraLoginReady === null
                                ? "登录态待检测"
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
                      </Stack>

                      {extraLoginReady === false ? (
                        <InlineQRCodePanel
                          onScanSuccess={() => {
                            messageApi.success("扫码登录成功，已保存额外登录态。", 0.8);
                            checkExtraLoginStatus(true);
                          }}
                        />
                      ) : extraLoginReady === null || checkingExtraLogin ? (
                        <Card
                          sx={{
                            borderRadius: "24px",
                            border: "1px solid",
                            borderColor: alpha(theme.palette.primary.main, 0.12),
                            boxShadow: "none",
                          }}
                        >
                          <CardContent sx={{ p: { xs: 2.25, md: 2.5 } }}>
                            <Stack
                              spacing={1.5}
                              direction={{ xs: "column", sm: "row" }}
                              alignItems={{ xs: "flex-start", sm: "center" }}
                            >
                              <CircularProgress size={22} />
                              <Typography variant="body2" color="text.secondary">
                                正在检查额外登录状态，确认未登录后会显示二维码。
                              </Typography>
                            </Stack>
                          </CardContent>
                        </Card>
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

                    {renderCardSaveAction("保存界面偏好")}
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={3}>
                    <Box>
                      <Typography variant="h5">高级选项</Typography>
                      <Typography variant="body2" color="text.secondary">
                        这部分用于接入 OpenAI-compatible 的 LLM 功能。
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
                        label="LLM API Key"
                        name="llm_api_key"
                        type={showApiKey ? "text" : "password"}
                        value={formData?.llm_api_key ?? ""}
                        onChange={(event) =>
                          updateField("llm_api_key", event.target.value)
                        }
                        placeholder="请输入 API Key…"
                        helperText="用于启用 OpenAI-compatible 大语言模型能力。"
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
                        gridTemplateColumns: {
                          xs: "minmax(0, 1fr)",
                          md: "1fr 1fr 180px",
                        },
                      }}
                    >
                      <TextField
                        label="LLM Base URL"
                        name="llm_base_url"
                        value={formData?.llm_base_url ?? ""}
                        onChange={(event) =>
                          updateField("llm_base_url", event.target.value)
                        }
                        placeholder="https://api.openai.com/v1"
                        helperText="留空时默认使用 DeepSeek 的 OpenAI-compatible 地址。"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <TextField
                        label="LLM Model"
                        name="llm_model"
                        value={formData?.llm_model ?? ""}
                        onChange={(event) =>
                          updateField("llm_model", event.target.value)
                        }
                        placeholder="gpt-4o-mini / deepseek-chat"
                        helperText="留空时默认使用 `deepseek-chat`。"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <TextField
                        label="Temperature"
                        name="llm_temperature"
                        type="number"
                        value={formData?.llm_temperature ?? ""}
                        onChange={(event) =>
                          handleLlmTemperatureChange(event.target.value)
                        }
                        placeholder="留空使用默认值"
                        helperText={`范围 ${MIN_LLM_TEMPERATURE}-${MAX_LLM_TEMPERATURE}，建议留空以兼容更严格的模型。`}
                        autoComplete="off"
                        spellCheck={false}
                        inputProps={{
                          min: MIN_LLM_TEMPERATURE,
                          max: MAX_LLM_TEMPERATURE,
                          step: LLM_TEMPERATURE_STEP,
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

                    {renderCardSaveAction("保存高级选项")}
                  </Stack>
                </CardContent>
              </Card>
            </Stack>

            <Stack spacing={3}>
              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={2.75}>
                    <Box>
                      <Typography variant="h5">快捷操作</Typography>
                      <Typography variant="body2" color="text.secondary">
                        把最常用的保存、测试和排障入口收在一起，减少来回滚动查找。
                      </Typography>
                    </Box>

                    <Box
                      ref={saveButtonRef}
                      sx={{
                        p: 2,
                        borderRadius: "24px",
                        border: "1px solid",
                        borderColor: alpha(theme.palette.primary.main, 0.16),
                        background: `linear-gradient(135deg, ${alpha(
                          theme.palette.primary.main,
                          0.14
                        )} 0%, ${alpha(theme.palette.background.paper, 0.96)} 100%)`,
                      }}
                    >
                      <Stack spacing={1.5}>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          justifyContent="space-between"
                        >
                          <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                              主操作
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              完成修改后优先在这里保存，避免配置和界面状态不同步。
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            color={dirty ? "warning" : "success"}
                            label={dirty ? "有未保存修改" : "已同步"}
                          />
                        </Stack>

                        <Button
                          fullWidth
                          size="large"
                          variant="contained"
                          startIcon={<SaveRoundedIcon />}
                          onClick={handleSaveConfig}
                          sx={{
                            minHeight: 56,
                            borderRadius: "18px",
                            fontWeight: 700,
                            boxShadow: "0 18px 36px rgba(15, 23, 42, 0.14)",
                          }}
                        >
                          保存全部设置
                        </Button>
                      </Stack>
                    </Box>

                    <Box>
                      <Typography
                        variant="overline"
                        sx={{
                          display: "block",
                          mb: 1.25,
                          fontWeight: 800,
                          letterSpacing: "0.08em",
                          color: "text.secondary",
                        }}
                      >
                        测试与排障
                      </Typography>

                      <Box
                        sx={{
                          display: "grid",
                          gap: 1.25,
                          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                        }}
                      >
                        <Button
                          variant="outlined"
                          onClick={handleTestToken}
                          sx={{
                            minHeight: 88,
                            px: 2,
                            py: 1.5,
                            borderRadius: "20px",
                            justifyContent: "flex-start",
                            textAlign: "left",
                            borderColor: alpha(theme.palette.divider, 0.9),
                          }}
                        >
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              测试 Canvas Token
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              快速确认账号令牌是否可用
                            </Typography>
                          </Stack>
                        </Button>

                        <Button
                          variant="outlined"
                          onClick={handleTestApiKey}
                          startIcon={<AutoAwesomeRoundedIcon />}
                          sx={{
                            minHeight: 88,
                            px: 2,
                            py: 1.5,
                            borderRadius: "20px",
                            justifyContent: "flex-start",
                            textAlign: "left",
                            borderColor: alpha(theme.palette.divider, 0.9),
                          }}
                        >
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              测试 LLM 连接
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              验证 Base URL、Model 与 API Key
                            </Typography>
                          </Stack>
                        </Button>

                        <Button
                          variant="outlined"
                          onClick={handleOpenConfigDir}
                          startIcon={<FolderOpenRoundedIcon />}
                          sx={{
                            minHeight: 88,
                            px: 2,
                            py: 1.5,
                            borderRadius: "20px",
                            justifyContent: "flex-start",
                            textAlign: "left",
                            borderColor: alpha(theme.palette.divider, 0.9),
                          }}
                        >
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              打开配置目录
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              查看配置文件与本地存储位置
                            </Typography>
                          </Stack>
                        </Button>

                        <Button
                          variant="outlined"
                          onClick={() => setShowLogModal(true)}
                          startIcon={<PreviewRoundedIcon />}
                          sx={{
                            minHeight: 88,
                            px: 2,
                            py: 1.5,
                            borderRadius: "20px",
                            justifyContent: "flex-start",
                            textAlign: "left",
                            borderColor: alpha(theme.palette.divider, 0.9),
                          }}
                        >
                          <Stack spacing={0.5} alignItems="flex-start">
                            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                              查看运行日志
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              排查登录、下载和接口调用异常
                            </Typography>
                          </Stack>
                        </Button>
                      </Box>
                    </Box>
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
