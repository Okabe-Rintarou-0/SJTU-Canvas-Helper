import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
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
  Autocomplete,
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
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Link as MuiLink,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import { ProviderIcon } from "@lobehub/icons";
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

const URL_PROVIDER_MAP: [RegExp, string][] = [
  [/deepseek/, "deepseek"],
  [/moonshot/, "moonshot"],
  [/openai/, "openai"],
  [/anthropic/, "anthropic"],
  [/zhipu/, "zhipu"],
  [/glm/, "zhipu"],
  [/bigmodel/, "zhipu"],
  [/baidu/, "baidu"],
  [/qianfan/, "baidu"],
  [/qwen/, "qwen"],
  [/aliyun/, "qwen"],
  [/dashscope/, "qwen"],
  [/hunyuan/, "tencent"],
  [/tencent/, "tencent"],
  [/doubao/, "doubao"],
  [/ark/, "doubao"],
  [/xai/, "xai"],
  [/grok/, "xai"],
  [/groq/, "groq"],
  [/together/, "togetherai"],
  [/perplexity/, "perplexity"],
  [/mistral/, "mistral"],
  [/cohere/, "cohere"],
  [/fireworks/, "fireworksai"],
  [/ollama/, "ollama"],
  [/mimo/, "xiaomimimo"],
  [/xiaomi/, "xiaomimimo"],
  [/minimax/, "minimax"],
];

const PROVIDER_PRESETS: { key: string; name: string; baseUrl: string }[] = [
  { key: "", name: "其他 (手动填写)", baseUrl: "" },
  { key: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  { key: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { key: "moonshot", name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/v1" },
  { key: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { key: "zhipu", name: "智谱 (Zhipu)", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { key: "baidu", name: "百度千帆", baseUrl: "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat" },
  { key: "qwen", name: "阿里通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { key: "tencent", name: "腾讯混元", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1" },
  { key: "doubao", name: "字节豆包", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  { key: "xai", name: "xAI (Grok)", baseUrl: "https://api.x.ai/v1" },
  { key: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { key: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai" },
  { key: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { key: "cohere", name: "Cohere", baseUrl: "https://api.cohere.com/v1" },
  { key: "ollama", name: "Ollama (本地)", baseUrl: "http://localhost:11434/v1" },
  { key: "xiaomimimo", name: "小米 (Xiaomi MiMo)", baseUrl: "https://api.xiaomimimo.com/v1" },
  { key: "minimax", name: "MiniMax (海螺AI)", baseUrl: "https://api.minimax.chat/v1" },
];

function detectProviderKey(baseUrl: string): string | null {
  const url = baseUrl.toLowerCase();
  for (const [rx, key] of URL_PROVIDER_MAP) {
    if (rx.test(url)) return key;
  }
  return null;
}

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
  const [showNewKeyValue, setShowNewKeyValue] = useState<boolean>(false);
  const [showAddKeyDialog, setShowAddKeyDialog] = useState<boolean>(false);
  const [newKeyName, setNewKeyName] = useState<string>("");
  const [newKeyValue, setNewKeyValue] = useState<string>("");
  const [newKeyProvider, setNewKeyProvider] = useState<string>("");
  const [newKeyBaseUrl, setNewKeyBaseUrl] = useState<string>("");
  const [newKeyModel, setNewKeyModel] = useState<string>("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingBaseUrl, setEditingBaseUrl] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string>("");
  const [savePathError, setSavePathError] = useState<string>("");
  const modelsCache = useRef<Record<string, string[]>>({});
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchModels = useCallback(async (baseUrl: string, apiKey?: string) => {
    if (!baseUrl.trim()) return;
    const cacheKey = baseUrl.replace(/\/+$/, "");
    if (modelsCache.current[cacheKey]) {
      setModelOptions(modelsCache.current[cacheKey]);
      return;
    }
    setLoadingModels(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const url = `${cacheKey}/models`;
      const headers: Record<string, string> = { "Accept": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const resp = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      const models: string[] = (body.data ?? []).map((m: { id: string }) => m.id).filter(Boolean);
      modelsCache.current[cacheKey] = models;
      const preferred = (id: string) => /chat|latest|instruct|turbo|plus|flash|pro|4o|reasoner/i.test(id) ? 0 : 1;
      setModelOptions(models.sort((a, b) => preferred(a) - preferred(b) || a.localeCompare(b)).slice(0, 100));
    } catch {
      setModelOptions([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);
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
        if (key === "theme" || key === "color_primary" || key === "compact_mode" || key === "debug_mode") {
          dispatch(updateConfig(next));
        }
        return next;
      });
    },
    [dispatch]
  );

  // Auto-save debug_mode immediately on toggle
  const prevDebugModeRef = useRef(formData?.debug_mode);
  useEffect(() => {
    if (!formData) return;
    if (prevDebugModeRef.current !== undefined && prevDebugModeRef.current !== formData.debug_mode) {
      prevDebugModeRef.current = formData.debug_mode;
      saveConfig(formData).then(
        () => messageApi.success(formData.debug_mode ? "Debug 模式已开启" : "Debug 模式已关闭"),
        (e) => messageApi.error("保存失败：" + e)
      );
    } else {
      prevDebugModeRef.current = formData.debug_mode;
    }
  }, [formData?.debug_mode]);

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
        mcp_enabled: config.mcp_enabled ?? false,
        mcp_port: config.mcp_port || 3100,
        proxy_port: config.proxy_port === 0 ? DEFAULT_PROXY_PORT : config.proxy_port,
        llm_api_keys: config.llm_api_keys ?? [],
        llm_active_api_key: config.llm_active_api_key ?? "",
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

  const handleCheckBalance = async () => {
    if (!formData) return;
    const entry = formData.llm_api_keys.find((k) => k.name === formData.llm_active_api_key);
    if (!entry) return;
    const baseUrl = entry.base_url || formData.llm_base_url || "";
    const apiKey = entry.key || formData.llm_api_key || "";
    const provider = detectProviderKey(baseUrl) || "unknown";
    try {
      messageApi.open({ key: "bal", type: "loading", content: "查询余额中…", duration: 0 });
      const resp = await invoke<{
        available_balance: number;
        voucher_balance?: number;
        cash_balance?: number;
      }>("check_balance", { baseUrl, apiKey, provider });
      messageApi.destroy("bal");
      const parts = [`可用余额: ¥${resp.available_balance.toFixed(2)}`];
      if (resp.voucher_balance !== undefined) {
        parts.push(`赠送余额: ¥${resp.voucher_balance.toFixed(2)}`);
      }
      if (resp.cash_balance !== undefined) {
        parts.push(`现金余额: ¥${resp.cash_balance.toFixed(2)}`);
      }
      messageApi.success(parts.join(" | "));
    } catch (e) {
      messageApi.destroy("bal");
      messageApi.error(e as string);
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

                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                        API Key 管理
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        添加多个 API Key 并命名，方便在多个账号之间切换。
                      </Typography>

                      <Box sx={{ display: "flex", gap: 2, alignItems: "center", mb: 3 }}>
                        <TextField
                          select
                          fullWidth
                          label="当前使用的 API Key"
                          name="llm_active_api_key"
                          value={formData?.llm_active_api_key ?? ""}
                          onChange={async (event) => {
                            const name = event.target.value;
                            const entry = formData?.llm_api_keys.find((k) => k.name === name);
                            if (!formData || !entry) return;
                            const next = {
                              ...formData,
                              llm_active_api_key: name,
                              llm_api_key: entry.key,
                              ...(entry.base_url ? { llm_base_url: entry.base_url } : {}),
                              ...(entry.model ? { llm_model: entry.model } : {}),
                            };
                            setFormData(next);
                            setEditingName(null);
                            setEditingKey(null);
                            setEditingBaseUrl(null);
                            setEditingModel(null);
                            try {
                              await saveConfig(next);
                            } catch (e) {
                              messageApi.error(e as string);
                            }
                          }}
                        >
                          {(formData?.llm_api_keys ?? []).length === 0 ? (
                            <MenuItem value="" disabled>
                              暂无已添加的 Key
                            </MenuItem>
                          ) : (
                            (formData?.llm_api_keys ?? []).map((entry) => {
                              const pv = detectProviderKey(entry.base_url || (formData?.llm_base_url ?? ""));
                              return (
                                <MenuItem key={entry.name} value={entry.name}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    {pv ? <ProviderIcon provider={pv} size={22} /> : null}
                                    <Typography variant="body2">{entry.name}</Typography>
                                  </Box>
                                </MenuItem>
                              );
                            })
                          )}
                        </TextField>

                        <Button
                          variant="outlined"
                          onClick={() => setShowAddKeyDialog(true)}
                          sx={{ minWidth: 100, whiteSpace: "nowrap" }}
                        >
                          添加 Key
                        </Button>
                      </Box>

                      {(formData?.llm_api_keys ?? []).length > 0 && formData?.llm_active_api_key ? (
                        (() => {
                          const entry = formData.llm_api_keys.find((k) => k.name === formData.llm_active_api_key);
                          if (!entry) return null;
                          const pv = detectProviderKey(entry.base_url || (formData?.llm_base_url ?? ""));
                          return (
                            <Box
                              sx={{
                                p: 3,
                                borderRadius: "16px",
                                border: "1px solid",
                                borderColor: "primary.main",
                                bgcolor: alpha(theme.palette.primary.main, 0.06),
                              }}
                            >
                              <Stack spacing={2.5}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                                  {pv ? <ProviderIcon provider={pv} size={32} /> : null}
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    {entry.name}
                                  </Typography>
                                </Box>
                                <TextField
                                  label="名称"
                                  size="small"
                                  value={editingName ?? entry.name}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onBlur={async () => {
                                    if (!editingName?.trim() || !formData) return;
                                    const updated = formData.llm_api_keys.map((k) =>
                                      k.name === entry.name ? { ...k, name: editingName.trim() } : k
                                    );
                                    const newActive = formData.llm_active_api_key === entry.name ? editingName.trim() : formData.llm_active_api_key;
                                    const next = { ...formData, llm_api_keys: updated, llm_active_api_key: newActive };
                                    setFormData(next);
                                    try { await saveConfig(next); } catch (e) { messageApi.error(e as string); }
                                  }}
                                  placeholder="Key 名称"
                                  autoComplete="off"
                                />
                                <TextField
                                  label="API Key"
                                  size="small"
                                  type={showNewKeyValue ? "text" : "password"}
                                  value={editingKey ?? entry.key}
                                  onChange={(e) => setEditingKey(e.target.value)}
                                  onBlur={async () => {
                                    if (!formData || editingKey === null) return;
                                    const keyName = editingName?.trim() || entry.name;
                                    const keyVal = editingKey.trim();
                                    if (!keyVal) return;
                                    const updated = formData.llm_api_keys.map((k) =>
                                      k.name === keyName ? { ...k, key: keyVal } : k
                                    );
                                    const next = { ...formData, llm_api_keys: updated, llm_api_key: keyVal };
                                    setFormData(next);
                                    try { await saveConfig(next); } catch (e) { messageApi.error(e as string); }
                                  }}
                                  placeholder="sk-…"
                                  autoComplete="off"
                                  spellCheck={false}
                                  InputProps={{
                                    endAdornment: (
                                      <InputAdornment position="end">
                                        <Tooltip title={showNewKeyValue ? "隐藏" : "显示"}>
                                          <IconButton
                                            size="small"
                                            onClick={() => setShowNewKeyValue((prev) => !prev)}
                                            edge="end"
                                          >
                                            {showNewKeyValue ? (
                                              <VisibilityOffRoundedIcon fontSize="small" />
                                            ) : (
                                              <VisibilityRoundedIcon fontSize="small" />
                                            )}
                                          </IconButton>
                                        </Tooltip>
                                      </InputAdornment>
                                    ),
                                  }}
                                />
                                <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "1fr 1fr" }}>
                                  <TextField
                                    label="Base URL"
                                    size="small"
                                    value={editingBaseUrl ?? (entry.base_url || (formData?.llm_base_url ?? ""))}
                                    onChange={(e) => setEditingBaseUrl(e.target.value)}
                                    onBlur={async () => {
                                      if (!formData || editingBaseUrl === null) return;
                                      const keyName = editingName?.trim() || entry.name;
                                      const val = editingBaseUrl.trim();
                                      const updated = formData.llm_api_keys.map((k) =>
                                        k.name === keyName ? { ...k, base_url: val } : k
                                      );
                                      const next = {
                                        ...formData,
                                        llm_api_keys: updated,
                                        ...(val ? { llm_base_url: val } : {}),
                                      };
                                      setFormData(next);
                                      try { await saveConfig(next); } catch (e) { messageApi.error(e as string); }
                                    }}
                                    placeholder={formData?.llm_base_url || "https://api.deepseek.com/v1"}
                                    autoComplete="off"
                                  />
                                  <Autocomplete
                                    freeSolo
                                    size="small"
                                    loading={loadingModels}
                                    options={modelOptions}
                                    value={editingModel ?? (entry.model || (formData?.llm_model ?? ""))}
                                    onInputChange={(_e, val) => setEditingModel(val)}
                                    onChange={(_e, val) => {
                                      const v = typeof val === "string" ? val : "";
                                      setEditingModel(v);
                                    }}
                                    onOpen={() => {
                                      const url = entry.base_url || formData?.llm_base_url || "";
                                      if (url) fetchModels(url, entry.key || formData?.llm_api_key);
                                    }}
                                    onBlur={async () => {
                                      if (!formData) return;
                                      if (editingModel === null) return;
                                      const keyName = editingName?.trim() || entry.name;
                                      const val = editingModel.trim();
                                      const updated = formData.llm_api_keys.map((k) =>
                                        k.name === keyName ? { ...k, model: val } : k
                                      );
                                      const next = { ...formData, llm_api_keys: updated, ...(val ? { llm_model: val } : {}) };
                                      setFormData(next);
                                      try { await saveConfig(next); } catch (e) { messageApi.error(e as string); }
                                    }}
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        label="Model"
                                        placeholder={formData?.llm_model || "deepseek-chat"}
                                      />
                                    )}
                                  />
                                </Box>
                                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AutoAwesomeRoundedIcon />}
                                    onClick={handleTestApiKey}
                                  >
                                    测试连接
                                  </Button>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AccountBalanceWalletRoundedIcon />}
                                    onClick={handleCheckBalance}
                                  >
                                    查询余额
                                  </Button>
                                  <Button
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    startIcon={<DeleteOutlineRoundedIcon />}
                                    onClick={() => {
                                      const next = (formData?.llm_api_keys ?? []).filter(
                                        (k) => k.name !== entry.name
                                      );
                                      updateField("llm_api_keys", next);
                                      if (formData?.llm_active_api_key === entry.name) {
                                        const first = next[0];
                                        updateField("llm_active_api_key", first?.name ?? "");
                                        updateField("llm_api_key", first?.key ?? "");
                                        if (first?.base_url) updateField("llm_base_url", first.base_url);
                                        if (first?.model) updateField("llm_model", first.model);
                                      }
                                    }}
                                  >
                                    删除此 Key
                                  </Button>
                                </Box>
                              </Stack>
                            </Box>
                          );
                        })()
                      ) : null}
                    </Box>

                    <Dialog
                      open={showAddKeyDialog}
                      onClose={() => {
                        setNewKeyName("");
                        setNewKeyValue("");
                        setNewKeyProvider("");
                        setNewKeyBaseUrl("");
                        setNewKeyModel("");
                        setShowAddKeyDialog(false);
                      }}
                      fullWidth
                      maxWidth="sm"
                    >
                      <DialogTitle>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                          {detectProviderKey(newKeyBaseUrl || formData?.llm_base_url || "") ? (
                            <ProviderIcon provider={detectProviderKey(newKeyBaseUrl || formData?.llm_base_url || "")!} size={28} />
                          ) : (
                            <Box sx={{ width: 28, height: 28, borderRadius: "7px", bgcolor: "#6B7280", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.7rem", fontWeight: 800 }}>
                              ?
                            </Box>
                          )}
                          <span>添加 API Key</span>
                        </Box>
                      </DialogTitle>
                      <DialogContent>
                        <Stack spacing={2} sx={{ mt: 1 }}>
                          <TextField
                            select
                            fullWidth
                            label="服务商"
                            value={newKeyProvider}
                            onChange={(e) => {
                              const val = e.target.value;
                              setNewKeyProvider(val);
                              const preset = PROVIDER_PRESETS.find((p) => p.key === val);
                              if (preset && preset.baseUrl) {
                                setNewKeyBaseUrl(preset.baseUrl);
                                setNewKeyModel("");
                              } else {
                                setNewKeyBaseUrl("");
                              }
                            }}
                            helperText="选择主流服务商后自动填入 Base URL 和 Model 建议。"
                          >
                            {PROVIDER_PRESETS.map((p) => (
                              <MenuItem key={p.key} value={p.key}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                  {p.key ? <ProviderIcon provider={p.key} size={20} /> : null}
                                  <Typography variant="body2">{p.name}</Typography>
                                </Box>
                              </MenuItem>
                            ))}
                          </TextField>
                          <TextField
                            label="名称"
                            name="new_key_name"
                            value={newKeyName}
                            onChange={(event) => setNewKeyName(event.target.value)}
                            placeholder="例如：strong_model, weak_model"
                            helperText="起一个好记的名字，方便后续在列表中切换。"
                            autoComplete="off"
                          />
                          <TextField
                            label="API Key"
                            name="new_key_value"
                            type={showNewKeyValue ? "text" : "password"}
                            value={newKeyValue}
                            onChange={(event) => setNewKeyValue(event.target.value)}
                            placeholder="sk-…"
                            autoComplete="off"
                            spellCheck={false}
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end">
                                  <Tooltip title={showNewKeyValue ? "隐藏" : "显示"}>
                                    <IconButton
                                      onClick={() => setShowNewKeyValue((prev) => !prev)}
                                      edge="end"
                                    >
                                      {showNewKeyValue ? (
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
                          <TextField
                            label="Base URL"
                            name="new_key_base_url"
                            value={newKeyBaseUrl}
                            onChange={(event) => {
                              setNewKeyBaseUrl(event.target.value);
                              setNewKeyProvider("");
                            }}
                            placeholder={formData?.llm_base_url || "https://api.deepseek.com"}
                            helperText={
                              detectProviderKey(newKeyBaseUrl || formData?.llm_base_url || "")
                                ? `检测到：${detectProviderKey(newKeyBaseUrl || formData?.llm_base_url || "")!}`
                                : "留空使用全局 LLM Base URL。"
                            }
                            autoComplete="off"
                          />
                          <Autocomplete
                            freeSolo
                            fullWidth
                            loading={loadingModels}
                            options={modelOptions}
                            value={newKeyModel}
                            onInputChange={(_e, val) => setNewKeyModel(val)}
                            onOpen={() => {
                              const url = newKeyBaseUrl || formData?.llm_base_url || "";
                              if (url) fetchModels(url, newKeyValue || formData?.llm_api_key);
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label="Model"
                                placeholder={formData?.llm_model || "deepseek-chat"}
                                helperText="可输入任意模型名，或从建议中选择。"
                              />
                            )}
                          />
                        </Stack>
                      </DialogContent>
                      <DialogActions sx={{ px: 3, pb: 2 }}>
                        <Button onClick={() => setShowAddKeyDialog(false)}>取消</Button>
                        <Button
                          variant="contained"
                          disabled={!newKeyName.trim() || !newKeyValue.trim()}
                          onClick={async () => {
                            const name = newKeyName.trim();
                            const key = newKeyValue.trim();
                            const current = formData?.llm_api_keys ?? [];
                            if (current.some((k) => k.name === name)) {
                              messageApi.error("名称已存在，请使用不同的名称。");
                              return;
                            }
                            const baseUrl = newKeyBaseUrl.trim();
                            const model = newKeyModel.trim();
                            const updated = [
                              ...current,
                              { name, key, base_url: baseUrl, model },
                            ];
                            const next = {
                              ...formData!,
                              llm_api_keys: updated,
                              llm_active_api_key: name,
                              llm_api_key: key,
                              ...(baseUrl ? { llm_base_url: baseUrl } : {}),
                              ...(model ? { llm_model: model } : {}),
                            };
                            setFormData(next);
                            setNewKeyName("");
                            setNewKeyValue("");
                            setNewKeyProvider("");
                            setNewKeyBaseUrl("");
                            setNewKeyModel("");
                            setShowAddKeyDialog(false);
                            try {
                              await saveConfig(next);
                              messageApi.success(`已添加 API Key「${name}」。`);
                            } catch (e) {
                              messageApi.error(e as string);
                            }
                          }}
                        >
                          添加
                        </Button>
                      </DialogActions>
                    </Dialog>

                    <Box sx={{ maxWidth: 220 }}>
                      <TextField
                        label="Temperature"
                        name="llm_temperature"
                        type="number"
                        fullWidth
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

                    <Divider />
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                        Debug 模式
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        开启后，左侧导航栏将显示 Debug 控制台入口，自动记录最近 1000 条网络请求（请求头、请求体、响应状态），方便排查问题。
                      </Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={formData?.debug_mode ?? false}
                            onChange={(event) =>
                              updateField("debug_mode", event.target.checked)
                            }
                          />
                        }
                        label="启用 Debug 模式"
                      />
                    </Box>
                    <Divider />
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                        MCP Server
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {`MCP（Model Context Protocol）服务器可将 Canvas 数据能力开放给 AI 客户端。开启后默认运行在 localhost:${formData?.mcp_port ?? 3100}。`}
                      </Typography>
                      <Box
                        sx={{
                          display: "grid",
                          gap: 2,
                          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "1fr 180px" },
                          alignItems: "center",
                        }}
                      >
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData?.mcp_enabled ?? false}
                              onChange={(event) =>
                                updateField("mcp_enabled", event.target.checked)
                              }
                            />
                          }
                          label="启用 MCP Server"
                        />
                        <TextField
                          label="MCP 端口"
                          name="mcp_port"
                          type="number"
                          value={formData?.mcp_port ?? 3100}
                          onChange={(event) => {
                            const port = parseInt(event.target.value, 10);
                            if (!isNaN(port) && port > 0 && port < 65536) {
                              updateField("mcp_port", port);
                            }
                          }}
                          disabled={!formData?.mcp_enabled}
                          helperText="默认 3100"
                          inputProps={{ min: 1024, max: 65535 }}
                        />
                      </Box>
                    </Box>

                    <Box
                      sx={{
                        p: 2,
                        borderRadius: "18px",
                        bgcolor: alpha(theme.palette.background.default, 0.6),
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      <Stack spacing={1}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          复制 MCP 连接配置
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          粘贴到 opencode / Claude Desktop / Cline 等支持 MCP 的 AI 客户端即可自动接入。MCP 服务器仅监听本机，无需额外鉴权。
                        </Typography>
                        <TextField
                          multiline
                          fullWidth
                          minRows={9}
                          maxRows={16}
                          sx={{
                            "& .MuiInputBase-root": { fontFamily: "monospace", fontSize: "0.8125rem", lineHeight: 1.6 },
                          }}
                          value={(() => {
                            if (!formData?.token) return "// 请先配置 Canvas Token 并保存";
                            const config = {
                              mcpServers: {
                                "sjtu-canvas": {
                                  type: "sse",
                                  url: `http://localhost:${formData.mcp_port ?? 3100}`,
                                },
                              },
                            };
                            return [
                              "我现在在本机运行了一个 Canvas MCP 服务器。",
                              "请帮我做以下几件事：",
                              "1. 读取下面的 MCP 服务器配置，连接到 MCP Server",
                              "2. 连接成功后，调用 list_courses 工具列出我的所有 Canvas 课程",
                              "3. 检查有无临近截止的作业，并提醒我",
                              "",
                              "MCP 配置如下：",
                              JSON.stringify(config, null, 2),
                            ].join("\n");
                          })()}
                          slotProps={{
                            input: {
                              readOnly: true,
                              endAdornment: formData?.token ? (
                                <InputAdornment position="end">
                                  <IconButton
                                    size="small"
                                    onClick={() => {
                                    const config = {
                                      mcpServers: {
                                        "sjtu-canvas": {
                                          type: "streamable-http",
                                          url: `http://localhost:${formData?.mcp_port ?? 3100}`,
                                        },
                                      },
                                    };
                                    const text = [
                                      "我现在在本机运行了一个 Canvas MCP 服务器。",
                                      "请帮我做以下几件事：",
                                      "1. 读取下面的 MCP 服务器配置，连接到 MCP Server",
                                      "2. 连接成功后，调用 list_courses 工具列出我的所有 Canvas 课程",
                                      "3. 检查有无临近截止的作业，并提醒我",
                                      "",
                                      "MCP 配置如下：",
                                      JSON.stringify(config, null, 2),
                                    ].join("\n");
                                    navigator.clipboard.writeText(text).then(
                                      () => messageApi.success("已复制！"),
                                      () => messageApi.error("复制失败")
                                    );
                                  }}
                                >
                                  <ContentCopyRoundedIcon />
                                </IconButton>
                              </InputAdornment>
                              ) : undefined,
                            },
                          }}
                        />
                      </Stack>
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
