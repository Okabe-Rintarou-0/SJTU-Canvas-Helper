import { Button, Checkbox, CheckboxProps, Form, Input, Select, Space, Table } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useState } from "react";
import { Course, ExportUsersConfig, User } from "../lib/model";
import { invoke } from "@tauri-apps/api";

export default function UsersPage() {
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [onlyExportStudents, setOnlyExportStudents] = useState<boolean>(true);
    const [courses, setCourses] = useState<Course[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
    // const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [form] = Form.useForm<ExportUsersConfig>();
    useEffect(() => {
        initCourses();
        form.setFieldsValue({ save_name: "用户名单" } as ExportUsersConfig)
    }, []);

    const handleGetUsers = async (courseId: number) => {
        setOperating(true);
        try {
            let users = onlyExportStudents ?
                await invoke("list_course_students", { courseId }) as User[]
                : await invoke("list_course_users", { courseId }) as User[];
            users.map(user => user.key = user.id);
            setUsers(users);
        } catch (e) {
            messageApi.error(e as string);
        }
        setOperating(false);
    }

    const columns = ['id', 'name', 'created_at', 'sortable_name', 'short_name', 'login_id', 'email'].map(column => ({
        title: column,
        dataIndex: column,
        key: column,
    }));

    const initCourses = async () => {
        try {
            let courses = await invoke("list_courses") as Course[];
            setCourses(courses);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleCourseSelect = async (selected: string) => {
        let selectedCourse = courses.find(course => course.name === selected);
        if (selectedCourse) {
            // setSelectedCourseId(selectedCourse.id);
            handleGetUsers(selectedCourse.id);
        }
    }

    const handleSelected = (_: React.Key[], selectedUsers: User[]) => {
        setSelectedUsers(selectedUsers);
    }

    const handleExport = async (config: ExportUsersConfig) => {
        try {
            await invoke("export_users", { users: selectedUsers, saveName: config.save_name + '.xlsx' });
            messageApi.success("导出成功！🎉", 0.5);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleSetOnlyExportStudents: CheckboxProps['onChange'] = (e) => {
        setOnlyExportStudents(e.target.checked);
    }

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
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
            <Checkbox onChange={handleSetOnlyExportStudents} defaultChecked>只导出学生</Checkbox>
            <Table style={{ width: "100%" }}
                columns={columns}
                dataSource={users}
                pagination={false}
                rowSelection={{ onChange: handleSelected }}
            />
            <Form
                form={form}
                layout="vertical"
                onFinish={handleExport}
                preserve={false}
            >
                <Form.Item name="save_name" label="导出文件名（无需扩展名）">
                    <Input placeholder="请输入导出文件名（无需扩展名）" />
                </Form.Item>
                <Form.Item>
                    <Button disabled={operating} type="primary" htmlType="submit">
                        导出
                    </Button>
                </Form.Item>
            </Form>
        </Space>
    </BasicLayout>
}