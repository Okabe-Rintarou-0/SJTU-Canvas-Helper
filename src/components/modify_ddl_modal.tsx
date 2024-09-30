import { useForm } from "antd/lib/form/Form";
import { Assignment, AssignmentDate, User } from "../lib/model";
import { Button, DatePicker, Form, Modal, Select, Space, Tag } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import useMessage from "antd/es/message/useMessage";
import { invoke } from "@tauri-apps/api";
import { consoleLog } from "../lib/utils";

const ALL_USERS = [0];
const ALL_USERS_TARGET = ALL_USERS.join(",");

interface DDLFormData {
    target: string;
    dueAt: Dayjs | null;
    lockAt: Dayjs | null;
}

export default function ModifyDDLModal({ open, assignment, courseId, handleCancel, onSuccess, onRefresh }: {
    open: boolean,
    courseId: number,
    assignment: Assignment,
    handleCancel?: () => void,
    onRefresh?: () => void,
    onSuccess?: () => void,
}) {
    const [form] = useForm<DDLFormData>();
    const [mode, setMode] = useState<"modify" | "add">("modify");
    const [messageApi, contextHolder] = useMessage();
    const [users, setUsers] = useState<User[]>([]);
    const [overrideUserIds, setOverrideUserIds] = useState<number[][]>([ALL_USERS]);
    const [userIdToAdd, setUserIdToAdd] = useState<number | undefined>(undefined);
    const [availableUsers, setAvailableUsers] = useState<User[]>([]);
    const [needRefresh, setNeedRefresh] = useState<boolean>(false);

    const getTargetDate = (target: string) => {
        // is all user
        if (target === ALL_USERS_TARGET) {
            return assignment.all_dates.find(date => date.base);
        }
        const overrideId = assignment.overrides.find(override => override.student_ids.join(",") === target)?.id;
        const date = assignment.all_dates.find(date => date.id === overrideId);
        return date;
    }

    const [targetDate, setTargetDate] = useState<AssignmentDate | undefined>(undefined);

    const userMap = useMemo(() => {
        const map = new Map<number, User>();
        users.map(user => map.set(user.id, user));
        return map;
    }, [users]);

    useEffect(() => {
        if (targetDate) {
            form.setFieldValue("dueAt", targetDate?.due_at ? dayjs(targetDate.due_at) : undefined);
            form.setFieldValue("lockAt", targetDate?.lock_at ? dayjs(targetDate.lock_at) : undefined);
        }
    }, [targetDate]);

    useEffect(() => {
        const handleInitUsers = async () => {
            try {
                const users = await invoke("list_course_students", { courseId }) as User[];
                setUsers(users);
            } catch (e) {
                consoleLog(e);
            }
        }
        handleInitUsers();
    }, []);

    const init = () => {
        form.setFieldValue("target", ALL_USERS_TARGET);
        setTargetDate(getTargetDate(ALL_USERS_TARGET));
    }

    useEffect(() => {
        if (open === false) {
            return;
        }
        init();
        setMode("modify");
        setNeedRefresh(false);
        setOverrideUserIds([ALL_USERS, ...assignment.overrides.map(override => override.student_ids)]);
    }, [assignment, open]);

    useEffect(() => {
        const existedUsers = new Set<number>;
        overrideUserIds.map(ids => ids.map(id => existedUsers.add(id)));
        setAvailableUsers(users.filter(user => !existedUsers.has(user.id)));
    }, [overrideUserIds, users]);

    const handleModifyAssignmentDDL = async (dueAt?: string, lockAt?: string) => {
        invoke("modify_assignment_ddl", {
            dueAt,
            lockAt,
            courseId,
            assignmentId: assignment.id
        });
    }

    const handleModifyAssignmentDDLOverride = async (dueAt?: string, lockAt?: string) => {
        const overrideId = targetDate?.id;
        if (!overrideId) {
            return;
        }
        invoke("modify_assignment_ddl_override", {
            dueAt,
            lockAt,
            overrideId,
            courseId,
            assignmentId: assignment.id
        });
    }

    const handleAddAssignmentDDLOverride = async (studentId: number, studentName: string, dueAt?: string, lockAt?: string) => {
        invoke("add_assignment_ddl_override", {
            dueAt,
            lockAt,
            studentId,
            courseId,
            title: studentName,
            assignmentId: assignment.id
        });
    }

    const handleDeleteAssignmentDDLOverride = async (overrideId: number) => {
        try {
            await invoke("delete_assignment_ddl_override", {
                courseId,
                assignmentId: assignment.id,
                overrideId
            });
            messageApi.success('删除成功！🎉');
            const overrideToDelete = assignment.overrides.find(override => override.id === overrideId);
            if (overrideToDelete) {
                const targetToDelete = overrideToDelete.student_ids.join(",");
                setOverrideUserIds(ids => ids.filter(ids => ids.join(",") !== targetToDelete));
            }
            init();
            setNeedRefresh(true);
        } catch (e) {
            messageApi.error(`删除失败☹️：${e}`);
        }
    }

    const handleSubmit = async ({ dueAt, lockAt, target }: DDLFormData) => {
        const newDueAt = dueAt?.toISOString();
        const newLockAt = lockAt?.toISOString();
        const modifyAll = target === ALL_USERS_TARGET;
        try {
            if (mode === "modify") {
                if (modifyAll) {
                    await handleModifyAssignmentDDL(newDueAt, newLockAt);
                } else {
                    await handleModifyAssignmentDDLOverride(newDueAt, newLockAt);
                }
                await messageApi.success("修改成功！🎉", 0.5);
            } else {
                const studentId = Number.parseInt(target);
                const studentName = userMap.get(studentId)?.name ?? "学生";
                await handleAddAssignmentDDLOverride(studentId, studentName, newDueAt, newLockAt);
                await messageApi.success("添加成功！🎉", 0.5);
            }
            onSuccess?.();
        } catch (e) {
            messageApi.error(`修改失败：${e}☹️`);
        }
    }

    const options = overrideUserIds.map(ids => ({
        value: ids.join(","),
        label: <Space>{ids.map(id => id === 0 ? <Tag key={id}>{overrideUserIds.length > 1 ? "其他所有人" : "所有人"}</Tag> :
            <Tag key={id}>{userMap.get(id)?.name}</Tag>
        )}</Space>
    }));

    const handleCancelModal = () => {
        handleCancel?.();
        if (needRefresh) {
            onRefresh?.();
            setNeedRefresh(false);
        }
    };

    return <Modal open={open} onCancel={handleCancelModal}
        onOk={() => {
            form
                .validateFields()
                .then(data => {
                    handleSubmit(data);
                });
        }}>
        {contextHolder}
        <Form style={{ marginTop: "30px" }} form={form} onFinish={handleSubmit} preserve={false}>
            <Form.Item>
                {mode === "modify" && <Space>
                    <Form.Item key="modify" style={{ marginBottom: "0px" }} label="目标" name="target" initialValue={ALL_USERS_TARGET}>
                        <Select onChange={(target) => setTargetDate(getTargetDate(target))} style={{ width: "200px" }}
                            key="modify" options={options} />
                    </Form.Item>
                    <Button onClick={() => {
                        setMode("add");
                        form.setFieldValue("target", "");
                    }}>添加目标</Button>
                    <Button disabled={targetDate?.base !== false} type="primary" onClick={() => handleDeleteAssignmentDDLOverride(targetDate!.id)}>删除当前目标</Button>
                </Space>}
                {mode === "add" && <Space>
                    <Form.Item key="add" style={{ marginBottom: "0px" }} label="目标" name="target">
                        <Select key="add" value={userIdToAdd} onChange={setUserIdToAdd} style={{ width: "200px" }}
                            options={availableUsers.map(user => ({
                                label: user.name,
                                value: user.id
                            }))}
                            showSearch
                            filterOption={(inputValue, option) => {
                                const id = option?.value;
                                const user = availableUsers.find(user => user.id === id);
                                const containsInName = user?.name.indexOf(inputValue) !== -1;
                                const containsInId = user?.login_id?.toString().indexOf(inputValue) !== -1;
                                return containsInName || containsInId;
                            }}
                            placeholder="输入姓名或学号搜索"
                        />
                    </Form.Item>
                    <Button type="primary" onClick={() => {
                        setMode("modify");
                        init();
                    }}>修改原有目标</Button>
                </Space>}
            </Form.Item>
            <Form.Item label="截止时间" name="dueAt">
                <DatePicker showMinute showHour showTime />
            </Form.Item>
            <Form.Item label="结束时间" name="lockAt">
                <DatePicker showMinute showHour showTime />
            </Form.Item>
        </Form>
    </Modal >
}