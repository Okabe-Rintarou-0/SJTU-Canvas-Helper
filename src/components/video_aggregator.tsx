import { invoke } from "@tauri-apps/api";
import { Badge, Button, Divider, Form, Input, InputNumber, Space } from "antd";
import { useForm } from "antd/es/form/Form";
import { useEffect, useRef, useState } from "react";
import { PathSelector } from "./path_selector";
import useMessage from "antd/es/message/useMessage";
import { LOG_LEVEL_INFO, VideoAggregateParams } from "../lib/model";
import { appWindow } from "@tauri-apps/api/window";
import { consoleLog } from "../lib/utils";

type FfmpegState = "unknown" | "installed" | "uninstalled";

const ffmpegBadgeMap = {
    "unknown": <Badge color="blue" text="未知" />,
    "installed": <Badge color="green" text="已安装" />,
    "uninstalled": <Badge color="red" text="未安装" />
}

const DEFAULT_SUB_VIDEO_SIZE_PERCENTAGE = 25;
const DEFAULT_SUB_VIDEO_ALPHA = 100;

export default function VideoAggregator() {
    const [ffmpegState, setFfmpegState] = useState<FfmpegState>("unknown");
    const [output, setOutput] = useState<string>("");
    const [running, setRunning] = useState<boolean>(false);
    const [form] = useForm<VideoAggregateParams>();
    const [messageApi, contextHolder] = useMessage();
    const preRef = useRef<HTMLPreElement>(null);

    const handleCheckFfmpegState = async () => {
        let installed = await invoke("is_ffmpeg_installed");
        if (installed) {
            setFfmpegState("installed");
        } else {
            setFfmpegState("uninstalled");
        }
        return installed;
    }

    const preCheckFfmpegState = async () => {
        let ok = await handleCheckFfmpegState();
        if (!ok) {
            messageApi.error("ffmpeg 未安装或未设置环境变量");
        }
        return ok;
    }

    useEffect(() => {
        let unlistenOutput = appWindow.listen<String>("ffmpeg://output", ({ payload }) => {
            setOutput(output => output + payload);
            if (preRef.current) {
                preRef.current.scrollTop = preRef.current.scrollHeight;
            }
        });
        return () => {
            unlistenOutput.then(f => f());
        }
    }, []);

    const handleSubmit = async (params: VideoAggregateParams) => {
        params.outputName += ".mp4";
        consoleLog(LOG_LEVEL_INFO, "params: ", params);
        if (!preCheckFfmpegState()) {
            return;
        }

        setRunning(true);
        setOutput("");
        try {
            let exitCode = await invoke("run_video_aggregate", { params });
            if (exitCode === 0) {
                messageApi.success("合并成功！🎉");
            } else {
                messageApi.error("合并失败！🥹, exit code: " + exitCode);
            }
        } catch (e) {
            messageApi.error("合并失败！🥹" + e);
        }
        setRunning(false);
    }

    return <Space size="large" direction="vertical" style={{ width: "100%" }}>
        {contextHolder}
        <Space>
            <div>ffmpeg 是否正确安装且设置环境变量：{ffmpegBadgeMap[ffmpegState]}</div>
            <Button onClick={handleCheckFfmpegState}>检查</Button>
        </Space>
        <Form form={form} onFinish={handleSubmit} preserve={false}>
            <Form.Item label="主视频（黑板录屏）路径" name="mainVideoPath" required rules={[{
                required: true,
                message: "请输入主视频（黑板录屏）路径！"
            }]}>
                <PathSelector directory={false} extensions={["mp4"]} placeholder="请选择正确文件路径" />
            </Form.Item>
            <Form.Item label="副视频（PPT 录屏）路径" name="subVideoPath" required rules={[{
                required: true,
                message: "请输入副视频（PPT 录屏）路径！"
            }]}>
                <PathSelector directory={false} extensions={["mp4"]} placeholder="请选择正确文件路径" />
            </Form.Item>
            <Form.Item label="输出文件夹" name="outputDir" required rules={[{
                required: true,
                message: "请输入输出文件夹"
            }]}>
                <PathSelector placeholder="请选择文件夹" />
            </Form.Item>
            <Form.Item label="输出视频名" name="outputName" required rules={[{
                required: true,
                message: "请输入输出视频名！"
            }]}>
                <Input suffix=".mp4" />
            </Form.Item>
            <Form.Item label="副视频透明度" name="subVideoAlpha" initialValue={DEFAULT_SUB_VIDEO_ALPHA}>
                <InputNumber min={0} max={100} suffix="%" />
            </Form.Item>
            <Form.Item label="副视频大小" name="subVideoSizePercentage" initialValue={DEFAULT_SUB_VIDEO_SIZE_PERCENTAGE}>
                <InputNumber min={0} max={100} suffix="%" />
            </Form.Item>
            <Form.Item>
                <Button disabled={running} type="primary" htmlType="submit">
                    开始合并
                </Button>
            </Form.Item>
        </Form>
        <Divider orientation="left">执行输出</Divider>
        <pre style={{ width: "100%", maxHeight: "500px", overflow: "scroll" }} ref={preRef} >
            <code style={{ width: "100%", whiteSpace: "pre-wrap" }}>
                {output}
            </code>
        </pre>
    </Space>
}