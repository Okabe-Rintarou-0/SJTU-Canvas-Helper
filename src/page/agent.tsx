import { invoke } from "@tauri-apps/api/core";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import SchoolRoundedIcon from "@mui/icons-material/SchoolRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import SmartToyRoundedIcon from "@mui/icons-material/SmartToyRounded";
import {
  Avatar,
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
import { useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import BasicLayout from "../components/layout";
import { WorkspaceHero } from "../components/workspace_hero";
import { useCourses } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { CanvasAgentChatMessage, LLMChatMessage } from "../lib/model";
import { formatDate } from "../lib/utils";

const DEFAULT_MAX_TURNS = 6;
const MIN_MAX_TURNS = 1;
const MAX_MAX_TURNS = 12;

const DEFAULT_MAX_TOKENS = 4096;
const MIN_MAX_TOKENS = 256;
const MAX_MAX_TOKENS = 8192;

function createMessage(
  role: "user" | "assistant",
  content: string,
  extras?: Partial<CanvasAgentChatMessage>
): CanvasAgentChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

function toPayload(messages: CanvasAgentChatMessage[]): LLMChatMessage[] {
  return messages
    .filter((message) => !message.pending)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function TypingDots() {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.6, py: 0.5 }}>
      {[0, 1, 2].map((index) => (
        <Box
          key={index}
          sx={{
            width: 7,
            height: 7,
            borderRadius: "999px",
            bgcolor: "primary.main",
            opacity: 0.3,
            animation: "canvas-agent-bounce 1.1s infinite ease-in-out",
            animationDelay: `${index * 0.14}s`,
            "@keyframes canvas-agent-bounce": {
              "0%, 80%, 100%": {
                transform: "translateY(0)",
                opacity: 0.3,
              },
              "40%": {
                transform: "translateY(-4px)",
                opacity: 1,
              },
            },
          }}
        />
      ))}
    </Box>
  );
}

function ChatBubble(message: CanvasAgentChatMessage) {
  const theme = useTheme();
  const mine = message.role === "user";

  return (
    <Stack direction={mine ? "row-reverse" : "row"} spacing={1.5} alignItems="flex-start">
      <Avatar
        sx={{
          width: 42,
          height: 42,
          bgcolor: mine ? "primary.main" : alpha(theme.palette.primary.main, 0.12),
          color: mine ? "primary.contrastText" : "primary.main",
        }}
      >
        {mine ? "你" : <SmartToyRoundedIcon fontSize="small" />}
      </Avatar>

      <Box
        sx={{
          maxWidth: { xs: "100%", md: "78%" },
          px: 2,
          py: 1.5,
          borderRadius: mine ? "22px 8px 22px 22px" : "8px 22px 22px 22px",
          bgcolor: mine ? "primary.main" : alpha(theme.palette.primary.main, 0.06),
          color: mine ? "primary.contrastText" : "text.primary",
          border: "1px solid",
          borderColor: message.error
            ? theme.palette.error.main
            : mine
            ? alpha("#ffffff", 0.18)
            : alpha(theme.palette.primary.main, 0.1),
        }}
      >
        <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {mine ? "你" : "Canvas Agent"}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            {message.pending ? (
              <CircularProgress size={14} color={mine ? "inherit" : "primary"} />
            ) : null}
            <Typography
              variant="caption"
              sx={{ color: mine ? alpha("#ffffff", 0.82) : "text.secondary" }}
            >
              {formatDate(message.createdAt)}
            </Typography>
          </Stack>
        </Stack>

        {message.pending && !message.content ? (
          <Stack spacing={0.75} alignItems="flex-start">
            <TypingDots />
            <Typography variant="body2" color={mine ? "inherit" : "text.secondary"}>
              正在分析 Canvas 数据并组织回复…
            </Typography>
          </Stack>
        ) : (
          <Box
            sx={{
              fontSize: 14,
              lineHeight: 1.75,
              wordBreak: "break-word",
              "& a": {
                color: mine ? "inherit" : "primary.main",
              },
              "& p": { m: 0 },
              "& p + p": { mt: 1.25 },
              "& ul, & ol": { pl: 2.5, my: 0.75 },
              "& li + li": { mt: 0.5 },
              "& code": {
                px: 0.5,
                py: 0.15,
                borderRadius: 1,
                bgcolor: mine ? alpha("#ffffff", 0.16) : alpha("#94a3b8", 0.18),
              },
              "& pre": {
                overflow: "auto",
                p: 1.25,
                borderRadius: 2,
                bgcolor: mine ? alpha("#ffffff", 0.1) : alpha("#0f172a", 0.06),
              },
            }}
          >
            <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
          </Box>
        )}
      </Box>
    </Stack>
  );
}

const SUGGESTIONS = [
  "帮我列出当前所有课程，并标出我可能最需要关注的几门。",
  "作业最多的课程是哪个？",
  "检查最近 7 天内截止的作业，按时间顺序帮我整理。",
];

export default function CanvasAgentPage() {
  const theme = useTheme();
  const courses = useCourses();
  const [messageApi] = useAppMessage();
  const [messages, setMessages] = useState<CanvasAgentChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [maxTurns, setMaxTurns] = useState(String(DEFAULT_MAX_TURNS));
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(
    () => [
      {
        label: "已加载课程",
        value: `${courses.data.length}`,
        icon: <SchoolRoundedIcon />,
      },
      {
        label: "当前会话",
        value: `${messages.filter((item) => item.role === "user").length}`,
        icon: <ForumRoundedIcon />,
      },
      {
        label: "服务模式",
        value: "智能问答",
        icon: <PsychologyRoundedIcon />,
      },
    ],
    [courses.data.length, messages]
  );

  const canSend = input.trim().length > 0 && !loading;

  const normalizeNumber = (
    value: string,
    defaultValue: number,
    min: number,
    max: number
  ) => {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed)) {
      return defaultValue;
    }
    return Math.min(Math.max(parsed, min), max);
  };

  const scrollToBottom = () => {
    window.setTimeout(() => {
      bodyRef.current?.scrollTo({
        top: bodyRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 0);
  };

  const sendMessage = async (content: string) => {
    const userMessage = createMessage("user", content);
    const pendingAssistantMessage = createMessage("assistant", "", { pending: true });
    const nextMessages = [...messages, userMessage];
    const resolvedMaxTurns = normalizeNumber(
      maxTurns,
      DEFAULT_MAX_TURNS,
      MIN_MAX_TURNS,
      MAX_MAX_TURNS
    );
    const resolvedMaxTokens = normalizeNumber(
      maxTokens,
      DEFAULT_MAX_TOKENS,
      MIN_MAX_TOKENS,
      MAX_MAX_TOKENS
    );

    setMessages([...nextMessages, pendingAssistantMessage]);
    setLoading(true);
    scrollToBottom();

    try {
      const response = (await invoke("canvas_agent_chat", {
        messages: toPayload(nextMessages),
        options: {
          max_turns: resolvedMaxTurns,
          max_tokens: resolvedMaxTokens,
        },
      })) as string;

      setMessages([
        ...nextMessages,
        {
          ...pendingAssistantMessage,
          content: response,
          pending: false,
        },
      ]);
    } catch (error) {
      const errorText = String(error);
      messageApi.error(`Canvas Agent 调用失败：${errorText}`);
      setMessages([
        ...nextMessages,
        {
          ...pendingAssistantMessage,
          content: `Canvas Agent 调用失败：${errorText}`,
          pending: false,
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  const handleSubmit = async () => {
    const nextInput = input.trim();
    if (!nextInput || loading) {
      return;
    }
    setInput("");
    await sendMessage(nextInput);
  };

  return (
    <BasicLayout>
      <Stack spacing={3} sx={{ width: "100%" }}>
        <WorkspaceHero
          chipLabel="Canvas Agent"
          chipIcon={<AutoAwesomeRoundedIcon />}
          title="Canvas 智能聊天工作台"
          description="在这里你可以直接用自然语言提问，让它帮你查看课程信息、整理作业待办、查找文件资料，并快速回答和 Canvas 学习相关的问题。"
          aside={
            <Stack spacing={1} alignItems={{ xs: "flex-start", md: "flex-end" }}>
              <Chip
                label={loading ? "正在处理中" : "随时可提问"}
                color={loading ? "warning" : "primary"}
                variant="outlined"
              />
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
                适合直接问“最近要交什么”“这门课文件在哪”“谁还没交作业”这类需要查 Canvas 数据的问题。
              </Typography>
            </Stack>
          }
          stats={stats}
        />

        <Box
          sx={{
            display: "grid",
            gap: 3,
            gridTemplateColumns: { xs: "1fr", xl: "320px minmax(0, 1fr)" },
            alignItems: "start",
          }}
        >
          <Card sx={{ borderRadius: "28px", border: "1px solid", borderColor: "divider" }}>
            <CardContent sx={{ p: { xs: 2.25, md: 2.5 } }}>
              <Stack spacing={2}>
                <Box
                  sx={{
                    p: 1.75,
                    borderRadius: "20px",
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                    border: "1px solid",
                    borderColor: alpha(theme.palette.primary.main, 0.12),
                  }}
                >
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        Agent 配置
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        调整回答时可用的内部检索轮次和输出长度。
                      </Typography>
                    </Box>

                    <Stack spacing={1.25}>
                      <TextField
                        label="最大轮次"
                        value={maxTurns}
                        onChange={(event) => setMaxTurns(event.target.value)}
                        disabled={loading}
                        size="small"
                        type="number"
                        inputProps={{ min: MIN_MAX_TURNS, max: MAX_MAX_TURNS, step: 1 }}
                        helperText="一次回答过程中，Agent 最多可连续调用工具和推理的轮数。"
                      />
                      <TextField
                        label="最大输出 Tokens"
                        value={maxTokens}
                        onChange={(event) => setMaxTokens(event.target.value)}
                        disabled={loading}
                        size="small"
                        type="number"
                        inputProps={{ min: MIN_MAX_TOKENS, max: MAX_MAX_TOKENS, step: 256 }}
                        helperText="值越大，回复通常越长，但耗时和消耗也会更高。"
                      />
                    </Stack>
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    快速提问
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    可以从这些常见问题开始，也可以直接输入你自己的任务。
                  </Typography>
                </Box>

                <Stack spacing={1.25}>
                  {SUGGESTIONS.map((suggestion) => (
                    <Button
                      key={suggestion}
                      variant="outlined"
                      onClick={() => void sendMessage(suggestion)}
                      disabled={loading}
                      sx={{
                        minHeight: 68,
                        px: 1.75,
                        py: 1.4,
                        borderRadius: "18px",
                        justifyContent: "flex-start",
                        textAlign: "left",
                        borderColor: alpha(theme.palette.divider, 0.9),
                      }}
                    >
                      <Typography variant="body2">{suggestion}</Typography>
                    </Button>
                  ))}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ borderRadius: "28px", border: "1px solid", borderColor: "divider" }}>
            <CardContent
              sx={{
                p: 0,
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr) auto",
                minHeight: "70vh",
              }}
            >
              <Box
                sx={{
                  px: { xs: 2, md: 3 },
                  py: 2,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  spacing={1}
                  justifyContent="space-between"
                  alignItems={{ xs: "flex-start", md: "center" }}
                >
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                      对话区
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      你可以像聊天一样直接提问，它会尽量结合你当前的 Canvas 学习内容给出更有用的回答。
                    </Typography>
                  </Box>
                  <Chip
                    icon={<SmartToyRoundedIcon />}
                    label={loading ? "处理中" : "智能助手在线"}
                    color={loading ? "warning" : "primary"}
                    variant="outlined"
                  />
                </Stack>
              </Box>

              <Box
                ref={bodyRef}
                sx={{
                  px: { xs: 2, md: 3 },
                  py: 2.5,
                  overflowY: "auto",
                  bgcolor: alpha(theme.palette.background.default, 0.58),
                }}
              >
                {messages.length > 0 ? (
                  <Stack spacing={2.2}>
                    {messages.map((message) => (
                      <ChatBubble key={message.id} {...message} />
                    ))}
                  </Stack>
                ) : (
                  <Stack
                    spacing={1.25}
                    alignItems="center"
                    justifyContent="center"
                    sx={{ minHeight: 360, textAlign: "center" }}
                  >
                    <SmartToyRoundedIcon sx={{ fontSize: 42, color: "text.secondary" }} />
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      开始和 Canvas Agent 对话
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
                      例如：帮我列出最近一周截止的作业；或者先列出课程，再深入问某一门课的文件、讨论区、提交情况。
                    </Typography>
                  </Stack>
                )}
              </Box>

              <Box sx={{ px: { xs: 2, md: 3 }, py: 2.25, borderTop: "1px solid", borderColor: "divider" }}>
                <Stack spacing={1.25}>
                  <TextField
                    multiline
                    minRows={3}
                    maxRows={8}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="直接描述你的需求，例如：帮我找出最近截止的作业，并告诉我每门课各有几个。"
                    disabled={loading}
                  />
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="caption" color="text.secondary">
                      {loading
                        ? "正在整理相关课程信息并生成回复。"
                        : "建议尽量描述清楚你的需求，比如课程范围、时间范围或想看的内容。"}
                    </Typography>
                    <Button
                      variant="contained"
                      endIcon={<SendRoundedIcon />}
                      onClick={() => void handleSubmit()}
                      disabled={!canSend}
                    >
                      发送
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </BasicLayout>
  );
}
