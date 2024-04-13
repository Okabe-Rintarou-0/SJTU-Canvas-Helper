import { Button, Progress, Space, Table, message } from "antd";
import { File, DownloadState, FileDownloadTask, ProgressPayload } from "../lib/model";
import { appWindow } from "@tauri-apps/api/window";
import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api";
import { sleep } from "../lib/utils";

export default function FileDownloadTable({
    tasks,
    handleRemoveTask,
    handleOpenTaskFile
}: {
    tasks: FileDownloadTask[],
    handleRemoveTask?: (task: FileDownloadTask) => void,
    handleOpenTaskFile?: (task: FileDownloadTask) => void,
}) {
    const [currentTasks, setCurrentTasks] = useState<FileDownloadTask[]>([]);
    const taskSet = new Set<string>(currentTasks.map(task => task.key));

    useEffect(() => {
        let unlisten = appWindow.listen<ProgressPayload>("download://progress", ({ payload }) => {
            updateTaskProgress(payload.uuid, Math.ceil(payload.processed / payload.total * 100));
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
                handleDownloadFile(task.file);
            }
        }
    }, [tasks]);

    const handleDownloadFile = async (file: File) => {
        updateTaskProgress(file.uuid, 0);

        let retries = 0;
        let maxRetries = 3;
        while (retries < maxRetries) {
            try {
                await invoke("download_file", { file });
                updateTaskProgress(file.uuid, 100);
                // messageApi.success("下载成功！", 0.5);
                break;
            } catch (e) {
                updateTaskProgress(file.uuid, undefined, e as string);
                retries += 1;
            }
            await sleep(1000);
        }
    }

    const handleRetryTask = (task: FileDownloadTask) => {
        if (task.progress < 100 && task.state !== 'fail') {
            message.warning("任务正在下载中，请勿重试☹️");
            return;
        }
        handleDownloadFile(task.file);
    }

    const handleRemoveTasks = () => {
        for (let task of selectedTasks) {
            taskSet.delete(task.key);
            handleRemoveTask?.(task);
        }
        setSelectedTasks([]);
    }

    const [selectedTasks, setSelectedTasks] = useState<FileDownloadTask[]>([]);

    const handleSelect = (_: React.Key[], selectedTasks: FileDownloadTask[]) => {
        setSelectedTasks(selectedTasks);
    }

    const updateTaskProgress = (uuid: string, progress?: number, error?: string) => {
        setCurrentTasks(tasks => {
            let task = tasks.find(task => task.file.uuid === uuid);
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
            title: '文件名',
            dataIndex: 'file',
            key: 'file',
            render: (_: any, task: FileDownloadTask) => task.file.display_name
        },
        {
            title: '进度条',
            dataIndex: 'progress',
            render: (_: any, task: FileDownloadTask) => <Progress percent={task.progress}
                status={task.state === "fail" ? "exception" : task.state === "downloading" ? "active" : "success"} />
        },
        {
            title: '操作',
            dataIndex: 'operation',
            key: 'operation',
            render: (_: any, task: FileDownloadTask) => (
                <Space size="middle">
                    <a onClick={e => {
                        e.preventDefault();
                        handleOpenTaskFile?.(task);
                    }}>打开</a>
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
    return <>
        <Table style={{ width: "100%" }} columns={columns} dataSource={currentTasks} pagination={false}
            rowSelection={{
                onChange: handleSelect,
                selectedRowKeys: selectedTasks.map(task => task.key),
            }} />
        <Button onClick={handleRemoveTasks}>删除</Button>
    </>
}
