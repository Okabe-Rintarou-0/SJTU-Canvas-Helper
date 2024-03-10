import { Button, Input, Select, Space, Table, Tag } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useState } from "react";
import { Assignment, Attachment, Course, FileDownloadTask, GradeStatistic, Submission, User } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import { attachmentToFile, formatDate } from "../lib/utils";
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import GradeStatisticChart from "../components/grade_statistic";
import { usePreview } from "../lib/hooks";

export default function SubmissionsPage() {
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [courses, setCourses] = useState<Course[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
    const [selectedAssignment, setSelectedAssignment] = useState<Assignment | undefined>(undefined);
    const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>([]);
    const usersMap = new Map<number, User>(users.map(user => ([user.id, user])));
    const [statistic, setStatistic] = useState<GradeStatistic | undefined>(undefined);
    const [keyword, setKeyword] = useState<string>("");

    const { previewer, onHoverFile, onLeaveFile, setPreviewFile } = usePreview();

    useEffect(() => {
        initCourses();
    }, []);

    const validateGrade = (grade: string) => {
        if (grade.length === 0) {
            return true;
        }
        let maxGrade = selectedAssignment?.points_possible;
        let gradeNumber;
        try {
            gradeNumber = Number.parseFloat(grade);
        } catch (_) {
            return false;
        }
        return 0 <= gradeNumber && (!maxGrade || gradeNumber <= maxGrade);
    }

    const gatherGrades = (attachments: Attachment[]): [number[], number] => {
        let grades = []
        let visitSet = new Set<number>();
        let userId;
        for (let attachment of attachments) {
            userId = attachment.user_id;
            if (!visitSet.has(userId)) {
                visitSet.add(userId);
                if (attachment.grade) {
                    grades.push(Number.parseFloat(attachment.grade));
                }
            }
        }
        let total = visitSet.size;
        return [grades, total];
    }

    const updateGradeStatistic = (attachments: Attachment[]) => {
        let [grades, total] = gatherGrades(attachments);
        let statistic = { grades, total } as GradeStatistic;
        setStatistic(statistic);
    }

    const handleGrade = async (grade: string, attachment: Attachment) => {
        if (!validateGrade(grade)) {
            messageApi.error("请输入正确格式的评分（不超过上限的正数或空字符串）！🙅🙅🙅");
            return;
        }
        try {
            await invoke("update_grade", {
                courseId: selectedCourseId,
                assignmentId: selectedAssignment?.id,
                studentId: attachment.user_id,
                grade
            });
            attachments.filter(thisAttachment => thisAttachment.user_id === attachment.user_id)
                .map(attachment => attachment.grade = grade);
            setAttachments([...attachments]);
            updateGradeStatistic(attachments);
            messageApi.success("打分成功！🎉", 0.5);
        } catch (e) {
            console.log(e as string);
            messageApi.error(e as string);
        }
    }

    const readonlyGrade = selectedAssignment?.needs_grading_count === null;

    const columns = [{
        title: '学生',
        dataIndex: 'user',
        key: 'user',
    }, {
        title: '分数',
        dataIndex: 'grade',
        key: 'grade',
        render: (grade: string | null, attachment: Attachment) => <Input disabled={readonlyGrade} defaultValue={grade ?? ""}
            placeholder="输入成绩并按回车以打分"
            onPressEnter={(ev) => handleGrade(ev.currentTarget.value, attachment)} />
    }, {
        title: '文件',
        dataIndex: 'display_name',
        key: 'display_name',
        render: (name: string, attachment: Attachment) => <a
            onMouseEnter={() => onHoverFile(attachmentToFile(attachment))}
            onMouseLeave={onLeaveFile}
        >
            {name}
        </a>
    }, {
        title: '提交时间',
        dataIndex: 'submitted_at',
        key: 'submitted_at',
        render: formatDate,
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
            <Space>
                {attachment.url && <a onClick={e => {
                    e.preventDefault();
                    handleDownloadAttachment(attachment);
                }}>下载</a>}
                <a onClick={e => {
                    e.preventDefault();
                    setPreviewFile(attachmentToFile(attachment));
                }}>预览</a>
            </Space>
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
        if (courseId === -1 || assignmentId === -1) {
            return;
        }
        setOperating(true);
        setLoading(true);
        try {
            let submissions = await invoke("list_course_assignment_submissions", { courseId, assignmentId }) as Submission[];
            let attachments: Attachment[] = [];
            for (let submission of submissions) {
                let thisAttachments = submission.attachments;
                for (let attachment of thisAttachments) {
                    attachment.user = usersMap.get(submission.user_id)?.name;
                    attachment.user_id = submission.user_id;
                    attachment.submitted_at = submission.submitted_at;
                    attachment.grade = submission.grade;
                    attachment.key = attachment.id;
                    attachment.late = submission.late;
                }
                attachments.push(...thisAttachments);
            }
            setAttachments(attachments);
            updateGradeStatistic(attachments);
        } catch (e) {
            messageApi.error(e as string);
        }
        setOperating(false);
        setLoading(false);
    }

    const initCourses = async () => {
        try {
            let courses = await invoke("list_ta_courses") as Course[];
            setCourses(courses);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleDownloadAttachment = async (attachment: Attachment) => {
        let file = attachmentToFile(attachment);
        if (!downloadTasks.find(task => task.file.uuid === file.uuid)) {
            setDownloadTasks(tasks => [...tasks, {
                key: file.uuid,
                file,
                progress: 0
            } as FileDownloadTask]);
        } else {
            messageApi.warning("当前任务已存在！请勿重复添加！");
            return;
        }
    }

    const handleCourseSelect = async (courseId: number) => {
        if (courses.find(course => course.id === courseId)) {
            setAttachments([]);
            setSelectedAttachments([]);
            setStatistic(undefined);
            setSelectedAssignment(undefined);
            setSelectedCourseId(courseId);
            handleGetUsers(courseId);
            handleGetAssignments(courseId);
        }
    }

    const handleAssignmentSelect = (assignmentId: number) => {
        setStatistic(undefined);
        setAttachments([]);
        setSelectedAttachments([]);
        let assignment = assignments.find(assignment => assignment.id === assignmentId);
        if (assignment) {
            setSelectedAssignment(assignment);
            handleGetSubmissions(selectedCourseId, assignmentId);
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
            // messageApi.success("删除成功🎉！", 0.5);
        } catch (e) {
            if (taskToRemove.state !== "fail") {
                // no need to show error message for already failed tasks
                messageApi.error(e as string);
            }
        }
    }

    const assignmentOptions = assignments.map(assignment => ({
        label: assignment.name,
        value: assignment.id,
    }));

    const shouldShow = (attachment: Attachment) => {
        return attachment.user && attachment.user.indexOf(keyword) !== -1;
    }

    return <BasicLayout>
        {contextHolder}
        {previewer}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} />
            <Space>
                <span>选择作业：</span>
                <Select
                    style={{ width: 300 }}
                    disabled={operating}
                    onChange={handleAssignmentSelect}
                    value={selectedAssignment?.id}
                    defaultValue={selectedAssignment?.id}
                    options={assignmentOptions}
                />
            </Space>
            {
                selectedAssignment?.points_possible &&
                <span>满分：<b>{selectedAssignment.points_possible}</b>分</span>
            }
            {statistic && <GradeStatisticChart statistic={statistic} />}
            <Input.Search placeholder="输入文件关键词" onSearch={setKeyword} />
            <Table style={{ width: "100%" }}
                columns={columns}
                loading={loading}
                dataSource={attachments.filter(attachment => shouldShow(attachment))}
                pagination={false}
                rowSelection={{ onChange: handleAttachmentSelect, selectedRowKeys: selectedAttachments.map(attachment => attachment.key) }}
            />
            <Button disabled={operating} onClick={handleDownloadSelectedAttachments}>下载</Button>
            <FileDownloadTable tasks={downloadTasks} handleRemoveTask={handleRemoveTask} />
        </Space>
    </BasicLayout>
}