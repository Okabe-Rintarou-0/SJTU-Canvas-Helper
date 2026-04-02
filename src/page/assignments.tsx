import { invoke } from "@tauri-apps/api/core";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import EditCalendarRoundedIcon from "@mui/icons-material/EditCalendarRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  Link as MuiLink,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import CourseSelect from "../components/course_select";
import { GradeOverviewChart } from "../components/grade_overview";
import BasicLayout from "../components/layout";
import ModifyDDLModal from "../components/modify_ddl_modal";
import { SubmitModal } from "../components/submit_modal";
import { useBaseURL, useCourses, useMe, usePreview } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import {
  Assignment,
  Attachment,
  GradeStatus,
  LOG_LEVEL_ERROR,
  ScoreStatistic,
  Submission,
} from "../lib/model";
import {
  assignmentIsEnded,
  assignmentNotNeedSubmit,
  attachmentToFile,
  consoleLog,
  formatDate,
  getBaseDate,
} from "../lib/utils";

const surfaceCardSx = {
  borderRadius: "28px",
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
  backgroundImage: "none",
};

export default function AssignmentsPage() {
  const theme = useTheme();
  const [messageApi, contextHolder] = useAppMessage();
  const [operating, setOperating] = useState(false);
  const [onlyShowUnfinished, setOnlyShowUnfinished] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
  const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry } =
    usePreview();
  const [linksMap, setLinksMap] = useState<Record<number, Attachment[]>>({});
  const [expandedAssignmentIds, setExpandedAssignmentIds] = useState<number[]>(
    []
  );
  const [showModifyDDLModal, setShowModifyDDLModal] = useState(false);
  const [assignmentToModify, setAssignmentToModify] = useState<
    Assignment | undefined
  >();
  const [showModal, setShowModal] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<
    Assignment | undefined
  >();
  const [gradeMap, setGradeMap] = useState<Map<number, GradeStatus>>(new Map());
  const [searchParams, setSearchParams] = useSearchParams();
  const courses = useCourses();
  const me = useMe();
  const baseURL = useBaseURL();

  useEffect(() => {
    if (courses.data.length > 0) {
      const courseId = Number.parseInt(searchParams.get("id") ?? "");
      if (courseId > 0) {
        setSearchParams({});
        setSelectedCourseId(courseId);
        void handleGetAssignments(courseId, onlyShowUnfinished);
      }
    }
  }, [courses.data, onlyShowUnfinished, searchParams, setSearchParams]);

  useEffect(() => {
    const nextGradeMap = new Map<number, GradeStatus>();
    assignments.forEach((assignment) => {
      const actualGrade = Number.parseInt(assignment.submission?.grade ?? "0");
      let maxGrade = assignment.points_possible ?? 0;
      const graded =
        assignment.submission?.workflow_state === "graded" &&
        !Number.isNaN(actualGrade);
      if (!graded) {
        return;
      }
      if (maxGrade < actualGrade) {
        maxGrade = actualGrade;
      }
      nextGradeMap.set(assignment.id, {
        assignmetName: assignment.name,
        actualGrade,
        maxGrade,
      } as GradeStatus);
    });
    setGradeMap(nextGradeMap);
  }, [assignments]);

  const isTAOrTeacher = (courseId: number) => {
    const course = courses.data.find((item) => item.id === courseId);
    return (
      course !== undefined &&
      course.enrollments.find(
        (enrollment) =>
          enrollment.role === "TaEnrollment" ||
          enrollment.role === "TeacherEnrollment"
      ) !== undefined
    );
  };

  const assignmentSummary = useMemo(() => {
    const total = assignments.length;
    const ended = assignments.filter((assignment) =>
      assignmentIsEnded(assignment)
    ).length;
    const submitted = assignments.filter(
      (assignment) => assignment.submission?.submitted_at
    ).length;
    const unfinished = assignments.filter(
      (assignment) =>
        !assignmentNotNeedSubmit(assignment) &&
        assignment.submission?.workflow_state === "unsubmitted"
    ).length;

    return { total, ended, submitted, unfinished };
  }, [assignments]);

  const handleGetAssignments = async (
    courseId: number,
    onlyShowUnfinishedValue: boolean
  ) => {
    if (courseId === -1) {
      return;
    }
    setOperating(true);
    try {
      const nextLinksMap: Record<number, Attachment[]> = {};
      let nextAssignments = (await invoke("list_course_assignments", {
        courseId,
      })) as Assignment[];
      nextAssignments = nextAssignments.map((assignment) => ({
        ...assignment,
        key: assignment.id,
      }));
      if (!isTAOrTeacher(courseId) && onlyShowUnfinishedValue) {
        nextAssignments = nextAssignments.filter(
          (assignment) =>
            assignment.submission?.workflow_state === "unsubmitted"
        );
      }
      nextAssignments.forEach((assignment) =>
        dealWithDescription(assignment, nextLinksMap)
      );
      setLinksMap(nextLinksMap);
      setAssignments(nextAssignments);
      setExpandedAssignmentIds([]);
    } catch (error) {
      messageApi.error(error as string);
    }
    setOperating(false);
  };

  const handleDownloadAttachment = async (attachment: Attachment) => {
    const file = attachmentToFile(attachment);
    try {
      await invoke("download_file", { file });
      messageApi.success("下载成功", 0.5);
    } catch (error) {
      messageApi.error(`下载失败：${error}`);
    }
  };

  const handleCourseSelect = async (courseId: number) => {
    const selectedCourse = courses.data.find((course) => course.id === courseId);
    if (!selectedCourse) {
      return;
    }
    setSelectedCourseId(courseId);
    await handleGetAssignments(courseId, onlyShowUnfinished);
  };

  const handleSetOnlyShowUnfinished = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const nextValue = event.target.checked;
    setOnlyShowUnfinished(nextValue);
    await handleGetAssignments(selectedCourseId, nextValue);
  };

  const dealWithDescription = (
    assignment: Assignment,
    nextLinksMap: Record<number, Attachment[]>
  ) => {
    if (!assignment.description) {
      return;
    }
    const parser = new DOMParser();
    const document = parser.parseFromString(assignment.description, "text/html");
    const anchorTags = document.querySelectorAll("a");
    const downloadableRegex =
      /https:\/\/oc\.sjtu\.edu\.cn\/courses\/(\d+)\/files\/(\d+)/g;
    const id = assignment.id;
    if (!nextLinksMap[id]) {
      nextLinksMap[id] = [];
    }
    const links = nextLinksMap[id];
    anchorTags.forEach((anchorTag) => {
      anchorTag.setAttribute("target", "_blank");
      const result = anchorTag.href.match(downloadableRegex);
      if (result && result.length > 0) {
        const urlObj = new URL(anchorTag.href);
        const params = new URLSearchParams(urlObj.search);
        const url = result[0] + "/download?" + params;
        links.push({
          url,
          display_name: anchorTag.text,
          key: url,
        } as Attachment);
      }
    });
    assignment.description = document.body.innerHTML;
  };

  const handleGetMySingleSubmission = async (
    courseId: number,
    assignmentId: number
  ) => {
    try {
      const submission = (await invoke("get_my_single_submission", {
        courseId,
        assignmentId,
      })) as Submission;
      const nextAssignments = assignments.map((assignment) =>
        assignment.id === assignmentId ? { ...assignment, submission } : assignment
      );
      setAssignments(nextAssignments);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      messageApi.error(`加载出错：${error}`);
    }
  };

  const handleDeleteComment = async (
    commentId: number,
    assignmentId: number
  ) => {
    try {
      await invoke("delete_my_submission_comment", {
        courseId: selectedCourseId,
        assignmentId,
        commentId,
      });
      messageApi.success("删除成功", 0.5);
      await handleGetMySingleSubmission(selectedCourseId, assignmentId);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      messageApi.error(error as string);
    }
  };

  const toggleExpanded = async (assignment: Assignment) => {
    const expanded = expandedAssignmentIds.includes(assignment.id);
    if (expanded) {
      setExpandedAssignmentIds((prev) => prev.filter((id) => id !== assignment.id));
      return;
    }
    setExpandedAssignmentIds((prev) => [...prev, assignment.id]);
    if (!isTAOrTeacher(selectedCourseId)) {
      await handleGetMySingleSubmission(selectedCourseId, assignment.id);
    }
  };

  const getAssignmentStatusChips = (
    assignment: Assignment,
    submission?: Submission
  ) => {
    const chips = [];
    chips.push(
      <Chip
        key="time"
        label={assignmentIsEnded(assignment) ? "已截止" : "进行中"}
        color={assignmentIsEnded(assignment) ? "warning" : "primary"}
        variant={assignmentIsEnded(assignment) ? "outlined" : "filled"}
        size="small"
      />
    );
    if (assignmentNotNeedSubmit(assignment)) {
      chips.push(
        <Chip key="skip" label="无需提交" variant="outlined" size="small" />
      );
    } else if (submission?.submitted_at) {
      chips.push(
        <Chip
          key="submission"
          label={submission.late ? "迟交" : "已提交"}
          color={submission.late ? "error" : "success"}
          variant="outlined"
          size="small"
        />
      );
    } else {
      chips.push(
        <Chip
          key="submission"
          label="未提交"
          color="error"
          variant="outlined"
          size="small"
        />
      );
    }
    return chips;
  };

  const renderAttachmentsTable = (
    rows: Attachment[] | undefined,
    showSubmittedAt = false
  ) => {
    if (!rows || rows.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          暂无可展示的文件。
        </Typography>
      );
    }

    return (
      <Box
        sx={{
          borderRadius: "20px",
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>文件</TableCell>
              {showSubmittedAt ? <TableCell>提交时间</TableCell> : null}
              {showSubmittedAt ? <TableCell>状态</TableCell> : null}
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((attachment) => (
              <TableRow key={attachment.id ?? attachment.key}>
                <TableCell>
                  <MuiLink
                    component="button"
                    underline="hover"
                    onMouseEnter={() => onHoverEntry(attachmentToFile(attachment))}
                    onMouseLeave={onLeaveEntry}
                    onClick={() => setPreviewEntry(attachmentToFile(attachment))}
                  >
                    {attachment.display_name}
                  </MuiLink>
                </TableCell>
                {showSubmittedAt ? (
                  <TableCell>{formatDate(attachment.submitted_at)}</TableCell>
                ) : null}
                {showSubmittedAt ? (
                  <TableCell>
                    <Chip
                      size="small"
                      label={attachment.late ? "迟交" : "按时提交"}
                      color={attachment.late ? "error" : "success"}
                      variant="outlined"
                    />
                  </TableCell>
                ) : null}
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
                        startIcon={<FileDownloadRoundedIcon />}
                        onClick={() => void handleDownloadAttachment(attachment)}
                      >
                        下载
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<PreviewRoundedIcon />}
                      onClick={() => setPreviewEntry(attachmentToFile(attachment))}
                    >
                      预览
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    );
  };

  const selectedCourse = courses.data.find(
    (course) => course.id === selectedCourseId
  );

  return (
    <BasicLayout>
      {contextHolder}
      {previewer}
      {assignmentToModify ? (
        <ModifyDDLModal
          open={showModifyDDLModal}
          assignment={assignmentToModify}
          handleCancel={() => setShowModifyDDLModal(false)}
          onRefresh={() =>
            void handleGetAssignments(selectedCourseId, onlyShowUnfinished)
          }
          onSuccess={() => {
            setShowModifyDDLModal(false);
            void handleGetAssignments(selectedCourseId, onlyShowUnfinished);
          }}
          courseId={selectedCourseId}
        />
      ) : null}
      {selectedAssignment ? (
        <SubmitModal
          open={showModal}
          allowed_extensions={selectedAssignment.allowed_extensions}
          courseId={selectedCourseId}
          assignmentId={selectedAssignment.id}
          onCancel={() => setShowModal(false)}
          onSubmit={() => {
            setShowModal(false);
            setSelectedAssignment(undefined);
            messageApi.success("提交成功", 0.5);
            void handleGetMySingleSubmission(
              selectedCourseId,
              selectedAssignment.id
            );
          }}
        />
      ) : null}

      <Stack spacing={3}>
        <Card
          sx={{
            ...surfaceCardSx,
            background:
              theme.palette.mode === "dark"
                ? `linear-gradient(135deg, ${alpha(
                    theme.palette.primary.main,
                    0.18
                  )}, ${alpha("#0f172a", 0.88)})`
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
                    作业工作台
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    集中查看课程作业、提交状态、得分概览和历史评论。
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
                  { label: "作业总数", value: assignmentSummary.total },
                  { label: "待完成", value: assignmentSummary.unfinished },
                  { label: "已提交", value: assignmentSummary.submitted },
                  { label: "已截止", value: assignmentSummary.ended },
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
                alignItems={{ xs: "stretch", md: "center" }}
                justifyContent="space-between"
                spacing={2}
              >
                {!isTAOrTeacher(selectedCourseId) ? (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={onlyShowUnfinished}
                        onChange={(event) =>
                          void handleSetOnlyShowUnfinished(event)
                        }
                      />
                    }
                    label="只显示未完成作业"
                    sx={{ m: 0 }}
                  />
                ) : (
                  <Chip label="教师 / 助教模式" color="primary" variant="outlined" />
                )}
                {selectedCourse ? (
                  <Chip
                    icon={<CalendarMonthRoundedIcon />}
                    label={selectedCourse.name}
                    color="primary"
                    variant="outlined"
                  />
                ) : null}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 800 }}>
                  成绩概览
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  已评分作业会在这里汇总成图，帮助快速判断失分分布。
                </Typography>
              </Box>
              <GradeOverviewChart gradeMap={gradeMap} />
            </Stack>
          </CardContent>
        </Card>

        <Stack spacing={2.25}>
          {assignments.map((assignment) => {
            const expanded = expandedAssignmentIds.includes(assignment.id);
            const submission = assignment.submission ?? undefined;
            const attachments =
              submission?.attachments?.map((attachment) => ({
                ...attachment,
                submitted_at: submission.submitted_at,
                key: attachment.id,
              })) ?? [];
            const submissionComments = submission?.submission_comments ?? [];
            const scoreText = assignment.points_possible
              ? `${assignment.submission?.grade ?? 0}/${assignment.points_possible}`
              : assignment.submission?.grade ?? "-";
            const stats = assignment.score_statistics as ScoreStatistic | null;
            const now = dayjs();
            const lockAt = dayjs(assignment.lock_at);
            const dueAt = dayjs(assignment.due_at);
            const allowSubmit =
              !isTAOrTeacher(selectedCourseId) &&
              !!assignment.submission &&
              !assignment.submission_types.includes("none") &&
              !assignment.submission_types.includes("not_graded") &&
              !now.isAfter(lockAt) &&
              !now.isAfter(dueAt);

            return (
              <Card key={assignment.id} sx={surfaceCardSx}>
                <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
                  <Stack spacing={2.5}>
                    <Stack
                      direction={{ xs: "column", lg: "row" }}
                      justifyContent="space-between"
                      spacing={2}
                    >
                      <Stack spacing={1.5} sx={{ minWidth: 0 }}>
                        <Stack
                          direction={{ xs: "column", sm: "row" }}
                          spacing={1}
                          alignItems={{ xs: "flex-start", sm: "center" }}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Typography variant="h5" sx={{ fontWeight: 800 }}>
                            {assignment.name}
                          </Typography>
                          {getAssignmentStatusChips(assignment, submission)}
                        </Stack>
                        <Stack
                          direction={{ xs: "column", md: "row" }}
                          spacing={2}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Typography variant="body2" color="text.secondary">
                            开始时间：{formatDate(assignment.unlock_at)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            截止时间：
                            {formatDate(getBaseDate(assignment.all_dates)?.due_at)}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            结束时间：
                            {formatDate(getBaseDate(assignment.all_dates)?.lock_at)}
                          </Typography>
                        </Stack>
                      </Stack>

                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                        alignItems={{ xs: "stretch", sm: "center" }}
                      >
                        <Chip
                          label={`得分：${scoreText}`}
                          color="primary"
                          variant="outlined"
                        />
                        {stats ? (
                          <Chip
                            label={`最低/最高/平均：${stats.min}/${stats.max}/${stats.mean}`}
                            variant="outlined"
                          />
                        ) : null}
                      </Stack>
                    </Stack>

                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Button
                        variant="outlined"
                        startIcon={expanded ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
                        onClick={() => void toggleExpanded(assignment)}
                      >
                        {expanded ? "收起详情" : "展开详情"}
                      </Button>
                      <Button
                        component="a"
                        href={assignment.html_url}
                        target="_blank"
                        rel="noreferrer"
                        variant="text"
                        startIcon={<LaunchRoundedIcon />}
                      >
                        在 Canvas 打开
                      </Button>
                      {isTAOrTeacher(selectedCourseId) ? (
                        <Button
                          variant="text"
                          startIcon={<EditCalendarRoundedIcon />}
                          onClick={() => {
                            setShowModifyDDLModal(true);
                            setAssignmentToModify(assignment);
                          }}
                        >
                          修改日期
                        </Button>
                      ) : allowSubmit ? (
                        <Button
                          variant="contained"
                          startIcon={<SendRoundedIcon />}
                          onClick={() => {
                            setSelectedAssignment(assignment);
                            setShowModal(true);
                          }}
                        >
                          提交作业
                        </Button>
                      ) : null}
                    </Stack>

                    <Collapse in={expanded} timeout="auto" unmountOnExit>
                      <Stack spacing={2.5} sx={{ pt: 1 }}>
                        <Box
                          sx={{
                            p: 2.25,
                            borderRadius: "22px",
                            bgcolor: alpha(theme.palette.primary.main, 0.04),
                            border: "1px solid",
                            borderColor: alpha(theme.palette.primary.main, 0.1),
                          }}
                        >
                          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                            作业描述
                          </Typography>
                          {assignment.description ? (
                            <Box
                              sx={{
                                color: "text.secondary",
                                "& a": {
                                  color: "primary.main",
                                },
                                "& img": {
                                  maxWidth: "100%",
                                },
                              }}
                              dangerouslySetInnerHTML={{
                                __html: assignment.description,
                              }}
                            />
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              暂无作业描述。
                            </Typography>
                          )}
                        </Box>

                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.25 }}>
                            作业附件
                          </Typography>
                          {renderAttachmentsTable(linksMap[assignment.id])}
                        </Box>

                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.25 }}>
                            历史评论
                          </Typography>
                          {submissionComments.length ? (
                            <List
                              sx={{
                                border: "1px solid",
                                borderColor: "divider",
                                borderRadius: "20px",
                                overflow: "hidden",
                                p: 0,
                              }}
                            >
                              {submissionComments.map((comment, index) => (
                                <Box key={comment.id}>
                                  <ListItem
                                    alignItems="flex-start"
                                    secondaryAction={
                                      comment.author_id === me.data?.id ? (
                                        <Button
                                          color="error"
                                          variant="text"
                                          size="small"
                                          onClick={() =>
                                            void handleDeleteComment(
                                              comment.id,
                                              assignment.id
                                            )
                                          }
                                        >
                                          删除
                                        </Button>
                                      ) : undefined
                                    }
                                  >
                                    <ListItemAvatar>
                                      <Avatar src={baseURL.data + comment.avatar_path} />
                                    </ListItemAvatar>
                                    <ListItemText
                                      primary={comment.author_name}
                                      secondary={comment.comment}
                                    />
                                  </ListItem>
                                  {index !== submissionComments.length - 1 ? (
                                    <Divider component="li" />
                                  ) : null}
                                </Box>
                              ))}
                            </List>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              暂无评论记录。
                            </Typography>
                          )}
                        </Box>

                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.25 }}>
                            我的提交
                          </Typography>
                          {renderAttachmentsTable(attachments, true)}
                        </Box>
                      </Stack>
                    </Collapse>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}

          {!operating && assignments.length === 0 ? (
            <Card sx={surfaceCardSx}>
              <CardContent sx={{ py: 8 }}>
                <Typography align="center" variant="h6" sx={{ fontWeight: 700 }}>
                  当前没有可展示的作业
                </Typography>
                <Typography align="center" variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  可以切换课程，或者关闭“只显示未完成”后再看看。
                </Typography>
              </CardContent>
            </Card>
          ) : null}
        </Stack>
      </Stack>
    </BasicLayout>
  );
}
