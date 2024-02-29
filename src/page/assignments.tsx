import { Checkbox, CheckboxProps, Divider, Space, Table, Tag } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useState } from "react";
import { Assignment, Course, Submission } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import { formatDate } from "../lib/utils";
import CourseSelect from "../components/course_select";

export default function AssignmentsPage() {
    const [messageApi, contextHolder] = useMessage();
    const [operating, setOperating] = useState<boolean>(false);
    const [onlyShowUnfinished, setOnlyShowUnfinished] = useState<boolean>(true);
    const [courses, setCourses] = useState<Course[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);

    useEffect(() => {
        initCourses();
    }, []);

    const handleGetAssignments = async (courseId: number, onlyShowUnfinished: boolean) => {
        if (courseId === -1) {
            return;
        }
        setOperating(true);
        try {
            let assignments = await invoke("list_course_assignments", { courseId }) as Assignment[];
            assignments.map(assignment => assignment.key = assignment.id);
            if (onlyShowUnfinished) {
                assignments = assignments.filter(assignment => assignment.submission?.workflow_state === "unsubmitted")
            }
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
        render: formatDate,
    }, {
        title: '结束时间',
        dataIndex: 'lock_at',
        key: 'lock_at',
        render: formatDate,
    }, {
        title: '分数',
        dataIndex: 'points_possible',
        key: 'points_possible',
    }, {
        title: '状态',
        dataIndex: 'submission',
        key: 'submission',
        render: (submission: Submission) => {
            if (!submission) {
                // no need to submit
                return <Tag>无需提交</Tag>;
            }
            if (submission.workflow_state === "submitted") {
                return submission.late ? <Tag color="green">迟交</Tag> : <Tag color="green">已提交</Tag>;
            }
            return <Tag color="red">未提交</Tag>;
        }
    }]

    const handleCourseSelect = async (selected: string) => {
        let selectedCourse = courses.find(course => course.name === selected);
        if (selectedCourse) {
            setSelectedCourseId(selectedCourse.id);
            handleGetAssignments(selectedCourse.id, onlyShowUnfinished);
        }
    }

    const handleSetOnlyShowUnfinished: CheckboxProps['onChange'] = (e) => {
        let onlyShowUnfinished = e.target.checked;
        setOnlyShowUnfinished(onlyShowUnfinished);
        handleGetAssignments(selectedCourseId, onlyShowUnfinished);
    }

    const formatDescription = (description: string) => {
        const parser = new DOMParser();
        const document = parser.parseFromString(description, "text/html");
        const anchorTags = document.querySelectorAll('a');
        anchorTags.forEach(anchorTag => {
            // Set the target attribute of each anchor tag to "_blank"
            anchorTag.setAttribute('target', '_blank');
        });
        return document.body.innerHTML;
    }

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} />
            <Checkbox disabled={operating} onChange={handleSetOnlyShowUnfinished} defaultChecked>只显示未完成</Checkbox>
            <Table style={{ width: "100%" }}
                columns={columns}
                dataSource={assignments}
                pagination={false}
                expandable={{
                    expandedRowRender: (assignment) => <Space direction="vertical" style={{ width: "100%" }}>
                        <Divider orientation="left">作业描述</Divider>
                        <div dangerouslySetInnerHTML={{ __html: formatDescription(assignment.description) }} />
                    </Space>
                }}
            />
        </Space>
    </BasicLayout>
}