import { Button, Progress, Space, Table } from "antd";
import { DownloadState, VideoDownloadTask, ProgressPayload, VideoPlayInfo } from "../lib/model";
import { appWindow } from "@tauri-apps/api/window";
import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api";
import { sleep } from "../lib/utils";
import { DOWNLOAD_TASK_MAP } from "../lib/store";
import useMessage from "antd/es/message/useMessage";

export default function VideoDownloadTable({
    tasks,
    handleRemoveTask,
}: {
    tasks: VideoDownloadTask[],
    handleRemoveTask?: (task: VideoDownloadTask) => void,
}) {
    const [currentTasks, setCurrentTasks] = useState<VideoDownloadTask[]>([]);
    const [messageApi, contextHolder] = useMessage();
    const taskSet = useRef<Set<string>>(new Set<string>());

    useEffect(() => {
        let unlisten = appWindow.listen<ProgressPayload>("video_download://progress", ({ payload }) => {
            let progress = Math.ceil(payload.downloaded / payload.total * 100);
            let uuid = payload.uuid;
            if (taskSet.current.has(uuid)) {
                updateTaskProgress(uuid, progress);
            } else {
                let object = DOWNLOAD_TASK_MAP.get(uuid);
                if (!object) {
                    return;
                }
                let video = object as VideoPlayInfo;
                let task = { key: uuid, progress, video, state: "downloading" } as VideoDownloadTask;
                taskSet.current.add(uuid);
                setCurrentTasks(currentTasks => [...currentTasks, task]);
            }
        });
        return () => {
            unlisten.then(f => f());
        }
    }, []);

    useEffect(() => {
        let targetTasks = [...currentTasks];
        for (let task of tasks) {
            if (!taskSet.current.has(task.key)) {
                taskSet.current.add(task.key);
                targetTasks.push(task);
                handleDownloadVideo(task);
            }
        }
        setCurrentTasks(targetTasks);
    }, [tasks]);

    const handleDownloadVideo = async (task: VideoDownloadTask) => {
        let video = task.video;
        let uuid = video.id + "";
        updateTaskProgress(uuid, 0);

        let retries = 0;
        let maxRetries = 3;
        while (retries < maxRetries) {
            try {
                DOWNLOAD_TASK_MAP.set(uuid, video);
                await invoke("download_video", { video, saveName: task.video.name });
                updateTaskProgress(uuid, 100);
                DOWNLOAD_TASK_MAP.delete(uuid);
                // messageApi.success("下载成功！", 0.5);
                break;
            } catch (e) {
                messageApi.error(e as string);
                updateTaskProgress(uuid, undefined, e as string);
                retries += 1;
            }
            await sleep(1000);
        }
    }

    const handleRetryTask = (task: VideoDownloadTask) => {
        if (task.progress < 100 && task.state !== 'fail') {
            messageApi.warning("任务正在下载中，请勿重试☹️");
            return;
        }
        handleDownloadVideo(task);
    }

    const handleRemoveTasks = () => {
        for (let task of selectedTasks) {
            taskSet.current.delete(task.key);
            handleRemoveTask?.(task);
        }
        setSelectedTasks([]);
    }

    const [selectedTasks, setSelectedTasks] = useState<VideoDownloadTask[]>([]);

    const handleSelect = (_: React.Key[], selectedTasks: VideoDownloadTask[]) => {
        setSelectedTasks(selectedTasks);
    }

    const updateTaskProgress = (id: string, progress?: number, error?: string) => {
        setCurrentTasks(tasks => {
            let task = tasks.find(task => task.key === id);
            let state: DownloadState = error ? "fail" : progress === 100 ? "succeed" : "downloading";
            if (task) {
                if (progress) {
                    task.progress = progress;
                }
                task.state = state;
            }
            return [...tasks];
        });
    }

    const columns = [
        {
            title: '视频',
            dataIndex: 'file',
            key: 'file',
            render: (_: any, task: VideoDownloadTask) => task.video.name
        },
        {
            title: '进度条',
            dataIndex: 'progress',
            render: (_: any, task: VideoDownloadTask) => <Progress percent={task.progress}
                status={task.state === "fail" ? "exception" : task.state === "downloading" ? "active" : "success"} />
        },
        {
            title: '操作',
            dataIndex: 'operation',
            key: 'operation',
            render: (_: any, task: VideoDownloadTask) => (
                <Space size="middle">
                    {/* <a onClick={e => {
                        e.preventDefault();
                        handleRemoveTask?.(task);
                    }}>删除</a> */}
                    <a onClick={e => {
                        e.preventDefault();
                        handleRetryTask(task);
                    }}>重试</a>
                </Space>
            ),
        }
    ];
    return <>
        {contextHolder}
        <Table style={{ width: "100%" }} columns={columns} dataSource={currentTasks} pagination={false}
            rowSelection={{
                onChange: handleSelect,
                selectedRowKeys: selectedTasks.map(task => task.key),
            }} />
        <Button onClick={handleRemoveTasks}>删除</Button>
    </>
}