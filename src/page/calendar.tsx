import { Alert, Badge, Calendar, Space, Spin, Tooltip } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import { firstDayOfMonth, lastDayOfMonth } from "../lib/utils";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import { CalendarEvent, Colors, Course } from "../lib/model";
import { Link } from "react-router-dom";

export default function CalendarPage() {
    const [currentDate, setCurrentDate] = useState<Dayjs>(dayjs());
    const [messageApi, contextHolder] = useMessage();
    const [colors, setColors] = useState<Colors | undefined>(undefined);
    const [contextCodes, setContextCodes] = useState<string[]>([]);
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [hintEvents, setHintEvents] = useState<CalendarEvent[]>([]);

    useEffect(() => {
        init();
    }, []);

    const handleInitCalendarEvents = async (contextCodes: string[], currentDate: Dayjs) => {
        setLoading(true);
        try {
            const startDate = firstDayOfMonth(currentDate);
            const endDate = lastDayOfMonth(currentDate);
            let events = await handleGetCalendarEvents(contextCodes, startDate, endDate);
            let assignmentSet = new Set<number>();
            events.map(event => assignmentSet.add(event.assignment.id));
            events = events.filter(event => {
                if (assignmentSet.has(event.assignment.id)) {
                    assignmentSet.delete(event.assignment.id);
                    return true;
                } else {
                    return false;
                }
            })
            setEvents(events);
        } catch (e) {
            messageApi.error(e as string)
        }
        setLoading(false);
    }

    const init = async () => {
        const colors = await getColors() as Colors;
        const courses = await invoke("list_courses") as Course[];
        const courses_id = Array.from(courses, (course) => `course_${course.id}`);
        const contextCodes = courses_id.filter((course_id) => Object.keys(colors.custom_colors).includes(course_id));
        setColors(colors);
        setContextCodes(contextCodes);
        getHints(contextCodes);
        handleInitCalendarEvents(contextCodes, currentDate);
    }

    const getHints = async (contextCodes: string[]) => {
        let now = dayjs().toISOString();
        let afterAWeek = dayjs().add(7, "day").toISOString();
        try {
            let events = await handleGetCalendarEvents(contextCodes, now, afterAWeek);
            setHintEvents(events);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const cellRender = (date: Dayjs) => {
        let filteredEvents = events.filter(event => dayjs(event.end_at).isSame(date, "day"));
        return (
            <ul>
                {filteredEvents.map((event) => (
                    <span key={event.title} style={{ whiteSpace: "nowrap" }}>
                        <Tooltip placement="top" title={event.context_name}>
                            <Badge color={colors?.custom_colors[event.context_code]} text={<Link to={`/assignments?id=${getCourseId(event)}`}>{event.title}</Link>} />
                        </Tooltip>
                    </span>
                ))}
            </ul>
        );
    };

    const getColors = () => {
        return invoke("get_colors");
    }

    const handleGetCalendarEvents = async (contextCodes: string[], startDate: string, endDate: string) => {
        let events = await invoke("list_calendar_events", { contextCodes, startDate, endDate }) as CalendarEvent[];
        return events;
    }

    const handlePanelChange = (date: Dayjs) => {
        if (contextCodes.length > 0) {
            handleInitCalendarEvents(contextCodes, date);
            setCurrentDate(date);
        }
    }

    const getCourseId = (event: CalendarEvent) => {
        const parts = event.context_code.split('_');
        const courseId = parts[parts.length - 1];
        return courseId;
    }

    const hintList = hintEvents.map(event => {
        const now = dayjs();
        const diff = dayjs(event.end_at).diff(now, 'hour');
        const days = Math.floor(diff / 24);
        const hours = diff % 24;
        return <div key={event.id}>
            距离作业<Link to={`/assignments?id=${getCourseId(event)}`} >{event.title}</Link>({event.context_name})截止还有<b>{days}天{hours}小时</b>
        </div>
    })

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical">
            <Alert message={"DDL 提示"} description={hintList} type="warning" showIcon />
            <Spin spinning={loading}>
                <Calendar onPanelChange={handlePanelChange} cellRender={cellRender} />
            </Spin>
        </Space>
    </BasicLayout >
}