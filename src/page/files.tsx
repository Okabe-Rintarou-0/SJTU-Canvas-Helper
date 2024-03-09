import { Button, Checkbox, CheckboxProps, Input, Select, Space, Table, Tooltip } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import { Course, File, FileDownloadTask, Folder } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import { InfoCircleOutlined } from '@ant-design/icons';
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import { usePreview } from "../lib/hooks";

export default function FilesPage() {
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
    const [loading, setLoading] = useState<boolean>(false);
    const [currentFolder, setCurrentFolder] = useState<string>(ALL_FILES);
    const [keyword, setKeyword] = useState<string>("");

    const { previewer, onHoverFile, onLeaveFile, setPreviewFile } = usePreview();

    useEffect(() => {
        initCourses();
    }, []);

    const fileColumns = [
        {
            title: '文件名',
            dataIndex: 'display_name',
            key: 'display_name',
            render: (name: string, file: File) => <a
                onMouseEnter={() => onHoverFile(file)}
                onMouseLeave={onLeaveFile}
            >
                {name}
            </a>
        },
        {
            title: '操作',
            dataIndex: 'operation',
            key: 'operation',
            render: (_: any, file: File) => (
                <Space>
                    {file.url && <a onClick={e => {
                        e.preventDefault();
                        handleDownloadFile(file);
                    }}>下载</a>}
                    <a onClick={e => {
                        e.preventDefault();
                        setPreviewFile(file);
                    }}>预览</a>
                </Space>
            ),
        }
    ];

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
        setLoading(true);
        try {
            let files = await invoke("list_course_files", { courseId }) as File[];
            files.map(file => file.key = file.uuid);
            setFiles(files);
        } catch (_) {
            setFiles([]);
        }
        setOperating(false);
        setLoading(false);
    }

    const handleGetFolderFiles = async (folderId: number) => {
        setOperating(true);
        setLoading(true);
        try {
            let files = await invoke("list_folder_files", { folderId }) as File[];
            files.map(file => file.key = file.uuid);
            setFiles(files);
        } catch (e) {
            setFiles([]);
        }
        setOperating(false);
        setLoading(false);
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
            setSelectedFiles([]);
            setFiles([]);
            handleGetFiles(selectedCourse.id);
            handleGetFolders(selectedCourse.id);
            setCurrentFolder(ALL_FILES);
        }
    }

    const handleFolderSelect = async (selected: string) => {
        if (selected === currentFolder) {
            return;
        }
        setSelectedFiles([]);
        setFiles([]);
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

    const handleRemoveTask = async (taskToRemove: FileDownloadTask) => {
        setDownloadTasks(tasks => tasks.filter(task => task.file.uuid !== taskToRemove.file.uuid));
        try {
            await invoke("delete_file", { file: taskToRemove.file });
            // messageApi.success("删除成功🎉！", 0.5);
        } catch (e) {
            if (taskToRemove.state !== "fail") {
                // no need to show error message for already failed tasks
                messageApi.error(e as string);
            }
        }
    }

    const handleDownloadFile = async (file: File) => {
        if (!downloadTasks.find(task => task.file.uuid === file.uuid)) {
            setDownloadTasks(tasks => [...tasks, {
                key: file.uuid,
                file,
                progress: 0
            } as FileDownloadTask]);
        } else {
            messageApi.warning("请勿重复添加任务！");
            return;
        }
    }

    const handleSetShowAllFiles: CheckboxProps['onChange'] = (e) => {
        setDownloadableOnly(e.target.checked);
    }

    const handleFileSelect = (_: React.Key[], selectedFiles: File[]) => {
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

    const shouldShow = (file: File) => {
        let notContainsKeyword = file.display_name.indexOf(keyword) === -1;
        let notDownloadable = downloadableOnly && !file.url;
        return !notContainsKeyword && !notDownloadable;
    }

    return <BasicLayout>
        {contextHolder}
        {previewer}
        <Space direction="vertical" style={{ width: "100%" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} />
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
            <Space>
                <Checkbox disabled={operating} onChange={handleSetShowAllFiles} defaultChecked>只显示可下载文件</Checkbox>
                <Input.Search placeholder="输入文件关键词" onSearch={setKeyword} />
            </Space>
            <Table style={{ width: "100%" }}
                columns={fileColumns}
                loading={loading}
                pagination={false}
                dataSource={files.filter(file => shouldShow(file))}
                rowSelection={{ onChange: handleFileSelect, selectedRowKeys: selectedFiles.map(file => file.key) }}
            />
            <Button disabled={operating} onClick={handleDownloadSelectedFiles}>下载</Button>
            <FileDownloadTable tasks={downloadTasks} handleRemoveTask={handleRemoveTask} />
        </Space>
    </BasicLayout>
}