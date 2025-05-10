import { ExclamationCircleFilled, FolderOutlined, HomeOutlined, LeftOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api";
import { Button, Checkbox, CheckboxProps, Divider, Input, Space, Table, Tabs, TabsProps, message } from "antd";
import useMessage from "antd/es/message/useMessage";
import confirm from "antd/es/modal/confirm";
import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from 'remark-gfm';
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import FileOrderSelectModal from "../components/file_order_select_modal";
import BasicLayout from "../components/layout";
import { useBaseURL, useCourses, useLoginModal, useMerger, usePreview } from "../lib/hooks";
import { Course, Entry, File, FileDownloadTask, Folder, LOG_LEVEL_ERROR, LOG_LEVEL_INFO, entryName, isFile } from "../lib/model";
import { consoleLog, getFileIcon, isMergableFileType, scrollToTop } from "../lib/utils";

interface DownloadInfo {
    course?: Course;
    folderPath: string;
}

const COURSE_FILES = "course files";
const MY_FILES = "my files";
const EXPLAINABLE_FILE_EXTS = [".pdf", ".docx"];

function isExplainableFile(file: File) {
    let dotPos = file.display_name.lastIndexOf(".");
    if (dotPos === -1) {
        return false;
    }
    let ext = file.display_name.slice(dotPos);
    return EXPLAINABLE_FILE_EXTS.indexOf(ext) != -1;
}

export default function FilesPage() {
    const [section, setSection] = useState<string>(COURSE_FILES);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [selectedEntries, setSelectedEntries] = useState<Entry[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [allFolders, setAllFolders] = useState<Folder[]>([]);
    const [downloadableOnly, setDownloadableOnly] = useState<boolean>(true);
    const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [currentFolderId, setCurrentFolderId] = useState(0);
    const [currentFolderFullName, setCurrentFolderFullName] = useState<string | undefined>('');
    const [parentFolderId, setParentFolderId] = useState<number | undefined | null>(null);
    const [keyword, setKeyword] = useState<string>("");
    const [openFileOrderSelectModal, setOpenFileOrderSelectModal] = useState<boolean>(false);
    const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry, setEntries } = usePreview();
    const { merger, mergePDFs } = useMerger({ setPreviewEntry, onHoverEntry, onLeaveEntry });
    const courses = useCourses();
    const baseURL = useBaseURL();
    const downloadInfoMap = useMemo(() => new Map<number, DownloadInfo>(), []);

    useEffect(() => {
        setEntries(files)
    }, [files]);

    useEffect(() => {
        if (currentFolderId > 0) {
            handleGetFoldersAndFiles(currentFolderId);
        }
    }, [currentFolderId]);

    useEffect(() => {
        if (section === MY_FILES) {
            initAllMyFolders();
        } else {
            if (selectedCourseId !== -1) {
                handleCourseSelect(selectedCourseId);
            } else {
                clearFilesAndFolders();
            }
        }
    }, [section]);

    const handleExplainFile = async (file: File) => {
        try {
            messageApi.open({
                key: "waiting_response",
                type: "loading",
                content: "正在等待 LLM 答复😄...",
                duration: 0,
            });
            let resp = await invoke("explain_file", { file }) as string;
            consoleLog(LOG_LEVEL_INFO, resp);
            confirm({
                style: {
                    minWidth: "80%", maxWidth: "80%",
                    maxHeight: "80%",
                },
                styles: {
                    body: { overflow: "scroll", }
                },
                title: 'AI 总结',
                icon: <ExclamationCircleFilled />,
                content: <Markdown remarkPlugins={[remarkGfm]}>
                    {resp}
                </Markdown>,
            });
            messageApi.destroy("waiting_response");
        } catch (e) {
            messageApi.error(`总结出错！${e}`)
        }
    }

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
                                href={`${baseURL.data}/courses/${selectedCourseId}/files?preview=${file.id}`}
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
                                onClick={() => handleFolderOpen(folder.id)}
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
                                handleAddDownloadFileTask(file);
                            }}>下载</a>}
                            {file.url && <a onClick={e => {
                                e.preventDefault();
                                handleUploadFile(file);
                            }}>上传云盘</a>}
                            <a onClick={e => {
                                e.preventDefault();
                                setPreviewEntry(file);
                            }}>预览</a>
                            {isExplainableFile(file) && <a onClick={() => handleExplainFile(file)}>AI 总结</a>}
                        </Space >
                    );
                }
                else {
                    return <></>;
                }
            },
        }
    ];

    const getSelectedCourse = () => {
        if (section !== COURSE_FILES) {
            return undefined;
        }
        return courses.data.find(course => course.id === selectedCourseId);
    }

    const initWithFolders = (folders: Folder[]) => {
        setAllFolders(folders);
        let folder = folders.find(folder => folder.name === section)!;
        setCurrentFolderId(folder.id);
        setCurrentFolderFullName(section);
        setParentFolderId(null);
    }

    const clearFilesAndFolders = () => {
        setSelectedEntries([]);
        setAllFolders([]);
        setFiles([]);
        setFolders([]);
        setCurrentFolderId(0);
    }

    const initAllMyFolders = async () => {
        try {
            let myFolders = await invoke("list_my_folders") as Folder[];
            initWithFolders(myFolders);
        } catch (e) {
            consoleLog(LOG_LEVEL_ERROR, e);
            clearFilesAndFolders();
        }
    }

    const initAllCourseFolders = async (courseId: number) => {
        try {
            let courseFolders = await invoke("list_course_folders", { courseId }) as Folder[];
            initWithFolders(courseFolders);
        } catch (_) {
            clearFilesAndFolders();
        }
    }

    const getParentFolder = async (folderId: number): Promise<Folder | undefined> => {
        let parentFolder = undefined;
        try {
            let folder = await invoke("get_folder_by_id", { folderId }) as Folder;
            parentFolder = folder;
        } catch (_) {
            parentFolder = undefined;
        }
        return parentFolder;
    }

    const handleGetFolderFiles = async (folderId: number) => {
        try {
            let files = await invoke("list_folder_files", { folderId }) as File[];
            if (folderId !== currentFolderId) {
                return;
            }
            files.map(file => file.key = file.uuid);
            setFiles(files);
        } catch (e) {
            setFiles([]);
        }
    }

    const handleGetFolderFolders = async (folderId: number) => {
        try {
            let folders = await invoke("list_folder_folders", { folderId }) as Folder[];
            folders.map(folder => folder.key = folder.id.toString());
            setFolders(folders);
        } catch (e) {
            setFolders([]);
        }
    }

    const handleGetFoldersAndFiles = async (folderId: number) => {
        setOperating(true);
        setLoading(true);
        try {
            await Promise.all([handleGetFolderFolders(folderId), handleGetFolderFiles(folderId)]);
        } catch (e) {
            consoleLog(LOG_LEVEL_ERROR, e);
            setFiles([]);
            setFolders([]);
        }
        setOperating(false);
        setLoading(false);
    }

    const handleCourseSelect = async (courseId: number) => {
        if (courses.data.find(course => course.id === courseId)) {
            setSelectedCourseId(courseId);
            setSelectedEntries([]);
            await initAllCourseFolders(courseId);
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
        scrollToTop();
    }

    const getFolderPath = (file: File) => {
        let folderPath = allFolders.find(folder => folder.id === file.folder_id)?.full_name.slice(section.length + 1);
        return folderPath;
    }

    const handleOpenTaskFile = async (task: FileDownloadTask) => {
        const name = task.file.display_name;
        const downloadInfo = downloadInfoMap.get(task.file.folder_id)!;
        const course = downloadInfo.course;
        const folderPath = downloadInfo.folderPath;
        try {
            if (course) {
                await invoke("open_course_file", { name, course, folderPath });
            } else {
                await invoke("open_my_file", { name, folderPath });
            }
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleDownloadFile = async (file: File) => {
        const folderPath = getFolderPath(file);
        const course = getSelectedCourse()!;
        if (!downloadInfoMap.get(file.folder_id) && folderPath !== undefined) {
            downloadInfoMap.set(file.folder_id, {
                course,
                folderPath
            });
        }
        if (section === COURSE_FILES) {
            await invoke("download_course_file", { file, course, folderPath });
        } else {
            await invoke("download_my_file", { file, folderPath });
        }
    }

    const handleSyncFiles = async () => {
        try {
            const course = getSelectedCourse()!;
            messageApi.open({
                type: "loading",
                key: "syncing",
                content: "正在计算中🚀..."
            });
            let filesToSync = await invoke("sync_course_files", { course }) as File[];
            messageApi.destroy("syncing");
            if (filesToSync.length > 0) {
                messageApi.success(`共${filesToSync.length}个文件需要下载，下载任务开始🥰`, 1);
            } else {
                messageApi.success("已同步，无需下载🎉", 1);
            }
            filesToSync.map(file => handleAddDownloadFileTask(file));
        } catch (e) {
            consoleLog(LOG_LEVEL_ERROR, e);
            messageApi.error(`同步失败😑：${e}`)
        }
    }

    const handleRemoveTask = async (taskToRemove: FileDownloadTask) => {
        setDownloadTasks(tasks => tasks.filter(task => task.file.uuid !== taskToRemove.file.uuid));
        const file = taskToRemove.file;
        const downloadInfo = downloadInfoMap.get(file.folder_id)!;
        const course = downloadInfo.course;
        const folderPath = downloadInfo.folderPath;
        try {
            if (course) {
                await invoke("delete_course_file", { file, course, folderPath });
            } else {
                await invoke("delete_my_file", { file, folderPath })
            }
            // messageApi.success("删除成功🎉！", 0.5);
        } catch (e) {
            if (taskToRemove.state !== "fail") {
                // no need to show error message for already failed tasks
                messageApi.error(e as string);
            }
        }
    }

    const handleAddDownloadFileTask = async (file: File) => {
        let task = downloadTasks.find(task => task.file.uuid === file.uuid);
        if (!task) {
            setDownloadTasks(tasks => [...tasks, {
                key: file.uuid,
                file,
                progress: 0,
                state: "downloading",
            } as FileDownloadTask]);
        } else if (task.state === "fail") {
            task.progress = 0;
            task.state = 'wait_retry';
            setDownloadTasks([...downloadTasks]);
            return;
        }
    }

    const handleUploadFile = async (file: File) => {
        let saveDir;
        const subDir = currentFolderFullName?.replace(section, "");
        if (section === COURSE_FILES) {
            let course = getSelectedCourse()!;
            saveDir = course.name + subDir;
        } else {
            saveDir = "我的Canvas文件" + subDir;
        }
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
                handleAddDownloadFileTask(selectedEntry as File);
            }
        }
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
        let mainFolder = allFolders.find(folder => folder.name === section)!;
        setCurrentFolderId(mainFolder.id);
        setCurrentFolderFullName(section);
        setParentFolderId(null);
    }

    const shouldShow = (entry: Entry) => {
        let containsKeyword = entryName(entry).indexOf(keyword) !== -1;
        let downloadable = !isFile(entry) || !downloadableOnly || (entry as File).url;
        return containsKeyword && downloadable;
    }

    const noSelectedPDFs = (selectedEntries.filter(isFile) as File[])
        .filter(file => isMergableFileType(file.display_name)).length < 2;

    const tabs: TabsProps['items'] = [
        {
            key: COURSE_FILES,
            label: '课程文件',
            disabled: operating,
            children: <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses.data} />
        },
        {
            key: MY_FILES,
            disabled: operating,
            label: '我的文件(beta)',
        }
    ]

    const getSupportedMergeFiles = () => {
        return (selectedEntries as File[]).filter(f => isMergableFileType(f.display_name));
    }

    return <BasicLayout>
        {contextHolder}
        {previewer}
        {modal}
        <FileOrderSelectModal open={openFileOrderSelectModal}
            handleOk={(items) => {
                setOpenFileOrderSelectModal(false);
                const files = items.map(item => item.data as File);
                mergePDFs(files);
            }}
            handleCancel={() => setOpenFileOrderSelectModal(false)} files={getSupportedMergeFiles()} />
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <Tabs items={tabs} onChange={setSection} />
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
                    disabled={!parentFolderId}
                    onClick={backToRootDir}
                >
                    根目录
                </Button>
            </Space>
            {currentFolderFullName && <span>当前目录：{currentFolderFullName}</span>}
            <Table style={{ width: "100%" }}
                columns={fileColumns}
                loading={baseURL.isLoading || loading}
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
                <Button disabled={operating || selectedEntries.length === 0} onClick={handleDownloadSelectedFiles}>下载</Button>
                <Button disabled={operating || noSelectedPDFs} onClick={() => setOpenFileOrderSelectModal(true)}>合并 Word/PDF/PPTX</Button>
            </Space>
            <Divider orientation="left">Word/PDF/PPTX (混合)合并</Divider>
            {merger}
            <Divider orientation="left">文件下载</Divider>
            {section === COURSE_FILES && selectedCourseId > 0 && <Button onClick={handleSyncFiles}>一键同步</Button>}
            <FileDownloadTable
                tasks={downloadTasks}
                handleRemoveTask={handleRemoveTask}
                handleDownloadFile={handleDownloadFile}
                handleOpenTaskFile={handleOpenTaskFile}
            />
        </Space>
    </BasicLayout>
}
