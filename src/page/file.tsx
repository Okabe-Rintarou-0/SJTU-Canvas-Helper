import { Button, Checkbox, CheckboxProps, Progress, Select, Space, Table } from "antd";
import { appWindow } from "@tauri-apps/api/window";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import { Course, File, FileDownloadTask, ProgressPayload } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";

export default function FilePage() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [_selectedCourse, setSelectedCourse] = useState<string>("");
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [showAllFiles, setShowAllFiles] = useState<boolean>(false);
    const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
    const [messageApi, contextHolder] = useMessage();
    useEffect(() => {
        initCourses();
        appWindow.listen<ProgressPayload>("download://progress", ({ payload }) => {
            updateTaskProgress(payload.uuid, payload.downloaded / payload.total * 100);
        });
    }, []);

    const initCourses = async () => {
        try {
            let courses = await invoke("list_courses") as Course[];
            setCourses(courses);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleSelect = async (selected: string) => {
        setSelectedCourse(selected);
        let selectedCourse = courses.find(course => course.name === selected);
        if (selectedCourse) {
            try {
                let files = await invoke("list_files", { courseId: selectedCourse.id }) as File[];
                files.map(file => file.key = file.uuid);
                setFiles(files);
            } catch (_) {
                setFiles([]);
            }
        }
    }

    const updateTaskProgress = (uuid: string, progress: number) => {
        setDownloadTasks(tasks => {
            let task = tasks.find(task => task.file.uuid === uuid);
            if (task) {
                task.progress = Math.ceil(progress);
            }
            return [...tasks];
        });
    }

    const handleRemoveTask = async (taskToRemove: FileDownloadTask) => {
        setDownloadTasks(tasks => tasks.filter(task => task.file.uuid !== taskToRemove.file.uuid));
    }

    const handleDownloadFile = async (file: File) => {
        try {
            let task = downloadTasks.find(task => task.file.uuid === file.uuid);
            if (!task) {
                setDownloadTasks(tasks => [...tasks, {
                    key: file.uuid,
                    file,
                    progress: 0
                } as FileDownloadTask]);
            } else if (task.progress !== 100) {
                messageApi.warning("当前任务正在下载！请勿重复添加！");
                return;
            }
            await invoke("download_file", { file });
            // unlisten();
            updateTaskProgress(file.uuid, 100);
            messageApi.success("下载成功！");
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const fileColumns = [
        {
            title: '文件名',
            dataIndex: 'display_name',
            key: 'display_name',
        },
        {
            title: '操作',
            dataIndex: 'operation',
            key: 'operation',
            render: (_: any, file: File) => (
                file.url ?
                    <a onClick={e => {
                        e.preventDefault();
                        handleDownloadFile(file);
                    }}>下载</a> : '未开放下载'
            ),
        }
    ];

    const task_columns = [
        {
            title: '文件名',
            dataIndex: 'file',
            key: 'file',
            render: (_: any, task: FileDownloadTask) => task.file.display_name
        },
        {
            title: '进度条',
            dataIndex: 'progress',
            render: (_: any, task: FileDownloadTask) => <Progress percent={task.progress} />
        },
        {
            title: '操作',
            dataIndex: 'operation',
            key: 'operation',
            render: (_: any, task: FileDownloadTask) => (
                <Space size="middle">
                    <a onClick={e => {
                        e.preventDefault();
                        handleRemoveTask(task);
                    }}>删除</a>
                </Space>
            ),
        }
    ];

    const handleSetShowAllFiles: CheckboxProps['onChange'] = (e) => {
        setShowAllFiles(e.target.checked);
    }

    const handleSelected = (_: React.Key[], selectedFiles: File[]) => {
        setSelectedFiles(selectedFiles);
    }

    const handleDownloadSelectedFiles = () => {
        for (let selectedFile of selectedFiles) {
            handleDownloadFile(selectedFile);
        }
    }

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%" }} size={"large"}>
            <Space>
                <span>选择课程：</span>
                <Select
                    style={{ width: 300 }}
                    onChange={handleSelect}
                    options={courses.map(course => ({
                        label: course.name,
                        value: course.name
                    }))}
                />
            </Space>
            <Checkbox onChange={handleSetShowAllFiles}>显示全部</Checkbox>
            <Table style={{ width: "100%" }} columns={fileColumns} dataSource={showAllFiles ? files : files.filter(file => file.url)} rowSelection={{ onChange: handleSelected }} />
            <Button onClick={handleDownloadSelectedFiles}>下载</Button>
            <Table style={{ width: "100%" }} columns={task_columns} dataSource={downloadTasks} />
        </Space>
    </BasicLayout>
}