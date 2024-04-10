import { Button, Checkbox, CheckboxProps, Divider, Input, Space, Table, message } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import { Course, Entry, entryName, File, FileDownloadTask, Folder, isFile } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import { useLoginModal, useMerger, usePreview } from "../lib/hooks";
import { PiMicrosoftExcelLogoFill, PiMicrosoftPowerpointLogoFill, PiMicrosoftWordLogoFill } from "react-icons/pi";
import { FaRegFilePdf, FaImage, FaFileCsv, FaRegFileArchive, FaRegFileVideo, FaRegFileAudio } from "react-icons/fa";
import { FolderOutlined, FileOutlined, HomeOutlined, LeftOutlined } from "@ant-design/icons"

export default function FilesPage() {
    const MAIN_FOLDER = 'course files';
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [selectedEntries, setSelectedEntries] = useState<Entry[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [downloadableOnly, setDownloadableOnly] = useState<boolean>(true);
    const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [currentFolderId, setCurrentFolderId] = useState(0);
    const [currentFolderFullName, setCurrentFolderFullName] = useState<string | undefined>('');
    const [parentFolderId, setParentFolderId] = useState<number | undefined | null>(null);
    const [keyword, setKeyword] = useState<string>("");
    const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry, setEntries } = usePreview();
    const { merger, mergePDFs } = useMerger({ setPreviewEntry, onHoverEntry, onLeaveEntry });

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

    useEffect(() => {
        setEntries(files)
    }, [files]);

    useEffect(() => {
        handleGetFolderFiles(currentFolderId);
        handleGetFolderFolders(currentFolderId);
    }, [currentFolderId]);

    const getFileIcon = (file: File) => {
        const name = file.display_name;
        const mime_class = file.mime_class;
        if (name.endsWith(".pdf")) {
            return <FaRegFilePdf style={{ fontSize: '22px' }} />
        }
        if (name.endsWith(".doc") || name.endsWith(".docx")) {
            return <PiMicrosoftWordLogoFill style={{ fontSize: '24px' }} />
        }
        if (name.endsWith(".ppt") || name.endsWith(".pptx")) {
            return <PiMicrosoftPowerpointLogoFill style={{ fontSize: '24px' }} />
        }
        if (name.endsWith(".csv")) {
            return <FaFileCsv style={{ fontSize: '22px' }} />
        }
        if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
            return <PiMicrosoftExcelLogoFill style={{ fontSize: '24px' }} />
        }
        if (name.endsWith(".ppt") || name.endsWith(".pptx")) {
            return <PiMicrosoftPowerpointLogoFill style={{ fontSize: '24px' }} />
        }
        if (name.endsWith(".flv") || name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".m4v") || name.endsWith(".avi")) {
            return <FaRegFileVideo style={{ fontSize: '22px' }} />
        }
        if (name.endsWith(".mp3") || name.endsWith(".wav")) {
            return <FaRegFileAudio style={{ fontSize: '22px' }} />
        }
        if (name.endsWith(".7z") || name.endsWith(".rar") || name.endsWith(".tar") || name.endsWith(".zip")) {
            return <FaRegFileArchive style={{ fontSize: '22px' }} />
        }
        if (mime_class.startsWith("image")) {
            return <FaImage style={{ fontSize: '22px' }} />
        }
        return <FileOutlined style={{ fontSize: '21px' }} />
    }

    const fileColumns = [
        {
            title: '文件',
            key: 'name',
            render: (entry: Entry) => {
                if (isFile(entry)) {
                    const file = entry as File;
                    const displayName = file.display_name;
                    return (
                        <Space>
                            {getFileIcon(file)}
                            <a
                                target="_blank"
                                href={`https://oc.sjtu.edu.cn/courses/65860/files?preview=${file.id}`}
                                onMouseEnter={() => onHoverEntry(entry)}
                                onMouseLeave={onLeaveEntry}
                            >
                                {displayName}
                            </a>
                        </Space>);
                }
                else {
                    const folder = entry as Folder;
                    return (
                        <Space>
                            <FolderOutlined style={{ fontSize: '22px' }} />
                            <a
                                onMouseEnter={() => onHoverEntry(entry)}
                                onMouseLeave={onLeaveEntry}
                                onClick={async () => {
                                    await handleFolderOpen(folder.id);
                                }}
                            >
                                {folder.name}
                            </a>
                        </Space>
                    )
                }
            },
        },
        {
            title: '操作',
            key: 'operation',
            render: (entry: Entry) => {
                if (isFile(entry)) {
                    const file = entry as File;
                    return (
                        isFile(file) && <Space>
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
                                setPreviewEntry(file);
                            }}>预览</a>
                        </Space>
                    );
                }
                else {
                    return <></>;
                }
            },
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

    /**
     * 获取课程的主文件夹(course files) id
     * @param courseId
     */
    const getCourseMainFolderId = async (courseId: number) => {
        setOperating(true);
        setLoading(true);
        let mainFolderId;
        try {
            let courseFolders = await invoke("list_folders", { courseId }) as Folder[];
            mainFolderId = courseFolders.find(folder => folder.name === MAIN_FOLDER)?.id;
        } catch (_) {
            mainFolderId = undefined;
        }
        setOperating(false);
        setLoading(false);
        return mainFolderId;
    };

    const getParentFolder = async (folderId: number): Promise<Folder | undefined> => {
        setOperating(true);
        setLoading(true);
        let parentFolder = undefined;
        try {
            let folder = await invoke("get_folder_by_id", { folderId }) as Folder;
            parentFolder = folder;
        } catch (_) {
            parentFolder = undefined;
        }
        setOperating(false);
        setLoading(false);
        return parentFolder;
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

    const handleGetFolderFolders = async (folderId: number) => {
        setOperating(true);
        setLoading(true);
        try {
            let folders = await invoke("list_folder_folders", { folderId }) as Folder[];
            folders.map(folder => folder.key = folder.id.toString());
            setFolders(folders);
        } catch (e) {
            setFolders([]);
        }
        setOperating(false);
        setLoading(false);
    }

    const handleCourseSelect = async (courseId: number) => {
        if (courses.find(course => course.id === courseId)) {
            setSelectedCourseId(courseId);
            setSelectedEntries([]);
            setFiles([]);
            setFolders([]);
            let courseMainFolderId = await getCourseMainFolderId(courseId);
            if (courseMainFolderId !== undefined) {
                await handleGetFolderFolders(courseMainFolderId)
                await handleGetFolderFiles(courseMainFolderId);
                setCurrentFolderId(courseMainFolderId);
                setCurrentFolderFullName(MAIN_FOLDER);
                setParentFolderId(null);
                setOperating(false);
            }
        }
    }

    const handleFolderOpen = async (folderId: number) => {
        setSelectedEntries([]);
        setFiles([]);
        setFolders([]);
        setCurrentFolderId(folderId);
        const parentFolder = await getParentFolder(folderId);
        setCurrentFolderFullName(parentFolder?.full_name);
        setParentFolderId(parentFolder?.parent_folder_id);
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
        let course = courses.find(course => course.id === selectedCourseId)!;
        const saveDir = course.name + currentFolderFullName?.replace("course files", "");
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

    const handleEntrySelect = (_: React.Key[], selectedEntries: Entry[]) => {
        setSelectedEntries(selectedEntries);
    }

    const handleDownloadSelectedFiles = () => {
        for (let selectedEntry of selectedEntries) {
            if (isFile(selectedEntry)) {
                handleDownloadFile(selectedEntry as File);
            }
        }
    }

    const handleMergePDFs = () => {
        mergePDFs(selectedEntries.filter(isFile) as File[]);
    }

    const backToParentDir = async () => {
        setFiles([]);
        setFolders([]);
        const currentFolderId = parentFolderId as number;
        setCurrentFolderId(currentFolderId);
        const parentFolder = await getParentFolder(currentFolderId);
        setCurrentFolderFullName(parentFolder?.full_name);
        setParentFolderId(parentFolder?.parent_folder_id);
    }

    const backToRootDir = async () => {
        let courseMainFolderId = await getCourseMainFolderId(selectedCourseId);
        if (typeof courseMainFolderId === 'number') {
            setFiles([]);
            setFolders([]);
            setCurrentFolderId(courseMainFolderId);
            setCurrentFolderFullName(MAIN_FOLDER);
            setParentFolderId(null);
        }
    }

    const shouldShow = (entry: Entry) => {
        let containsKeyword = entryName(entry).indexOf(keyword) !== -1;
        let downloadable = !isFile(entry) || !downloadableOnly || (entry as File).url;
        return containsKeyword && downloadable;
    }

    const noSelectedPDFs = (selectedEntries.filter(isFile) as File[])
        .filter(file => file.display_name.endsWith(".pdf") || file.display_name.endsWith(".pptx")).length < 2;

    return <BasicLayout>
        {contextHolder}
        {previewer}
        {modal}
        <Space direction="vertical" style={{ width: "100%" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} />
            <Space>
                <Checkbox disabled={operating} onChange={handleSetShowAllFiles} defaultChecked>只显示可下载文件</Checkbox>
                <Input.Search placeholder="输入文件关键词" onSearch={setKeyword} />
            </Space>
            <Space>
                <Button
                    icon={<LeftOutlined />}
                    disabled={typeof parentFolderId != 'number'}
                    onClick={backToParentDir}
                >
                    上级目录
                </Button>
                <Button
                    icon={<HomeOutlined />}
                    disabled={selectedCourseId === -1 || !parentFolderId}
                    onClick={backToRootDir}
                >
                    根目录
                </Button>
            </Space>
            {currentFolderFullName && <span>当前目录：{currentFolderFullName}</span>}
            <Table style={{ width: "100%" }}
                columns={fileColumns}
                loading={loading}
                pagination={false}
                dataSource={[...folders as Entry[], ...files as Entry[]].filter(shouldShow)}
                rowSelection={{
                    onChange: handleEntrySelect,
                    selectedRowKeys: selectedEntries.map(entry => entry.key),
                    getCheckboxProps: (entry: Entry) => ({
                        disabled: !isFile(entry)
                    }),
                }}
            />
            <Space>
                <Button disabled={operating} onClick={handleDownloadSelectedFiles}>下载</Button>
                <Button disabled={operating || noSelectedPDFs} onClick={handleMergePDFs}>合并 PDF/PPTX</Button>
            </Space>
            <Divider orientation="left">PDF/PPTX (混合)合并</Divider>
            {merger}
            <Divider orientation="left">文件下载</Divider>
            <FileDownloadTable tasks={downloadTasks} handleRemoveTask={handleRemoveTask} />
        </Space>
    </BasicLayout>
}
