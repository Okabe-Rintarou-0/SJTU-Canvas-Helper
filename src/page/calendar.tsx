import { invoke } from "@tauri-apps/api/core";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import TodayRoundedIcon from "@mui/icons-material/TodayRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { zhCN } from "@mui/x-date-pickers/locales";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import BasicLayout from "../components/layout";
import { WorkspaceHero } from "../components/workspace_hero";
import type { CalendarEvent, Colors, Course } from "../lib/model";
import { surfaceCardSx } from "../lib/styles";

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const weekColumns = "repeat(7, minmax(0, 1fr))";

type CalendarSources = {
  colors: Colors["custom_colors"];
  courses: Map<string, Course>;
  lockOnlyEvents: Promise<CalendarEvent[]>;
};

type CalendarAssignment = {
  key: string;
  title: string;
  courseId: number;
  courseName: string;
  date: Dayjs;
  closes: boolean;
  color?: string;
};

type CalendarResult = { items: CalendarAssignment[]; error?: true };

const dateKey = (date: Dayjs) => date.format("YYYY-MM-DD");

function getMonthGridDates(month: Dayjs) {
  const firstDay = month.startOf("month");
  const offset = (firstDay.day() + 6) % 7;
  const start = firstDay.subtract(offset, "day");
  const days = Math.ceil((offset + month.daysInMonth()) / 7) * 7;
  return Array.from({ length: days }, (_, index) => start.add(index, "day"));
}

async function loadAssignments(sources: CalendarSources, start: Dayjs, end: Dayjs) {
  if (!sources.courses.size) return [];
  const [datedEvents, lockOnlyEvents] = await Promise.all([
    invoke<CalendarEvent[]>("list_calendar_events", {
      contextCodes: [...sources.courses.keys()],
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    }),
    sources.lockOnlyEvents,
  ]);
  const items = new Map<string, CalendarAssignment>();
  for (const event of [...datedEvents, ...lockOnlyEvents]) {
    const course = sources.courses.get(event.context_code);
    const { due_at: due, lock_at: lock } = event.assignment;
    const timestamp = due || lock || event.end_at || event.start_at;
    if (!course || !timestamp) continue;
    const date = dayjs(timestamp);
    if (!date.isValid() || date.isBefore(start) || date.isAfter(end)) continue;
    const key = `${course.id}:${event.assignment.id}:${date.valueOf()}`;
    if (items.has(key)) continue;
    items.set(key, {
      key,
      title: event.title,
      courseId: course.id,
      courseName: course.name || event.context_name,
      date,
      closes: !due && Boolean(lock),
      color: sources.colors[event.context_code],
    });
  }
  return [...items.values()].sort((left, right) => left.date.valueOf() - right.date.valueOf());
}

function getRemainingTime({ date, closes }: CalendarAssignment, now: Dayjs) {
  const minutes = date.diff(now, "minute");
  if (!date.isAfter(now)) return closes ? "已关闭" : "已截止";
  if (minutes < 1) return "不足 1 分钟";
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `剩 ${days} 天 ${hours % 24} 小时`;
  if (hours) return `剩 ${hours} 小时 ${minutes % 60} 分钟`;
  return `剩 ${minutes} 分钟`;
}

function AssignmentLink({ item, inCalendar = false, now }: {
  item: CalendarAssignment;
  inCalendar?: boolean;
  now?: Dayjs;
}) {
  const theme = useTheme();
  const color = item.color || theme.palette.primary.main;
  const localTime = item.date.format("HH:mm");
  const dateLabel = item.closes ? "关闭 " : "";
  const calendarTitle = `${item.title} · ${item.courseName} · ${dateLabel}${localTime}`;

  return (
    <Tooltip title={inCalendar ? calendarTitle : ""} placement="top">
      <MuiLink
        component={RouterLink}
        to={`/assignments?id=${item.courseId}`}
        underline="hover"
        onClick={inCalendar ? (event) => event.stopPropagation() : undefined}
        sx={{
          display: "flex", justifyContent: "space-between", gap: 0.75, minWidth: 0,
          px: inCalendar ? 0.5 : 0.75, py: inCalendar ? 0.25 : 0.5,
          borderLeft: "3px solid", borderColor: color, borderRadius: "4px",
          bgcolor: inCalendar ? alpha(color, 0.1) : undefined,
          color: "text.primary",
          "&:hover": { bgcolor: alpha(color, 0.16) },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="span" variant={inCalendar ? "caption" : "body2"}
            noWrap={inCalendar} sx={{ display: "block", fontWeight: 600, overflowWrap: "anywhere", lineHeight: 1.35 }}>
            {item.title}
          </Typography>
          <Typography component="span" variant="caption" color="text.secondary"
            noWrap={inCalendar} sx={{ display: "block", overflowWrap: "anywhere", lineHeight: 1.35 }}>
            {item.courseName}
          </Typography>
        </Box>
        {!inCalendar && (
          <Stack alignItems="flex-end" sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            <Typography component="time" dateTime={item.date.toISOString()} variant="caption" color="text.secondary">
              {dateLabel}{item.date.format("M/D HH:mm")}
            </Typography>
            {now && (
              <Typography variant="caption" color={item.date.diff(now, "hour") < 24 ? "warning.main" : "text.secondary"}>
                {getRemainingTime(item, now)}
              </Typography>
            )}
          </Stack>
        )}
      </MuiLink>
    </Tooltip>
  );
}

function Agenda({ title, result, empty, now }: { title: string; result?: CalendarResult; empty: string; now?: Dayjs }) {
  return (
    <Box>
      <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, mb: 0.75 }}>{title}</Typography>
      {!result ? <LinearProgress aria-label={`正在加载${title}`} /> : result.error ? (
        <Typography variant="body2" color="error">读取事项失败。</Typography>
      ) : result.items.length > 0 ? (
        <Stack spacing={0.5}>
          {result.items.map((item) => <AssignmentLink key={item.key} item={item} now={now} />)}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">{empty}</Typography>
      )}
    </Box>
  );
}

export default function CalendarPage() {
  const today = dayjs();
  const [currentMonth, setCurrentMonth] = useState(() => dayjs().startOf("month"));
  const [selectedDate, setSelectedDate] = useState(() => dayjs());
  const [sources, setSources] = useState<CalendarSources>();
  const [sourceError, setSourceError] = useState(false);
  const [lockDateError, setLockDateError] = useState(false);
  const [monthResult, setMonthResult] = useState<{ month: Dayjs; result: CalendarResult }>();
  const [upcoming, setUpcoming] = useState<CalendarResult>();

  useEffect(() => {
    let active = true;
    Promise.all([invoke<Colors>("get_colors"), invoke<Course[]>("list_courses")])
      .then(([{ custom_colors: colors }, courses]) => {
        if (!active) return;
        const courseMap = new Map<string, Course>();
        for (const course of courses) {
          const context = `course_${course.id}`;
          if (Object.prototype.hasOwnProperty.call(colors, context)) courseMap.set(context, course);
        }
        const contextCodes = [...courseMap.keys()];
        const lockOnlyEvents = contextCodes.length
          ? invoke<CalendarEvent[]>("list_calendar_assignments_with_only_lock_dates", { contextCodes })
            .catch(() => {
              if (active) setLockDateError(true);
              return [];
            })
          : Promise.resolve([]);
        setSources({ colors, courses: courseMap, lockOnlyEvents });
      })
      .catch(() => { if (active) setSourceError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sources) return;
    let active = true;
    const finish = (result: CalendarResult) => { if (active) setMonthResult({ month: currentMonth, result }); };
    void loadAssignments(sources, currentMonth.startOf("month"), currentMonth.endOf("month"))
      .then((items) => finish({ items }), () => finish({ items: [], error: true }));
    return () => { active = false; };
  }, [currentMonth, sources]);

  useEffect(() => {
    if (!sources) return;
    let active = true;
    const now = dayjs();
    const finish = (result: CalendarResult) => { if (active) setUpcoming(result); };
    void loadAssignments(sources, now, now.add(7, "day"))
      .then((items) => finish({ items }), () => finish({ items: [], error: true }));
    return () => { active = false; };
  }, [sources]);

  const selectDate = useCallback((date: Dayjs) => {
    setCurrentMonth((previous) => previous.isSame(date, "month") ? previous : date.startOf("month"));
    setSelectedDate(date);
  }, []);

  const changeMonth = useCallback((date: Dayjs) => {
    const now = dayjs();
    selectDate(date.isSame(now, "month") ? now : date.startOf("month"));
  }, [selectDate]);

  useEffect(() => {
    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (event.target instanceof Element && event.target.closest(
        "input, textarea, select, [contenteditable], [role=dialog], [role=menu]"
      )) return;
      changeMonth(currentMonth.add(event.key === "ArrowRight" ? 1 : -1, "month"));
    };
    document.addEventListener("keydown", handleArrowKey);
    return () => document.removeEventListener("keydown", handleArrowKey);
  }, [changeMonth, currentMonth]);

  const visibleMonth = monthResult?.month === currentMonth ? monthResult.result : undefined;
  const dates = useMemo(() => getMonthGridDates(currentMonth), [currentMonth]);
  const byDate = useMemo(() => {
    const indexed = new Map<string, CalendarAssignment[]>();
    for (const item of visibleMonth?.items ?? []) {
      const key = dateKey(item.date);
      const group = indexed.get(key);
      if (group) group.push(item);
      else indexed.set(key, [item]);
    }
    return indexed;
  }, [visibleMonth]);

  return (
    <BasicLayout>
      <Stack spacing={2.5}>
        <WorkspaceHero
          chipLabel="日程管理"
          chipIcon={<CalendarMonthRoundedIcon />}
          title="课程日历"
          description="查看 Canvas 作业的截止时间、关闭时间和未来七天的事项。"
          aside={
            <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="zh-cn"
              localeText={zhCN.components.MuiLocalizationProvider.defaultProps.localeText}>
              <DatePicker
                label="选择月份"
                views={["year", "month"]}
                openTo="month"
                format="YYYY 年 M 月"
                value={currentMonth}
                closeOnSelect
                onChange={(date, context) => {
                  if (date && !context.validationError) changeMonth(date);
                }}
                sx={{ width: 196, maxWidth: "100%" }}
              />
            </LocalizationProvider>
          }
        />

        {lockDateError && <Alert severity="warning">无法读取仅设置了关闭日期的作业。</Alert>}
        {sourceError ? (
          <Alert severity="error">无法读取 Canvas 课程日历。</Alert>
        ) : (
          <Box sx={{
            display: "grid", alignItems: "start", gap: 2,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "minmax(0, 1fr) minmax(230px, 0.32fr)" },
          }}>
            <Card sx={surfaceCardSx} aria-label={currentMonth.format("YYYY 年 M 月作业日历")}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.25, py: 0.5 }}>
                <Typography variant="caption" color="text.secondary">点击日期查看当天事项</Typography>
                <Stack direction="row" spacing={0.25}>
                  <Tooltip title="回到今天">
                    <IconButton size="small" aria-label="回到今天" onClick={() => selectDate(dayjs())}>
                      <TodayRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="上个月">
                    <IconButton size="small" aria-label="上个月" onClick={() => changeMonth(currentMonth.subtract(1, "month"))}>
                      <ChevronLeftRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="下个月">
                    <IconButton size="small" aria-label="下个月" onClick={() => changeMonth(currentMonth.add(1, "month"))}>
                      <ChevronRightRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
              {!visibleMonth && <LinearProgress aria-label="正在加载月历" />}
              <Box sx={{ display: "grid", gridTemplateColumns: weekColumns, bgcolor: "action.hover" }}>
                {weekdayLabels.map((label) => (
                  <Typography key={label} variant="caption" align="center" color="text.secondary" sx={{ py: 0.75 }}>
                    {label}
                  </Typography>
                ))}
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: weekColumns }}>
                {dates.map((date, index) => {
                  const key = dateKey(date);
                  const items = byDate.get(key) ?? [];
                  const inMonth = date.isSame(currentMonth, "month");
                  const isToday = date.isSame(today, "day");
                  const selected = date.isSame(selectedDate, "day");

                  return (
                    <Stack key={key} spacing={0.25} onClick={() => selectDate(date)} sx={{
                      cursor: "pointer", minWidth: 0, minHeight: { xs: 46, md: 72 }, p: { xs: 0.25, md: 0.5 },
                      borderTop: "1px solid", borderRight: index % 7 < 6 ? "1px solid" : undefined,
                      borderColor: "divider",
                      bgcolor: selected ? "action.selected" : !inMonth ? "action.hover" : undefined,
                      "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
                    }}>
                      <Button size="small"
                        aria-pressed={selected} aria-current={isToday ? "date" : undefined}
                        aria-label={`${date.format("M 月 D 日")}，${items.length} 项作业`}
                        sx={{
                          alignSelf: { md: "flex-start" }, minWidth: 0, minHeight: 34, px: 0.75, py: 0,
                          color: isToday || selected ? "primary.main" : inMonth ? "text.primary" : "text.secondary", gap: 0.5,
                        }}>
                        {date.date()}
                        {isToday && <Box aria-hidden component="span" sx={{ display: { xs: "none", md: "inline" }, fontSize: 10 }}>今天</Box>}
                        {!!items.length && <Box aria-hidden component="span" sx={{
                          fontSize: 10, color: "primary.main", display: { md: "none" },
                        }}>·{items.length}</Box>}
                      </Button>
                      <Stack spacing={0.25} sx={{ display: { xs: "none", md: "flex" } }}>
                        {items.slice(0, 3).map((item) => <AssignmentLink key={item.key} item={item} inCalendar />)}
                        {items.length > 3 && (
                          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                            另有 {items.length - 3} 项
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                  );
                })}
              </Box>
            </Card>

            <Card sx={surfaceCardSx}>
              <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                <Stack spacing={2} divider={<Box sx={{ borderTop: "1px solid", borderColor: "divider" }} />}>
                  <Agenda
                    title={selectedDate.format("M 月 D 日事项")}
                    result={visibleMonth && { items: byDate.get(dateKey(selectedDate)) ?? [], error: visibleMonth.error }}
                    empty="当天没有作业截止或关闭。"
                  />
                  <Agenda title="未来七天" result={upcoming} now={today} empty="未来七天没有作业截止或关闭。" />
                </Stack>
              </CardContent>
            </Card>
          </Box>
        )}
      </Stack>
    </BasicLayout>
  );
}
