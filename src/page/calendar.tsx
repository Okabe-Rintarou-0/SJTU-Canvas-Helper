import { invoke } from "@tauri-apps/api/core";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import KeyboardDoubleArrowLeftRoundedIcon from "@mui/icons-material/KeyboardDoubleArrowLeftRounded";
import TodayRoundedIcon from "@mui/icons-material/TodayRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import dayjs, { Dayjs } from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

import BasicLayout from "../components/layout";
import { WorkspaceHero } from "../components/workspace_hero";
import { useAppMessage } from "../lib/message";
import { CalendarEvent, Colors, Course } from "../lib/model";

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const monthOptions = [
  "1 月",
  "2 月",
  "3 月",
  "4 月",
  "5 月",
  "6 月",
  "7 月",
  "8 月",
  "9 月",
  "10 月",
  "11 月",
  "12 月",
];

const cardSx = {
  borderRadius: "28px",
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 22px 50px rgba(15, 23, 42, 0.08)",
  backgroundImage: "none",
};

function getCourseId(event: CalendarEvent) {
  const parts = event.context_code.split("_");
  return parts[parts.length - 1];
}

function getEventMoment(event: CalendarEvent) {
  return dayjs(event.end_at || event.start_at || dayjs().toISOString());
}

function getDateKey(date: Dayjs) {
  return date.format("YYYY-MM-DD");
}

function getMonthGridDates(currentMonth: Dayjs) {
  const firstDay = currentMonth.startOf("month");
  const offset = (firstDay.day() + 6) % 7;
  const gridStart = firstDay.subtract(offset, "day");
  return Array.from({ length: 42 }, (_, index) => gridStart.add(index, "day"));
}

export default function CalendarPage() {
  const [messageApi, contextHolder] = useAppMessage();
  const [currentMonth, setCurrentMonth] = useState<Dayjs>(dayjs());
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [colors, setColors] = useState<Colors | undefined>();
  const [contextCodes, setContextCodes] = useState<string[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [hintEvents, setHintEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const currentMonthRef = useRef<Dayjs>(dayjs());
  const contextCodesRef = useRef<string[]>([]);

  useEffect(() => {
    init();
    document.body.addEventListener("keydown", handleKeyDownEvent, true);
    return () => {
      document.body.removeEventListener("keydown", handleKeyDownEvent, true);
    };
  }, []);

  useEffect(() => {
    currentMonthRef.current = currentMonth;
  }, [currentMonth]);

  useEffect(() => {
    contextCodesRef.current = contextCodes;
  }, [contextCodes]);

  const handleKeyDownEvent = (event: KeyboardEvent) => {
    if (loading) {
      return;
    }
    if (event.key === "ArrowRight" && !event.repeat) {
      void handleMonthChange(currentMonthRef.current.add(1, "month"));
    }
    if (event.key === "ArrowLeft" && !event.repeat) {
      void handleMonthChange(currentMonthRef.current.subtract(1, "month"));
    }
  };

  const getColors = () => invoke("get_colors");

  const handleGetCalendarEvents = async (
    nextContextCodes: string[],
    startDate: string,
    endDate: string
  ) => {
    return (await invoke("list_calendar_events", {
      contextCodes: nextContextCodes,
      startDate,
      endDate,
    })) as CalendarEvent[];
  };

  const dedupeEvents = (rawEvents: CalendarEvent[]) => {
    const seenAssignments = new Set<number>();
    return rawEvents.filter((event) => {
      if (seenAssignments.has(event.assignment.id)) {
        return false;
      }
      seenAssignments.add(event.assignment.id);
      return true;
    });
  };

  const init = async () => {
    try {
      const nextColors = (await getColors()) as Colors;
      const courses = (await invoke("list_courses")) as Course[];
      const courseIds = Array.from(courses, (course) => `course_${course.id}`);
      const nextContextCodes = courseIds.filter((courseId) =>
        Object.keys(nextColors.custom_colors).includes(courseId)
      );

      setColors(nextColors);
      setContextCodes(nextContextCodes);
      await Promise.all([
        handleInitCalendarEvents(nextContextCodes, currentMonth),
        getHints(nextContextCodes),
      ]);
    } catch (error) {
      messageApi.error(`初始化日历失败：${error}`);
    }
  };

  const handleInitCalendarEvents = async (
    nextContextCodes: string[],
    date: Dayjs
  ) => {
    setLoading(true);
    try {
      const startDate = date.startOf("month").toISOString();
      const endDate = date.endOf("month").toISOString();
      const rawEvents = await handleGetCalendarEvents(
        nextContextCodes,
        startDate,
        endDate
      );
      setEvents(dedupeEvents(rawEvents));
    } catch (error) {
      messageApi.error(error as string);
    } finally {
      setLoading(false);
    }
  };

  const getHints = async (nextContextCodes: string[]) => {
    try {
      const now = dayjs().toISOString();
      const afterAWeek = dayjs().add(7, "day").toISOString();
      const rawEvents = await handleGetCalendarEvents(nextContextCodes, now, afterAWeek);
      const deduped = dedupeEvents(rawEvents).sort(
        (a, b) => getEventMoment(a).valueOf() - getEventMoment(b).valueOf()
      );
      setHintEvents(deduped);
    } catch (error) {
      messageApi.error(error as string);
    }
  };

  const handleMonthChange = async (date: Dayjs) => {
    setCurrentMonth(date);
    setSelectedDate(date);
    if (contextCodesRef.current.length > 0) {
      await handleInitCalendarEvents(contextCodesRef.current, date);
    }
  };

  const monthGridDates = useMemo(() => getMonthGridDates(currentMonth), [currentMonth]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = getDateKey(getEventMoment(event));
      const current = grouped.get(key) ?? [];
      current.push(event);
      grouped.set(key, current);
    }
    for (const [key, list] of grouped) {
      grouped.set(
        key,
        list.sort((a, b) => getEventMoment(a).valueOf() - getEventMoment(b).valueOf())
      );
    }
    return grouped;
  }, [events]);

  const selectedDayEvents = useMemo(() => {
    return eventsByDate.get(getDateKey(selectedDate)) ?? [];
  }, [eventsByDate, selectedDate]);

  const statItems = useMemo(() => {
    const thisMonthCount = events.length;
    const todayCount = eventsByDate.get(getDateKey(dayjs()))?.length ?? 0;
    const urgentCount = hintEvents.length;
    const selectedCount = selectedDayEvents.length;
    return [
      { label: "本月事项", value: `${thisMonthCount}`, icon: <CalendarMonthRoundedIcon /> },
      { label: "今日截止", value: `${todayCount}`, icon: <WarningAmberRoundedIcon /> },
      { label: "七日提醒", value: `${urgentCount}`, icon: <EventAvailableRoundedIcon /> },
      { label: "所选日期", value: `${selectedCount}`, icon: <TodayRoundedIcon /> },
    ];
  }, [events.length, eventsByDate, hintEvents.length, selectedDayEvents.length]);

  const yearOptions = useMemo(() => {
    const currentYear = dayjs().year();
    return Array.from({ length: 11 }, (_, index) => currentYear - 5 + index);
  }, []);

  const handleYearSelect = async (year: number) => {
    await handleMonthChange(currentMonth.year(year));
  };

  const handleMonthSelect = async (month: number) => {
    await handleMonthChange(currentMonth.month(month));
  };

  return (
    <BasicLayout>
      {contextHolder}
      <Box sx={{ minHeight: "100%", color: "text.primary" }}>
        <Stack spacing={3}>
          <WorkspaceHero
            chipLabel="Calendar Workspace"
            chipIcon={<CalendarMonthRoundedIcon />}
            title="日历与 DDL 工作台"
            description="更适合扫读、排程和追踪作业截止日期的月历视图。"
            aside={
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                <TextField
                  select
                  size="small"
                  label="年份"
                  value={currentMonth.year()}
                  onChange={(event) => void handleYearSelect(Number(event.target.value))}
                  sx={{ minWidth: 120 }}
                >
                  {yearOptions.map((year) => (
                    <MenuItem key={year} value={year}>
                      {year} 年
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="月份"
                  value={currentMonth.month()}
                  onChange={(event) => void handleMonthSelect(Number(event.target.value))}
                  sx={{ minWidth: 110 }}
                >
                  {monthOptions.map((label, index) => (
                    <MenuItem key={label} value={index}>
                      {label}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="outlined"
                  startIcon={<KeyboardDoubleArrowLeftRoundedIcon />}
                  onClick={() => void handleMonthChange(dayjs())}
                >
                  回到本月
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ArrowBackRoundedIcon />}
                  onClick={() => void handleMonthChange(currentMonth.subtract(1, "month"))}
                >
                  上个月
                </Button>
                <Button
                  variant="contained"
                  endIcon={<ArrowForwardRoundedIcon />}
                  onClick={() => void handleMonthChange(currentMonth.add(1, "month"))}
                >
                  下个月
                </Button>
              </Stack>
            }
            stats={statItems}
          />

          <Box
            sx={{
              display: "grid",
              gap: 3,
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                xl: "minmax(0, 1.5fr) minmax(320px, 0.78fr)",
              },
            }}
          >
            <Card sx={cardSx}>
              <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                <Stack spacing={2.5}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    spacing={1.5}
                  >
                    <Box>
                      <Typography variant="h5">
                        {currentMonth.format("YYYY 年 M 月")}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        使用左右方向键也可以切换月份。
                      </Typography>
                    </Box>
                    <Chip
                      icon={<AutoAwesomeRoundedIcon />}
                      label={`共 ${events.length} 个去重后的日历事项`}
                      color="primary"
                      variant="outlined"
                    />
                  </Stack>

                  <Alert severity="info" sx={{ borderRadius: "18px" }}>
                    点击某一天可以查看当天的截止事项，点击事项名称会跳转到对应课程的作业页。
                  </Alert>

                  {loading ? (
                    <Box
                      sx={{
                        minHeight: 420,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <CircularProgress />
                    </Box>
                  ) : (
                    <Box sx={{ display: "grid", gap: 1.25 }}>
                      <Box
                        sx={{
                          display: "grid",
                          gap: 1,
                          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                        }}
                      >
                        {weekdayLabels.map((label) => (
                          <Box
                            key={label}
                            sx={{
                              px: 1.25,
                              py: 1,
                              borderRadius: "16px",
                              bgcolor: alpha("#2563eb", 0.07),
                              textAlign: "center",
                            }}
                          >
                            <Typography variant="subtitle2" color="text.secondary">
                              {label}
                            </Typography>
                          </Box>
                        ))}
                      </Box>

                      <Box
                        sx={{
                          display: "grid",
                          gap: 1,
                          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                        }}
                      >
                        {monthGridDates.map((date) => {
                          const key = getDateKey(date);
                          const dayEvents = eventsByDate.get(key) ?? [];
                          const isCurrentMonth = date.isSame(currentMonth, "month");
                          const isToday = date.isSame(dayjs(), "day");
                          const isSelected = date.isSame(selectedDate, "day");

                          return (
                            <Card
                              key={key}
                              onClick={() => setSelectedDate(date)}
                              sx={{
                                minHeight: { xs: 132, md: 156 },
                                cursor: "pointer",
                                borderRadius: "22px",
                                border: "1px solid",
                                borderColor: isSelected
                                  ? "primary.main"
                                  : isToday
                                    ? alpha("#2563eb", 0.3)
                                    : "divider",
                                bgcolor: isSelected
                                  ? alpha("#2563eb", 0.06)
                                  : isCurrentMonth
                                    ? "background.paper"
                                    : alpha("#cbd5e1", 0.38),
                                boxShadow: isSelected
                                  ? "0 16px 34px rgba(37, 99, 235, 0.12)"
                                  : "none",
                                transition: "border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
                                "&:hover": {
                                  transform: "translateY(-2px)",
                                  borderColor: "primary.main",
                                },
                              }}
                            >
                              <CardContent
                                sx={{
                                  p: 1.25,
                                  height: "100%",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 1,
                                }}
                              >
                                <Stack
                                  direction="row"
                                  justifyContent="space-between"
                                  alignItems="center"
                                  spacing={1}
                                >
                                  <Typography
                                    variant="subtitle2"
                                    sx={{
                                      fontWeight: isToday || isSelected ? 700 : 600,
                                      color: isCurrentMonth ? "text.primary" : "text.disabled",
                                    }}
                                  >
                                    {date.date()}
                                  </Typography>
                                  {isToday && <Chip size="small" label="今天" color="primary" />}
                                </Stack>

                                <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                                  {dayEvents.slice(0, 3).map((event) => (
                                    <Tooltip
                                      key={event.id}
                                      title={`${event.context_name} · ${getEventMoment(event).format(
                                        "MM/DD HH:mm"
                                      )}`}
                                      placement="top"
                                    >
                                      <MuiLink
                                        component={RouterLink}
                                        to={`/assignments?id=${getCourseId(event)}`}
                                        underline="none"
                                        onClick={(eventClick) => eventClick.stopPropagation()}
                                        sx={{
                                          display: "block",
                                          px: 1,
                                          py: 0.7,
                                          borderRadius: "12px",
                                          bgcolor: alpha(
                                            colors?.custom_colors[event.context_code] || "#2563eb",
                                            0.12
                                          ),
                                          color: "text.primary",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                          borderLeft: `4px solid ${
                                            colors?.custom_colors[event.context_code] || "#2563eb"
                                          }`,
                                          "&:hover": {
                                            bgcolor: alpha(
                                              colors?.custom_colors[event.context_code] || "#2563eb",
                                              0.18
                                            ),
                                          },
                                        }}
                                      >
                                        {event.title}
                                      </MuiLink>
                                    </Tooltip>
                                  ))}
                                  {dayEvents.length > 3 && (
                                    <Typography variant="caption" color="text.secondary">
                                      还有 {dayEvents.length - 3} 项…
                                    </Typography>
                                  )}
                                </Stack>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </Box>
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>

            <Stack spacing={3}>
              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="h5">七日内 DDL</Typography>
                      <Typography variant="body2" color="text.secondary">
                        优先关注最近一周需要处理的事项。
                      </Typography>
                    </Box>

                    {hintEvents.length === 0 ? (
                      <Alert severity="success" sx={{ borderRadius: "18px" }}>
                        暂无临近 DDL，尽情享受当下。
                      </Alert>
                    ) : (
                      <Stack spacing={1.25}>
                        {hintEvents.map((event) => {
                          const now = dayjs();
                          const diff = getEventMoment(event).diff(now, "hour");
                          const days = Math.floor(diff / 24);
                          const hours = diff % 24;

                          return (
                            <Box
                              key={event.id}
                              sx={{
                                p: 1.5,
                                borderRadius: "18px",
                                border: "1px solid",
                                borderColor: "divider",
                                bgcolor: alpha(
                                  colors?.custom_colors[event.context_code] || "#2563eb",
                                  0.06
                                ),
                              }}
                            >
                              <Stack spacing={0.7}>
                                <MuiLink
                                  component={RouterLink}
                                  to={`/assignments?id=${getCourseId(event)}`}
                                  underline="hover"
                                  sx={{ fontWeight: 700, color: "text.primary" }}
                                >
                                  {event.title}
                                </MuiLink>
                                <Typography variant="body2" color="text.secondary">
                                  {event.context_name}
                                </Typography>
                                <Chip
                                  size="small"
                                  color={days <= 1 ? "warning" : "default"}
                                  label={`还有 ${days} 天 ${hours} 小时`}
                                  sx={{ width: "fit-content" }}
                                />
                              </Stack>
                            </Box>
                          );
                        })}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={cardSx}>
                <CardContent sx={{ p: { xs: 2.25, md: 3 } }}>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="h5">
                        {selectedDate.format("M 月 D 日")} 事项
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        选中日期后，这里会显示当天所有作业与截止事项。
                      </Typography>
                    </Box>
                    <Divider />

                    {selectedDayEvents.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        这一天没有记录到截止事项。
                      </Typography>
                    ) : (
                      <Stack spacing={1.25}>
                        {selectedDayEvents.map((event) => (
                          <Box
                            key={event.id}
                            sx={{
                              p: 1.5,
                              borderRadius: "18px",
                              border: "1px solid",
                              borderColor: "divider",
                            }}
                          >
                            <Stack spacing={0.7}>
                              <MuiLink
                                component={RouterLink}
                                to={`/assignments?id=${getCourseId(event)}`}
                                underline="hover"
                                sx={{ fontWeight: 700, color: "text.primary" }}
                              >
                                {event.title}
                              </MuiLink>
                              <Typography variant="body2" color="text.secondary">
                                {event.context_name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                截止时间：{getEventMoment(event).format("YYYY/MM/DD HH:mm")}
                              </Typography>
                            </Stack>
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </Box>
        </Stack>

      </Box>
    </BasicLayout>
  );
}
