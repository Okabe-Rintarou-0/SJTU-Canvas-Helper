import { Badge, Button, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import { usePreview } from "../lib/hooks";
import { File } from "../lib/model";
import CourseFileSelectModal from "./course_file_select_modal";

interface CourseFileSelectorProps {
    courseId: number;        // 课程ID，用于获取课程文件列表
    initialFiles: File[];    // 初始选中的文件列表
    onSelectFiles?: (files: File[]) => void; // 文件选择变化时的回调函数
}

/**
 * 课程文件选择器组件
 * 用于选择课程相关的文件，并提供文件预览和删除功能
 */
function CourseFileSelector({ courseId, initialFiles, onSelectFiles }: CourseFileSelectorProps) {
    const [showModal, setShowModal] = useState<boolean>(false); // 控制文件选择模态框的显示
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]); // 当前选中的文件列表
    const { previewer, onHoverEntry, onLeaveEntry } = usePreview(); // 文件预览相关的钩子函数

    /**
     * 处理文件选择完成事件
     */
    const handleSelect = (files: File[]) => {
        setSelectedFiles(files);
        setShowModal(false);
        onSelectFiles?.(files);
    };

    /**
     * 处理文件删除事件
     */
    const handleRemoveFile = (fileToRemove: File) => {
        const updatedFiles = selectedFiles.filter(file => file.id !== fileToRemove.id);
        setSelectedFiles(updatedFiles);
        onSelectFiles?.(updatedFiles);
    };

    /**
     * 当初始文件列表变化时，更新选中的文件列表
     */
    useEffect(() => {
        setSelectedFiles(initialFiles);
    }, [initialFiles]);

    return <>
        {previewer}
        <Space wrap>
            <span>选择课程文件：</span>
            {selectedFiles.map(file => (
                <Tag
                    key={file.id}
                    closable
                    onClose={() => handleRemoveFile(file)}
                    style={{
                        margin: '4px 0',
                        fontSize: '14px',
                        backgroundColor: '#f0f5ff',
                        borderColor: '#adc6ff'
                    }}
                    color="blue"
                >
                    <a
                        onMouseEnter={() => onHoverEntry(file)}
                        onMouseLeave={onLeaveEntry}
                        style={{
                            textDecoration: 'none',
                            color: '#1890ff',
                            display: 'inline-block',
                            padding: '0 4px'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                        onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                    >
                        {file.display_name}
                    </a>
                </Tag>
            ))}
            <Badge count={selectedFiles.length} showZero>
                <Button onClick={() => setShowModal(true)}>选择</Button>
            </Badge>
        </Space>
        <CourseFileSelectModal courseId={courseId} open={showModal}
            onCancel={() => setShowModal(false)}
            onOk={handleSelect}
        />
    </>
}

export default CourseFileSelector;