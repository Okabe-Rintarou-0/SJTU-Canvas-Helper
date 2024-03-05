import { Badge, Calendar, Spin } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useState } from "react";
import dayjs, { Dayjs } from "dayjs";
import { firstDayOfMonth, lastDayOfMonth } from "../lib/utils";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import { CalendarEvent, Colors } from "../lib/model";

export default function CalendarPage() {
    const [currentDate, setCurrentDate] = useState<Dayjs>(dayjs());
    const [messageApi, contextHolder] = useMessage();
    const [colors, setColors] = useState<Colors | undefined>(undefined);
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        init();
    }, []);

    const handleInitCalendarEvents = async (colors: Colors, currentDate: Dayjs) => {
        setLoading(true);
        try {
            let contextCodes = [];
            for (let courseCode in colors.custom_colors) {
                contextCodes.push(courseCode);
            }
            let events = await handleGetCalendarEvents(contextCodes, currentDate);
            setEvents(events);
        } catch (e) {
            messageApi.error(e as string)
        }
        setLoading(false);
    }

    const init = async () => {
        let colors = await getColors() as Colors;
        setColors(colors);
        handleInitCalendarEvents(colors, currentDate);
    }

    const cellRender = (date: Dayjs) => {
        let filteredEvents = events.filter(event => dayjs(event.end_at).isSame(date, "day"));
        return (
            <ul>
                {filteredEvents.map((event) => (
                    <span key={event.title} style={{ whiteSpace: "nowrap" }}>
                        <Badge color={colors?.custom_colors[event.context_code]} text={<a href={event.html_url} target="_blank">{event.title}</a>} />
                    </span>
                ))}
            </ul>
        );
    };

    const getColors = () => {
        return invoke("get_colors");
    }

    const handleGetCalendarEvents = async (contextCodes: string[], currentDate: Dayjs) => {
        const startDate = firstDayOfMonth(currentDate);
        const endDate = lastDayOfMonth(currentDate);
        let events = await invoke("list_calendar_events", { contextCodes, startDate, endDate }) as CalendarEvent[];
        return events;
    }

    const handlePanelChange = (date: Dayjs) => {
        if (colors) {
            handleInitCalendarEvents(colors, date);
            setCurrentDate(date);
        }
    }

    return <BasicLayout>
        {contextHolder}
        <Spin spinning={loading}>
            <Calendar onPanelChange={handlePanelChange} cellRender={cellRender} />
        </Spin>
    </BasicLayout >
}