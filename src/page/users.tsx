import { invoke } from "@tauri-apps/api/core";
import { Button, Form, Input, message, Space, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import { useCurrentTermCourses } from "../lib/hooks";
import { ExportUsersConfig, User } from "../lib/model";
import { formatDate } from "../lib/utils";

export default function UsersPage() {
  const [operating, setOperating] = useState<boolean>(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [form] = Form.useForm<ExportUsersConfig>();
  const courses = useCurrentTermCourses();

  useEffect(() => {
    form.setFieldsValue({ save_name: "用户名单" } as ExportUsersConfig);
  }, [form]);

  const handleGetUsers = useCallback(async (courseId: number) => {
    if (courseId === -1) {
      return;
    }
    setOperating(true);
    try {
      let users = (await invoke("list_course_users", { courseId })) as User[];
      users.forEach((user) => (user.key = user.id));
      setUsers(users);
    } catch (e) {
      message.error(e as string);
    } finally {
      setOperating(false);
    }
  }, []);

  const columns = [
    "id",
    "name",
    "email",
    "created_at",
    "sortable_name",
    "short_name",
    "login_id",
  ].map((column) => ({
    title: column,
    dataIndex: column,
    key: column,
    render: column === "created_at" ? formatDate : undefined,
  }));

  const handleCourseSelect = useCallback(async (courseId: number) => {
    if (courses.data.find((course) => course.id === courseId)) {
      setSelectedUsers([]);
      setUsers([]);
      handleGetUsers(courseId);
    }
  }, [courses.data, handleGetUsers]);

  const handleSelected = useCallback((_: React.Key[], selectedUsers: User[]) => {
    setSelectedUsers(selectedUsers);
  }, []);

  const handleExport = useCallback(async (config: ExportUsersConfig) => {
    try {
      await invoke("export_users", {
        users: selectedUsers,
        saveName: config.save_name + ".xlsx",
      });
      message.success("导出成功！🎉", 0.5);
    } catch (e) {
      message.error(e as string);
    }
  }, [selectedUsers]);

  const handleExportAll = useCallback(async (config: ExportUsersConfig) => {
    try {
      await invoke("export_users", {
        users: users,
        saveName: config.save_name + ".xlsx",
      });
      message.success("导出全部成功！🎉", 0.5);
    } catch (e) {
      message.error(e as string);
    }
  }, [users]);

  return (
    <BasicLayout>
      <Space
        direction="vertical"
        style={{ width: "100%", overflow: "scroll" }}
        size={"large"}
      >
        <CourseSelect
          onChange={handleCourseSelect}
          disabled={operating}
          courses={courses.data}
        />
        <Table
          style={{ width: "100%" }}
          loading={operating}
          columns={columns}
          dataSource={users}
          pagination={false}
          rowSelection={{
            onChange: handleSelected,
            selectedRowKeys: selectedUsers.map((user) => user.key),
          }}
          locale={{
            emptyText: operating ? "加载中..." : "暂无用户数据",
          }}
        />
        <Form
          form={form}
          layout="vertical"
          preserve={false}
        >
          <Form.Item
            name="save_name"
            label="导出文件名（无需扩展名）"
            rules={[{ required: true, message: '请输入导出文件名！' }]}
          >
            <Input placeholder="请输入导出文件名（无需扩展名）" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button
                disabled={operating}
                type="primary"
                htmlType="button"
                onClick={async () => {
                  try {
                    const values = await form.validateFields();
                    handleExportAll(values);
                  } catch (error) {
                    // 验证失败，表单会自动显示错误提示
                  }
                }}
              >
                导出全部
              </Button>
              <Button
                disabled={operating}
                type="default"
                htmlType="button"
                onClick={async () => {
                  try {
                    const values = await form.validateFields();
                    handleExport(values);
                  } catch (error) {
                    // 验证失败，表单会自动显示错误提示
                  }
                }}
              >
                导出
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Space>
    </BasicLayout>
  );
}
