import { Table, Progress, Button, Space } from "antd";
import { DownloadTask, ProgressPayload } from "../lib/model";
import { appWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

interface PPTDownloadTableProps {
    tasks: DownloadTask[];
    handleRemoveTask: (task: DownloadTask) => void;
}

export default function PPTDownloadTable({ tasks, handleRemoveTask }: PPTDownloadTableProps) {
    const [currentTasks, setCurrentTasks] = useState<DownloadTask[]>([]);

    useEffect(() => {
        let unlisten = appWindow.listen<ProgressPayload>("ppt_download://progress", ({ payload }) => {
            console.log("Received progress update:", payload);
            updateTaskProgress(payload.uuid, payload.processed, payload.total);
        });
        return () => {
            unlisten.then(f => f());
        };
    }, []);

    useEffect(() => {
        setCurrentTasks(tasks);
    }, [tasks]);

    const updateTaskProgress = (id: string, processed: number, total: number) => {
        setCurrentTasks(tasks => {
            console.log("Updating task progress:", id, processed, total);
            console.log("Current tasks:", tasks);
            let task = tasks.find(task => task.key === id);
            if (!task) {
                console.error("Task not found:", id);
                return tasks;
            }
            if (task) {
                task.progress = Math.ceil((processed / total) * 100);
                task.state = task.progress === 100 ? "merging" : "downloading";
                console.log("Updated task:", task);
            }
            return [...tasks];
        });
    };

    const columns = [
        {
            title: "任务名",
            dataIndex: "name",
            key: "name",
        },
        {
            title: "进度",
            dataIndex: "progress",
            key: "progress",
            render: (progress: number) => <Progress percent={progress} />,
        },
        {
            title: "状态",
            dataIndex: "state",
            key: "state",
            render: (state: string) => {
                switch (state) {
                    case "downloading":
                        return "下载中";
                    case "completed":
                        return "已完成";
                    case "fail":
                        return "失败";
                    case "merging":
                        return "合并中";
                    default:
                        return "未知";
                }
            },
        },
        {
            title: "操作",
            key: "operation",
            render: (_: any, task: DownloadTask) => (
                <Space>
                    <Button danger onClick={() => handleRemoveTask(task)}>
                        删除
                    </Button>
                </Space>
            ),
        },
    ];

    return <Table columns={columns} dataSource={currentTasks} rowKey="key" pagination={false} />;
}
