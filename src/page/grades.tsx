import { invoke } from "@tauri-apps/api/core";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  InputAdornment,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";

import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import GradeStatisticChart from "../components/grade_statistic";
import { getConfig } from "../lib/config";
import { useAppMessage } from "../lib/message";
import {
  useAssignments,
  useStudents,
  useTAOrTeacherCourses,
  useUserSubmissions,
} from "../lib/hooks";
import {
  Assignment,
  Course,
  GradeStatistic,
  LOG_LEVEL_ERROR,
  Submission,
  User,
} from "../lib/model";
import { assignmentIsEnded, consoleLog } from "../lib/utils";

interface DetailedGradeStatistic {
  eachAssignments: [Assignment, GradeStatistic][];
  total: GradeStatistic;
}

interface ExportInfo {
  fileName: string;
  folderPath: string;
}

const surfaceCardSx = {
  borderRadius: "28px",
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
  backgroundImage: "none",
};

export default function GradePage() {
  const theme = useTheme();
  const [selectedCourseId, setSelectedCourseId] = useState<number | undefined>();
  const [studentIds, setStudentIds] = useState<number[]>([]);
  const [currentView, setCurrentView] = useState("overview");
  const [messageApi, contextHolder] = useAppMessage();
  const [statistics, setStatistics] = useState<DetailedGradeStatistic>({
    eachAssignments: [],
    total: {} as GradeStatistic,
  });
  const [editingGrades, setEditingGrades] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [exportInfo, setExportInfo] = useState<ExportInfo>({
    fileName: "",
    folderPath: "",
  });

  const courses = useTAOrTeacherCourses();
  const students = useStudents(selectedCourseId);
  const userSubmissions = useUserSubmissions(selectedCourseId, studentIds);
  const assignments = useAssignments(selectedCourseId);

  const selectedCourse = courses.data.find(
    (course) => course.id === selectedCourseId
  );

  useEffect(() => {
    const initExportInfo = async (course: Course) => {
      const config = await getConfig();
      setExportInfo({
        fileName: `${course.name}_成绩`,
        folderPath: config.save_path,
      });
    };

    if (selectedCourse) {
      void initExportInfo(selectedCourse);
    }
  }, [selectedCourse]);

  useEffect(() => {
    setStudentIds(students.data.map((student) => student.id));
  }, [students.data]);

  useEffect(() => {
    if (currentView !== "statistic") {
      return;
    }
    setStatistics(computeGradeStatistics());
  }, [currentView, userSubmissions.data, assignments.data, students.data]);

  const isLoading = useMemo(
    () =>
      courses.isLoading ||
      students.isLoading ||
      userSubmissions.isLoading ||
      assignments.isLoading,
    [
      courses.isLoading,
      students.isLoading,
      userSubmissions.isLoading,
      assignments.isLoading,
    ]
  );

  const studentMap = useMemo(() => {
    const map = new Map<number, User>();
    students.data.forEach((student) => map.set(student.id, student));
    return map;
  }, [students.data]);

  const rows = useMemo(() => {
    return userSubmissions.data
      .map((userSubmission) => {
        const name = studentMap.get(userSubmission.user_id)?.name;
        if (!name) {
          return null;
        }
        const record: Record<string | number, Submission | string | number> = {
          username: name,
          userId: userSubmission.user_id,
          key: `${userSubmission.user_id}${selectedCourseId}`,
        };
        userSubmission.submissions.forEach((submission) => {
          record[submission.assignment_id] = submission;
        });
        return record;
      })
      .filter(Boolean) as Record<string | number, Submission | string | number>[];
  }, [selectedCourseId, studentMap, userSubmissions.data]);

  const paginatedRows = useMemo(() => {
    const start = page * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [page, rows, rowsPerPage]);

  useEffect(() => {
    setPage(0);
  }, [selectedCourseId, rows.length]);

  const gradeSummary = useMemo(() => {
    const totalAssignments = assignments.data.length;
    const totalStudents = students.data.length;
    const gradedCount = userSubmissions.data.reduce((count, item) => {
      return (
        count +
        item.submissions.filter((submission) => {
          const grade = Number.parseFloat(submission.grade ?? "");
          return !Number.isNaN(grade);
        }).length
      );
    }, 0);
    const pendingAssignments = assignments.data.filter((assignment) =>
      assignmentIsEnded(assignment)
    ).length;

    return {
      totalAssignments,
      totalStudents,
      gradedCount,
      pendingAssignments,
    };
  }, [assignments.data, students.data, userSubmissions.data]);

  const computeGradeStatistics = () => {
    const submissionMap = new Map<number, Submission[]>();
    const studentsTotalGradesMap = new Map<number, number>();

    userSubmissions.data.forEach((userSubmission) => {
      userSubmission.submissions.forEach((submission) => {
        const assignmentId = submission.assignment_id;
        if (!submissionMap.has(assignmentId)) {
          submissionMap.set(assignmentId, []);
        }
        submissionMap.get(assignmentId)!.push(submission);

        if (!studentsTotalGradesMap.has(userSubmission.user_id)) {
          studentsTotalGradesMap.set(userSubmission.user_id, 0);
        }
        const grade = Number.parseFloat(submission.grade ?? "");
        if (!Number.isNaN(grade)) {
          studentsTotalGradesMap.set(
            userSubmission.user_id,
            studentsTotalGradesMap.get(userSubmission.user_id)! + grade
          );
        }
      });
    });

    const eachAssignments = assignments.data
      .filter((assignment) => submissionMap.has(assignment.id))
      .map(
        (assignment) =>
          [assignment, gatherGrades(submissionMap.get(assignment.id)!)] as [
            Assignment,
            GradeStatistic
          ]
      )
      .filter(([_, statistic]) => statistic.grades.length > 0);

    const totalGrades: number[] = [];
    studentsTotalGradesMap.forEach((grades) => totalGrades.push(grades));

    return {
      eachAssignments,
      total: {
        grades: totalGrades,
        total: students.data.length,
      } as GradeStatistic,
    };
  };

  const gatherGrades = (submissions: Submission[]): GradeStatistic => {
    const grades: number[] = [];
    submissions.forEach((submission) => {
      if (!submission.grade) {
        return;
      }
      const grade = Number.parseFloat(submission.grade);
      if (!Number.isNaN(grade)) {
        grades.push(grade);
      }
    });
    return {
      grades,
      total: submissions.length,
    } as GradeStatistic;
  };

  const validateGrade = (grade: string, assignment: Assignment) => {
    if (grade.length === 0) {
      return true;
    }
    const maxGrade = assignment.points_possible;
    const gradeNumber = Number.parseFloat(grade);
    if (Number.isNaN(gradeNumber)) {
      return false;
    }
    return gradeNumber >= 0 && (!maxGrade || gradeNumber <= maxGrade);
  };

  const handleGrade = async (
    grade: string,
    assignment: Assignment,
    studentId: number
  ) => {
    if (!validateGrade(grade, assignment)) {
      messageApi.error("请输入正确格式的评分");
      return;
    }
    try {
      await invoke("update_grade", {
        courseId: selectedCourseId,
        assignmentId: assignment.id,
        studentId,
        grade,
      });
      messageApi.success("打分成功", 0.5);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      messageApi.error(`打分时出错：${error}`);
    }
  };

  const handleSelectExportPath = async () => {
    const selected = await openDialog({
      directory: true,
      defaultPath: exportInfo.folderPath || undefined,
    });
    if (!selected) {
      return;
    }
    const nextPath = Array.isArray(selected) ? selected[0] : selected;
    if (!nextPath) {
      return;
    }
    setExportInfo((prev) => ({ ...prev, folderPath: nextPath }));
  };

  const handleExport = async () => {
    if (!exportInfo.fileName.trim()) {
      messageApi.error("请输入导出文件名");
      return;
    }
    if (!exportInfo.folderPath.trim()) {
      messageApi.error("请选择导出目录");
      return;
    }

    const exportData: string[][] = [];
    const headers: string[] = ["学生"];
    assignments.data.forEach((assignment) => {
      headers.push(assignment.name);
    });
    exportData.push(headers);

    rows.forEach((rowData) => {
      const row: string[] = [String(rowData.username)];
      assignments.data.forEach((assignment) => {
        const submission = rowData[assignment.id] as Submission | undefined;
        row.push(submission?.grade ?? "");
      });
      exportData.push(row);
    });

    let fileName = exportInfo.fileName;
    if (!fileName.endsWith(".xlsx")) {
      fileName += ".xlsx";
    }

    try {
      await invoke("export_excel", {
        data: exportData,
        fileName,
        folderPath: exportInfo.folderPath,
      });
      messageApi.success("导出成功", 0.5);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      messageApi.error(`导出失败：${error}`);
    }
  };

  return (
    <BasicLayout>
      {contextHolder}
      <Stack spacing={3}>
        <Card
          sx={{
            ...surfaceCardSx,
            background:
              theme.palette.mode === "dark"
                ? `linear-gradient(135deg, ${alpha(
                    theme.palette.primary.main,
                    0.18
                  )}, ${alpha("#0f172a", 0.9)})`
                : `linear-gradient(135deg, ${alpha(
                    theme.palette.primary.main,
                    0.1
                  )}, rgba(255,255,255,0.96))`,
          }}
        >
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={3}>
              <Stack
                direction={{ xs: "column", lg: "row" }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 800 }}>
                    评分册
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    批量查看学生作业成绩、录入分数，并导出 Excel 成绩表。
                  </Typography>
                </Box>
                <Box
                  sx={{
                    width: "100%",
                    maxWidth: { xs: "100%", lg: 640 },
                    alignSelf: { xs: "stretch", lg: "flex-start" },
                  }}
                >
                  <CourseSelect
                    courses={courses.data}
                    onChange={setSelectedCourseId}
                    value={selectedCourseId}
                  />
                </Box>
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(4, minmax(0, 1fr))",
                  },
                }}
              >
                {[
                  { label: "作业数量", value: gradeSummary.totalAssignments },
                  { label: "学生人数", value: gradeSummary.totalStudents },
                  { label: "已评分条目", value: gradeSummary.gradedCount },
                  { label: "已截止作业", value: gradeSummary.pendingAssignments },
                ].map((item) => (
                  <Card
                    key={item.label}
                    sx={{
                      borderRadius: "22px",
                      backgroundColor: alpha(theme.palette.background.paper, 0.8),
                      border: "1px solid",
                      borderColor: alpha(theme.palette.divider, 0.5),
                      boxShadow: "none",
                    }}
                  >
                    <CardContent sx={{ p: 2.25 }}>
                      <Typography variant="overline" color="text.secondary">
                        {item.label}
                      </Typography>
                      <Typography variant="h4" sx={{ fontWeight: 800, mt: 1 }}>
                        {item.value}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>

              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                spacing={1.5}
              >
                {selectedCourse ? (
                  <Chip
                    label={selectedCourse.name}
                    color="primary"
                    variant="outlined"
                  />
                ) : (
                  <Chip label="请选择课程" variant="outlined" />
                )}
                <Button
                  variant="outlined"
                  startIcon={<RefreshRoundedIcon />}
                  onClick={() => userSubmissions.mutate()}
                  disabled={isLoading}
                >
                  刷新数据
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Tabs
              value={currentView}
              onChange={(_, value) => setCurrentView(value)}
              sx={{ mb: 3 }}
            >
              <Tab value="overview" label="总览视图" />
              <Tab value="statistic" label="统计视图" />
            </Tabs>

            {isLoading ? (
              <Box sx={{ py: 10, display: "grid", placeItems: "center" }}>
                <CircularProgress />
              </Box>
            ) : currentView === "overview" ? (
              <Stack spacing={3}>
                {rows.length > 0 ? (
                  <>
                    <Box
                      sx={{
                        borderRadius: "22px",
                        border: "1px solid",
                        borderColor: "divider",
                        overflow: "auto",
                      }}
                    >
                      <Table stickyHeader sx={{ minWidth: 960 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell
                              sx={{
                                minWidth: 160,
                                position: "sticky",
                                left: 0,
                                zIndex: 3,
                                bgcolor: "background.paper",
                              }}
                            >
                              学生
                            </TableCell>
                            {assignments.data.map((assignment) => (
                              <TableCell key={assignment.id} sx={{ minWidth: 220 }}>
                                <Stack spacing={0.75}>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    {assignment.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    满分 {assignment.points_possible ?? "-"}
                                  </Typography>
                                </Stack>
                              </TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {paginatedRows.map((record) => (
                            <TableRow key={String(record.key)} hover>
                              <TableCell
                                sx={{
                                  position: "sticky",
                                  left: 0,
                                  zIndex: 2,
                                  bgcolor: "background.paper",
                                  fontWeight: 600,
                                }}
                              >
                                {String(record.username)}
                              </TableCell>
                              {assignments.data.map((assignment) => {
                                const submission = record[
                                  assignment.id
                                ] as Submission | undefined;
                                const isEnded = assignmentIsEnded(assignment);
                                const readonlyGrade =
                                  assignment.needs_grading_count === null;
                                const notSubmitted =
                                  isEnded &&
                                  submission?.workflow_state === "unsubmitted";
                                const inputKey = `${record.userId}-${assignment.id}`;
                                const displayedValue =
                                  editingGrades[inputKey] ??
                                  (submission?.grade ? String(submission.grade) : "");

                                return (
                                  <TableCell key={`${record.key}-${assignment.id}`}>
                                    <Stack spacing={1}>
                                      <TextField
                                        value={displayedValue}
                                        disabled={readonlyGrade}
                                        size="small"
                                        placeholder="输入分数"
                                        onChange={(event) =>
                                          setEditingGrades((prev) => ({
                                            ...prev,
                                            [inputKey]: event.target.value,
                                          }))
                                        }
                                        onKeyDown={(event) => {
                                          if (event.key !== "Enter") {
                                            return;
                                          }
                                          void handleGrade(
                                            (event.currentTarget as HTMLInputElement).value,
                                            assignment,
                                            Number(record.userId)
                                          );
                                        }}
                                      />
                                      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                        {submission?.late ? (
                                          <Chip size="small" label="迟交" color="info" variant="outlined" />
                                        ) : null}
                                        {notSubmitted ? (
                                          <Chip size="small" label="未提交" color="error" variant="outlined" />
                                        ) : null}
                                        {readonlyGrade ? (
                                          <Chip size="small" label="只读" variant="outlined" />
                                        ) : (
                                          <Chip size="small" label="回车保存" color="primary" variant="outlined" />
                                        )}
                                      </Stack>
                                    </Stack>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>

                    <TablePagination
                      component="div"
                      count={rows.length}
                      page={page}
                      onPageChange={(_, nextPage) => setPage(nextPage)}
                      rowsPerPage={rowsPerPage}
                      onRowsPerPageChange={(event) => {
                        setRowsPerPage(Number(event.target.value));
                        setPage(0);
                      }}
                      rowsPerPageOptions={[10, 20, 50]}
                      labelRowsPerPage="每页学生数"
                      labelDisplayedRows={({ from, to, count }) =>
                        `${from}-${to} / ${count}`
                      }
                    />

                    <Divider />

                    <Stack spacing={2}>
                      <Box>
                        <Typography variant="h6" sx={{ fontWeight: 800 }}>
                          导出成绩
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          将当前评分数据导出为 Excel，便于归档或二次处理。
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: "grid",
                          gap: 2,
                          gridTemplateColumns: {
                            xs: "minmax(0, 1fr)",
                            lg: "1fr 1.2fr auto",
                          },
                        }}
                      >
                        <TextField
                          label="导出文件名"
                          value={exportInfo.fileName}
                          onChange={(event) =>
                            setExportInfo((prev) => ({
                              ...prev,
                              fileName: event.target.value,
                            }))
                          }
                          InputProps={{
                            endAdornment: (
                              <InputAdornment position="end">.xlsx</InputAdornment>
                            ),
                          }}
                        />
                        <TextField
                          label="导出目录"
                          value={exportInfo.folderPath}
                          onChange={(event) =>
                            setExportInfo((prev) => ({
                              ...prev,
                              folderPath: event.target.value,
                            }))
                          }
                        />
                        <Button
                          variant="outlined"
                          onClick={() => void handleSelectExportPath()}
                        >
                          选择目录
                        </Button>
                      </Box>
                      <Box>
                        <Button
                          variant="contained"
                          startIcon={<DownloadRoundedIcon />}
                          onClick={() => void handleExport()}
                        >
                          导出 Excel
                        </Button>
                      </Box>
                    </Stack>
                  </>
                ) : (
                  <Alert severity="info" sx={{ borderRadius: "18px" }}>
                    当前课程还没有可展示的评分数据。
                  </Alert>
                )}
              </Stack>
            ) : (
              <Stack spacing={3}>
                {statistics.total.total > 0 ? (
                  <Card
                    sx={{
                      borderRadius: "22px",
                      border: "1px solid",
                      borderColor: "divider",
                      boxShadow: "none",
                    }}
                  >
                    <CardContent>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
                        总分分布
                      </Typography>
                      <GradeStatisticChart
                        statistic={statistics.total}
                        subTitleRenderer={({ average }) => (
                          <Typography variant="body2" color="text.secondary">
                            平均分 <b>{average}</b>
                          </Typography>
                        )}
                      />
                    </CardContent>
                  </Card>
                ) : null}

                {statistics.eachAssignments.map(([assignment, gradeStatistic]) => (
                  <Card
                    key={assignment.id}
                    sx={{
                      borderRadius: "22px",
                      border: "1px solid",
                      borderColor: "divider",
                      boxShadow: "none",
                    }}
                  >
                    <CardContent>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
                        {assignment.name}
                      </Typography>
                      <GradeStatisticChart
                        statistic={gradeStatistic}
                        subTitleRenderer={({ average }) => (
                          <Typography variant="body2" color="text.secondary">
                            平均分 <b>{average}</b>
                          </Typography>
                        )}
                      />
                    </CardContent>
                  </Card>
                ))}

                {statistics.eachAssignments.length === 0 &&
                statistics.total.total === 0 ? (
                  <Alert severity="info" sx={{ borderRadius: "18px" }}>
                    暂无统计数据，请先选择课程或刷新成绩。
                  </Alert>
                ) : null}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Stack>
    </BasicLayout>
  );
}
