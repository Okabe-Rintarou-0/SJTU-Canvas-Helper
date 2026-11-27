import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import { invoke } from "@tauri-apps/api/core";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Divider,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  Tooltip,
  Stack,
  Typography,
} from "@mui/material";
import { useMemo, useRef, useState } from "react";

import CourseSelect from "../components/course_select";
import { WorkspaceHero } from "../components/workspace_hero";
import BasicLayout from "../components/layout";
import { useCourses, useMe, useSelectedCourse, useAutoLoadCourse } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import {
  DiscussionTopic,
  DiscussionView,
  FullDiscussion,
  LOG_LEVEL_ERROR,
  Participant,
} from "../lib/model";
import { consoleLog, formatCompactDate } from "../lib/utils";

import { surfaceCardSx } from "../lib/styles";

function DiscussionReply({
  author,
  message,
  createdAt,
  mine,
  unread,
}: {
  author: string;
  message: string;
  createdAt?: string | null;
  mine: boolean;
  unread?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ py: 1.25 }}>
      <Avatar sx={{ width: 28, height: 28, fontSize: 13 }}>
        {author.slice(0, 1).toUpperCase()}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
          <Typography variant="subtitle2">{author}{mine ? "（我）" : ""}</Typography>
          <Typography variant="caption" color="text.secondary">{formatCompactDate(createdAt)}</Typography>
          {unread && <Typography variant="caption" color="primary.main">未读</Typography>}
        </Stack>
        <Box
          sx={{
            fontSize: 14,
            lineHeight: 1.65,
            overflowWrap: "anywhere",
            "& a": { color: "primary.main" },
            "& img": { maxWidth: "100%" },
            "& p": { my: 0.5 },
          }}
          dangerouslySetInnerHTML={{ __html: message || "<p>无内容</p>" }}
        />
      </Box>
    </Stack>
  );
}

export default function DiscussionsPage() {
  const [messageApi, contextHolder] = useAppMessage();
  const [topics, setTopics] = useState<DiscussionTopic[]>([]);
  const [operating, setOperating] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<number | "">("");
  const [fullDiscussion, setFullDiscussion] = useState<FullDiscussion>();
  const [loadingTopic, setLoadingTopic] = useState(false);
  const topicRequest = useRef(0);
  const { selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const courses = useCourses();
  const me = useMe();

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId),
    [selectedTopicId, topics]
  );

  const participantMap = useMemo(() => {
    const map = new Map<number, Participant>();
    fullDiscussion?.participants.forEach((participant) =>
      map.set(participant.id, participant)
    );
    return map;
  }, [fullDiscussion]);

  const discussionMessages = useMemo(() => {
    if (!fullDiscussion) {
      return [];
    }

    const flattenReplies = (view: DiscussionView) => {
      const entries = [view];
      view.replies.forEach((reply) => {
        entries.push({
          ...reply,
          replies: [],
        } as unknown as DiscussionView);
      });
      return entries;
    };

    return fullDiscussion.view.flatMap(flattenReplies);
  }, [fullDiscussion]);

  const handleGetDiscussionTopics = async (courseId: number) => {
    try {
      const nextTopics = (await invoke("list_discussion_topics", {
        courseId,
      })) as DiscussionTopic[];
      setTopics(nextTopics);
    } catch (error) {
      messageApi.error(`获取讨论话题失败：${error}`);
    }
  };

  const loadCourse = async (courseId: number) => {
    setOperating(true);
    topicRequest.current += 1;
    setLoadingTopic(false);
    setTopics([]);
    setSelectedTopicId("");
    setFullDiscussion(undefined);
    try {
      if (courses.data.find((course) => course.id === courseId)) {
        await handleGetDiscussionTopics(courseId);
      }
    } finally {
      setOperating(false);
    }
  };

  useAutoLoadCourse(
    (courseId) => void loadCourse(courseId),
    courses.data.length > 0
  );

  const handleTopicSelect = async (topicId: number) => {
    const request = ++topicRequest.current;
    setSelectedTopicId(topicId);
    setFullDiscussion(undefined);
    setLoadingTopic(true);
    try {
      const discussion = await invoke<FullDiscussion>("get_full_discussion", {
        courseId: selectedCourseId,
        topicId,
      });
      if (request === topicRequest.current) setFullDiscussion(discussion);
    } catch (error) {
      if (request === topicRequest.current) {
        consoleLog(LOG_LEVEL_ERROR, error);
        messageApi.error(`获取讨论内容失败：${error}`);
      }
    } finally {
      if (request === topicRequest.current) setLoadingTopic(false);
    }
  };

  const refreshTopics = async () => {
    setOperating(true);
    try {
      await handleGetDiscussionTopics(selectedCourseId);
    } finally {
      setOperating(false);
    }
  };

  return (
    <BasicLayout>
      {contextHolder}
      <Stack spacing={2}>
        <WorkspaceHero
          chipLabel="讨论管理"
          chipIcon={<ForumRoundedIcon />}
          title="课程讨论"
          description="按话题阅读课程讨论和回复。"
          aside={
            <Box sx={{ width: { xs: "100%", lg: 640 } }}>
              <CourseSelect
                onChange={setSelectedCourseId}
                disabled={operating}
                courses={courses.data}
                value={selectedCourseId === -1 ? undefined : selectedCourseId}
              />
            </Box>
          }
        />

        <Box sx={{
          display: "grid",
          gap: 1.5,
          alignItems: "start",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(220px, 1fr) minmax(0, 2fr)" },
        }}>
          <Card sx={surfaceCardSx}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.5, py: 0.75 }}>
              <Typography component="h2" variant="subtitle2">话题</Typography>
              <Tooltip title="刷新话题" describeChild>
                <span>
                  <IconButton size="small" aria-label="刷新话题" disabled={selectedCourseId <= 0 || operating} onClick={() => void refreshTopics()}>
                    <RefreshRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
            {operating ? <LinearProgress aria-label="正在读取话题" /> : <Divider />}
            {topics.length ? (
              <List disablePadding aria-label="讨论话题" sx={{ maxHeight: { xs: 230, md: "65vh" }, overflow: "auto" }}>
                {topics.map((topic) => {
                  const selected = topic.id === selectedTopicId;
                  const activity = formatCompactDate(topic.last_reply_at || topic.created_at);
                  return (
                    <ListItem key={topic.id} disablePadding>
                      <ListItemButton
                        component="button"
                        selected={selected}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => void handleTopicSelect(topic.id)}
                        sx={{ display: "block", width: "100%", textAlign: "left", px: 1.5, py: 1 }}
                      >
                        <Stack direction="row" gap={0.75} alignItems="baseline">
                          {topic.pinned && <PushPinRoundedIcon role="img" aria-label="置顶" sx={{ fontSize: 14, color: "text.secondary", alignSelf: "center" }} />}
                          <Typography variant="body2" fontWeight={selected || topic.unread_count > 0 ? 700 : 500} sx={{ overflowWrap: "anywhere" }}>
                            {topic.title}
                          </Typography>
                        </Stack>
                        <Typography component="div" variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
                          {topic.discussion_subentry_count} 条回复
                          {topic.unread_count > 0 && <Box component="span" sx={{ color: "primary.main" }}> · {topic.unread_count} 条未读</Box>}
                          {activity && ` · ${activity}`}
                        </Typography>
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            ) : !operating && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                {selectedCourseId <= 0 ? "请选择课程" : "本课程暂无讨论"}
              </Typography>
            )}
          </Card>

          <Card sx={surfaceCardSx}>
            {loadingTopic && <LinearProgress aria-label="正在读取讨论" />}
            <CardContent sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, "&:last-child": { pb: 1.5 } }}>
              {selectedTopic ? (
                <Stack spacing={1.5}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography component="h2" variant="h6" fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                        {selectedTopic.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[
                          selectedTopic.user_name,
                          formatCompactDate(selectedTopic.created_at),
                          selectedTopic.subscribed && "已订阅",
                          selectedTopic.locked && "已锁定",
                        ].filter(Boolean).join(" · ")}
                      </Typography>
                    </Box>
                    <Tooltip title="在 Canvas 打开" describeChild>
                      <IconButton component="a" href={selectedTopic.html_url} target="_blank" rel="noreferrer" size="small" aria-label="在 Canvas 打开">
                        <LaunchRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  {selectedTopic.message && (
                    <Box
                      sx={{ fontSize: 14, lineHeight: 1.65, overflowWrap: "anywhere", "& a": { color: "primary.main" }, "& img": { maxWidth: "100%" } }}
                      dangerouslySetInnerHTML={{ __html: selectedTopic.message }}
                    />
                  )}
                  {fullDiscussion && (
                    <>
                      <Divider />
                      {discussionMessages.length ? (
                        <Stack divider={<Divider />}>
                          {discussionMessages.map((view) => {
                            const user = view.user_id == null ? undefined : participantMap.get(view.user_id);
                            return (
                              <DiscussionReply
                                key={view.id}
                                author={user?.display_name ?? "未知用户"}
                                message={view.message ?? ""}
                                createdAt={view.created_at}
                                mine={Boolean(user && user.id === me.data?.id)}
                                unread={fullDiscussion.unread_entries.includes(view.id) || fullDiscussion.new_entries.includes(view.id)}
                              />
                            );
                          })}
                        </Stack>
                      ) : <Typography variant="body2" color="text.secondary">暂无回复</Typography>}
                    </>
                  )}
                </Stack>
              ) : (
                <Typography align="center" variant="body2" color="text.secondary" sx={{ py: 5 }}>
                  {topics.length ? "请选择话题" : "暂无可查看的讨论"}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </BasicLayout>
  );
}
