import { Button, Checkbox, CheckboxProps, Divider, Input, Select, Space, Table, Tooltip, message } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import { Course, File, FileDownloadTask, Folder } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import { InfoCircleOutlined } from '@ant-design/icons';
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import { useLoginModal, useMerger, usePreview } from "../lib/hooks";

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
    const { merger, mergePDFs } = useMerger({ setPreviewFile, onHoverFile, onLeaveFile });

    const handleLoginJbox = async () => {
        try {
            await invoke("login_jbox");
            return true;
        } catch (e) {
            return false;
        }
    }

    const onLogin = async () => {
        if (await handleLoginJbox()) {
            message.success('登录成功🎉！');
            closeModal();
        }
    }

    const { modal, showModal, closeModal } = useLoginModal({ onLogin });

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
                    {file.url && <a onClick={e => {
                        e.preventDefault();
                        handleUploadFile(file);
                    }}>上传云盘</a>}
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

    const handleCourseSelect = async (courseId: number) => {
        if (courses.find(course => course.id === courseId)) {
            setSelectedCourseId(courseId);
            setSelectedFiles([]);
            setFiles([]);
            handleGetFiles(courseId);
            handleGetFolders(courseId);
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

    const handleUploadFile = async (file: File) => {
        let folder = folders.find(folder => folder.id === file.folder_id);
        let folderName = (folder?.full_name ?? "/").replace("course files", "");
        let course = courses.find(course => course.id === selectedCourseId)!;
        const saveDir = course.name + folderName;
        const savePath = saveDir + "/" + file.display_name;
        const infoKey = `uploading_${savePath}`;
        let retries = 0;
        let maxRetries = 1;
        let error: any;
        let logined = false;
        messageApi.open({
            key: infoKey,
            type: 'loading',
            content: `正在上传至交大云盘🚀（文件路径：${savePath}）...`,
            duration: 0,
        });
        while (retries <= maxRetries) {
            try {
                await invoke("upload_file", { file, saveDir });
                messageApi.destroy(infoKey);
                messageApi.success('上传文件成功🎉！');
                break;
            } catch (e) {
                error = e;
                retries += 1;
                logined = await handleLoginJbox();
            }
        }
        if (!logined && error) {
            messageApi.destroy(infoKey);
            messageApi.error(`上传文件出错🥹：${error}`);
            showModal();
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

    const handleMergePDFs = () => {
        mergePDFs(selectedFiles);
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

    const noSelectedPDFs = selectedFiles.filter(file => file.mime_class.indexOf("pdf") !== -1).length < 2;

    return <BasicLayout>
        {contextHolder}
        {previewer}
        {modal}
        <Space direction="vertical" style={{ width: "100%" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} />
            <Space>
                <span>选择目录：</span>
                <Select
                    style={{ width: 350 }}
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
            <Space>
                <Button disabled={operating} onClick={handleDownloadSelectedFiles}>下载</Button>
                {/* <Button disabled={true} onClick={() => { }}>上传云盘</Button> */}
                <Button disabled={operating || noSelectedPDFs} onClick={handleMergePDFs}>合并 PDF</Button>
            </Space>
            <Divider orientation="left">PDF 合并</Divider>
            {merger}
            <Divider orientation="left">文件下载</Divider>
            <FileDownloadTable tasks={downloadTasks} handleRemoveTask={handleRemoveTask} />
        </Space>
    </BasicLayout>
}