import { Button, Select, Space, Table, Tag } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useState } from "react";
import { Assignment, Attachment, Course, File, FileDownloadTask, Submission, User } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import { formatDate } from "../lib/utils";
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";

export default function SubmissionsPage() {
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [courses, setCourses] = useState<Course[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
    const [selectedAssignment, setSelectedAssignment] = useState<Assignment | undefined>(undefined);
    const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>([]);
    const usersMap = new Map<number, User>(users.map(user => ([user.id, user])));

    useEffect(() => {
        initCourses();
    }, []);

    const columns = [{
        title: '学生',
        dataIndex: 'user',
        key: 'user',
    }, {
        title: '提交时间',
        dataIndex: 'submitted_at',
        key: 'submitted_at',
        render: formatDate,
    }, {
        title: '文件',
        dataIndex: 'display_name',
        key: 'display_name',
    }, {
        title: '状态',
        dataIndex: 'late',
        key: 'late',
        render: (late: boolean) => late ? <Tag color="red">迟交</Tag> : <Tag color="green">按时提交</Tag>
    }, {
        title: '操作',
        dataIndex: 'operation',
        key: 'operation',
        render: (_: any, attachment: Attachment) => (
            attachment.url ?
                <a onClick={e => {
                    e.preventDefault();
                    handleDownloadAttachment(attachment);
                }}>下载</a> : '未开放下载'
        ),
    }];

    const handleGetUsers = async (courseId: number) => {
        if (courseId === -1) {
            return;
        }
        setOperating(true);
        try {
            let users = await invoke("list_course_students", { courseId }) as User[];
            users.map(user => user.key = user.id);
            setUsers(users);
        } catch (e) {
            messageApi.error(e as string);
        }
        setOperating(false);
    }

    const handleGetAssignments = async (courseId: number) => {
        if (courseId === -1) {
            return;
        }
        setOperating(true);
        try {
            let assignments = await invoke("list_course_assignments", { courseId }) as Assignment[];
            assignments.map(assignment => assignment.key = assignment.id);
            setAssignments(assignments);
        } catch (e) {
            messageApi.error(e as string);
        }
        setOperating(false);
    }

    const handleGetSubmissions = async (courseId: number, assignmentId: number) => {
        if (courseId === -1) {
            return;
        }
        setOperating(true);
        try {
            let submissions = await invoke("list_course_assignment_submissions", { courseId, assignmentId }) as Submission[];
            let attachments: Attachment[] = [];
            for (let submission of submissions) {
                let thisAttachments = submission.attachments;
                for (let attachment of thisAttachments) {
                    attachment.user = usersMap.get(submission.user_id)?.name;
                    attachment.submitted_at = submission.submitted_at;
                    attachment.key = attachment.id;
                    attachment.late = submission.late;
                }
                attachments.push(...thisAttachments);
            }
            setAttachments(attachments);
        } catch (e) {
            messageApi.error(e as string);
        }
        setOperating(false);
    }

    const initCourses = async () => {
        try {
            let courses = await invoke("list_ta_courses") as Course[];
            setCourses(courses);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const updateTaskProgress = (uuid: string, progress: number) => {
        setDownloadTasks(tasks => {
            let task = tasks.find(task => task.file.uuid === uuid);
            if (task) {
                task.progress = Math.ceil(progress);
            }
            return [...tasks];
        });
    }

    const handleDownloadAttachment = async (attachment: Attachment) => {
        let file = {
            id: attachment.id,
            uuid: attachment.uuid,
            url: attachment.url,
            display_name: attachment.user + "_" + attachment.display_name,
            folder_id: attachment.folder_id,
            locked: attachment.locked,
            filename: attachment.filename,
            size: attachment.size,
        } as File;
        try {
            let task = downloadTasks.find(task => task.file.uuid === file.uuid);
            if (!task) {
                setDownloadTasks(tasks => [...tasks, {
                    key: file.uuid,
                    file,
                    progress: 0
                } as FileDownloadTask]);
            } else if (task.progress !== 100) {
                messageApi.warning("当前任务正在下载！请勿重复添加！");
                return;
            }
            await invoke("download_file", { file });
            updateTaskProgress(file.uuid, 100);
            messageApi.success("下载成功！", 0.5);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleCourseSelect = async (selected: string) => {
        let selectedCourse = courses.find(course => course.name === selected);
        if (selectedCourse) {
            setSelectedCourseId(selectedCourse.id);
            handleGetUsers(selectedCourse.id);
            handleGetAssignments(selectedCourse.id);
        }
    }

    const handleAssignmentSelect = (selected: string) => {
        let assignment = assignments.find(assignment => assignment.name === selected);
        setSelectedAssignment(assignment);
        if (assignment) {
            handleGetSubmissions(selectedCourseId, assignment.id);
        }
    }

    const handleAttachmentSelect = (_: React.Key[], selectedAttachments: Attachment[]) => {
        setSelectedAttachments(selectedAttachments);
    }

    const handleDownloadSelectedAttachments = () => {
        for (let selectedAttachment of selectedAttachments) {
            handleDownloadAttachment(selectedAttachment);
        }
    }

    const handleRemoveTask = async (taskToRemove: FileDownloadTask) => {
        setDownloadTasks(tasks => tasks.filter(task => task.file.uuid !== taskToRemove.file.uuid));
        try {
            await invoke("delete_file", { file: taskToRemove.file });
            messageApi.success("删除成功！", 0.5);
        } catch (e) {
            messageApi.error(e as string)
        }
    }

    const assignmentOptions = assignments.map(assignment => ({
        label: assignment.name,
        value: assignment.name,
    }));

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} />
            <Space>
                <span>选择作业：</span>
                <Select
                    style={{ width: 300 }}
                    disabled={operating}
                    onChange={handleAssignmentSelect}
                    value={selectedAssignment?.name}
                    defaultValue={selectedAssignment?.name}
                    options={assignmentOptions}
                />
            </Space>
            <Table style={{ width: "100%" }}
                columns={columns}
                dataSource={attachments}
                pagination={false}
                rowSelection={{ onChange: handleAttachmentSelect }}
            />
            <Button disabled={operating} onClick={handleDownloadSelectedAttachments}>下载</Button>
            <FileDownloadTable tasks={downloadTasks} handleRemoveTask={handleRemoveTask} />
        </Space>
    </BasicLayout>
}