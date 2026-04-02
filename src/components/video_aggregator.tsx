import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import {
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
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

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      <Card sx={{ borderRadius: "24px" }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
              <Stack spacing={1}>
                <Typography variant="h6">视频合并器</Typography>
                <Typography variant="body2" color="text.secondary">
                  合并主视频和副视频，生成适合回看的最终录播文件。
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1.25} alignItems="center">
                <Chip icon={ffmpegMeta.icon} label={ffmpegMeta.label} color={ffmpegMeta.color} />
                <Button variant="outlined" onClick={() => void handleCheckFfmpegState()}>
                  检查 ffmpeg
                </Button>
              </Stack>
            </Stack>

            <Stack spacing={2}>
              <PathSelector
                directory={false}
                extensions={["mp4"]}
                placeholder="请选择主视频（黑板录屏）路径"
                value={formData.mainVideoPath}
                onChange={(value) => setFormData((prev) => ({ ...prev, mainVideoPath: value }))}
              />
              <PathSelector
                directory={false}
                extensions={["mp4"]}
                placeholder="请选择副视频（PPT 录屏）路径"
                value={formData.subVideoPath}
                onChange={(value) => setFormData((prev) => ({ ...prev, subVideoPath: value }))}
              />
              <PathSelector
                placeholder="请选择输出文件夹"
                value={formData.outputDir}
                onChange={(value) => setFormData((prev) => ({ ...prev, outputDir: value }))}
              />
              <TextField
                label="输出视频名"
                value={formData.outputName}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, outputName: event.target.value }))
                }
                InputProps={{
                  endAdornment: <Typography variant="caption" color="text.secondary">.mp4</Typography>,
                }}
              />
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <TextField
                  type="number"
                  label="副视频透明度"
                  value={formData.subVideoAlpha}
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
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      subVideoSizePercentage: Number(event.target.value),
                    }))
                  }
                />
              </Stack>
              <Button variant="contained" onClick={() => void handleSubmit()} disabled={running}>
                开始合并
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Divider>执行输出</Divider>
      {output ? (
        <ReactAnsi
          log={output}
          bodyStyle={{ height: "100%", overflowY: "auto" }}
          logStyle={{ height: 500 }}
          autoScroll
        />
      ) : null}
    </Stack>
  );
}
