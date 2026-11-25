import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
import { downloadCourseContext } from "../lib/downloads";
import { DownloadCourseContext } from "../lib/download_context";
import { invoke } from "@tauri-apps/api/core";
import EditCalendarRoundedIcon from "@mui/icons-material/EditCalendarRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import PreviewRoundedIcon from "@mui/icons-material/PreviewRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  Link as MuiLink,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import dayjs from "dayjs";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import CourseSelect from "../components/course_select";
import { WorkspaceHero } from "../components/workspace_hero";
import { GradeOverviewChart } from "../components/grade_overview";
import BasicLayout from "../components/layout";
import { ListSkeleton } from "../components/skeleton";
import ModifyDDLModal from "../components/modify_ddl_modal";
import { SubmitModal } from "../components/submit_modal";
import { useBaseURL, useCourses, useMe, usePreview, useSelectedCourse, useAutoLoadCourse } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import {
  Assignment,
  Attachment,
  GradeStatus,
  LOG_LEVEL_ERROR,
  Submission,
} from "../lib/model";
import {
  assignmentNotNeedSubmit,
  attachmentToFile,
  consoleLog,
  formatCompactDate,
  getBaseDate,
} from "../lib/utils";

import { surfaceCardSx } from "../lib/styles";

const scoreNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

function AssignmentDisclosure({
  secondaryActions,
  actions,
  onOpen,
  renderDetails,
}: {
  secondaryActions: ReactNode;
  actions: ReactNode;
  onOpen: () => void;
  renderDetails: () => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  return (
    <>
      <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="space-between" sx={{ mt: 0.75 }}>
        {secondaryActions}
        <Stack direction="row" gap={0.5} flexWrap="wrap" justifyContent="flex-end" sx={{ ml: "auto" }}>
          {actions}
          <Button
            size="small"
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            endIcon={expanded ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
            onClick={() => {
              setExpanded(!expanded);
              if (!expanded) onOpen();
            }}
          >
            {expanded ? "收起详情" : "展开详情"}
          </Button>
        </Stack>
      </Stack>
      {expanded && <Box id={detailsId}>{renderDetails()}</Box>}
    </>
  );
}

export default function AssignmentsPage() {
  const [messageApi, contextHolder] = useAppMessage();
  const [operating, setOperating] = useState(false);
  const [onlyShowUnfinished, setOnlyShowUnfinished] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const { selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry } =
    usePreview();
  const [linksMap, setLinksMap] = useState<Record<number, Attachment[]>>({});
  const submissionRequests = useRef(new Map<number, symbol>());
  const [showModifyDDLModal, setShowModifyDDLModal] = useState(false);
  const [assignmentToModify, setAssignmentToModify] = useState<
    Assignment | undefined
  >();
  const [showModal, setShowModal] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<
    Assignment | undefined
  >();
  const [searchParams, setSearchParams] = useSearchParams();
  const courses = useCourses();
  const me = useMe();
  const baseURL = useBaseURL();

  useEffect(() => {
    const courseId = Number.parseInt(searchParams.get("id") ?? "");
    if (courseId > 0) {
      setSearchParams({});
      setSelectedCourseId(courseId);
    }
  }, [searchParams, setSearchParams, setSelectedCourseId]);

  const gradeMap = useMemo(() => {
    const grades = new Map<number, GradeStatus>();
    assignments.forEach((assignment) => {
      const grade = assignment.submission?.grade?.trim();
      if (assignment.submission?.workflow_state !== "graded" || !grade ||
        assignment.grading_type !== "points" || assignment.points_possible == null) return;

      const actualGrade = Number(grade);
      if (!Number.isFinite(actualGrade)) return;
      grades.set(assignment.id, {
        assignmetName: assignment.name,
        actualGrade,
        maxGrade: Math.max(assignment.points_possible, actualGrade),
      });
    });
    return grades;
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

  const staff = isTAOrTeacher(selectedCourseId);
  const filterUnfinished = !staff && onlyShowUnfinished;
  const visibleAssignments = filterUnfinished
    ? assignments.filter((assignment) =>
        assignment.submission?.workflow_state === "unsubmitted" &&
        !assignmentNotNeedSubmit(assignment)
      )
    : assignments;

  const handleGetAssignments = async (courseId: number) => {
    if (courseId === -1) return;
    setOperating(true);
    try {
      const nextLinksMap: Record<number, Attachment[]> = {};
      const nextAssignments = await invoke<Assignment[]>("list_course_assignments", { courseId });
      nextAssignments.forEach((assignment) =>
        dealWithDescription(assignment, nextLinksMap)
      );
      setLinksMap(nextLinksMap);
      setAssignments(nextAssignments);
      submissionRequests.current.clear();
    } catch (error) {
      messageApi.error(error as string);
    } finally {
      setOperating(false);
    }
  };

  const handleDownloadAttachment = async (attachment: Attachment) => {
    const file = attachmentToFile(attachment);
    const course = courses.data.find((item) => item.id === selectedCourseId);
    try {
      await invoke("download_file", { file, ...(course ? { course: downloadCourseContext(course) } : {}) });
      messageApi.success("下载成功", 0.5);
    } catch (error) {
      messageApi.error(`下载失败：${error}`);
    }
  };

  useAutoLoadCourse(
    (courseId) => {
      setAssignments([]);
      void handleGetAssignments(courseId);
    },
    courses.data.length > 0
  );

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

  const loadSubmissionDetails = async (assignmentId: number, refresh = false) => {
    const requests = submissionRequests.current;
    if (staff || (!refresh && requests.has(assignmentId))) return;

    const request = Symbol();
    const courseId = selectedCourseId;
    requests.set(assignmentId, request);
    try {
      const submission = await invoke<Submission>("get_my_single_submission", { courseId, assignmentId });
      if (requests.get(assignmentId) !== request) return;
      setAssignments((current) => current.map((assignment) =>
        assignment.course_id === courseId && assignment.id === assignmentId
          ? { ...assignment, submission }
          : assignment
      ));
    } catch (error) {
      if (requests.get(assignmentId) !== request) return;
      requests.delete(assignmentId);
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
      await loadSubmissionDetails(assignmentId, true);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      messageApi.error(error as string);
    }
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
          borderRadius: "8px",
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
                  <TableCell>{formatCompactDate(attachment.submitted_at) || "—"}</TableCell>
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
      <DownloadCourseContext.Provider value={selectedCourse ? downloadCourseContext(selectedCourse) : undefined}>{previewer}</DownloadCourseContext.Provider>
      {assignmentToModify ? (
        <ModifyDDLModal
          open={showModifyDDLModal}
          assignment={assignmentToModify}
          handleCancel={() => setShowModifyDDLModal(false)}
          onRefresh={() =>
            void handleGetAssignments(selectedCourseId)
          }
          onSuccess={() => {
            setShowModifyDDLModal(false);
            void handleGetAssignments(selectedCourseId);
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
            void loadSubmissionDetails(selectedAssignment.id, true);
          }}
        />
      ) : null}

      <Stack spacing={2}>
        <WorkspaceHero
          chipLabel="作业管理"
          chipIcon={<AssignmentRoundedIcon />}
          title="作业工作台"
          description="查看作业截止时间、提交情况和成绩。"
          aside={
            <Box sx={{ width: { xs: "100%", lg: 640 } }}>
              <CourseSelect
                onChange={setSelectedCourseId}
                disabled={operating}
                courses={courses.data}
                value={selectedCourse?.id}
              />
            </Box>
          }
          footer={!staff && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={onlyShowUnfinished}
                  onChange={(_, checked) => setOnlyShowUnfinished(checked)}
                />
              }
              label="只显示未完成作业"
              sx={{ m: 0 }}
            />
          )}
        />

        <Stack spacing={1.25}>
          {operating && assignments.length === 0 ? (
            <ListSkeleton items={3} />
          ) : null}
          {selectedCourse && visibleAssignments.map((assignment) => {
            const submission = assignment.submission ?? undefined;
            const attachments =
              submission?.attachments?.map((attachment) => ({
                ...attachment,
                submitted_at: submission.submitted_at,
                late: submission.late,
                key: attachment.id,
              })) ?? [];
            const submissionComments = submission?.submission_comments ?? [];
            const dates = staff ? getBaseDate(assignment.all_dates) ?? assignment : assignment;
            const now = dayjs();
            const unlock = dates.unlock_at ? dayjs(dates.unlock_at) : null;
            const due = dates.due_at ? dayjs(dates.due_at) : null;
            const lock = dates.lock_at ? dayjs(dates.lock_at) : null;
            const upcoming = unlock?.isAfter(now);
            const overdue = due?.isValid() && !due.isAfter(now);
            const closed = lock?.isValid() && !lock.isAfter(now);
            const dateLabels = [
              [upcoming ? "开放于" : "开放", formatCompactDate(dates.unlock_at)],
              [overdue ? "已截止" : "截止", formatCompactDate(dates.due_at)],
              [closed ? "已关闭" : "关闭", lock && due?.isSame(lock) ? "" : formatCompactDate(dates.lock_at)],
            ].filter(([, value]) => value);
            const needsSubmission = !assignment.submission_types.includes("none") &&
              !assignment.submission_types.includes("not_graded");
            const submitted = Boolean(submission?.submitted_at) ||
              submission?.workflow_state === "submitted" ||
              submission?.workflow_state === "pending_review";
            const late = submitted && submission?.late;
            const grade = submission?.grade?.trim();
            const missed = needsSubmission && !!submission && !submitted && (closed || overdue);
            const submissionLabel = !needsSubmission ? "无需提交"
              : submitted ? (late ? "已提交（迟交）" : "已提交")
              : missed ? (overdue ? "已截止 · 未提交" : "已关闭 · 未提交")
              : upcoming ? "尚未开放" : "提交状态未知";
            const stats = assignment.score_statistics;
            const points = assignment.points_possible;
            const pointsGrade = assignment.grading_type === "points";
            const allowSubmit = !staff && !!submission && needsSubmission && !closed && !overdue && !upcoming;

            return (
              <Card key={assignment.id} sx={surfaceCardSx}>
                <CardContent sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" gap={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography component="h2" variant="subtitle1" fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                        {assignment.name}
                      </Typography>
                      <Stack direction="row" flexWrap="wrap" columnGap={2} rowGap={0.25} sx={{ mt: 0.5 }}>
                        {dateLabels.map(([label, value]) => (
                          <Typography key={label} variant="caption" color={label.startsWith("已") ? "warning.main" : "text.secondary"}>
                            {label} {value}
                          </Typography>
                        ))}
                        {!dateLabels.length && (
                          <Typography variant="caption" color="text.secondary">未设时间</Typography>
                        )}
                      </Stack>
                    </Box>
                    {(grade || points != null || stats) && (
                      <Box sx={{ textAlign: { md: "right" }, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                        <Typography variant="body2" color="text.secondary">
                          {grade && (
                            <>我的得分 <Box component="strong" sx={{ color: "text.primary" }}>{grade}</Box></>
                          )}
                          {grade && points != null && pointsGrade && <> / {points} 分</>}
                          {points != null && !(grade && pointsGrade) && (
                            <>{grade ? " · " : ""}满分 {points}</>
                          )}
                          {!staff && !grade && points != null && assignment.grading_type !== "not_graded" && " · 未评分"}
                        </Typography>
                        {stats && (
                          <Typography variant="caption" color="text.secondary">
                            班级均分 {scoreNumber.format(stats.mean)} · 最低 {scoreNumber.format(stats.min)} · 最高 {scoreNumber.format(stats.max)}
                          </Typography>
                        )}
                      </Box>
                    )}
                  </Stack>

                  <AssignmentDisclosure
                    onOpen={() => void loadSubmissionDetails(assignment.id)}
                    secondaryActions={
                      <Button
                        size="small"
                        component="a"
                        href={assignment.html_url}
                        target="_blank"
                        rel="noreferrer"
                        startIcon={<LaunchRoundedIcon />}
                      >
                        在 Canvas 打开
                      </Button>
                    }
                    actions={staff ? (
                      <Button
                        size="small"
                        startIcon={<EditCalendarRoundedIcon />}
                        onClick={() => {
                          setShowModifyDDLModal(true);
                          setAssignmentToModify(assignment);
                        }}
                      >
                        修改日期
                      </Button>
                    ) : allowSubmit && !submitted ? (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SendRoundedIcon />}
                        onClick={() => {
                          setSelectedAssignment(assignment);
                          setShowModal(true);
                        }}
                      >
                        提交作业
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled
                        sx={missed ? { "&.Mui-disabled": { color: "error.main", borderColor: "error.main" } } : undefined}
                      >
                        {submissionLabel}
                      </Button>
                    )}
                    renderDetails={() => (
                      <Stack spacing={2.5} sx={{ pt: 2 }}>
                        <Box
                          sx={{
                            p: 2.25,
                            borderRadius: "8px",
                            border: "1px solid",
                            borderColor: "divider",
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
                                borderRadius: "8px",
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
                          {submitted && allowSubmit && (
                            <Button
                              size="small"
                              sx={{ mt: 1 }}
                              startIcon={<SendRoundedIcon />}
                              onClick={() => {
                                setSelectedAssignment(assignment);
                                setShowModal(true);
                              }}
                            >
                              重新提交
                            </Button>
                          )}
                        </Box>
                      </Stack>
                    )}
                  />
                </CardContent>
              </Card>
            );
          })}

          {!operating && (!selectedCourse || visibleAssignments.length === 0) && (
            <Typography align="center" variant="body2" color="text.secondary" sx={{ py: 5 }}>
              {!selectedCourse ? "请选择课程" : filterUnfinished && assignments.length ? "没有未完成的作业" : "本课程暂无作业"}
            </Typography>
          )}
        </Stack>
        {selectedCourse && gradeMap.size > 0 && (
          <Accordion disableGutters elevation={0} sx={{ ...surfaceCardSx, "&::before": { display: "none" } }} slotProps={{ transition: { unmountOnExit: true } }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Typography component="span" variant="subtitle2">成绩概览</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <GradeOverviewChart gradeMap={gradeMap} />
            </AccordionDetails>
          </Accordion>
        )}
      </Stack>
    </BasicLayout>
  );
}
