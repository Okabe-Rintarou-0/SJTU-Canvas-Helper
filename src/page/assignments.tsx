import { Avatar, Button, Checkbox, CheckboxProps, Divider, List, Space, Table, Tag } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useState } from "react";
import { Assignment, Attachment, Course, GradeStatus, Submission, User } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import { assignmentIsEnded, assignmentNotNeedSubmit, attachmentToFile, formatDate, getBaseDate } from "../lib/utils";
import CourseSelect from "../components/course_select";
import { usePreview } from "../lib/hooks";
import dayjs from "dayjs";
import ModifyDDLModal from "../components/modify_ddl_modal";
import { SubmitModal } from "../components/submit_modal";
import { GradeOverviewChart } from "../components/grade_overview";
import { useSearchParams } from "react-router-dom";

export default function AssignmentsPage() {
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [onlyShowUnfinished, setOnlyShowUnfinished] = useState<boolean>(true);
    const [courses, setCourses] = useState<Course[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
    const [me, setMe] = useState<User | undefined>(undefined);
    const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry } = usePreview();
    const [linksMap, setLinksMap] = useState<Record<number, Attachment[]>>({});
    const [showModifyDDLModal, setShowModifyDDLModal] = useState<boolean>(false);
    const [assignmentToModify, setAssignmentToModify] = useState<Assignment | undefined>(undefined);
    const [showModal, setShowModal] = useState<boolean>(false);
    const [selectedAssignment, setSelectedAssignment] = useState<Assignment | undefined>(undefined);
    const [gradeMap, setGradeMap] = useState<Map<number, GradeStatus>>(new Map());
    const [searchParams, setSearchParams] = useSearchParams();

    const initMe = async () => {
        try {
            const me = await invoke("get_me") as User;
            setMe(me);
        } catch (e) {
            console.log(e);
        }
    }

    useEffect(() => {
        initMe();
        initCourses();
    }, []);

    useEffect(() => {
        if (courses.length > 0) {
            const courseId = Number.parseInt(searchParams.get("id") ?? "");
            if (courseId > 0) {
                setSearchParams({});
                setSelectedCourseId(courseId);
                handleGetAssignments(courseId, onlyShowUnfinished);
            }
        }
    }, [courses]);

    useEffect(() => {
        let newGradeMap = new Map<number, GradeStatus>();
        assignments.map(assignment => {
            const actualGrade = Number.parseInt(assignment.submission?.grade ?? "0");
            let maxGrade = assignment.points_possible ?? 0;
            const graded = assignment.submission?.workflow_state === "graded" && !isNaN(actualGrade);
            const assignmetName = assignment.name;
            if (!graded) {
                return;
            }
            if (maxGrade < actualGrade) {
                maxGrade = actualGrade;
            }
            let status = {
                assignmetName,
                actualGrade,
                maxGrade
            } as GradeStatus;
            newGradeMap.set(assignment.id, status);
        })
        setGradeMap(newGradeMap);
    }, [assignments])

    const handleGetAssignments = async (courseId: number, onlyShowUnfinished: boolean) => {
        if (courseId === -1) {
            return;
        }
        setOperating(true);
        try {
            let linksMap = {};
            let assignments = await invoke("list_course_assignments", { courseId }) as Assignment[];
            assignments.map(assignment => assignment.key = assignment.id);
            if (!isTA(courseId) && onlyShowUnfinished) {
                assignments = assignments.filter(assignment => assignment.submission?.workflow_state === "unsubmitted")
            }
            for (let assignment of assignments) {
                dealWithDescription(assignment, linksMap);
            }
            setLinksMap(linksMap);
            setAssignments(assignments);
        } catch (e) {
            messageApi.error(e as string);
        }
        setOperating(false);
    }

    const initCourses = async () => {
        try {
            let courses = await invoke("list_courses") as Course[];
            setCourses(courses);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const getColumns = () => {
        const columns = [{
            title: '作业名',
            dataIndex: 'name',
            key: 'name',
            render: (_: any, assignment: Assignment) => <a href={assignment.html_url} target="_blank">{assignment.name}</a>
        }, {
            title: '开始时间',
            dataIndex: 'unlock_at',
            key: 'unlock_at',
            render: formatDate,
        }, {
            title: '截止时间',
            dataIndex: 'due_at',
            key: 'due_at',
            render: (_: any, assignment: Assignment) => formatDate(getBaseDate(assignment.all_dates)?.due_at),
        }, {
            title: '结束时间',
            dataIndex: 'lock_at',
            key: 'lock_at',
            render: (_: any, assignment: Assignment) => formatDate(getBaseDate(assignment.all_dates)?.lock_at),
        }, {
            title: '得分',
            dataIndex: 'points_possible',
            key: 'points_possible',
            render: (points_possible: number | undefined, assignment: Assignment) => {
                let grade = assignment.submission?.grade ?? 0;
                if (points_possible) {
                    return `${grade}/${points_possible}`;
                }
                return grade;
            }
        }, {
            title: '状态',
            dataIndex: 'submission',
            key: 'submission',
            render: (submission: Submission, assignment: Assignment) => {
                const tags = [];
                if (assignmentIsEnded(assignment)) {
                    tags.push(<Tag color="orange">已截止</Tag>);
                } else {
                    tags.push(<Tag color="blue">进行中</Tag>);
                }
                if (assignmentNotNeedSubmit(assignment)) {
                    tags.push(<Tag>无需提交</Tag>);
                } else if (submission.submitted_at) {
                    tags.push(submission.late ? <Tag color="red">迟交</Tag> : <Tag color="green">已提交</Tag>);
                } else {
                    tags.push(<Tag color="red">未提交</Tag>);
                }
                return <Space size={"small"}>{tags}</Space>
            }
        }];
        if (isTA(selectedCourseId)) {
            columns.push({
                title: '操作',
                key: 'action',
                dataIndex: 'action',
                render: (_: any, assignment: Assignment) => <Button onClick={() => {
                    setShowModifyDDLModal(true);
                    setAssignmentToModify(assignment);
                }}>修改日期</Button>,
            })
        } else {
            columns.push({
                title: "操作",
                key: 'action',
                dataIndex: 'action',
                render: (_: any, assignment: Assignment) => {
                    const now = dayjs();
                    const lockAt = dayjs(assignment.lock_at);
                    const dueAt = dayjs(assignment.due_at);
                    if (!assignment.submission ||
                        assignment.submission_types.includes("none") || assignment.submission_types.includes("not_graded") ||
                        now.isAfter(lockAt) || now.isAfter(dueAt)) {
                        return <p />;
                    }
                    return <a onClick={(e) => {
                        e.preventDefault();
                        setSelectedAssignment(assignment);
                        setShowModal(true);
                    }}>提交</a>
                }
            });
        }
        return columns;
    }

    const isTA = (courseId: number) => {
        const course = courses.find(course => course.id === courseId);
        return course !== undefined && course.enrollments.find(enrollment => enrollment.role == "TaEnrollment") !== undefined;
    }

    const handleDownloadAttachment = async (attachment: Attachment) => {
        let file = attachmentToFile(attachment);
        try {
            await invoke("download_file", { file });
            messageApi.success("下载成功🎉！", 0.5);
        } catch (e) {
            messageApi.success(`下载失败🥹(${e})！`);
        }
    }

    const attachmentColumns = [{
        title: '文件',
        dataIndex: 'display_name',
        key: 'display_name',
        render: (name: string, attachment: Attachment) => <a
            onMouseEnter={() => onHoverEntry(attachmentToFile(attachment))}
            onMouseLeave={onLeaveEntry}
        >
            {name}
        </a>
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
            </Space>
        ),
    }];

    const submittedAttachmentColumns = [{
        title: '文件',
        dataIndex: 'display_name',
        key: 'display_name',
        render: (name: string, attachment: Attachment) => <a
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
            </Space>
        ),
    }];

    const handleCourseSelect = async (courseId: number) => {
        let selectedCourse = courses.find(course => course.id === courseId);
        if (selectedCourse) {
            setSelectedCourseId(courseId);
            handleGetAssignments(courseId, onlyShowUnfinished);
        }
    }

    const handleSetOnlyShowUnfinished: CheckboxProps['onChange'] = (e) => {
        let onlyShowUnfinished = e.target.checked;
        setOnlyShowUnfinished(onlyShowUnfinished);
        handleGetAssignments(selectedCourseId, onlyShowUnfinished);
    }

    const dealWithDescription = (assignment: Assignment, linksMap: Record<number, Attachment[]>) => {
        if (!assignment.description) {
            return;
        }
        const parser = new DOMParser();
        const document = parser.parseFromString(assignment.description, "text/html");
        const anchorTags = document.querySelectorAll('a');
        const downloadableRegex = /https:\/\/oc\.sjtu\.edu\.cn\/courses\/(\d+)\/files\/(\d+)\/download\?/g;
        const id = assignment.id;
        if (!linksMap[id]) {
            linksMap[id] = [];
        }
        let links = linksMap[id];
        anchorTags.forEach(anchorTag => {
            // Set the target attribute of each anchor tag to "_blank"
            anchorTag.setAttribute("target", "_blank");
            if (anchorTag.href.match(downloadableRegex)) {
                links.push({ url: anchorTag.href, display_name: anchorTag.text, key: assignment.id } as Attachment);
            }
        });
        assignment.description = document.body.innerHTML;
    }

    const handleGetMySingleSubmission = async (courseId: number, assignmentId: number) => {
        try {
            let submission = await invoke("get_my_single_submission", { courseId, assignmentId }) as Submission;
            let assignment = assignments.find(assignment => assignment.id === assignmentId)!;
            assignment.submission = submission;
            setAssignments([...assignments]);
        } catch (e) {
            console.log(e);
            messageApi.error(`加载出错🥹：${e}`);
        }
    }

    const handleDeleteComment = async (commentId: number, assignmentId: number) => {
        try {
            await invoke("delete_my_submission_comment", {
                courseId: selectedCourseId,
                assignmentId,
                commentId
            });
            messageApi.success("删除成功！🎉", 0.5);
            handleGetMySingleSubmission(selectedCourseId, assignmentId);
        } catch (e) {
            console.log(e as string);
            messageApi.error(e as string);
        }
    }

    return <BasicLayout>
        {contextHolder}
        {previewer}
        {assignmentToModify && <ModifyDDLModal open={showModifyDDLModal} assignment={assignmentToModify}
            handleCancel={() => setShowModifyDDLModal(false)}
            onRefresh={() => handleGetAssignments(selectedCourseId, onlyShowUnfinished)}
            onSuccess={() => {
                setShowModifyDDLModal(false);
                handleGetAssignments(selectedCourseId, onlyShowUnfinished);
            }}
            courseId={selectedCourseId} />}
        {selectedAssignment && <SubmitModal open={showModal} allowed_extensions={selectedAssignment.allowed_extensions}
            courseId={selectedCourseId} assignmentId={selectedAssignment.id} onCancel={() => setShowModal(false)} onSubmit={() => {
                setShowModal(false);
                setSelectedAssignment(undefined);
                messageApi.success("提交成功🎉！");
                handleGetMySingleSubmission(selectedCourseId, selectedAssignment.id);
            }} />}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} value={selectedCourseId === -1 ? undefined : selectedCourseId} />
            {!isTA(selectedCourseId) && <Checkbox disabled={operating} onChange={handleSetOnlyShowUnfinished} defaultChecked>只显示未完成</Checkbox>}
            <GradeOverviewChart gradeMap={gradeMap} />
            <Table style={{ width: "100%" }}
                loading={operating}
                columns={getColumns()}
                dataSource={assignments}
                pagination={false}
                expandable={{
                    onExpand: (expanded, assignment) => {
                        if (expanded && !isTA(selectedCourseId)) {
                            handleGetMySingleSubmission(selectedCourseId, assignment.id);
                        }
                    },
                    expandedRowRender: (assignment) => {
                        let attachments = undefined;
                        let submission = assignment.submission;
                        if (submission) {
                            attachments = submission?.attachments;
                            attachments?.map(attachment => {
                                attachment.submitted_at = submission?.submitted_at;
                                attachment.key = attachment.id;
                            });
                        }
                        return <Space direction="vertical" style={{ width: "100%" }}>
                            <Divider orientation="left">作业描述</Divider>
                            {assignment.description && <div dangerouslySetInnerHTML={{ __html: assignment.description }} />}
                            <Divider orientation="left">作业附件</Divider>
                            <Table columns={attachmentColumns} dataSource={linksMap[assignment.id]} pagination={false} />
                            <Divider orientation="left">历史评论</Divider>
                            <List
                                itemLayout="horizontal"
                                dataSource={assignment.submission?.submission_comments}
                                renderItem={(comment) => (
                                    <List.Item actions={comment.author_id === me?.id ? [<a onClick={(e) => {
                                        e.preventDefault();
                                        handleDeleteComment(comment.id, assignment.id);
                                    }}>删除</a>] : undefined}>
                                        <List.Item.Meta
                                            avatar={<Avatar src={"https://oc.sjtu.edu.cn" + comment.avatar_path} />}
                                            title={comment.author_name}
                                            description={comment.comment}
                                        />
                                    </List.Item>
                                )}
                            />
                            <Divider orientation="left">我的提交</Divider>
                            <Table columns={submittedAttachmentColumns} dataSource={attachments} pagination={false} />
                        </Space>
                    }
                }}
            />
        </Space>
    </BasicLayout>
}
