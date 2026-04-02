import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import MovieCreationRoundedIcon from "@mui/icons-material/MovieCreationRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import SlideshowRoundedIcon from "@mui/icons-material/SlideshowRounded";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";
import {
  alpha,
  Button,
  CircularProgress,
  Card,
  CardContent,
  Chip,
  Divider,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import ReactAnsi from "react-ansi";

import { useAppMessage } from "../lib/message";
import { LOG_LEVEL_INFO, VideoAggregateParams } from "../lib/model";
import { consoleLog } from "../lib/utils";
import { PathSelector } from "./path_selector";

const appWindow = getCurrentWebviewWindow();

type FfmpegState = "unknown" | "installed" | "uninstalled";

const DEFAULT_SUB_VIDEO_SIZE_PERCENTAGE = 25;
const DEFAULT_SUB_VIDEO_ALPHA = 100;

function ffmpegStateMeta(state: FfmpegState) {
  switch (state) {
    case "installed":
      return {
        label: "已安装",
        color: "success" as const,
        icon: <CheckCircleRoundedIcon />,
      };
    case "uninstalled":
      return {
        label: "未安装",
        color: "error" as const,
        icon: <ErrorOutlineRoundedIcon />,
      };
    default:
      return {
        label: "未知",
        color: "default" as const,
        icon: <HelpOutlineRoundedIcon />,
      };
  }
}

export default function VideoAggregator() {
  const theme = useTheme();
  const [ffmpegState, setFfmpegState] = useState<FfmpegState>("unknown");
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [messageApi] = useAppMessage();
  const [formData, setFormData] = useState<VideoAggregateParams>({
    mainVideoPath: "",
    subVideoPath: "",
    outputDir: "",
    outputName: "",
    subVideoAlpha: DEFAULT_SUB_VIDEO_ALPHA,
    subVideoSizePercentage: DEFAULT_SUB_VIDEO_SIZE_PERCENTAGE,
  });

  const handleCheckFfmpegState = async () => {
    const installed = await invoke("is_ffmpeg_installed");
    setFfmpegState(installed ? "installed" : "uninstalled");
    return installed;
  };

  const preCheckFfmpegState = async () => {
    const ok = await handleCheckFfmpegState();
    if (!ok) {
      messageApi.error("ffmpeg 未安装或未设置环境变量");
    }
    return ok;
  };

  useEffect(() => {
    const unlistenOutput = appWindow.listen<string>("ffmpeg://output", ({ payload }) => {
      setOutput((current) => current + payload);
    });
    return () => {
      unlistenOutput.then((fn) => fn());
    };
  }, []);

  const handleSubmit = async () => {
    const params = {
      ...formData,
      outputName: `${formData.outputName}.mp4`,
    };
    consoleLog(LOG_LEVEL_INFO, "params: ", params);
    if (!(await preCheckFfmpegState())) {
      return;
    }

    setRunning(true);
    setOutput("");
    try {
      const exitCode = await invoke("run_video_aggregate", { params });
      if (exitCode === 0) {
        messageApi.success("合并成功！🎉");
      } else {
        messageApi.error(`合并失败，exit code: ${exitCode}`);
      }
    } catch (e) {
      messageApi.error(`合并失败：${e}`);
    } finally {
      setRunning(false);
    }
  };

  const ffmpegMeta = ffmpegStateMeta(ffmpegState);
  const canSubmit =
    formData.mainVideoPath.trim().length > 0 &&
    formData.subVideoPath.trim().length > 0 &&
    formData.outputDir.trim().length > 0 &&
    formData.outputName.trim().length > 0;

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      <Card
        sx={{
          borderRadius: "30px",
          border: "1px solid",
          borderColor: alpha(theme.palette.divider, 0.7),
          background:
            theme.palette.mode === "dark"
              ? `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.14)}, ${alpha("#020617", 0.9)})`
              : `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.1)}, rgba(255,255,255,0.98))`,
          boxShadow:
            theme.palette.mode === "dark"
              ? "0 28px 70px rgba(2, 6, 23, 0.42)"
              : "0 24px 60px rgba(15, 23, 42, 0.08)",
        }}
      >
        <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
          <Stack spacing={3}>
            <Stack
              direction={{ xs: "column", lg: "row" }}
              justifyContent="space-between"
              spacing={2.5}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <Paper
                    elevation={0}
                    sx={{
                      width: 48,
                      height: 48,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: "18px",
                      bgcolor: alpha(theme.palette.primary.main, 0.14),
                      color: "primary.main",
                    }}
                  >
                    <MovieCreationRoundedIcon />
                  </Paper>
                  <BoxLike>
                    <Typography variant="h5" sx={{ fontWeight: 800 }}>
                      视频合并器
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      把黑板主视角和 PPT 副视角整合成一支更适合回看的成片。
                    </Typography>
                  </BoxLike>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  建议先确认两段视频时长接近，再设置副屏大小和透明度，能得到更自然的画面层次。
                </Typography>
              </Stack>

              <Stack spacing={1.25} alignItems={{ xs: "stretch", lg: "flex-end" }}>
                <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
                  <Chip
                    icon={ffmpegMeta.icon}
                    label={`ffmpeg：${ffmpegMeta.label}`}
                    color={ffmpegMeta.color}
                    sx={{ height: 40, borderRadius: "999px", px: 1 }}
                  />
                  <Chip
                    label={`透明度 ${formData.subVideoAlpha}%`}
                    variant="outlined"
                    sx={{ height: 40, borderRadius: "999px", px: 1 }}
                  />
                  <Chip
                    label={`副屏 ${formData.subVideoSizePercentage}%`}
                    variant="outlined"
                    sx={{ height: 40, borderRadius: "999px", px: 1 }}
                  />
                </Stack>
                <Button variant="outlined" onClick={() => void handleCheckFfmpegState()}>
                  检查 ffmpeg
                </Button>
              </Stack>
            </Stack>

            <Stack
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.4fr) minmax(280px, 0.6fr)" },
                alignItems: "start",
              }}
            >
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2, md: 2.5 },
                  borderRadius: "24px",
                  border: "1px solid",
                  borderColor: alpha(theme.palette.divider, 0.7),
                  bgcolor: alpha(theme.palette.background.paper, 0.86),
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    素材编排
                  </Typography>
                  <Stack spacing={1.5}>
                    <Stack spacing={0.75}>
                      <Typography variant="caption" color="text.secondary">
                        主视频（黑板录屏）
                      </Typography>
                      <PathSelector
                        directory={false}
                        extensions={["mp4"]}
                        placeholder="请选择主视频（黑板录屏）路径"
                        value={formData.mainVideoPath}
                        onChange={(value) =>
                          setFormData((prev) => ({ ...prev, mainVideoPath: value }))
                        }
                      />
                    </Stack>
                    <Stack spacing={0.75}>
                      <Typography variant="caption" color="text.secondary">
                        副视频（PPT 录屏）
                      </Typography>
                      <PathSelector
                        directory={false}
                        extensions={["mp4"]}
                        placeholder="请选择副视频（PPT 录屏）路径"
                        value={formData.subVideoPath}
                        onChange={(value) =>
                          setFormData((prev) => ({ ...prev, subVideoPath: value }))
                        }
                      />
                    </Stack>
                    <Stack spacing={0.75}>
                      <Typography variant="caption" color="text.secondary">
                        输出目录
                      </Typography>
                      <PathSelector
                        placeholder="请选择输出文件夹"
                        value={formData.outputDir}
                        onChange={(value) =>
                          setFormData((prev) => ({ ...prev, outputDir: value }))
                        }
                      />
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>

              <Paper
                elevation={0}
                sx={{
                  p: { xs: 2, md: 2.5 },
                  borderRadius: "24px",
                  border: "1px solid",
                  borderColor: alpha(theme.palette.divider, 0.7),
                  bgcolor: alpha(theme.palette.background.paper, 0.9),
                }}
              >
                <Stack spacing={2}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    合成参数
                  </Typography>
                  <TextField
                    label="输出视频名"
                    value={formData.outputName}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, outputName: event.target.value }))
                    }
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <Typography variant="caption" color="text.secondary">
                            .mp4
                          </Typography>
                        </InputAdornment>
                      ),
                    }}
                  />
                  <TextField
                    type="number"
                    label="副视频透明度"
                    value={formData.subVideoAlpha}
                    helperText="建议 70-100，能同时保留板书和 PPT 信息。"
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        subVideoAlpha: Number(event.target.value),
                      }))
                    }
                  />
                  <TextField
                    type="number"
                    label="副视频大小"
                    value={formData.subVideoSizePercentage}
                    helperText="推荐 20-35，更适合作为角标式副屏。"
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        subVideoSizePercentage: Number(event.target.value),
                      }))
                    }
                  />
                </Stack>
              </Paper>
            </Stack>

            <Paper
              elevation={0}
              sx={{
                p: { xs: 2, md: 2.5 },
                borderRadius: "24px",
                border: "1px solid",
                borderColor: alpha(theme.palette.divider, 0.7),
                bgcolor: alpha(theme.palette.background.paper, 0.88),
              }}
            >
              <Stack
                direction={{ xs: "column", lg: "row" }}
                justifyContent="space-between"
                spacing={2}
                alignItems={{ xs: "stretch", lg: "center" }}
              >
                <Stack spacing={1}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    合成预期
                  </Typography>
                  <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
                    <Chip icon={<PlayCircleOutlineRoundedIcon />} label="主画面优先保留黑板视角" />
                    <Chip icon={<SlideshowRoundedIcon />} label="副画面叠加为 PPT 视角" />
                  </Stack>
                </Stack>
                <Button
                  variant="contained"
                  size="large"
                  onClick={() => void handleSubmit()}
                  disabled={running || !canSubmit}
                  endIcon={running ? <CircularProgress size={16} color="inherit" /> : undefined}
                  sx={{ minWidth: 160 }}
                >
                  {running ? "合并中" : "开始合并"}
                </Button>
              </Stack>
            </Paper>
          </Stack>
        </CardContent>
      </Card>

      <Card
        sx={{
          borderRadius: "28px",
          border: "1px solid",
          borderColor: alpha(theme.palette.divider, 0.7),
          overflow: "hidden",
        }}
      >
        <CardContent sx={{ p: 0 }}>
          <Stack spacing={0}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                px: 3,
                py: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.06),
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <TerminalRoundedIcon color="primary" />
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  执行输出
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {output ? "实时滚动日志" : "等待任务启动"}
              </Typography>
            </Stack>
            <Divider />
            {output ? (
              <ReactAnsi
                log={output}
                bodyStyle={{ height: "100%", overflowY: "auto" }}
                logStyle={{ height: 500, padding: 20, background: "#020617" }}
                autoScroll
              />
            ) : (
              <Stack
                spacing={1.25}
                alignItems="center"
                justifyContent="center"
                sx={{ minHeight: 240, px: 3, py: 5 }}
              >
                <TerminalRoundedIcon sx={{ fontSize: 36, color: "text.secondary" }} />
                <Typography variant="body1">运行日志会在这里实时显示</Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  点击“开始合并”后，可以在这里查看 ffmpeg 的执行输出和错误信息。
                </Typography>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

function BoxLike({ children }: { children: React.ReactNode }) {
  return <Stack spacing={0.25}>{children}</Stack>;
}
