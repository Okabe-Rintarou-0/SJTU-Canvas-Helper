import { Button, Checkbox, CheckboxProps, Divider, Input, Space, Table, message } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useMemo, useState } from "react";
import { Course, Entry, entryName, File, FileDownloadTask, Folder, isFile } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import { useLoginModal, useMerger, usePreview } from "../lib/hooks";
import { FolderOutlined, HomeOutlined, LeftOutlined } from "@ant-design/icons"
import { getFileIcon } from "../lib/utils";

interface DownloadInfo {
    course: Course;
    folderPath: string;
}

export default function FilesPage() {
    const MAIN_FOLDER = 'course files';
    const [courses, setCourses] = useState<Course[]>([]);
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
    const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry, setEntries } = usePreview();
    const { merger, mergePDFs } = useMerger({ setPreviewEntry, onHoverEntry, onLeaveEntry });

    const downloadInfoMap = useMemo(() => new Map<number, DownloadInfo>(), []);

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
        handleGetFoldersAndFiles(currentFolderId);
    }, [currentFolderId]);

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
                                href={`https://oc.sjtu.edu.cn/courses/${selectedCourseId}/files?preview=${file.id}`}
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

    const getSelectedCourse = () => {
        return courses.find(course => course.id === selectedCourseId);
    }

    const initAllFolders = async (courseId: number) => {
        try {
            let courseFolders = await invoke("list_folders", { courseId }) as Folder[];
            setAllFolders(courseFolders);
            let folder = courseFolders.find(folder => folder.name === MAIN_FOLDER)!;
            setCurrentFolderId(folder.id);
            setCurrentFolderFullName(MAIN_FOLDER);
            setParentFolderId(null);
        } catch (_) {
            setAllFolders([]);
            setFiles([]);
            setFolders([]);
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
            console.log(e);
            setFiles([]);
            setFolders([]);
        }
        setOperating(false);
        setLoading(false);
    }

    const handleCourseSelect = async (courseId: number) => {
        if (courses.find(course => course.id === courseId)) {
            setSelectedCourseId(courseId);
            setSelectedEntries([]);
            await initAllFolders(courseId);
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

    const getFolderPath = (file: File) => {
        let folderPath = allFolders.find(folder => folder.id === file.folder_id)?.full_name.slice(MAIN_FOLDER.length + 1);
        return folderPath;
    }

    const handleOpenTaskFile = async (task: FileDownloadTask) => {
        const name = task.file.display_name;
        const downloadInfo = downloadInfoMap.get(task.file.folder_id)!;
        const course = downloadInfo.course;
        const folderPath = downloadInfo.folderPath;
        try {
            await invoke("open_course_file", { name, course, folderPath });
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleDownloadFile = async (file: File) => {
        const course = getSelectedCourse()!;
        const folderPath = getFolderPath(file);
        if (!downloadInfoMap.get(file.folder_id) && folderPath !== undefined) {
            downloadInfoMap.set(file.folder_id, {
                course,
                folderPath
            });
        }
        await invoke("download_course_file", { file, course, folderPath });
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
            console.log(e);
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
            await invoke("delete_course_file", { file, course, folderPath });
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
        let course = getSelectedCourse()!;
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
                handleAddDownloadFileTask(selectedEntry as File);
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
        let mainFolder = allFolders.find(folder => folder.name === MAIN_FOLDER)!;
        setCurrentFolderId(mainFolder.id);
        setCurrentFolderFullName(MAIN_FOLDER);
        setParentFolderId(null);
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
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
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
                <Button disabled={operating || selectedEntries.length === 0} onClick={handleDownloadSelectedFiles}>下载</Button>
                <Button disabled={operating || noSelectedPDFs} onClick={handleMergePDFs}>合并 PDF/PPTX</Button>
            </Space>
            <Divider orientation="left">PDF/PPTX (混合)合并</Divider>
            {merger}
            <Divider orientation="left">文件下载</Divider>
            {selectedCourseId > 0 && <Button onClick={handleSyncFiles}>一键同步</Button>}
            <FileDownloadTable
                tasks={downloadTasks}
                handleRemoveTask={handleRemoveTask}
                handleDownloadFile={handleDownloadFile}
                handleOpenTaskFile={handleOpenTaskFile}
            />
        </Space>
    </BasicLayout>
}
