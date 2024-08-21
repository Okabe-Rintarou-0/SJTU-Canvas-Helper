import { Button, Input, Popconfirm, Select, Space, Table, Tag } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Assignment, Attachment, File, FileDownloadTask, GradeStatistic, Submission, User } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import { assignmentIsNotUnlocked, attachmentToFile, formatDate } from "../lib/utils";
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import GradeStatisticChart from "../components/grade_statistic";
import { useMe, usePreview, useTAOrTeacherCourses } from "../lib/hooks";
import CommentPanel from "../components/comment_panel";
import { WarningOutlined } from "@ant-design/icons"
import CourseFileSelector from "../components/course_file_selector";
import { getConfig, saveConfig } from "../lib/store";
import type { SelectProps } from 'antd';


export default function SubmissionsPage() {
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [users, setUsers] = useState<User[]>([]);
    const [options, setOptions] = useState<SelectProps['options']>([]);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
    const [selectedAssignment, setSelectedAssignment] = useState<Assignment | undefined>(undefined);
    const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>([]);
    const usersMap = useMemo(() => new Map<number, User>(users.map(user => ([user.id, user]))), [users]);
    const [statistic, setStatistic] = useState<GradeStatistic | undefined>(undefined);
    const [keywords, setKeywords] = useState<string[]>([""]);
    const [attachmentToComment, setAttachmentToComment] = useState<number>(-1);
    const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);
    const [previewFooter, setPreviewFooter] = useState<ReactNode>(undefined);
    const [commentingWhilePreviewing, setCommentingWhilePreviewing] = useState<boolean>(false);
    const [notSubmitStudents, setNotSubmitStudents] = useState<User[]>([]);
    const [boundFiles, setBoundFiles] = useState<File[]>([]);
    const courses = useTAOrTeacherCourses();
    const me = useMe();

    const refreshSubmission = async (studentId: number) => {
        const submission = await invoke("get_single_course_assignment_submission", {
            courseId: selectedCourseId,
            assignmentId: selectedAssignment?.id,
            studentId,
        }) as Submission;
        attachments.filter(thisAttachment => thisAttachment.user_id === studentId)
            .map(attachment => {
                attachment.user = usersMap.get(submission.user_id)?.name;
                attachment.user_id = submission.user_id;
                attachment.submitted_at = submission.submitted_at;
                attachment.grade = submission.grade;
                attachment.key = attachment.id;
                attachment.late = submission.late;
                attachment.comments = submission.submission_comments;
            });
        setAttachments([...attachments]);
    }
    const shouldMonitor = !previewFooter || !commentingWhilePreviewing;
    const { previewEntry, previewer, onHoverEntry, onLeaveEntry, setPreviewEntry, setEntries } = usePreview(previewFooter, { height: "67vh", marginTop: "0px" }, shouldMonitor);

    useEffect(() => {
        if (!previewEntry) {
            setPreviewFooter(undefined);
            return;
        }
        const previewedAttachement = attachments.find(attachment => attachment.id === previewEntry.id);
        if (!previewedAttachement || !selectedAssignment) {
            return;
        }
        const footer = <Space direction="vertical" size="large" style={{ width: "100%", marginTop: "10px" }}>
            <Space>
                打分：
                <Input key={previewedAttachement.id} disabled={readonlyGrade} defaultValue={previewedAttachement.grade ?? ""}
                    placeholder="输入成绩并按下回车以打分"
                    onPressEnter={(ev) => handleGrade(ev.currentTarget.value, previewedAttachement)} />
            </Space>
            <CommentPanel me={me.data} onRefresh={refreshSubmission}
                onFocus={() => setCommentingWhilePreviewing(true)} onBlur={() => setCommentingWhilePreviewing(false)}
                attachment={previewedAttachement} assignmentId={selectedAssignment.id} courseId={selectedCourseId} showInput={true} messageApi={messageApi} />
        </Space>
        setPreviewFooter(footer);
    }, [previewEntry, attachments]);

    useEffect(() => {
        setEntries(attachments.map(attachmentToFile));
    }, [attachments]);

    useEffect(() => {
        if (attachments.length > 0) {
            setNotSubmitStudents(getNotSubmitStudents());
        }
    }, [attachments])

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
        render: (grade: string | null, attachment: Attachment) => <Input key={grade} disabled={readonlyGrade} defaultValue={grade ?? ""}
            placeholder="输入成绩并按下回车以打分"
            onPressEnter={(ev) => handleGrade(ev.currentTarget.value, attachment)} />
    }, {
        title: '文件',
        dataIndex: 'display_name',
        key: 'display_name',
        render: (name: string, attachment: Attachment) => <a href={`https://oc.sjtu.edu.cn/courses/${selectedCourseId}/gradebook/speed_grader?assignment_id=${selectedAssignment?.id}&student_id=${attachment.user_id}`}
            target="_blank"
            onMouseEnter={() => onHoverEntry(attachmentToFile(attachment))}
            onMouseLeave={onLeaveEntry}
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
                    setPreviewEntry(attachmentToFile(attachment));
                }}>预览</a>
                <a onClick={e => {
                    e.preventDefault();
                    setAttachmentToComment(attachment.id);
                    setExpandedRowKeys(keys => [...keys, attachment.id])
                }}>评论</a>
            </Space>
        ),
    }];

    const handleGetUsers = async (courseId: number) => {
        if (courseId === -1) {
            return;
        }
        try {
            let users = await invoke("list_course_students", { courseId }) as User[];
            users.map(user => user.key = user.id);
            setUsers(users);
            setOptions(users.map(user => { return { label: user.name, value: user.name } }));
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleGetAssignments = async (courseId: number) => {
        if (courseId === -1) {
            return;
        }
        try {
            let assignments = await invoke("list_course_assignments", { courseId }) as Assignment[];
            assignments.map(assignment => assignment.key = assignment.id);
            setAssignments(assignments);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleGetSubmissions = async (courseId: number, assignmentId: number) => {
        if (courseId === -1 || assignmentId === -1) {
            return;
        }
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
                    attachment.comments = submission.submission_comments;
                }
                attachments.push(...thisAttachments);
            }
            setAttachments(attachments);
            updateGradeStatistic(attachments);
        } catch (e) {
            messageApi.error(e as string);
        }
        setLoading(false);
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
        setOperating(true);
        if (courses.data.find(course => course.id === courseId)) {
            setAttachments([]);
            setSelectedAttachments([]);
            setStatistic(undefined);
            setSelectedAssignment(undefined);
            setSelectedCourseId(courseId);
            handleGetAssignments(courseId);
            await handleGetUsers(courseId);
        }
        setOperating(false);
    }

    const handleAssignmentSelect = (assignmentId: number) => {
        setOperating(true);
        setStatistic(undefined);
        setSelectedAttachments([]);
        let assignment = assignments.find(assignment => assignment.id === assignmentId);
        if (assignment) {
            setSelectedAssignment(assignment);
            handleGetSubmissions(selectedCourseId, assignmentId);
        }
        getConfig(true).then(config => {
            if (assignmentId in config.course_assignment_file_bindings) {
                const files = config.course_assignment_file_bindings[assignmentId];
                setBoundFiles(files);
            } else {
                setBoundFiles([]);
            }
        });
        setOperating(false);
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

    const getNotSubmitStudents = () => {
        const notSubmitStudentsMap = new Map<number, User>();
        usersMap.forEach(user => {
            notSubmitStudentsMap.set(user.id, user);
        });
        attachments.forEach(attachment => {
            notSubmitStudentsMap.delete(attachment.user_id);
        });
        return [...notSubmitStudentsMap.values()].filter(student => student.name !== "测验学生");
    }

    const getAssignmentTag = (assignment: Assignment) => {
        const count = assignment.needs_grading_count ?? 0;
        const notUnlocked = assignmentIsNotUnlocked(assignment);
        if (notUnlocked) {
            return <Tag color="geekblue">尚未解锁</Tag>
        }
        if (count === 0) {
            return <Tag color="success">暂无待批改</Tag>
        }

        return <Tag color="warning" icon={<WarningOutlined />}>{count}份待批改</Tag>
    }

    const assignmentOptions = assignments.map(assignment => ({
        label: <Space>
            <span>{assignment.name}</span>
            {getAssignmentTag(assignment)}
        </Space>,
        value: assignment.id,
    }));

    const shouldShow = (attachment: Attachment) => {
        return attachment.user && (keywords.length == 0 || keywords.includes(attachment.user));
    }

    const handleDownloadFile = async (file: File) => {
        await invoke("download_file", { file });
    }

    const handleOpenTaskFile = async (task: FileDownloadTask) => {
        const name = task.file.display_name;
        try {
            await invoke("open_file", { name });
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const bindCourseAssignmentFiles = async (files: File[]) => {
        let config = await getConfig(true);
        if (selectedAssignment) {
            config.course_assignment_file_bindings[selectedAssignment.id] = files;
            await saveConfig(config);
        }
    }

    const showShowAttachments = attachments.filter(attachment => shouldShow(attachment));

    return <BasicLayout>
        {contextHolder}
        {previewer}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses.data} />
            <Space>
                <span>选择作业：</span>
                <Select
                    style={{ width: 350 }}
                    disabled={operating}
                    onChange={handleAssignmentSelect}
                    value={selectedAssignment?.id}
                    defaultValue={selectedAssignment?.id}
                    options={assignmentOptions}
                />
            </Space>
            {selectedCourseId > 0 && selectedAssignment && <CourseFileSelector courseId={selectedCourseId} onSelectFiles={bindCourseAssignmentFiles} initialFiles={boundFiles} />}
            {
                selectedAssignment?.points_possible &&
                <span>满分：<b>{selectedAssignment.points_possible}</b>分</span>
            }
            {
                attachments.length > 0 && notSubmitStudents.length > 0 && <Space wrap>
                    未提交学生: {notSubmitStudents.map(s => <Popconfirm
                        key={s.id}
                        placement="top"
                        title={"学生信息"}
                        showCancel={false}
                        description={<Space direction="vertical">
                            <p>姓名：{s.name}</p>
                            <p>学号: {s.login_id}</p>
                            <p>邮箱: <a href={`mailto:${s.email}`} target="_blank">{s.email}</a></p>
                        </Space>}
                        okText="确认"
                    >
                        <a><Tag>{s.name}</Tag></a>
                    </Popconfirm>)}
                </Space>
            }
            {
                attachments.length === 0 && <Space wrap>
                    未提交学生: <Tag>暂无任何提交</Tag>
                </Space>
            }
            {statistic && <GradeStatisticChart statistic={statistic} />}
            {/* <Input.Search placeholder="输入学生姓名关键词" onSearch={setKeyword} /> */}
            <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="请选择学生" onChange={(value) => { setKeywords(value) }} options={options} />
            <Table style={{ width: "100%" }}
                columns={columns}
                loading={loading}
                dataSource={showShowAttachments}
                pagination={false}
                rowSelection={{ onChange: handleAttachmentSelect, selectedRowKeys: selectedAttachments.map(attachment => attachment.key) }}
                expandable={{
                    onExpand(expanded, record) {
                        if (expanded) {
                            setExpandedRowKeys([...expandedRowKeys, record.id]);
                        } else {
                            setExpandedRowKeys(expandedRowKeys.filter(key => key !== record.id));
                        }
                    },
                    expandedRowKeys,
                    rowExpandable: (attachment) => attachment.comments.length > 0 || attachmentToComment === attachment.id,
                    expandedRowRender: (attachment) => {
                        if (!selectedAssignment) {
                            return null;
                        }
                        const showInput = attachmentToComment === attachment.id;
                        return <CommentPanel me={me.data} onRefresh={refreshSubmission}
                            onHoverEntry={onHoverEntry}
                            onLeaveEntry={onLeaveEntry}
                            attachment={attachment} assignmentId={selectedAssignment.id} courseId={selectedCourseId} showInput={showInput} messageApi={messageApi} />
                    }
                }}
            />
            <Button disabled={operating || selectedAttachments.length === 0} onClick={handleDownloadSelectedAttachments}>下载</Button>
            <FileDownloadTable
                tasks={downloadTasks}
                handleDownloadFile={handleDownloadFile}
                handleOpenTaskFile={handleOpenTaskFile}
                handleRemoveTask={handleRemoveTask} />
        </Space>
    </BasicLayout >
}
