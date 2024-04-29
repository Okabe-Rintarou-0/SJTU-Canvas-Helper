import { Button, Progress, Space, Table } from "antd";
import { DownloadState, VideoDownloadTask, ProgressPayload } from "../lib/model";
import { appWindow } from "@tauri-apps/api/window";
import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api";
import { sleep } from "../lib/utils";
import { message } from "antd/lib";

export default function VideoDownloadTable({
    tasks,
    handleRemoveTask,
}: {
    tasks: VideoDownloadTask[],
    handleRemoveTask?: (task: VideoDownloadTask) => void,
}) {
    const [currentTasks, setCurrentTasks] = useState<VideoDownloadTask[]>([]);
    const taskSet = new Set<string>(currentTasks.map(task => task.key));

    useEffect(() => {
        let unlisten = appWindow.listen<ProgressPayload>("video_download://progress", ({ payload }) => {
            updateTaskProgress(payload.uuid, payload.processed / payload.total * 100);
        });
        return () => {
            unlisten.then(f => f());
        }
    }, []);

    useEffect(() => {
        setCurrentTasks(tasks);
        for (let task of tasks) {
            if (!taskSet.has(task.key)) {
                taskSet.add(task.key);
                handleDownloadVideo(task);
            }
        }
    }, [tasks]);

    const handleDownloadVideo = async (task: VideoDownloadTask) => {
        let video = task.video;
        let uuid = video.id + "";
        updateTaskProgress(uuid, 0);

        let retries = 0;
        let maxRetries = 3;
        while (retries < maxRetries) {
            try {
                await invoke("download_video", { video, saveName: task.video.name });
                updateTaskProgress(uuid, 100);
                // messageApi.success("下载成功！", 0.5);
                break;
            } catch (e) {
                message.error(e as string);
                updateTaskProgress(uuid, undefined, e as string);
                retries += 1;
            }
            await sleep(1000);
        }
    }

    const handleRetryTask = (task: VideoDownloadTask) => {
        if (task.progress < 100 && task.state !== 'fail') {
            message.warning("任务正在下载中，请勿重试☹️");
            return;
        }
        handleDownloadVideo(task);
    }

    const handleRemoveTasks = () => {
        for (let task of selectedTasks) {
            taskSet.delete(task.key);
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
                    task.progress = Math.ceil(progress);
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
                    <a onClick={e => {
                        e.preventDefault();
                        handleRemoveTask?.(task);
                    }}>删除</a>
                    <a onClick={e => {
                        e.preventDefault();
                        handleRetryTask(task);
                    }}>重试</a>
                </Space>
            ),
        }
    ];
    return <Space direction="vertical" style={{ width: "100%" }} >
        <Table style={{ width: "100%" }} columns={columns} dataSource={currentTasks} pagination={false}
            rowSelection={{
                onChange: handleSelect,
                selectedRowKeys: selectedTasks.map(task => task.key),
            }} />
        <Button onClick={handleRemoveTasks}>删除</Button>
    </Space>
}