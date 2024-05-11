import { useEffect, useState } from "react";
import { useCourseFolders, useFolderFiles, useFolderFolders, usePreview } from "../lib/hooks";
import { Entry, Folder, File, isFile } from "../lib/model";
import { Button, Empty, Modal, Space, Spin } from "antd";
import { HomeOutlined, LeftOutlined } from "@ant-design/icons"
import EntryIconText from "./entry_icon_text";

export default function CourseFileSelectModal({ courseId, open, onOk, onCancel }: {
    courseId: number,
    open: boolean,
    onOk: (files: File[]) => void,
    onCancel: () => void
}) {
    const [currentFolder, setCurrentFolder] = useState<Folder | undefined>();
    const [folderMap, setFolderMap] = useState<Map<number, Folder>>(new Map<number, Folder>());
    const [rootFolder, setRootFolder] = useState<Folder | undefined>();
    const [entries, setEntries] = useState<Entry[]>([]);
    const allFolders = useCourseFolders(courseId);
    const folders = useFolderFolders(currentFolder?.id);
    const files = useFolderFiles(currentFolder?.id);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const { previewer, onHoverEntry, onLeaveEntry } = usePreview();

    useEffect(() => {
        if (!allFolders.data) {
            return;
        }
        const folderMap = new Map<number, Folder>();
        for (let folder of allFolders.data) {
            folderMap.set(folder.id, folder);
            if (folder.name === "course files") {
                setCurrentFolder(folder);
                setRootFolder(folder);
            }
        }
        setFolderMap(folderMap);
    }, [allFolders.data]);

    useEffect(() => {
        if (folders.isLoading || files.isLoading) {
            return;
        }
        if (folders.data && files.data) {
            setEntries([...folders.data, ...files.data]);
        }
    }, [folders.data, files.data]);

    const handleSelect = (entry: Entry) => {
        if (isFile(entry)) {
            const file = entry as File;
            if (!selectedFiles.find(file => file.id === entry.id)) {
                setSelectedFiles([...selectedFiles, file]);
            } else {
                setSelectedFiles(selectedFiles.filter(file => file.id !== entry.id));
            }
        }
    }

    const handleEnter = (entry: Entry) => {
        if (isFile(entry)) {
            return;
        }
        setEntries([]);
        setSelectedFiles([]);
        const folder = entry as Folder;
        setCurrentFolder(folder);
    }

    const backToParentDir = () => {
        const parentId = currentFolder?.parent_folder_id;
        if (!parentId) {
            return;
        }
        setCurrentFolder(folderMap.get(parentId));
    }

    const backToRootDir = () => {
        setCurrentFolder(rootFolder);
    }

    return <Modal open={open} width={"90%"} title={"选择文件"} onCancel={onCancel} onOk={() => onOk(selectedFiles)}>
        {entries.length === 0 && <Empty />}
        {previewer}
        <Spin spinning={folders.isLoading || files.isLoading}>
            <Space direction="vertical">
                <Space>
                    <Button
                        icon={<LeftOutlined />}
                        disabled={!currentFolder?.parent_folder_id}
                        onClick={backToParentDir}
                    >
                        上级目录
                    </Button>
                    <Button
                        icon={<HomeOutlined />}
                        disabled={!currentFolder?.parent_folder_id}
                        onClick={backToRootDir}
                    >
                        根目录
                    </Button>
                </Space>
                <Space wrap>
                    {entries.map(entry => <EntryIconText key={entry.id} entry={entry}
                        selected={selectedFiles.find(file => file.id === entry.id) != undefined}
                        onEnter={handleEnter}
                        onSelect={handleSelect}
                        onHover={onHoverEntry}
                        onLeaveHover={onLeaveEntry}
                    />)}
                </Space>
            </Space>
        </Spin>
    </Modal>
}