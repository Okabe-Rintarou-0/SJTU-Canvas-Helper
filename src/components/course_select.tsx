import { Select, Space, Tooltip } from "antd";
import { Course } from "../lib/model";
import { InfoCircleOutlined } from '@ant-design/icons'

export default function CourseSelect({ courses, disabled, onChange }: {
    courses: Course[],
    disabled?: boolean,
    onChange?: (course: string) => void,
}) {
    const courseLabel = (course: Course) => {
        return course.enrollments.find(enrollment => enrollment.role === "TaEnrollment") ?
            <span><span style={{ color: "red" }}>*</span>{course.name}</span> :
            course.name
    }

    return <Space>
        <span>选择课程：</span>
        <Select
            style={{ width: 300 }}
            disabled={disabled}
            onChange={onChange}
            options={courses.map(course => ({
                label: courseLabel(course),
                value: course.name
            }))}
        />
        <Tooltip placement="top" title={"带星号的课程为担任助教的课程"}>
            <InfoCircleOutlined />
        </Tooltip>
    </Space>
}