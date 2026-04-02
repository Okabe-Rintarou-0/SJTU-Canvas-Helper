import AccountCircleRoundedIcon from "@mui/icons-material/AccountCircleRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import KeyRoundedIcon from "@mui/icons-material/KeyRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SettingsSuggestRoundedIcon from "@mui/icons-material/SettingsSuggestRounded";
import SmartToyRoundedIcon from "@mui/icons-material/SmartToyRounded";
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
  CssBaseline,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Link as MuiLink,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { ThemeProvider, alpha, createTheme } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { TourProps } from "antd";
import { Image, Tour } from "antd";
import useMessage from "antd/es/message/useMessage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactJson from "react-json-view-ts";

import BasicLayout from "../components/layout";
import LogModal from "../components/log_modal";
import { getConfig, saveConfig } from "../lib/config";
import { AccountInfo, AppConfig, LOG_LEVEL_INFO, User } from "../lib/model";
import { consoleLog, savePathValidator } from "../lib/utils";

type AccountMode = "create" | "select";

const SURFACE_RADIUS = 6;
const DEFAULT_PRIMARY = "#00b96b";
const DEFAULT_PROXY_PORT = 3030;

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

export default function SettingsPage() {
  const [messageApi, contextHolder] = useMessage();
  const tokenFieldRef = useRef<HTMLDivElement>(null);
  const savePathFieldRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLDivElement>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [openTour, setOpenTour] = useState<boolean>(false);
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

  const steps: TourProps["steps"] = [
    {
      title: "填写您的 Canvas Token",
      description: (
        <div>
          <p>
            请前往{" "}
            <a
              href="https://oc.sjtu.edu.cn/profile/settings"
              target="_blank"
              rel="noreferrer"
            >
              https://oc.sjtu.edu.cn/profile/settings
            </a>{" "}
            创建您的 API Token。
          </p>
          <Image alt="Canvas Token 指引" src="help.png" width={360} />
        </div>
      ),
      target: () => tokenFieldRef.current!,
    },
    {
      title: "填写您的下载保存目录",
      description: "请正确填写您的下载保存目录。",
      target: () => savePathFieldRef.current!,
    },
    {
      title: "保存",
      description: "保存您的设置。",
      target: () => saveButtonRef.current!,
    },
  ];

  const muiTheme = useMemo(() => {
    const mode = formData?.theme ?? "light";
    const primary = formData?.color_primary || DEFAULT_PRIMARY;

    return createTheme({
      palette: {
        mode,
        primary: {
          main: primary,
        },
        secondary: {
          main: "#1d4ed8",
        },
        background:
          mode === "dark"
            ? {
              default: "#08111c",
              paper: alpha("#0f172a", 0.92),
            }
            : {
              default: "#f5f8fc",
              paper: "#ffffff",
            },
      },
      shape: {
        borderRadius: SURFACE_RADIUS * 2,
      },
      typography: {
        fontFamily:
          '"SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
        h3: {
          fontWeight: 700,
        },
        h5: {
          fontWeight: 700,
        },
        h6: {
          fontWeight: 700,
        },
      },
      components: {
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 999,
              textTransform: "none",
              paddingInline: 18,
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              backgroundImage: "none",
            },
          },
        },
        MuiTextField: {
          defaultProps: {
            fullWidth: true,
            variant: "outlined",
          },
        },
      },
    });
  }, [formData?.color_primary, formData?.theme]);

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
      setFormData((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    []
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
      setTokenError("");
      setSavePathError("");
      consoleLog(LOG_LEVEL_INFO, "init config: ", normalizedConfig);

      if (normalizedConfig.token.length === 0) {
        setOpenTour(true);
      }
    } catch (e) {
      messageApi.error(`初始化时发生错误：${e}`);
    }
  };

  useEffect(() => {
    initConfig();
  }, []);

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

  const summaryItems = [
    {
      label: "当前账号",
      value: currentAccount || "未选择",
      icon: <AccountCircleRoundedIcon fontSize="small" />,
    },
    {
      label: "主题模式",
      value: formData?.theme === "dark" ? "深色" : "明亮",
      icon: <ColorLensRoundedIcon fontSize="small" />,
    },
    {
      label: "下载目录",
      value: formData?.save_path ? "已配置" : "待配置",
      icon: <FolderOpenRoundedIcon fontSize="small" />,
    },
    {
      label: "智能功能",
      value: formData?.llm_api_key ? "已接入" : "未接入",
      icon: <SmartToyRoundedIcon fontSize="small" />,
    },
  ];

  return (
    <BasicLayout>
      {contextHolder}
      <ThemeProvider theme={muiTheme}>
        <CssBaseline enableColorScheme />
        <Box
          sx={{
            minHeight: "100%",
            color: "text.primary",
          }}
        >
          <Stack spacing={3}>
            <Paper
              sx={{
                ...cardSx,
                overflow: "hidden",
                position: "relative",
                px: { xs: 2.5, md: 4 },
                py: { xs: 3, md: 4 },
                background:
                  muiTheme.palette.mode === "dark"
                    ? `linear-gradient(135deg, ${alpha(
                      muiTheme.palette.primary.main,
                      0.26
                    )}, ${alpha("#0f172a", 0.96)})`
                    : `linear-gradient(135deg, ${alpha(
                      muiTheme.palette.primary.main,
                      0.16
                    )}, ${alpha("#eff6ff", 0.94)})`,
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "radial-gradient(circle at top right, rgba(255,255,255,0.28), transparent 30%), radial-gradient(circle at bottom left, rgba(255,255,255,0.14), transparent 20%)",
                  pointerEvents: "none",
                }}
              />
              <Stack
                direction={{ xs: "column", lg: "row" }}
                justifyContent="center"
                spacing={3}
                sx={{ position: "relative" }}
              >
                <Stack spacing={1.5} maxWidth={760} sx={{ width: "100%", flex: 1 }}>
                  <Chip
                    icon={<SettingsSuggestRoundedIcon />}
                    label="设置中心"
                    color="primary"
                    variant="outlined"
                    sx={{
                      ...fullWidthChipSx,
                      bgcolor: alpha(muiTheme.palette.background.paper, 0.48),
                      borderColor: alpha(muiTheme.palette.primary.main, 0.32),
                    }}
                  />
                </Stack>

                <Box
                  sx={{
                    width: "100%",
                    maxWidth: { lg: 380 },
                    display: "grid",
                    gap: 1.5,
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  }}
                >
                  {summaryItems.map((item) => (
                    <Card
                      key={item.label}
                      sx={{
                        borderRadius: "24px",
                        bgcolor: alpha(muiTheme.palette.background.paper, 0.62),
                        backdropFilter: "blur(18px)",
                        border: "1px solid",
                        borderColor: alpha(muiTheme.palette.common.white, 0.1),
                      }}
                    >
                      <CardContent sx={{ p: 2.2 }}>
                        <Stack spacing={1.2}>
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={1}
                            sx={{ width: "100%" }}
                          >
                            <Box
                              sx={{
                                flexShrink: 0,
                                display: "grid",
                                placeItems: "center",
                                width: 36,
                                height: 36,
                                borderRadius: "14px",
                                bgcolor: alpha(muiTheme.palette.primary.main, 0.14),
                                color: "primary.main",
                              }}
                            >
                              {item.icon}
                            </Box>
                            <Chip
                              size="small"
                              label={item.value}
                              sx={{
                                ...fullWidthChipSx,
                                flex: 1,
                                bgcolor: alpha(
                                  muiTheme.palette.background.default,
                                  0.72
                                ),
                              }}
                            />
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {item.label}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              </Stack>
            </Paper>

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
                    <Stack spacing={2.5}>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        justifyContent="space-between"
                        spacing={1.5}
                        sx={{ width: "100%" }}
                      >
                        <Box>
                          <Typography variant="h5">账号与身份</Typography>
                          <Typography variant="body2" color="text.secondary">
                            为不同使用场景准备独立账号配置，避免 Token 和保存目录互相覆盖。
                          </Typography>
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
                    </Stack>
                  </CardContent>
                </Card>

                <Card sx={cardSx}>
                  <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                    <Stack spacing={3}>
                      <Box>
                        <Typography variant="h5">Canvas 连接</Typography>
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
                          href="https://oc.sjtu.edu.cn/profile/settings"
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

                      <FormControlLabel
                        control={
                          <Switch
                            checked={formData?.compact_mode ?? false}
                            onChange={(event) =>
                              updateField("compact_mode", event.target.checked)
                            }
                          />
                        }
                        label="启用紧凑模式"
                        sx={{ m: 0 }}
                      />
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
                            bgcolor: alpha(muiTheme.palette.background.default, 0.72),
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
                    borderColor: alpha(muiTheme.palette.error.main, 0.24),
                    bgcolor: alpha(muiTheme.palette.error.main, 0.04),
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
          {openTour && (
            <Tour open={openTour} onClose={() => setOpenTour(false)} steps={steps} />
          )}
        </Box>
      </ThemeProvider>
    </BasicLayout>
  );
}
