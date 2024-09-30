import { useEffect, useMemo, useState } from "react";
import BasicLayout from "../components/layout";
import { useAssignments, useStudents, useTAOrTeacherCourses, useUserSubmissions } from "../lib/hooks";
import CourseSelect from "../components/course_select";
import { Assignment, Course, GradeStatistic, LOG_LEVEL_ERROR, Submission, User } from "../lib/model";
import { Button, Empty, Form, Input, Space, Spin, Table, Tabs, TabsProps, Tag } from "antd";
import { assignmentIsEnded, consoleLog } from "../lib/utils";
import GradeStatisticChart from "../components/grade_statistic";
import useMessage from "antd/es/message/useMessage";
import { invoke } from "@tauri-apps/api";
import { useForm } from "antd/es/form/Form";
import { PathSelector } from "../components/path_selector";
import { getConfig } from "../lib/store";

interface DetailedGradeStatistic {
    eachAssignments: [Assignment, GradeStatistic][],
    total: GradeStatistic
}

interface ExportInfo {
    fileName: string,
    folderPath: string,
}

export default function GradePage() {
    const [selectedCourseId, setSelectedCourseId] = useState<number | undefined>();
    const [studentIds, setStudentIds] = useState<number[]>([]);
    const courses = useTAOrTeacherCourses();
    const students = useStudents(selectedCourseId);
    const userSubmissions = useUserSubmissions(selectedCourseId, studentIds);
    const assignments = useAssignments(selectedCourseId);
    const [columns, setColumns] = useState<any[]>([]);
    const [data, setData] = useState<any[]>([]);
    const [currentView, setCurrentView] = useState<string>("overview");
    const [messageApi, contextHolder] = useMessage();
    const [statistics, setStatistics] = useState<DetailedGradeStatistic>({
        eachAssignments: [],
        total: {} as GradeStatistic
    });
    const [form] = useForm<ExportInfo>();

    const initForm = async (course: Course) => {
        form.setFieldValue("fileName", `${course.name}_成绩`);
        form.setFieldValue("folderPath", (await getConfig()).save_path);
    }

    useEffect(() => {
        const course = courses.data.find(course => course.id === selectedCourseId);
        if (!course) {
            return;
        }
        initForm(course);
    }, [selectedCourseId]);

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
            key: "username",
            fixed: 'left'
        }, ...assignments.data.map((assignment) => {
            const isEnded = assignmentIsEnded(assignment);
            const readonlyGrade = assignment.needs_grading_count === null;
            return {
                title: assignment.name,
                dataIndex: assignment.id,
                key: assignment.id,
                render: (submission: Submission | undefined, record: any) => {
                    const notSubmitted = isEnded && submission?.workflow_state === "unsubmitted";
                    const grade = submission?.grade ?? "";
                    return <Space>
                        <Input defaultValue={grade} disabled={readonlyGrade} style={{ width: "100px" }} key={submission?.id} onPressEnter={(e) => {
                            let userId = record["userId"];
                            if (submission || userId) {
                                handleGrade(e.currentTarget.value, assignment, submission?.user_id ?? userId);
                            }
                        }} />
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
            record["userId"] = us.user_id;
            record["key"] = `${us.user_id}${selectedCourseId}`;
            data.push(record);
        });
        setData(data);
    }, [userSubmissions.data, assignments.data]);

    useEffect(() => {
        setStudentIds(students.data.map(student => student.id));
    }, [students.data]);

    useEffect(() => {
        if (currentView !== "statistic") {
            return;
        }
        setStatistics(computeGradeStatistics());
    }, [currentView, userSubmissions.data]);

    const computeGradeStatistics = () => {
        const submissionMap = new Map<number, Submission[]>();
        const studentsTotalGradesMap = new Map<number, number>();
        userSubmissions.data.map(us => {
            us.submissions.map(submission => {
                const assignmentId = submission.assignment_id;
                if (!submissionMap.has(assignmentId)) {
                    submissionMap.set(assignmentId, []);
                }
                submissionMap.get(assignmentId)!.push(submission);

                if (!studentsTotalGradesMap.has(us.user_id)) {
                    studentsTotalGradesMap.set(us.user_id, 0);
                }
                const grade = Number.parseFloat(submission.grade ?? "");
                if (!isNaN(grade)) {
                    studentsTotalGradesMap.set(us.user_id, studentsTotalGradesMap.get(us.user_id)! + grade);
                }
            });
        });
        const eachAssignments = assignments.data
            .filter(assignment => submissionMap.has(assignment.id))
            .map(assignment => [assignment, gatherGrades(submissionMap.get(assignment.id)!)] as [Assignment, GradeStatistic])
            .filter(([_, statistic]) => statistic.grades.length > 0);
        const totalGrades: number[] = [];
        studentsTotalGradesMap.forEach(grades => totalGrades.push(grades));
        const total = {
            grades: totalGrades,
            total: students.data.length,
        } as GradeStatistic;
        return {
            eachAssignments,
            total
        };
    }

    const gatherGrades = (submissions: Submission[]): GradeStatistic => {
        let grades = []
        for (let submission of submissions) {
            if (submission.grade) {
                const grade = Number.parseFloat(submission.grade);
                if (!isNaN(grade)) {
                    grades.push(grade);
                }
            }
        }
        let total = submissions.length;
        return { grades, total } as GradeStatistic;
    }

    const isLoading = useMemo(() => courses.isLoading || students.isLoading || userSubmissions.isLoading || assignments.isLoading, [
        courses.isLoading, students.isLoading, userSubmissions.isLoading, assignments.isLoading
    ]);

    const validateGrade = (grade: string, assignment: Assignment) => {
        if (grade.length === 0) {
            return true;
        }
        let maxGrade = assignment.points_possible;
        let gradeNumber;
        try {
            gradeNumber = Number.parseFloat(grade);
        } catch (_) {
            return false;
        }
        return 0 <= gradeNumber && (!maxGrade || gradeNumber <= maxGrade);
    }

    const handleGrade = async (grade: string, assignment: Assignment, studentId: number) => {
        if (!validateGrade(grade, assignment)) {
            messageApi.error("请输入正确格式的评分（不超过上限的正数或空字符串）！🙅🙅🙅");
            return;
        }
        try {
            await invoke("update_grade", {
                courseId: selectedCourseId,
                assignmentId: assignment.id,
                studentId,
                grade
            });
            messageApi.success("打分成功！🎉", 0.5);
        } catch (e) {
            consoleLog(LOG_LEVEL_ERROR, e);
            messageApi.error(`打分时出错🥹：${e}`);
        }
    }

    const handleExport = async ({ fileName, folderPath }: ExportInfo) => {
        const exportData: string[][] = [];
        // add header
        const headers: string[] = ["学生"];
        assignments.data.map(assignment => {
            headers.push(assignment.name);
        });
        exportData.push(headers);
        data.map(rowData => {
            const row: string[] = [rowData["username"]];
            assignments.data.map(assignment => {
                let submission = rowData[assignment.id] as Submission | undefined;
                row.push(submission?.grade ?? "");
            });
            exportData.push(row);
        });
        if (!fileName.endsWith(".xlsx")) {
            fileName += ".xlsx";
        }
        try {
            await invoke("export_excel", { data: exportData, fileName, folderPath });
            messageApi.success("导出成功🎉！");
        } catch (e) {
            consoleLog(LOG_LEVEL_ERROR, e);
            messageApi.error(`导出失败🥹：${e}`);
        }
    }

    const items: TabsProps['items'] = [
        {
            key: 'overview',
            label: '总览视图',
            children: <Space style={{ width: "100%" }} direction="vertical">
                <Table columns={columns} dataSource={data} loading={isLoading} pagination={false} bordered />
                {userSubmissions.data.length > 0 && <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleExport}
                    preserve={false}
                >
                    <Form.Item name="fileName" label="导出文件名（无需扩展名）" required rules={[{
                        required: true,
                        message: "请输入导出文件名！"
                    }]}>
                        <Input placeholder="请输入导出文件名（无需扩展名）" suffix={".xlsx"} />
                    </Form.Item>
                    <Form.Item name="folderPath" label="导出目录" required rules={[{
                        required: true,
                        message: "请输入导出目录！"
                    }]}>
                        <PathSelector />
                    </Form.Item>
                    <Space>
                        <Form.Item>
                            <Button disabled={isLoading} type="primary" htmlType="submit">
                                导出
                            </Button>
                        </Form.Item>
                    </Space>
                </Form>}
            </Space>
        },
        {
            key: 'statistic',
            label: '统计视图',
            children: <Spin spinning={isLoading}>
                <Space style={{ width: "100%" }} direction="vertical">
                    {statistics.total.total > 0 && <Space style={{ width: "100%" }} direction="vertical">
                        <span>总分</span>
                        <GradeStatisticChart statistic={statistics.total} subTitleRenderer={({ average }) => {
                            return <span>平均<b>{average}</b>分</span>
                        }} />
                    </Space>}
                    {statistics.eachAssignments.map(([assignment, gradeStatistic]) => <Space key={assignment.id} style={{ width: "100%" }} direction="vertical">
                        <span>{assignment.name}</span>
                        <GradeStatisticChart statistic={gradeStatistic} subTitleRenderer={({ average }) => {
                            return <span>平均<b>{average}</b>分</span>
                        }} />
                    </Space>)}
                    {statistics.eachAssignments.length === 0 && statistics.total.total === 0 && <Empty />}
                </Space>
            </Spin>
        }
    ];

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect courses={courses.data} onChange={setSelectedCourseId} />
            <Button onClick={userSubmissions.mutate} disabled={isLoading}>刷新</Button>
            <Tabs defaultActiveKey={currentView} items={items} onChange={setCurrentView} />
        </Space>
    </BasicLayout>
}