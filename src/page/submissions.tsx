import { invoke } from "@tauri-apps/api/core";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import RateReviewRoundedIcon from "@mui/icons-material/RateReviewRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
  FormControl,
  InputLabel,
  Link as MuiLink,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { html, pinyin } from "pinyin-pro";
import { ReactNode, useEffect, useMemo, useState } from "react";

import ClosableAlert from "../components/closable_alert";
import CommentPanel from "../components/comment_panel";
import CourseFileSelector from "../components/course_file_selector";
import CourseSelect from "../components/course_select";
import FileDownloadTable from "../components/file_download_table";
import GradeStatisticChart from "../components/grade_statistic";
import BasicLayout from "../components/layout";
import { getConfig, saveConfig } from "../lib/config";
import { SUBMISSION_PAGE_HINT_ALERT_KEY } from "../lib/constants";
import { useAppMessage } from "../lib/message";
import {
  useBaseURL,
  useMe,
  usePreview,
  useTAOrTeacherCourses,
} from "../lib/hooks";
import {
  Assignment,
  Attachment,
  File,
  FileDownloadTask,
  GradeStatistic,
  LOG_LEVEL_ERROR,
  Option,
  Submission,
  User,
} from "../lib/model";
import {
  assignmentIsNotUnlocked,
  attachmentToFile,
  consoleLog,
  formatDate,
} from "../lib/utils";

interface SubmissionGradeProps {
  gradingType: string;
  gradeKey: Option<number | string>;
  disabled: boolean;
  defaultValue: string;
  onSubmit: (grade: string) => void;
}

function SubmissionGrade({
  gradingType,
  gradeKey,
  disabled,
  defaultValue,
  onSubmit,
}: SubmissionGradeProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, gradeKey]);

  if (gradingType === "pass_fail") {
    return (
      <FormControl fullWidth size="small">
        <Select
          value={value || ""}
          disabled={disabled}
          onChange={(event) => {
            const nextValue = event.target.value;
            setValue(nextValue);
            onSubmit(nextValue);
          }}
        >
          <MenuItem value="complete">完成</MenuItem>
          <MenuItem value="incomplete">未完成</MenuItem>
        </Select>
      </FormControl>
    );
  }

  return (
    <TextField
      value={value}
      disabled={disabled}
      size="small"
      placeholder="输入成绩后按回车"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") {
          return;
        }
        onSubmit((event.currentTarget as HTMLInputElement).value);
      }}
    />
  );
}

const surfaceCardSx = {
  borderRadius: "28px",
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
  backgroundImage: "none",
};

export default function SubmissionsPage() {
  const theme = useTheme();
  const [messageApi, contextHolder] = useAppMessage();
  const [operating, setOperating] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState(-1);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [downloadTasks, setDownloadTasks] = useState<FileDownloadTask[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<
    Assignment | undefined
  >(undefined);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>(
    []
  );
  const [statistic, setStatistic] = useState<GradeStatistic | undefined>();
  const [keywords, setKeywords] = useState<string[]>([]);
  const [attachmentToComment, setAttachmentToComment] = useState(-1);
  const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([]);
  const [previewFooter, setPreviewFooter] = useState<ReactNode>(undefined);
  const [commentingWhilePreviewing, setCommentingWhilePreviewing] =
    useState(false);
  const [notSubmitStudents, setNotSubmitStudents] = useState<User[]>([]);
  const [boundFiles, setBoundFiles] = useState<File[]>([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const courses = useTAOrTeacherCourses();
  const me = useMe();
  const baseURL = useBaseURL();

  const usersMap = useMemo(
    () => new Map<number, User>(users.map((user) => [user.id, user])),
    [users]
  );

  const readonlyGrade = selectedAssignment?.needs_grading_count === null;

  const refreshSubmission = async (studentId: number) => {
    const submission = (await invoke("get_single_course_assignment_submission", {
      courseId: selectedCourseId,
      assignmentId: selectedAssignment?.id,
      studentId,
    })) as Submission;
    attachments
      .filter((item) => item.user_id === studentId)
      .forEach((attachment) => {
        attachment.user = usersMap.get(submission.user_id)?.name;
        attachment.user_id = submission.user_id;
        attachment.submitted_at = submission.submitted_at;
        attachment.grade = submission.grade;
        attachment.key = attachment.id;
        attachment.late = submission.late;
        attachment.comments = submission.submission_comments;
      });
    setAttachments([...attachments]);
  };

  const shouldMonitor = !previewFooter || !commentingWhilePreviewing;
  const {
    previewEntry,
    previewer,
    onHoverEntry,
    onLeaveEntry,
    setPreviewEntry,
    setEntries,
  } = usePreview(
    previewFooter,
    { height: "67vh", marginTop: "0px" },
    shouldMonitor
  );

  useEffect(() => {
    if (!previewEntry) {
      setPreviewFooter(undefined);
      return;
    }
    const previewedAttachment = attachments.find(
      (attachment) => attachment.id === previewEntry.id
    );
    if (!previewedAttachment || !selectedAssignment) {
      return;
    }
    setPreviewFooter(
      <Stack spacing={2} sx={{ mt: 1.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.25}
          alignItems={{ xs: "stretch", sm: "center" }}
        >
          <Typography variant="subtitle2">打分</Typography>
          <Box sx={{ flex: 1 }}>
            <SubmissionGrade
              gradeKey={previewedAttachment.id}
              gradingType={selectedAssignment.grading_type}
              disabled={readonlyGrade}
              defaultValue={previewedAttachment.grade ?? ""}
              onSubmit={(grade) => handleGrade(grade, previewedAttachment)}
            />
          </Box>
        </Stack>
        <CommentPanel
          me={me.data}
          onRefresh={refreshSubmission}
          onFocus={() => setCommentingWhilePreviewing(true)}
          onBlur={() => setCommentingWhilePreviewing(false)}
          attachment={previewedAttachment}
          assignmentId={selectedAssignment.id}
          courseId={selectedCourseId}
          showInput={true}
          messageApi={messageApi}
        />
      </Stack>
    );
  }, [previewEntry, attachments, selectedAssignment, readonlyGrade, me.data]);

  useEffect(() => {
    setEntries(attachments.map(attachmentToFile));
  }, [attachments, setEntries]);

  useEffect(() => {
    if (attachments.length > 0) {
      setNotSubmitStudents(getNotSubmitStudents());
    } else {
      setNotSubmitStudents([]);
    }
  }, [attachments, usersMap]);

  useEffect(() => {
    setPage(0);
  }, [selectedAssignment?.id, keywords, attachments.length]);

  const gatherGrades = (items: Attachment[]): [number[], number] => {
    const grades: number[] = [];
    const visitSet = new Set<number>();
    items.forEach((attachment) => {
      const userId = attachment.user_id;
      if (visitSet.has(userId)) {
        return;
      }
      visitSet.add(userId);
      if (attachment.grade) {
        grades.push(Number.parseFloat(attachment.grade));
      }
    });
    return [grades, visitSet.size];
  };

  const updateGradeStatistic = (items: Attachment[]) => {
    const [grades, total] = gatherGrades(items);
    setStatistic({ grades, total } as GradeStatistic);
  };

  const handleGrade = async (grade: string, attachment: Attachment) => {
    try {
      await invoke("update_grade", {
        courseId: selectedCourseId,
        assignmentId: selectedAssignment?.id,
        studentId: attachment.user_id,
        grade,
      });
      attachments
        .filter((item) => item.user_id === attachment.user_id)
        .forEach((item) => (item.grade = grade));
      setAttachments([...attachments]);
      updateGradeStatistic(attachments);
      messageApi.success("打分成功", 0.5);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      messageApi.error(error as string);
    }
  };

  const handleGetUsers = async (courseId: number) => {
    if (courseId === -1) {
      return;
    }
    try {
      const nextUsers = (await invoke("list_course_students", {
        courseId,
      })) as User[];
      nextUsers.forEach((user) => (user.key = user.id));
      setUsers(nextUsers);
    } catch (error) {
      messageApi.error(error as string);
    }
  };

  const handleGetAssignments = async (courseId: number) => {
    if (courseId === -1) {
      return;
    }
    try {
      const nextAssignments = (await invoke("list_course_assignments", {
        courseId,
      })) as Assignment[];
      nextAssignments.forEach((assignment) => (assignment.key = assignment.id));
      setAssignments(nextAssignments);
    } catch (error) {
      messageApi.error(error as string);
    }
  };

  const handleGetSubmissions = async (courseId: number, assignmentId: number) => {
    if (courseId === -1 || assignmentId === -1) {
      return;
    }
    try {
      const submissions = (await invoke("list_course_assignment_submissions", {
        courseId,
        assignmentId,
      })) as Submission[];
      const nextAttachments: Attachment[] = [];
      submissions.forEach((submission) => {
        const thisAttachments = submission.attachments;
        thisAttachments.forEach((attachment) => {
          attachment.user = usersMap.get(submission.user_id)?.name;
          attachment.user_id = submission.user_id;
          attachment.submitted_at = submission.submitted_at;
          attachment.grade = submission.grade;
          attachment.key = attachment.id;
          attachment.late = submission.late;
          attachment.comments = submission.submission_comments;
        });
        nextAttachments.push(...thisAttachments);
      });
      setAttachments(nextAttachments);
      updateGradeStatistic(nextAttachments);
    } catch (error) {
      messageApi.error(error as string);
    }
  };

  const handleDownloadAttachment = async (attachment: Attachment) => {
    const file = attachmentToFile(attachment);
    if (!downloadTasks.find((task) => task.file.uuid === file.uuid)) {
      setDownloadTasks((tasks) => [
        ...tasks,
        {
          key: file.uuid,
          file,
          progress: 0,
        } as FileDownloadTask,
      ]);
    } else {
      messageApi.warning("当前任务已存在，请勿重复添加");
    }
  };

  const handleCourseSelect = async (courseId: number) => {
    setOperating(true);
    if (courses.data.find((course) => course.id === courseId)) {
      setAttachments([]);
      setSelectedAttachments([]);
      setStatistic(undefined);
      setSelectedAssignment(undefined);
      setSelectedCourseId(courseId);
      setExpandedRowKeys([]);
      setAttachmentToComment(-1);
      setBoundFiles([]);
      await Promise.all([handleGetAssignments(courseId), handleGetUsers(courseId)]);
    }
    setOperating(false);
  };

  const handleAssignmentSelect = async (assignmentId: number) => {
    setOperating(true);
    setStatistic(undefined);
    setSelectedAttachments([]);
    setExpandedRowKeys([]);
    setAttachmentToComment(-1);
    const assignment = assignments.find((item) => item.id === assignmentId);
    if (assignment) {
      setSelectedAssignment(assignment);
      await handleGetSubmissions(selectedCourseId, assignmentId);
    }
    const config = await getConfig(true);
    if (assignmentId in config.course_assignment_file_bindings) {
      setBoundFiles(config.course_assignment_file_bindings[assignmentId]);
    } else {
      setBoundFiles([]);
    }
    setOperating(false);
  };

  const handleDownloadSelectedAttachments = () => {
    selectedAttachments.forEach((attachment) => {
      void handleDownloadAttachment(attachment);
    });
  };

  const handleRemoveTask = async (taskToRemove: FileDownloadTask) => {
    setDownloadTasks((tasks) =>
      tasks.filter((task) => task.file.uuid !== taskToRemove.file.uuid)
    );
    try {
      await invoke("delete_file", { file: taskToRemove.file });
    } catch (error) {
      if (taskToRemove.state !== "fail") {
        messageApi.error(error as string);
      }
    }
  };

  const getNotSubmitStudents = () => {
    const notSubmitStudentsMap = new Map<number, User>();
    usersMap.forEach((user) => {
      notSubmitStudentsMap.set(user.id, user);
    });
    attachments.forEach((attachment) => {
      notSubmitStudentsMap.delete(attachment.user_id);
    });
    return [...notSubmitStudentsMap.values()].filter(
      (student) => student.name !== "测验学生"
    );
  };

  const getAssignmentChipProps = (assignment: Assignment) => {
    const count = assignment.needs_grading_count ?? 0;
    const notUnlocked = assignmentIsNotUnlocked(assignment);
    if (notUnlocked) {
      return { label: "尚未解锁", color: "info" as const };
    }
    if (count === 0) {
      return { label: "暂无待批改", color: "success" as const };
    }
    return { label: `${count} 份待批改`, color: "warning" as const };
  };

  const shouldShow = (attachment: Attachment) => {
    const showAll = keywords.length === 0;
    return attachment.user && (showAll || keywords.includes(attachment.user));
  };

  const handleDownloadFile = async (file: File) => {
    await invoke("download_file", { file });
  };

  const handleOpenTaskFile = async (task: FileDownloadTask) => {
    const name = task.file.display_name;
    try {
      await invoke("open_file", { name });
    } catch (error) {
      messageApi.error(error as string);
    }
  };

  const bindCourseAssignmentFiles = async (files: File[]) => {
    const config = await getConfig(true);
    if (selectedAssignment) {
      config.course_assignment_file_bindings[selectedAssignment.id] = files;
      await saveConfig(config);
    }
  };

  const visibleAttachments = attachments.filter((attachment) =>
    shouldShow(attachment)
  );

  const paginatedAttachments = useMemo(() => {
    const start = page * rowsPerPage;
    return visibleAttachments.slice(start, start + rowsPerPage);
  }, [page, rowsPerPage, visibleAttachments]);

  const selectedAttachmentIds = useMemo(
    () => new Set(selectedAttachments.map((attachment) => attachment.id)),
    [selectedAttachments]
  );

  const filterSelectorOptions = (optionName: string, input: string) => {
    const matchFullname = optionName.includes(input);
    if (matchFullname) {
      return true;
    }
    const py = pinyin(optionName, { type: "array" });
    let fc = "";
    for (let i = 0; i < py.length; i += 1) {
      fc += py[i].charAt(0);
    }
    return fc.includes(input) || input.includes(optionName);
  };

  const selectedCourse = courses.data.find(
    (course) => course.id === selectedCourseId
  );

  return (
    <BasicLayout>
      {contextHolder}
      {previewer}
      <Stack spacing={3}>
        <ClosableAlert
          message="使用指南"
          alertType="info"
          configKey={SUBMISSION_PAGE_HINT_ALERT_KEY}
          description={
            <div>
              <p>可以绑定课程参考文件，预览时方便对照答案或评分标准。</p>
              <p>填写分数后按回车即可提交成绩。</p>
              <p>鼠标移到文件链接上后按空格，或点击“预览”，可以快速打开提交文件。</p>
            </div>
          }
        />

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
                    作业批改
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    集中查看提交文件、批量下载、快速打分和管理评论。
                  </Typography>
                </Box>
                <Box
                  sx={{
                    width: "100%",
                    maxWidth: { xs: "100%", lg: 680 },
                    alignSelf: { xs: "stretch", lg: "flex-start" },
                  }}
                >
                  <CourseSelect
                    onChange={(courseId) => void handleCourseSelect(courseId)}
                    disabled={operating}
                    courses={courses.data}
                    value={selectedCourseId === -1 ? undefined : selectedCourseId}
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
                  { label: "提交文件", value: attachments.length },
                  { label: "已选文件", value: selectedAttachments.length },
                  { label: "未交学生", value: notSubmitStudents.length },
                  { label: "下载任务", value: downloadTasks.length },
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

              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    lg: "minmax(0, 1.2fr) minmax(260px, 0.9fr)",
                  },
                }}
              >
                <FormControl fullWidth>
                  <InputLabel id="assignment-select-label">选择作业</InputLabel>
                  <Select
                    labelId="assignment-select-label"
                    label="选择作业"
                    value={selectedAssignment?.id ?? ""}
                    disabled={operating || assignments.length === 0}
                    onChange={(event) =>
                      void handleAssignmentSelect(Number(event.target.value))
                    }
                  >
                    {assignments.map((assignment) => {
                      const chip = getAssignmentChipProps(assignment);
                      return (
                        <MenuItem key={assignment.id} value={assignment.id}>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            justifyContent="space-between"
                            sx={{ width: "100%" }}
                          >
                            <Typography variant="body2">{assignment.name}</Typography>
                            <Chip
                              size="small"
                              label={chip.label}
                              color={chip.color}
                              variant="outlined"
                              icon={
                                chip.color === "warning" ? (
                                  <WarningAmberRoundedIcon />
                                ) : undefined
                              }
                            />
                          </Stack>
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>

                <Autocomplete
                  multiple
                  options={users.map((user) => user.name)}
                  value={keywords}
                  onChange={(_, value) => setKeywords(value)}
                  filterOptions={(options, state) =>
                    options.filter((option) =>
                      filterSelectorOptions(option, state.inputValue)
                    )
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="筛选学生"
                      placeholder="按姓名或拼音首字母筛选"
                    />
                  )}
                />
              </Box>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                {selectedCourse ? (
                  <Chip label={selectedCourse.name} color="primary" variant="outlined" />
                ) : (
                  <Chip label="请选择课程" variant="outlined" />
                )}
                {selectedAssignment?.points_possible != null &&
                selectedAssignment.points_possible > 0 ? (
                  <Chip
                    label={`满分 ${selectedAssignment.points_possible} 分`}
                    variant="outlined"
                  />
                ) : null}
                <Button
                  variant="outlined"
                  startIcon={<RefreshRoundedIcon />}
                  disabled={!selectedAssignment || operating}
                  onClick={() =>
                    selectedAssignment
                      ? void handleGetSubmissions(
                          selectedCourseId,
                          selectedAssignment.id
                        )
                      : undefined
                  }
                >
                  刷新提交
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {selectedCourseId > 0 && selectedAssignment ? (
          <Card sx={surfaceCardSx}>
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  参考文件绑定
                </Typography>
                <CourseFileSelector
                  courseId={selectedCourseId}
                  onSelectFiles={bindCourseAssignmentFiles}
                  initialFiles={boundFiles}
                />
              </Stack>
            </CardContent>
          </Card>
        ) : null}

        {notSubmitStudents.length > 0 ? (
          <Card sx={surfaceCardSx}>
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              <Stack spacing={1.5}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  未提交学生
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {notSubmitStudents.map((student) => (
                    <Tooltip
                      key={student.id}
                      title={
                        <Box>
                          <Typography variant="body2">姓名：{student.name}</Typography>
                          <Typography variant="body2">
                            学号：{student.login_id || "-"}
                          </Typography>
                          {student.email ? (
                            <Typography variant="body2">邮箱：{student.email}</Typography>
                          ) : null}
                        </Box>
                      }
                    >
                      <Chip label={student.name} variant="outlined" />
                    </Tooltip>
                  ))}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ) : attachments.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: "18px" }}>
            当前还没有任何提交。
          </Alert>
        ) : null}

        {statistic ? (
          <Card sx={surfaceCardSx}>
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  成绩分布
                </Typography>
                <GradeStatisticChart statistic={statistic} />
              </Stack>
            </CardContent>
          </Card>
        ) : null}

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={3}>
              {visibleAttachments.length > 0 ? (
                <>
                  <Box
                    sx={{
                      borderRadius: "22px",
                      border: "1px solid",
                      borderColor: "divider",
                      overflow: "auto",
                    }}
                  >
                    <Table stickyHeader sx={{ minWidth: 1200 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={
                                visibleAttachments.length > 0 &&
                                selectedAttachments.length === visibleAttachments.length
                              }
                              indeterminate={
                                selectedAttachments.length > 0 &&
                                selectedAttachments.length < visibleAttachments.length
                              }
                              onChange={(event) =>
                                setSelectedAttachments(
                                  event.target.checked ? visibleAttachments : []
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>学生</TableCell>
                          <TableCell>分数</TableCell>
                          <TableCell>文件</TableCell>
                          <TableCell>提交时间</TableCell>
                          <TableCell>状态</TableCell>
                          <TableCell align="right">操作</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paginatedAttachments.map((attachment) => {
                          const expanded = expandedRowKeys.includes(attachment.id);
                          const checked = selectedAttachmentIds.has(attachment.id);
                          const showInput = attachmentToComment === attachment.id;
                          return (
                            <>
                              <TableRow key={attachment.id} hover selected={checked}>
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    checked={checked}
                                    onChange={(event) => {
                                      setSelectedAttachments((prev) => {
                                        if (event.target.checked) {
                                          return [...prev, attachment];
                                        }
                                        return prev.filter(
                                          (item) => item.id !== attachment.id
                                        );
                                      });
                                    }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Box
                                    dangerouslySetInnerHTML={{
                                      __html: html(attachment.user || ""),
                                    }}
                                  />
                                </TableCell>
                                <TableCell sx={{ minWidth: 180 }}>
                                  <SubmissionGrade
                                    gradeKey={attachment.grade}
                                    gradingType={
                                      selectedAssignment?.grading_type ?? "points"
                                    }
                                    disabled={readonlyGrade}
                                    defaultValue={attachment.grade ?? ""}
                                    onSubmit={(grade) =>
                                      void handleGrade(grade, attachment)
                                    }
                                  />
                                </TableCell>
                                <TableCell sx={{ minWidth: 260 }}>
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <MuiLink
                                      href={`${baseURL.data}/courses/${selectedCourseId}/gradebook/speed_grader?assignment_id=${selectedAssignment?.id}&student_id=${attachment.user_id}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      underline="hover"
                                      onMouseEnter={() =>
                                        onHoverEntry(attachmentToFile(attachment))
                                      }
                                      onMouseLeave={onLeaveEntry}
                                    >
                                      {attachment.display_name}
                                    </MuiLink>
                                  </Stack>
                                </TableCell>
                                <TableCell>{formatDate(attachment.submitted_at)}</TableCell>
                                <TableCell>
                                  <Chip
                                    size="small"
                                    label={attachment.late ? "迟交" : "按时提交"}
                                    color={attachment.late ? "error" : "success"}
                                    variant="outlined"
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    justifyContent="flex-end"
                                    flexWrap="wrap"
                                    useFlexGap
                                  >
                                    {attachment.url ? (
                                      <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={<DownloadRoundedIcon />}
                                        onClick={() =>
                                          void handleDownloadAttachment(attachment)
                                        }
                                      >
                                        下载
                                      </Button>
                                    ) : null}
                                    <Button
                                      size="small"
                                      variant="text"
                                      startIcon={<PreviewRoundedIcon />}
                                      onClick={() =>
                                        setPreviewEntry(attachmentToFile(attachment))
                                      }
                                    >
                                      预览
                                    </Button>
                                    <Button
                                      size="small"
                                      variant="text"
                                      startIcon={<RateReviewRoundedIcon />}
                                      onClick={() => {
                                        setAttachmentToComment(attachment.id);
                                        setExpandedRowKeys((keys) =>
                                          keys.includes(attachment.id)
                                            ? keys
                                            : [...keys, attachment.id]
                                        );
                                      }}
                                    >
                                      评论
                                    </Button>
                                    <Button
                                      size="small"
                                      variant="text"
                                      startIcon={<OpenInNewRoundedIcon />}
                                      component="a"
                                      href={`${baseURL.data}/courses/${selectedCourseId}/gradebook/speed_grader?assignment_id=${selectedAssignment?.id}&student_id=${attachment.user_id}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      SpeedGrader
                                    </Button>
                                  </Stack>
                                </TableCell>
                              </TableRow>
                              {(attachment.comments.length > 0 || showInput) && (
                                <TableRow key={`${attachment.id}-detail`}>
                                  <TableCell colSpan={7} sx={{ py: 0 }}>
                                    <Collapse in={expanded} unmountOnExit>
                                      <Box sx={{ p: 2 }}>
                                        {selectedAssignment ? (
                                          <CommentPanel
                                            me={me.data}
                                            onRefresh={refreshSubmission}
                                            onHoverEntry={onHoverEntry}
                                            onLeaveEntry={onLeaveEntry}
                                            attachment={attachment}
                                            assignmentId={selectedAssignment.id}
                                            courseId={selectedCourseId}
                                            showInput={showInput}
                                            messageApi={messageApi}
                                          />
                                        ) : null}
                                      </Box>
                                    </Collapse>
                                  </TableCell>
                                </TableRow>
                              )}
                            </>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>

                  <TablePagination
                    component="div"
                    count={visibleAttachments.length}
                    page={page}
                    onPageChange={(_, nextPage) => setPage(nextPage)}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(event) => {
                      setRowsPerPage(Number(event.target.value));
                      setPage(0);
                    }}
                    rowsPerPageOptions={[10, 20, 50]}
                    labelRowsPerPage="每页文件数"
                    labelDisplayedRows={({ from, to, count }) =>
                      `${from}-${to} / ${count}`
                    }
                  />

                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <Button
                      variant="contained"
                      startIcon={<DownloadRoundedIcon />}
                      disabled={operating || selectedAttachments.length === 0}
                      onClick={handleDownloadSelectedAttachments}
                    >
                      下载所选
                    </Button>
                    <Chip
                      icon={<ArticleRoundedIcon />}
                      label={`当前筛选结果 ${visibleAttachments.length} 份`}
                      variant="outlined"
                    />
                  </Stack>
                </>
              ) : (
                <Alert severity="info" sx={{ borderRadius: "18px" }}>
                  选择课程与作业后，这里会展示提交文件列表。
                </Alert>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={2}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                下载任务
              </Typography>
              <FileDownloadTable
                tasks={downloadTasks}
                handleDownloadFile={handleDownloadFile}
                handleOpenTaskFile={handleOpenTaskFile}
                handleRemoveTask={handleRemoveTask}
              />
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </BasicLayout>
  );
}
