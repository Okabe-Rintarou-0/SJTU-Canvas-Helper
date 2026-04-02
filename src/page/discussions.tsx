import { invoke } from "@tauri-apps/api/core";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import MarkEmailUnreadRoundedIcon from "@mui/icons-material/MarkEmailUnreadRounded";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useMemo, useState } from "react";

import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import { useCourses, useMe } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import {
  DiscussionTopic,
  DiscussionView,
  FullDiscussion,
  LOG_LEVEL_ERROR,
  Participant,
} from "../lib/model";
import { consoleLog, formatDate } from "../lib/utils";

const surfaceCardSx = {
  borderRadius: "28px",
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
  backgroundImage: "none",
};

function DiscussionBubble({
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
    <Stack
      direction={mine ? "row-reverse" : "row"}
      spacing={1.5}
      alignItems="flex-start"
    >
      <Avatar sx={{ width: 40, height: 40 }}>
        {author.slice(0, 1).toUpperCase()}
      </Avatar>
      <Box
        sx={{
          maxWidth: { xs: "100%", md: "80%" },
          px: 2,
          py: 1.5,
          borderRadius: mine ? "22px 8px 22px 22px" : "8px 22px 22px 22px",
          bgcolor: mine ? "primary.main" : alpha("#94a3b8", 0.12),
          color: mine ? "primary.contrastText" : "text.primary",
          border: "1px solid",
          borderColor: mine ? alpha("#ffffff", 0.16) : "divider",
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          spacing={1}
          sx={{ mb: 1, flexWrap: "wrap" }}
        >
          <Typography
            variant="subtitle2"
            sx={{ fontWeight: 700, color: mine ? "inherit" : "text.primary" }}
          >
            {author}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            {unread ? (
              <Chip
                size="small"
                label="未读"
                color={mine ? "default" : "primary"}
                variant={mine ? "filled" : "outlined"}
                sx={{ height: 22 }}
              />
            ) : null}
            <Typography
              variant="caption"
              sx={{ color: mine ? alpha("#ffffff", 0.82) : "text.secondary" }}
            >
              {formatDate(createdAt)}
            </Typography>
          </Stack>
        </Stack>
        <Box
          sx={{
            fontSize: 14,
            lineHeight: 1.7,
            wordBreak: "break-word",
            "& a": {
              color: mine ? "inherit" : "primary.main",
            },
            "& img": {
              maxWidth: "100%",
            },
            "& p": {
              m: 0,
            },
          }}
          dangerouslySetInnerHTML={{ __html: message || "<p>无内容</p>" }}
        />
      </Box>
    </Stack>
  );
}

export default function DiscussionsPage() {
  const theme = useTheme();
  const [messageApi, contextHolder] = useAppMessage();
  const [topics, setTopics] = useState<DiscussionTopic[]>([]);
  const [operating, setOperating] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<number | "">("");
  const [fullDiscussion, setFullDiscussion] = useState<FullDiscussion>();
  const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
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

  const handleCourseSelect = async (courseId: number) => {
    setOperating(true);
    setSelectedCourseId(courseId);
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

  const handleGetFullDiscussion = async (topicId: number) => {
    try {
      const nextFullDiscussion = (await invoke("get_full_discussion", {
        courseId: selectedCourseId,
        topicId,
      })) as FullDiscussion;
      setFullDiscussion(nextFullDiscussion);
    } catch (error) {
      consoleLog(LOG_LEVEL_ERROR, error);
      messageApi.error(`获取讨论内容失败：${error}`);
    }
  };

  const handleTopicSelect = async (topicId: number) => {
    setSelectedTopicId(topicId);
    await handleGetFullDiscussion(topicId);
  };

  const selectedCourse = courses.data.find(
    (course) => course.id === selectedCourseId
  );

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
                    讨论区
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    更清晰地查看课程讨论主题、发言流和未读情况。
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
                  { label: "讨论主题", value: topics.length },
                  {
                    label: "未读条目",
                    value: fullDiscussion?.unread_entries.length ?? 0,
                  },
                  {
                    label: "参与者",
                    value: fullDiscussion?.participants.length ?? 0,
                  },
                  {
                    label: "消息条数",
                    value: discussionMessages.length,
                  },
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
                spacing={1.5}
                justifyContent="space-between"
              >
                <TextField
                  select
                  fullWidth
                  disabled={operating || topics.length === 0}
                  label="选择话题"
                  value={selectedTopicId}
                  onChange={(event) =>
                    void handleTopicSelect(Number(event.target.value))
                  }
                  helperText={
                    selectedTopic
                      ? `当前查看：${selectedTopic.title}`
                      : "先选择课程，再选择一个讨论主题。"
                  }
                >
                  {topics.map((topic) => (
                    <MenuItem key={topic.id} value={topic.id}>
                      {topic.title}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="outlined"
                  startIcon={<RefreshRoundedIcon />}
                  onClick={() =>
                    selectedCourseId > 0
                      ? void handleGetDiscussionTopics(selectedCourseId)
                      : undefined
                  }
                  disabled={selectedCourseId <= 0 || operating}
                  sx={{ minWidth: { md: 132 } }}
                >
                  刷新主题
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              xl: "360px minmax(0, 1fr)",
            },
          }}
        >
          <Card sx={surfaceCardSx}>
            <CardContent sx={{ p: 0 }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ px: 2.5, py: 2 }}
              >
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  话题列表
                </Typography>
                {selectedCourse ? (
                  <Chip label={selectedCourse.name} variant="outlined" size="small" />
                ) : null}
              </Stack>
              <Divider />
              <Stack sx={{ maxHeight: { xl: "calc(100vh - 360px)" }, overflow: "auto" }}>
                {topics.length > 0 ? (
                  topics.map((topic) => {
                    const selected = topic.id === selectedTopicId;
                    return (
                      <Box
                        key={topic.id}
                        onClick={() => void handleTopicSelect(topic.id)}
                        sx={{
                          px: 2.5,
                          py: 2,
                          cursor: "pointer",
                          borderBottom: "1px solid",
                          borderColor: "divider",
                          bgcolor: selected
                            ? alpha(theme.palette.primary.main, 0.08)
                            : "transparent",
                          transition: "background-color 0.2s ease",
                          "&:hover": {
                            bgcolor: alpha(theme.palette.primary.main, 0.05),
                          },
                        }}
                      >
                        <Stack spacing={1.2}>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            flexWrap="wrap"
                            useFlexGap
                          >
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                              {topic.title}
                            </Typography>
                            {topic.pinned ? (
                              <Chip
                                size="small"
                                icon={<PushPinRoundedIcon />}
                                label="置顶"
                                color="primary"
                                variant="outlined"
                              />
                            ) : null}
                            {topic.unread_count > 0 ? (
                              <Chip
                                size="small"
                                icon={<MarkEmailUnreadRoundedIcon />}
                                label={`${topic.unread_count} 未读`}
                                color="warning"
                                variant="outlined"
                              />
                            ) : null}
                          </Stack>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            <Chip
                              size="small"
                              label={`${topic.discussion_subentry_count} 回复`}
                              variant="outlined"
                            />
                            {topic.user_name ? (
                              <Chip
                                size="small"
                                label={topic.user_name}
                                variant="outlined"
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="caption" color="text.secondary">
                            最后回复：{formatDate(topic.last_reply_at || topic.created_at)}
                          </Typography>
                        </Stack>
                      </Box>
                    );
                  })
                ) : (
                  <Box sx={{ px: 2.5, py: 8 }}>
                    <Typography align="center" variant="body2" color="text.secondary">
                      选择课程后，这里会显示讨论主题列表。
                    </Typography>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={surfaceCardSx}>
            <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
              {selectedTopic && fullDiscussion ? (
                <Stack spacing={3}>
                  <Stack spacing={1.5}>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      justifyContent="space-between"
                      spacing={1.5}
                    >
                      <Box>
                        <Typography variant="h5" sx={{ fontWeight: 800 }}>
                          {selectedTopic.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          创建于 {formatDate(selectedTopic.created_at)}，最近活跃于{" "}
                          {formatDate(selectedTopic.last_reply_at || selectedTopic.created_at)}
                        </Typography>
                      </Box>
                      <Button
                        component="a"
                        href={selectedTopic.html_url}
                        target="_blank"
                        rel="noreferrer"
                        variant="outlined"
                        startIcon={<LaunchRoundedIcon />}
                      >
                        在 Canvas 打开
                      </Button>
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip
                        icon={<ChatBubbleOutlineRoundedIcon />}
                        label={`${discussionMessages.length} 条消息`}
                        color="primary"
                        variant="outlined"
                      />
                      {selectedTopic.subscribed ? (
                        <Chip label="已订阅" variant="outlined" />
                      ) : null}
                      {selectedTopic.locked ? (
                        <Chip label="已锁定" color="warning" variant="outlined" />
                      ) : null}
                    </Stack>
                  </Stack>

                  <Box
                    sx={{
                      p: 2.25,
                      borderRadius: "22px",
                      bgcolor: alpha(theme.palette.primary.main, 0.04),
                      border: "1px solid",
                      borderColor: alpha(theme.palette.primary.main, 0.1),
                    }}
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.25 }}>
                      主题内容
                    </Typography>
                    <Box
                      sx={{
                        fontSize: 14,
                        lineHeight: 1.8,
                        color: "text.secondary",
                        "& a": {
                          color: "primary.main",
                        },
                        "& img": {
                          maxWidth: "100%",
                        },
                      }}
                      dangerouslySetInnerHTML={{
                        __html: selectedTopic.message || "<p>无主题内容</p>",
                      }}
                    />
                  </Box>

                  <Stack spacing={2}>
                    {discussionMessages.map((view) => {
                      const user = view.user_id
                        ? participantMap.get(view.user_id)
                        : undefined;
                      const isMine = user?.id === me.data?.id;
                      const unread =
                        fullDiscussion.unread_entries.includes(view.id) ||
                        fullDiscussion.new_entries.includes(view.id);

                      return (
                        <DiscussionBubble
                          key={view.id}
                          author={user?.display_name ?? "未知用户"}
                          message={view.message ?? ""}
                          createdAt={view.created_at}
                          mine={Boolean(isMine)}
                          unread={unread}
                        />
                      );
                    })}
                  </Stack>
                </Stack>
              ) : (
                <Box
                  sx={{
                    minHeight: 420,
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    px: 2,
                  }}
                >
                  <Stack spacing={1.25} alignItems="center">
                    <ChatBubbleOutlineRoundedIcon
                      sx={{ fontSize: 44, color: "text.secondary" }}
                    />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      还没有打开任何讨论
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      先选择课程和话题，右侧会显示完整讨论内容与回复流。
                    </Typography>
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </BasicLayout>
  );
}
