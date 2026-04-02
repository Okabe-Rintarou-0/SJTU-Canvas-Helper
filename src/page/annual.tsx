import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import MovieCreationRoundedIcon from "@mui/icons-material/MovieCreationRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import ScheduleRoundedIcon from "@mui/icons-material/ScheduleRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Snackbar,
  Stack,
  TextField,
  Typography,
  Alert,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import ReactEcharts from "echarts-for-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useMemo, useRef, useState } from "react";

import BasicLayout from "../components/layout";
import { useAnnualReport } from "../lib/hooks";
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

  return <ReactEcharts option={option} style={{ height: 360, width: "100%" }} />;
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

export default function AnnualPage() {
  const theme = useTheme();
  const now = new Date().getFullYear();
  const [currentYear, setCurrentYear] = useState<number>(now);
  const [selectedYear, setSelectedYear] = useState<number>(now);
  const [exporting, setExporting] = useState<"image" | "pdf" | null>(null);
  const [toast, setToast] = useState("");
  const annualRef = useRef<HTMLDivElement>(null);
  const report = useAnnualReport(selectedYear);

  const [dayCount, nightCount] = report.data ? countDayAndNightSubmits(report.data) : [0, 0];
  const hourCountMap = countSubmitsByHour(report.data);
  const [monthCountMap, maxMonth] = countSubmitsByMonth(report.data);
  const totalSubmits = dayCount + nightCount;
  const courseCount = report.data
    ? Object.keys(report.data.courseToStatistic).length
    : 0;
  const dominantTime =
    dayCount === nightCount ? "昼夜均衡" : dayCount > nightCount ? "白昼行动派" : "深夜创作者";

  const openingNarrative = useMemo(() => {
    if (!report.data) {
      return "";
    }
    if (totalSubmits === 0) {
      return `${selectedYear} 这一年，Canvas 里没有留下太多提交痕迹，像一卷几乎空白的胶片。`;
    }
    return `${selectedYear} 这一年，你在 ${courseCount} 门课程里留下了 ${totalSubmits} 次提交记录。每一次点击提交，都是这一年被记录下来的一个片段。`;
  }, [courseCount, report.data, selectedYear, totalSubmits]);

  const exportBaseName = `${selectedYear}-annual-review`;

  const captureAnnualCard = async () => {
    if (!annualRef.current) {
      throw new Error("未找到可导出的年度总结区域。");
    }
    return html2canvas(annualRef.current, {
      backgroundColor: theme.palette.mode === "dark" ? "#07111d" : "#f4f7fb",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: annualRef.current.scrollWidth,
      windowHeight: annualRef.current.scrollHeight,
    });
  };

  const blobToUint8Array = async (blob: Blob) => {
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  };

  const handleExportImage = async () => {
    try {
      setExporting("image");
      const canvas = await captureAnnualCard();
      const outputPath = await save({
        defaultPath: `${exportBaseName}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!outputPath) {
        return;
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((result) => resolve(result), "image/png")
      );
      if (!blob) {
        throw new Error("无法生成图片数据。");
      }
      await writeFile(outputPath, await blobToUint8Array(blob));
      setToast("年度总结图片已保存。");
    } catch (error) {
      setToast(`导出图片失败：${error}`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    try {
      setExporting("pdf");
      const canvas = await captureAnnualCard();
      const outputPath = await save({
        defaultPath: `${exportBaseName}.pdf`,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!outputPath) {
        return;
      }
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "landscape" : "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      const pdfBytes = pdf.output("arraybuffer");
      await writeFile(outputPath, new Uint8Array(pdfBytes));
      setToast("年度总结 PDF 已保存。");
    } catch (error) {
      setToast(`导出 PDF 失败：${error}`);
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
          <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
            <Stack spacing={4} sx={{ position: "relative" }}>
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

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={2600}
        onClose={() => setToast("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert onClose={() => setToast("")} severity="info" variant="filled">
          {toast}
        </Alert>
      </Snackbar>
    </BasicLayout>
  );
}
