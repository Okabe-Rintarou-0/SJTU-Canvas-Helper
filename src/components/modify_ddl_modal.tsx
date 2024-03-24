import { useForm } from "antd/lib/form/Form";
import { Assignment } from "../lib/model";
import { DatePicker, Form, Modal } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { useEffect } from "react";
import useMessage from "antd/es/message/useMessage";
import { invoke } from "@tauri-apps/api";

interface DDLFormData {
    dueAt: Dayjs | null;
    lockAt: Dayjs | null;
}

export default function ModifyDDLModal({ open, assignment, courseId, handleCancel, onSuccess }: {
    open: boolean,
    courseId: number,
    assignment: Assignment,
    handleCancel?: () => void,
    onSuccess?: () => void,
}) {
    const [form] = useForm<DDLFormData>();
    const [messageApi, contextHolder] = useMessage();

    useEffect(() => {
        form.setFieldsValue({
            dueAt: assignment.due_at ? dayjs(assignment.due_at) : null,
            lockAt: assignment.lock_at ? dayjs(assignment.lock_at) : null,
        });
    }, [assignment]);

    const handleSubmit = async ({ dueAt, lockAt }: DDLFormData) => {
        const newDueAt = dueAt?.toISOString();
        const newLockAt = lockAt?.toISOString();
        console.log(newDueAt, newLockAt);

        try {
            await invoke("modify_assignment_ddl", {
                dueAt: newDueAt,
                lockAt: newLockAt,
                courseId,
                assignmentId: assignment.id
            });
            await messageApi.success("修改成功！", 0.5);
            onSuccess?.();
        } catch (e) {
            messageApi.error(`修改失败：${e}☹️`);
        }
    }

    return <Modal open={open} onCancel={handleCancel}
        onOk={() => {
            form
                .validateFields()
                .then(data => {
                    handleSubmit(data);
                });
        }}>
        {contextHolder}
        <Form form={form} onFinish={handleSubmit} preserve={false}>
            <Form.Item label="截止时间" name="dueAt">
                <DatePicker showMinute showHour showTime />
            </Form.Item>
            <Form.Item label="结束时间" name="lockAt">
                <DatePicker showMinute showHour showTime />
            </Form.Item>
        </Form>
    </Modal >
}