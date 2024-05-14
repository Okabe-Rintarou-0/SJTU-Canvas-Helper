import { useEffect, useMemo, useState } from "react";
import BasicLayout from "../components/layout";
import { useAssignments, useStudents, useTACourses, useUserSubmissions } from "../lib/hooks";
import CourseSelect from "../components/course_select";
import { Submission, User } from "../lib/model";
import { Input, Space, Table, Tag } from "antd";
import { assignmentIsEnded } from "../lib/utils";

export default function GradePage() {
    const [selectedCourseId, setSelectedCourseId] = useState<number | undefined>();
    const courses = useTACourses();
    const students = useStudents(selectedCourseId);
    const userSubmissions = useUserSubmissions(selectedCourseId);
    const assignments = useAssignments(selectedCourseId);
    const [columns, setColumns] = useState<any[]>([]);
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        if (assignments.isLoading) {
            return;
        }
        const m = new Map<number, User>();
        students.data.map(student => {
            m.set(student.id, student);
        });
        userSubmissions.data.map(us => us.username = m.get(us.user_id)?.name);
        const columns = [{
            title: "学生",
            dataIndex: 'username',
            key: "username"
        }, ...assignments.data.map((assignment) => {
            const isEnded = assignmentIsEnded(assignment);
            return {
                title: assignment.name,
                dataIndex: assignment.id,
                key: assignment.id,
                render: (submission: Submission | undefined) => {
                    const notSubmitted = isEnded && submission?.workflow_state === "unsubmitted";
                    const grade = submission?.grade ?? "";
                    return <Space>
                        {isEnded && <span>{grade}</span>}
                        {!isEnded && <Input defaultValue={grade} />}
                        {submission?.late && <Tag color="geekblue">迟交</Tag>}
                        {notSubmitted && <Tag color="volcano">未提交</Tag>}
                    </Space>
                }
            };
        })];
        setColumns(columns);
        const data: any[] = [];
        userSubmissions.data.map(us => {
            if (!us.username) {
                return;
            }
            const record: Record<any, any> = {};
            us.submissions.map(submission => record[submission.assignment_id] = submission);
            record["username"] = us.username;
            record["key"] = us.user_id;
            data.push(record);
        });
        setData(data);
    }, [userSubmissions.data, assignments.data]);

    const isLoading = useMemo(() => courses.isLoading || students.isLoading || userSubmissions.isLoading || assignments.isLoading, [
        courses.isLoading, students.isLoading, userSubmissions.isLoading, assignments.isLoading
    ]);

    return <BasicLayout>
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect courses={courses.data} onChange={setSelectedCourseId} />
            <Table columns={columns} dataSource={data} loading={isLoading} pagination={false} />
        </Space>
    </BasicLayout >
}