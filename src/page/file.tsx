import { Button, Checkbox, CheckboxProps, Progress, Select, Space, Table, Tooltip } from "antd";
import { appWindow } from "@tauri-apps/api/window";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import { Course, File, FileDownloadTask, Folder, ProgressPayload } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import { InfoCircleOutlined } from '@ant-design/icons';

export default function FilePage() {
    const ALL_FILES = "全部文件";
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [downloadableOnly, setDownloadableOnly] = useState<boolean>(true);
    const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [currentFolder, setCurrentFolder] = useState<string>(ALL_FILES);
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

    const handleGetFiles = async (courseId: number) => {
        setOperating(true);
        try {
            let files = await invoke("list_course_files", { courseId }) as File[];
            files.map(file => file.key = file.uuid);
            setFiles(files);
        } catch (_) {
            setFiles([]);
        }
        setOperating(false);
    }

    const handleGetFolderFiles = async (folderId: number) => {
        setOperating(true);
        try {
            let files = await invoke("list_folder_files", { folderId }) as File[];
            files.map(file => file.key = file.uuid);
            setFiles(files);
        } catch (e) {
            setFiles([]);
        }
        setOperating(false);
    }

    const handleGetFolders = async (courseId: number) => {
        setOperating(true);
        try {
            let folders = await invoke("list_folders", { courseId }) as Folder[];
            setFolders(folders);
        } catch (e) {
            setFolders([]);
        }
        setOperating(false);
    }

    const handleCourseSelect = async (selected: string) => {
        let selectedCourse = courses.find(course => course.name === selected);
        if (selectedCourse) {
            setSelectedCourseId(selectedCourse.id);
            handleGetFiles(selectedCourse.id);
            handleGetFolders(selectedCourse.id);
            setSelectedFiles([]);
            setCurrentFolder(ALL_FILES);
        }
    }

    const handleFolderSelect = async (selected: string) => {
        if (selected === currentFolder) {
            return;
        }
        setCurrentFolder(selected);
        if (selected == ALL_FILES) {
            handleGetFiles(selectedCourseId);
            return;
        }

        let selectedFolder = folders.find(folder => folder.full_name === selected);
        if (selectedFolder) {
            handleGetFolderFiles(selectedFolder.id);
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
            updateTaskProgress(file.uuid, 100);
            messageApi.success("下载成功！", 0.5);
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
        setDownloadableOnly(e.target.checked);
    }

    const handleSelected = (_: React.Key[], selectedFiles: File[]) => {
        setSelectedFiles(selectedFiles);
    }

    const handleDownloadSelectedFiles = () => {
        for (let selectedFile of selectedFiles) {
            handleDownloadFile(selectedFile);
        }
    }

    const folderOptions = [{ label: ALL_FILES, value: ALL_FILES }, ...folders.map(folder => ({
        label: folder.full_name,
        value: folder.full_name
    }))];

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%" }} size={"large"}>
            <Space>
                <span>选择课程：</span>
                <Select
                    style={{ width: 300 }}
                    disabled={operating}
                    onChange={handleCourseSelect}
                    options={courses.map(course => ({
                        label: course.name,
                        value: course.name
                    }))}
                />
            </Space>
            <Space>
                <span>选择目录：</span>
                <Select
                    style={{ width: 300 }}
                    disabled={operating}
                    onChange={handleFolderSelect}
                    value={currentFolder}
                    defaultValue={currentFolder}
                    options={folderOptions}
                />
                <Tooltip placement="top" title={"course files 为默认的根目录名"}>
                    <InfoCircleOutlined />
                </Tooltip>
            </Space>
            <Checkbox onChange={handleSetShowAllFiles} defaultChecked>只显示可下载文件</Checkbox>
            <Table style={{ width: "100%" }}
                columns={fileColumns}
                pagination={false}
                dataSource={downloadableOnly ? files.filter(file => file.url) : files}
                rowSelection={{ onChange: handleSelected }}
            />
            <Button disabled={operating} onClick={handleDownloadSelectedFiles}>下载</Button>
            <Table style={{ width: "100%" }} columns={task_columns} dataSource={downloadTasks} />
        </Space>
    </BasicLayout>
}