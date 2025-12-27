import { InfoCircleOutlined } from '@ant-design/icons';
import { Select, Space, Tooltip } from "antd";
import { useMemo } from 'react';
import { Course } from "../lib/model";

export default function CourseSelect({ courses, disabled, onChange, value }: {
    courses: Course[],
    disabled?: boolean,
    onChange?: (courseId: number) => void,
    value?: number
}) {
    // Format course name with term and teachers
    const formatCourseName = (course: Course): string => {
        const term = course.term.name.replace("Spring", "春").replace("Fall", "秋");

        // Show multiple teachers if available, limit to 2
        const teacherNames = course.teachers?.filter(t => t?.display_name)
            .map(t => t.display_name)
            .slice(0, 2) || [];

        const teacherText = teacherNames.length > 0
            ? teacherNames.join('、')
            : '未知教师';

        return `${course.name} | ${term} | ${teacherText}`;
    };

    const formatCourses = (courses: Course[]) => {
        const formatted = courses.map(course => ({
            ...course,
            name: formatCourseName(course)
        }));
        // sort by term id, latest first
        formatted.sort((a, b) => b.term.id - a.term.id);
        return formatted;
    }

    const courseLabel = (course: Course) => {
        const isTA = course.enrollments?.find(enrollment => enrollment.role === "TaEnrollment");
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isTA && <span style={{ color: 'red', fontWeight: 'bold' }}>*</span>}
                {course.name}
            </div>
        );
    }

    const formattedCourses = useMemo(() => formatCourses(courses), [courses]);

    // Create course ID map for faster lookup
    const courseMap = useMemo(() => {
        const map = new Map<number, Course>();
        courses.forEach(course => map.set(course.id, course));
        return map;
    }, [courses]);

    // Handle empty courses
    const hasCourses = courses.length > 0;

    return <Space align="center" size="middle">
        <span style={{ fontWeight: '500' }}>选择课程：</span>
        <Select
            showSearch
            optionFilterProp="children"
            placeholder={hasCourses ? "请选择或搜索课程..." : "暂无可用课程"}
            filterOption={(filter, options) => {
                if (!options || !filter) {
                    return true;
                }
                let courseId = options.value;
                let course = courseMap.get(courseId);
                if (!course) {
                    return false;
                }

                // Convert to lowercase for case-insensitive matching
                const lowerFilter = filter.toLowerCase();

                // Search by course name, term name, or teacher name
                const nameMatch = course.name.toLowerCase().includes(lowerFilter);
                const termMatch = course.term.name.toLowerCase().includes(lowerFilter);
                const teacherMatch = course.teachers?.some(teacher =>
                    teacher?.display_name?.toLowerCase().includes(lowerFilter)
                ) || false;

                return nameMatch || termMatch || teacherMatch;
            }}
            value={value}
            style={{ width: 350 }}
            disabled={disabled || !hasCourses}
            onChange={onChange}
            options={formattedCourses.map(course => ({
                label: courseLabel(course),
                value: course.id
            }))}
        />
        <Tooltip placement="top" title={"带星号的课程为担任助教的课程"}>
            <InfoCircleOutlined />
        </Tooltip>
    </Space>
}