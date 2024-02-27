import { Select, Space, Table } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import { Course, File } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";

export default function FilePage() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<string>("");
    const [files, setFiles] = useState<File[]>([]);
    const [messageApi, contextHolder] = useMessage();
    useEffect(() => {
        initCourses();
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
                setFiles(files);
            } catch (_) {
                setFiles([]);
            }
        }
    }

    const handleDownloadFile = async (file: File) => {
        try {
            await invoke("download_file", { url: file.url, outPath: file.display_name });
            messageApi.success("下载成功！");
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const columns = [
        {
            title: '文件名',
            dataIndex: 'display_name',
            key: 'display_name',
        },
        {
            title: '操作',
            dataIndex: 'operation',
            render: (_: any, file: File) => (
                <Space size="middle">
                    <a onClick={e => {
                        e.preventDefault();
                        handleDownloadFile(file);
                    }}>下载</a>
                </Space>
            ),
        }
    ];

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%" }} >
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
            <Table style={{ width: "100%" }} columns={columns} dataSource={files.map(f => ({
                ...f,
                key: f.id
            }))} />
        </Space>
    </BasicLayout>
}