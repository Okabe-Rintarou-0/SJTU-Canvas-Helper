import { useEffect, useState } from "react";
import CourseFileSelectModal from "./course_file_select_modal";
import { Button, Space } from "antd";
import { File } from "../lib/model";
import { usePreview } from "../lib/hooks";

export default function CourseFileSelector({ courseId, initialFiles, onSelectFiles }: { courseId: number, initialFiles: File[], onSelectFiles?: (files: File[]) => void }) {
    const [showModal, setShowModal] = useState<boolean>(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const { previewer, onHoverEntry, onLeaveEntry } = usePreview();

    const handleSelect = (files: File[]) => {
        setSelectedFiles(files);
        setShowModal(false);
        onSelectFiles?.(files);
    }

    useEffect(() => {
        setSelectedFiles(initialFiles);
    }, [initialFiles]);

    return <>
        {previewer}
        <Space>
            <span>选择课程文件：</span>
            {selectedFiles.map(file => <a key={file.id}
                onMouseEnter={() => onHoverEntry(file)}
                onMouseLeave={onLeaveEntry}>
                {file.display_name}
            </a>)}
            <Button onClick={() => setShowModal(true)}>选择</Button>
        </Space>
        <CourseFileSelectModal courseId={courseId} open={showModal}
            onCancel={() => setShowModal(false)}
            onOk={handleSelect}
        />
    </>
}