import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import BoltRoundedIcon from "@mui/icons-material/BoltRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import MovieCreationRoundedIcon from "@mui/icons-material/MovieCreationRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import StarsRoundedIcon from "@mui/icons-material/StarsRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import ReactEcharts from "echarts-for-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useMemo, useRef, useState } from "react";

import BasicLayout from "../components/layout";
import { useAnnualReport } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { AnnualReport } from "../lib/model";

interface BarChartProps {
  data: Map<string, number[]>;
  xAxisData: string[];
  themeMode: "light" | "dark";
}

const barPalette = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

const ANNUAL_EXPORT_ROOT_ID = "annual-export-root";

function formatTimelineDate(value?: string | null) {
  if (!value) {
    return "暂无记录";
  }
  const date = new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${month}/${day}`;
}

function formatDetailedTimeline(value?: string | null) {
  if (!value) {
    return "暂无记录";
  }
  const date = new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

const BarChart: React.FC<BarChartProps> = ({ data, xAxisData, themeMode }) => {
  const option: echarts.EChartsOption = {
    color: barPalette,
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow",
      },
      backgroundColor: themeMode === "dark" ? "#0f172a" : "#111827",
      borderWidth: 0,
      textStyle: {
        color: "#f8fafc",
      },
      formatter(params: any) {
        let tooltipStr = "";
        for (const param of params) {
          if (param.value !== 0) {
            tooltipStr += `${param.marker}${param.seriesName}: ${param.value}<br>`;
          }
        }
        return tooltipStr || "暂无数据";
      },
    },
    grid: {
      left: 24,
      right: 18,
      top: 28,
      bottom: 24,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: xAxisData,
      axisLine: {
        lineStyle: {
          color: themeMode === "dark" ? "rgba(226,232,240,0.18)" : "rgba(15,23,42,0.12)",
        },
      },
      axisLabel: {
        color: themeMode === "dark" ? "#cbd5e1" : "#475569",
      },
    },
    yAxis: {
      type: "value",
      splitLine: {
        lineStyle: {
          color: themeMode === "dark" ? "rgba(226,232,240,0.08)" : "rgba(15,23,42,0.08)",
        },
      },
      axisLabel: {
        color: themeMode === "dark" ? "#cbd5e1" : "#475569",
      },
    },
    series: [],
  };

  data.forEach((seriesData, name) => {
    (option.series as any[]).push({
      name,
      type: "bar",
      stack: "total",
      barMaxWidth: 18,
      emphasis: {
        focus: "series",
      },
      data: seriesData,
    });
  });

  return (
    <Box sx={{ width: "100%", minWidth: 0, overflow: "hidden" }}>
      <ReactEcharts
        option={option}
        style={{ height: 360, width: "100%", minWidth: 0, overflow: "hidden" }}
        opts={{ renderer: "svg" }}
      />
    </Box>
  );
};

function isDaytime(timeStr: string): boolean {
  const date = new Date(timeStr);
  const hours = date.getHours();
  return hours >= 6 && hours < 18;
}

function countDayAndNightSubmits(report: AnnualReport): [number, number] {
  let dayCount = 0;
  let nightCount = 0;
  for (const courseId in report.courseToStatistic) {
    const courseStatistic = report.courseToStatistic[courseId];
    courseStatistic.submitTimeList.forEach((timeStr) => {
      if (isDaytime(timeStr)) {
        dayCount++;
      } else {
        nightCount++;
      }
    });
  }
  return [dayCount, nightCount];
}

function getHour(timeStr: string): number {
  return new Date(timeStr).getHours();
}

function getMonth(timeStr: string) {
  return new Date(timeStr).getMonth();
}

function countSubmitsByMonth(report?: AnnualReport): [Map<string, number[]>, number] {
  const result: Map<string, number[]> = new Map();
  if (!report) {
    return [result, 1];
  }

  let maxMonth = 1;
  let maxMonthCount = 0;
  const totalMonthArray = new Array(12).fill(0);
  for (const courseId in report.courseToStatistic) {
    const courseStatistic = report.courseToStatistic[courseId];
    const monthCountArray: number[] = new Array(12).fill(0);
    courseStatistic.submitTimeList.forEach((timeStr) => {
      const month = getMonth(timeStr);
      monthCountArray[month]++;
      totalMonthArray[month]++;
      if (totalMonthArray[month] > maxMonthCount) {
        maxMonth = month + 1;
        maxMonthCount = totalMonthArray[month];
      }
    });
    result.set(courseStatistic.courseName, monthCountArray);
  }
  return [result, maxMonth];
}

function countSubmitsByHour(report?: AnnualReport): Map<string, number[]> {
  const result: Map<string, number[]> = new Map();
  if (!report) {
    return result;
  }
  for (const courseId in report.courseToStatistic) {
    const courseStatistic = report.courseToStatistic[courseId];
    const hourCountArray: number[] = new Array(24).fill(0);
    courseStatistic.submitTimeList.forEach((timeStr) => {
      const hour = getHour(timeStr);
      hourCountArray[hour]++;
    });
    result.set(courseStatistic.courseName, hourCountArray);
  }
  return result;
}

function getTopCourseStatistic(report?: AnnualReport) {
  if (!report) {
    return null;
  }
  const statistics = Object.values(report.courseToStatistic);
  if (statistics.length === 0) {
    return null;
  }
  return statistics.reduce((best, current) =>
    current.submittedCount > best.submittedCount ? current : best
  );
}

export default function AnnualPage() {
  const theme = useTheme();
  const now = new Date().getFullYear();
  const [currentYear, setCurrentYear] = useState<number>(now);
  const [selectedYear, setSelectedYear] = useState<number>(now);
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);
  const [selectedStoryCard, setSelectedStoryCard] = useState(0);
  const annualRef = useRef<HTMLDivElement>(null);
  const annualExportRef = useRef<HTMLDivElement>(null);
  const report = useAnnualReport(selectedYear);
  const [messageApi] = useAppMessage();

  const [dayCount, nightCount] = report.data ? countDayAndNightSubmits(report.data) : [0, 0];
  const hourCountMap = countSubmitsByHour(report.data);
  const [monthCountMap, maxMonth] = countSubmitsByMonth(report.data);
  const totalSubmits = dayCount + nightCount;
  const courseCount = report.data
    ? Object.keys(report.data.courseToStatistic).length
    : 0;
  const totalAssignments = report.data
    ? Object.values(report.data.courseToStatistic).reduce(
        (sum, course) => sum + course.assignmentCount,
        0
      )
    : 0;
  const lateCount = report.data
    ? Object.values(report.data.courseToStatistic).reduce((sum, course) => sum + course.lateCount, 0)
    : 0;
  const gradedCount = report.data
    ? Object.values(report.data.courseToStatistic).reduce((sum, course) => sum + course.gradedCount, 0)
    : 0;
  const totalScore = report.data
    ? Object.values(report.data.courseToStatistic).reduce((sum, course) => sum + course.totalScore, 0)
    : 0;
  const totalPointsPossible = report.data
    ? Object.values(report.data.courseToStatistic).reduce(
        (sum, course) => sum + course.totalPointsPossible,
        0
      )
    : 0;
  const completionRate =
    totalAssignments > 0 ? Math.round((totalSubmits / totalAssignments) * 100) : 0;
  const scoreRate =
    totalPointsPossible > 0 ? Math.round((totalScore / totalPointsPossible) * 100) : 0;
  const activeDayCount = report.data?.activeDayCount ?? 0;
  const topCourseStatistic = getTopCourseStatistic(report.data);
  const dominantTime =
    dayCount === nightCount ? "昼夜均衡" : dayCount > nightCount ? "白昼行动派" : "深夜创作者";

  const openingNarrative = useMemo(() => {
    if (!report.data) {
      return "";
    }
    if (totalSubmits === 0) {
      return `${selectedYear} 这一年，Canvas 里没有留下太多提交痕迹，像一卷几乎空白的胶片。`;
    }
    return `${selectedYear} 这一年，你在 ${courseCount} 门课程、${totalAssignments} 个作业节点中留下了 ${totalSubmits} 次提交记录，活跃了 ${activeDayCount} 天。每一次点击提交，都是这一年被记录下来的一个片段。`;
  }, [activeDayCount, courseCount, report.data, selectedYear, totalAssignments, totalSubmits]);

  const timelineEvents = useMemo(() => {
    if (!report.data) {
      return [];
    }
    return [
      {
        title: "片头",
        eyebrow: formatDetailedTimeline(report.data.firstSubmitAt),
        description: `这一年的第一段 Canvas 轨迹从这里开始。它像整部回顾影片的第一帧，标记了 ${selectedYear} 的学习节奏正式启动。`,
        icon: <MovieCreationRoundedIcon />,
      },
      {
        title: "高峰月出现",
        eyebrow: `${maxMonth} 月`,
        description: `${maxMonth} 月成为你最忙碌的时间段。那时的作业提醒、提交动作和截止节点，几乎把整个月切成了更紧凑的节拍。`,
        icon: <BoltRoundedIcon />,
      },
      {
        title: "主线课程确定",
        eyebrow: topCourseStatistic?.courseName ?? "暂无主线课程",
        description: topCourseStatistic
          ? `${topCourseStatistic.courseName} 成了这一年里最常出现的课程镜头，你在这里留下了 ${topCourseStatistic.submittedCount} 次提交。`
          : "这一年里还没有足够的数据形成清晰的课程主线。",
        icon: <AutoStoriesRoundedIcon />,
      },
      {
        title: "结尾镜头",
        eyebrow: formatDetailedTimeline(report.data.lastSubmitAt),
        description: `最后一次提交发生在这里。全年完成率 ${completionRate}% ，你的时间人格是“${dominantTime}”。这一年到这里留下了完整句点。`,
        icon: <StarsRoundedIcon />,
      },
    ];
  }, [completionRate, dominantTime, maxMonth, report.data, selectedYear, topCourseStatistic]);

  const storyCards = useMemo(
    () => [
      {
        key: "persona",
        title: "年度时间人格",
        subtitle: `${selectedYear} Canvas 回顾卡`,
        accent: "linear-gradient(135deg, rgba(37,99,235,0.92) 0%, rgba(14,165,233,0.92) 100%)",
        value: dominantTime,
        description: `这一年里，你有 ${dayCount} 次在白天提交，${nightCount} 次在夜晚提交。节奏与状态，决定了你在这一年里的行动方式。`,
        badge: "Time Persona",
      },
      {
        key: "focus",
        title: "年度主线课程",
        subtitle: `${selectedYear} Course Spotlight`,
        accent: "linear-gradient(135deg, rgba(245,158,11,0.92) 0%, rgba(239,68,68,0.88) 100%)",
        value: topCourseStatistic?.courseName ?? "暂无数据",
        description: topCourseStatistic
          ? `你在这门课里完成了 ${topCourseStatistic.submittedCount} 次提交，面对 ${topCourseStatistic.assignmentCount} 个作业节点，它是这一年里最频繁出现的学习主线。`
          : "这一年里还没有形成足够清晰的课程焦点。",
        badge: "Course Focus",
      },
      {
        key: "completion",
        title: "年度完成度",
        subtitle: `${selectedYear} Completion Snapshot`,
        accent: "linear-gradient(135deg, rgba(16,185,129,0.92) 0%, rgba(20,184,166,0.92) 100%)",
        value: `${completionRate}%`,
        description: `你完成了 ${totalSubmits}/${totalAssignments || 0} 次提交，活跃了 ${activeDayCount} 天，累计得分率 ${scoreRate}%。这一张更像年度成绩海报。`,
        badge: "Progress Score",
      },
    ],
    [
      activeDayCount,
      completionRate,
      dayCount,
      dominantTime,
      nightCount,
      scoreRate,
      selectedYear,
      topCourseStatistic,
      totalAssignments,
      totalSubmits,
    ]
  );

  const exportBaseName = `${selectedYear}-annual-review`;

  const captureElement = async (
    element: HTMLElement | null,
    options?: {
      scale?: number;
      backgroundColor?: string;
    }
  ) => {
    if (!element) {
      throw new Error("未找到可导出的年度总结区域。");
    }
    const exportWidth = Math.ceil(element.getBoundingClientRect().width);
    const exportHeight = Math.ceil(element.getBoundingClientRect().height);
    return html2canvas(element, {
      backgroundColor:
        options?.backgroundColor ?? (theme.palette.mode === "dark" ? "#07111d" : "#f4f7fb"),
      scale: options?.scale ?? 2,
      useCORS: true,
      logging: false,
      width: exportWidth,
      height: exportHeight,
      windowWidth: exportWidth,
      windowHeight: exportHeight,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: -window.scrollY,
      onclone: (clonedDoc) => {
        const clonedRoot = clonedDoc.getElementById(ANNUAL_EXPORT_ROOT_ID);
        if (clonedRoot) {
          clonedRoot.style.width = `${exportWidth}px`;
          clonedRoot.style.maxWidth = "none";
          clonedRoot.style.minWidth = "0";
          clonedRoot.style.boxSizing = "border-box";
          clonedRoot.style.margin = "0";
          clonedRoot.style.overflow = "hidden";
        }
      },
    });
  };

  const captureAnnualCard = async (options?: { scale?: number; backgroundColor?: string }) =>
    captureElement(annualExportRef.current, options);

  const blobToUint8Array = async (blob: Blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  };

  const handleExportImage = async () => {
    try {
      setExporting("image");
      const outputPath = await save({
        defaultPath: `${exportBaseName}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!outputPath) {
        return;
      }
      const canvas = await captureAnnualCard({ scale: 2 });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((result) => resolve(result), "image/png")
      );
      if (!blob) {
        throw new Error("无法生成图片数据。");
      }
      await invoke("save_path_file", {
        path: outputPath,
        content: Array.from(await blobToUint8Array(blob)),
      });
      messageApi.success("年度总结图片已保存。");
    } catch (error) {
      messageApi.error(`导出图片失败：${error}`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    try {
      setExporting("pdf");
      const outputPath = await save({
        defaultPath: `${exportBaseName}.pdf`,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!outputPath) {
        return;
      }
      const canvas = await captureAnnualCard({
        scale: 1.2,
        backgroundColor: theme.palette.mode === "dark" ? "#07111d" : "#ffffff",
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.88);
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
        compress: true,
      });
      pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height, undefined, "FAST");
      const pdfBytes = pdf.output("arraybuffer");
      await invoke("save_path_file", {
        path: outputPath,
        content: Array.from(new Uint8Array(pdfBytes)),
      });
      messageApi.success("年度总结 PDF 已保存。");
    } catch (error) {
      messageApi.error(`导出 PDF 失败：${error}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <BasicLayout>
      <Stack spacing={3}>
        <Card
          ref={annualRef}
          sx={{
            overflow: "hidden",
            borderRadius: "32px",
            border: "1px solid",
            borderColor: alpha(theme.palette.primary.main, 0.18),
            background:
              theme.palette.mode === "dark"
                ? "linear-gradient(180deg, rgba(8,15,28,0.96) 0%, rgba(9,25,46,0.96) 54%, rgba(7,17,29,1) 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(241,245,249,0.98) 54%, rgba(226,232,240,0.98) 100%)",
            boxShadow:
              theme.palette.mode === "dark"
                ? "0 30px 90px rgba(2, 8, 23, 0.55)"
                : "0 30px 90px rgba(15, 23, 42, 0.12)",
            position: "relative",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at top center, rgba(255,255,255,0.14), transparent 26%), linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.08) 100%)",
              pointerEvents: "none",
            }}
          />
          <CardContent sx={{ p: 0 }}>
            <Stack
              id={ANNUAL_EXPORT_ROOT_ID}
              ref={annualExportRef}
              spacing={4}
              sx={{
                position: "relative",
                width: "100%",
                minWidth: 0,
                boxSizing: "border-box",
                overflow: "hidden",
                p: { xs: 2.5, md: 4 },
                background:
                  theme.palette.mode === "dark"
                    ? "linear-gradient(180deg, rgba(8,15,28,0.96) 0%, rgba(9,25,46,0.96) 54%, rgba(7,17,29,1) 100%)"
                    : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(241,245,249,0.98) 54%, rgba(226,232,240,0.98) 100%)",
              }}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                spacing={2}
              >
                <Stack spacing={1.25} maxWidth={760}>
                  <Chip
                    icon={<MovieCreationRoundedIcon />}
                    label="Year In Review"
                    color="primary"
                    variant="outlined"
                    sx={{ width: "fit-content", backdropFilter: "blur(10px)" }}
                  />
                  <Typography
                    variant="h3"
                    sx={{
                      fontWeight: 800,
                      letterSpacing: "-0.04em",
                      lineHeight: 1.04,
                      textWrap: "balance",
                    }}
                  >
                    {selectedYear} 年度总结
                  </Typography>
                  <Typography
                    variant="body1"
                    color="text.secondary"
                    sx={{ maxWidth: 680, lineHeight: 1.85 }}
                  >
                    {openingNarrative || "选择年份，重新播放你在 Canvas 里的这一年。"}
                  </Typography>
                </Stack>

                <Box
                  sx={{
                    minWidth: { xs: "100%", md: 220 },
                    p: 2,
                    borderRadius: "24px",
                    border: "1px solid",
                    borderColor: alpha(theme.palette.common.white, 0.12),
                    bgcolor:
                      theme.palette.mode === "dark"
                        ? alpha("#0f172a", 0.72)
                        : alpha("#ffffff", 0.72),
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <Stack spacing={1.25}>
                    <Typography variant="body2" color="text.secondary">
                      选择年份
                    </Typography>
                    <TextField
                      type="number"
                      value={currentYear}
                      onChange={(event) => setCurrentYear(Number(event.target.value || 0))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          setSelectedYear(currentYear);
                        }
                      }}
                      inputProps={{ min: 0 }}
                    />
                    <Chip
                      label="按回车重新生成"
                      variant="outlined"
                      sx={{ width: "fit-content" }}
                    />
                  </Stack>
                </Box>
              </Stack>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.25}
                justifyContent="flex-end"
              >
                <Button
                  variant="outlined"
                  startIcon={<ImageRoundedIcon />}
                  endIcon={exporting === "image" ? <CircularProgress size={14} /> : undefined}
                  onClick={() => void handleExportImage()}
                  disabled={report.isLoading || !report.data || exporting !== null}
                >
                  导出图片
                </Button>
                <Button
                  variant="contained"
                  startIcon={<PictureAsPdfRoundedIcon />}
                  endIcon={exporting === "pdf" ? <CircularProgress size={14} color="inherit" /> : undefined}
                  onClick={() => void handleExportPdf()}
                  disabled={report.isLoading || !report.data || exporting !== null}
                >
                  导出 PDF
                </Button>
              </Stack>

              {report.isLoading ? (
                <Box sx={{ py: 12, display: "grid", placeItems: "center" }}>
                  <Stack spacing={1.5} alignItems="center">
                    <CircularProgress />
                    <Typography variant="body2" color="text.secondary">
                      正在生成这一年的回顾片段…
                    </Typography>
                  </Stack>
                </Box>
              ) : report.data ? (
                <Stack spacing={3.5}>
                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.5,
                      gridTemplateColumns: {
                        xs: "repeat(2, minmax(0, 1fr))",
                        xl: "repeat(4, minmax(0, 1fr))",
                      },
                    }}
                  >
                    {[
                      {
                        label: "提交总数",
                        value: `${totalSubmits}`,
                        icon: <QueryStatsRoundedIcon />,
                      },
                      {
                        label: "课程轨迹",
                        value: `${courseCount} 门`,
                        icon: <AutoStoriesRoundedIcon />,
                      },
                      {
                        label: "时间人格",
                        value: dominantTime,
                        icon: dayCount >= nightCount ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />,
                      },
                      {
                        label: "最忙月份",
                        value: `${maxMonth} 月`,
                        icon: <ScheduleRoundedIcon />,
                      },
                      {
                        label: "完成率",
                        value: `${completionRate}%`,
                        icon: <TaskAltRoundedIcon />,
                      },
                      {
                        label: "活跃天数",
                        value: `${activeDayCount} 天`,
                        icon: <TimelineRoundedIcon />,
                      },
                    ].map((item) => (
                      <Box
                        key={item.label}
                        sx={{
                          p: 2.2,
                          borderRadius: "24px",
                          border: "1px solid",
                          borderColor: alpha(theme.palette.common.white, 0.1),
                          bgcolor:
                            theme.palette.mode === "dark"
                              ? alpha("#0f172a", 0.72)
                              : alpha("#ffffff", 0.76),
                          backdropFilter: "blur(10px)",
                        }}
                      >
                        <Stack spacing={1.1}>
                          <Box
                            sx={{
                              width: 52,
                              height: 52,
                              borderRadius: "18px",
                              display: "grid",
                              placeItems: "center",
                              bgcolor: alpha(theme.palette.primary.main, 0.14),
                              color: "primary.main",
                              "& svg": { fontSize: 28 },
                            }}
                          >
                            {item.icon}
                          </Box>
                          <Typography variant="body2" color="text.secondary">
                            {item.label}
                          </Typography>
                          <Typography variant="h5" sx={{ fontWeight: 700 }}>
                            {item.value}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                  </Box>

                  <Box
                    sx={{
                      display: "grid",
                      gap: 2,
                      gridTemplateColumns: {
                        xs: "minmax(0, 1fr)",
                        xl: "1.05fr 0.95fr",
                      },
                      alignItems: "stretch",
                    }}
                  >
                    <Box
                      sx={{
                        p: { xs: 2.25, md: 3 },
                        borderRadius: "28px",
                        border: "1px solid",
                        borderColor: alpha(theme.palette.common.white, 0.12),
                        bgcolor:
                          theme.palette.mode === "dark"
                            ? alpha("#0b1322", 0.78)
                            : alpha("#ffffff", 0.72),
                        backdropFilter: "blur(12px)",
                      }}
                    >
                      <Typography
                        variant="h5"
                        sx={{ fontWeight: 700, letterSpacing: "-0.02em", mb: 1.25 }}
                      >
                        幕间：学习时间线
                      </Typography>
                      <Typography variant="body1" color="text.secondary" sx={{ mb: 2.5 }}>
                        把这一年拆成几段镜头，会更容易看见节奏是如何形成的。起点、峰值、主线课程与结尾，一起构成了你在 Canvas 里的完整轨迹。
                      </Typography>
                      <Stack spacing={2.25}>
                        {timelineEvents.map((event, index) => (
                          <Stack key={event.title} direction="row" spacing={2} alignItems="stretch">
                            <Stack alignItems="center" sx={{ flexShrink: 0 }}>
                              <Box
                                sx={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: "16px",
                                  display: "grid",
                                  placeItems: "center",
                                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                                  color: "primary.main",
                                }}
                              >
                                {event.icon}
                              </Box>
                              {index < timelineEvents.length - 1 ? (
                                <Box
                                  sx={{
                                    width: 2,
                                    flex: 1,
                                    minHeight: 36,
                                    bgcolor: alpha(theme.palette.primary.main, 0.16),
                                    my: 0.5,
                                  }}
                                />
                              ) : null}
                            </Stack>
                            <Box
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                pb: index < timelineEvents.length - 1 ? 1.5 : 0,
                              }}
                            >
                              <Typography variant="caption" color="primary.main" sx={{ fontWeight: 700 }}>
                                {event.eyebrow}
                              </Typography>
                              <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.35, mb: 0.75 }}>
                                {event.title}
                              </Typography>
                              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
                                {event.description}
                              </Typography>
                            </Box>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>

                    <Box
                      sx={{
                        p: { xs: 2.25, md: 3 },
                        borderRadius: "28px",
                        border: "1px solid",
                        borderColor: alpha(theme.palette.common.white, 0.12),
                        bgcolor:
                          theme.palette.mode === "dark"
                            ? alpha("#0b1322", 0.78)
                            : alpha("#ffffff", 0.72),
                        backdropFilter: "blur(12px)",
                      }}
                    >
                      <Stack spacing={2}>
                        <Box>
                          <Typography
                            variant="h5"
                            sx={{ fontWeight: 700, letterSpacing: "-0.02em", mb: 1.25 }}
                          >
                            幕外：年度故事卡
                          </Typography>
                          <Typography variant="body1" color="text.secondary">
                            像其它 app 的年度报告一样，这里可以把你的年度特征压缩成一张更适合分享的卡片。
                          </Typography>
                        </Box>

                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap flexWrap="wrap">
                          {storyCards.map((card, index) => (
                            <Chip
                              key={card.key}
                              label={card.title}
                              color={selectedStoryCard === index ? "primary" : "default"}
                              variant={selectedStoryCard === index ? "filled" : "outlined"}
                              onClick={() => setSelectedStoryCard(index)}
                              sx={{ cursor: "pointer" }}
                            />
                          ))}
                        </Stack>

                        <Box
                          sx={{
                            p: 2.5,
                            borderRadius: "30px",
                            color: "#f8fafc",
                            background: storyCards[selectedStoryCard].accent,
                            boxShadow: "0 30px 80px rgba(15,23,42,0.24)",
                            overflow: "hidden",
                            minWidth: 0,
                          }}
                        >
                          <Stack spacing={2.5}>
                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                              <Box>
                                <Typography variant="overline" sx={{ letterSpacing: "0.24em", opacity: 0.82 }}>
                                  {storyCards[selectedStoryCard].subtitle}
                                </Typography>
                                <Typography
                                  variant="h4"
                                  sx={{ fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05, mt: 0.75 }}
                                >
                                  {storyCards[selectedStoryCard].title}
                                </Typography>
                              </Box>
                              <Chip
                                label={storyCards[selectedStoryCard].badge}
                                size="small"
                                sx={{
                                  bgcolor: "rgba(255,255,255,0.14)",
                                  color: "inherit",
                                  borderColor: "rgba(255,255,255,0.28)",
                                }}
                                variant="outlined"
                              />
                            </Stack>

                            <Typography
                              variant="h2"
                              sx={{ fontWeight: 900, letterSpacing: "-0.06em", lineHeight: 1 }}
                            >
                              {storyCards[selectedStoryCard].value}
                            </Typography>

                            <Typography variant="body1" sx={{ lineHeight: 1.9, color: "rgba(248,250,252,0.86)" }}>
                              {storyCards[selectedStoryCard].description}
                            </Typography>

                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                              <Typography variant="body2" sx={{ color: "rgba(248,250,252,0.74)" }}>
                                Generated by SJTU Canvas Helper
                              </Typography>
                              <Typography variant="body2" sx={{ color: "rgba(248,250,252,0.74)" }}>
                                {selectedYear}
                              </Typography>
                            </Stack>
                          </Stack>
                        </Box>
                      </Stack>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      p: { xs: 2.25, md: 3 },
                      borderRadius: "28px",
                      border: "1px solid",
                      borderColor: alpha(theme.palette.common.white, 0.12),
                      bgcolor:
                        theme.palette.mode === "dark"
                          ? alpha("#0b1322", 0.78)
                          : alpha("#ffffff", 0.72),
                      backdropFilter: "blur(12px)",
                    }}
                  >
                    <Typography
                      variant="h5"
                      sx={{ fontWeight: 700, letterSpacing: "-0.02em", mb: 1.25 }}
                    >
                      第一幕：你的提交时区
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 2.5 }}>
                      在过去的一年里，你有 {dayCount} 次在白天提交作业，{nightCount} 次在晚上提交作业。
                      {dayCount > nightCount && " 你更像一个白昼执行者，节奏稳定，行动直接。"}
                      {nightCount > dayCount && " 你更像深夜里的创作者，灵感常常在夜色落下后抵达。"}
                      {nightCount === dayCount && " 你像一位平衡派选手，在白天与黑夜之间自然切换。"}
                    </Typography>
                    <BarChart
                      data={hourCountMap}
                      xAxisData={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
                      themeMode={theme.palette.mode}
                    />
                  </Box>

                  <Box
                    sx={{
                      display: "grid",
                      gap: 2,
                      gridTemplateColumns: {
                        xs: "minmax(0, 1fr)",
                        lg: "1.2fr 0.8fr",
                      },
                    }}
                  >
                    <Box
                      sx={{
                        p: { xs: 2.25, md: 3 },
                        borderRadius: "28px",
                        border: "1px solid",
                        borderColor: alpha(theme.palette.common.white, 0.12),
                        bgcolor:
                          theme.palette.mode === "dark"
                            ? alpha("#0b1322", 0.78)
                            : alpha("#ffffff", 0.72),
                        backdropFilter: "blur(12px)",
                      }}
                    >
                      <Typography
                        variant="h5"
                        sx={{ fontWeight: 700, letterSpacing: "-0.02em", mb: 1.25 }}
                      >
                        中场旁白：这一年的完成度
                      </Typography>
                      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                        你一共面对了 {totalAssignments} 个作业节点，完成了 {totalSubmits} 次提交，整体完成率约为 {completionRate}%。其中有 {lateCount} 次晚交，{gradedCount} 次拿到了成绩反馈。
                      </Typography>
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} useFlexGap flexWrap="wrap">
                        <Chip label={`累计得分 ${totalScore.toFixed(1)}`} color="primary" variant="outlined" />
                        <Chip label={`可得总分 ${totalPointsPossible.toFixed(1)}`} variant="outlined" />
                        <Chip label={`得分率 ${scoreRate}%`} variant="outlined" />
                        <Chip label={`首次提交 ${formatTimelineDate(report.data?.firstSubmitAt)}`} variant="outlined" />
                        <Chip label={`最后提交 ${formatTimelineDate(report.data?.lastSubmitAt)}`} variant="outlined" />
                      </Stack>
                    </Box>

                    <Box
                      sx={{
                        p: { xs: 2.25, md: 3 },
                        borderRadius: "28px",
                        border: "1px solid",
                        borderColor: alpha(theme.palette.common.white, 0.12),
                        bgcolor:
                          theme.palette.mode === "dark"
                            ? alpha("#0b1322", 0.78)
                            : alpha("#ffffff", 0.72),
                        backdropFilter: "blur(12px)",
                      }}
                    >
                      <Typography
                        variant="h5"
                        sx={{ fontWeight: 700, letterSpacing: "-0.02em", mb: 1.25 }}
                      >
                        镜头聚焦：最常出现的课程
                      </Typography>
                      <Typography variant="body1" color="text.secondary">
                        {topCourseStatistic
                          ? `${topCourseStatistic.courseName} 是你这一年里留下最多提交痕迹的课程。你在这门课中完成了 ${topCourseStatistic.submittedCount} 次提交，面对 ${topCourseStatistic.assignmentCount} 个作业节点。`
                          : "这一年里还没有足够的数据生成课程焦点。"}
                      </Typography>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      p: { xs: 2.25, md: 3 },
                      borderRadius: "28px",
                      border: "1px solid",
                      borderColor: alpha(theme.palette.common.white, 0.12),
                      bgcolor:
                        theme.palette.mode === "dark"
                          ? alpha("#0b1322", 0.78)
                          : alpha("#ffffff", 0.72),
                      backdropFilter: "blur(12px)",
                    }}
                  >
                    <Typography
                      variant="h5"
                      sx={{ fontWeight: 700, letterSpacing: "-0.02em", mb: 1.25 }}
                    >
                      第二幕：最忙碌的季节
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 2.5 }}>
                      这一年里，你最忙碌的月份是 {maxMonth} 月。所有赶在截止前的点击、所有被保存下来的作业痕迹，都在那段时间里更密集地亮起。
                    </Typography>
                    <BarChart
                      data={monthCountMap}
                      xAxisData={Array.from({ length: 12 }, (_, i) => `${i + 1}月`)}
                      themeMode={theme.palette.mode}
                    />
                  </Box>

                  <Box
                    sx={{
                      px: { xs: 0.5, md: 1 },
                      py: 1.5,
                    }}
                  >
                    <Typography
                      variant="body1"
                      sx={{
                        maxWidth: 860,
                        mx: "auto",
                        textAlign: "center",
                        color: "text.secondary",
                        lineHeight: 1.95,
                        fontStyle: "italic",
                      }}
                    >
                      “这一年不是由大事构成的，而是由一次次普通却真实的提交、等待、截止与完成组成。你在 Canvas 留下的，不只是记录，更像是一段被认真走过的时间。”
                    </Typography>
                  </Box>
                </Stack>
              ) : (
                <Box sx={{ py: 10 }}>
                  <Typography variant="body1" color="text.secondary">
                    暂无年度数据，请尝试切换年份或稍后重试。
                  </Typography>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

    </BasicLayout>
  );
}
