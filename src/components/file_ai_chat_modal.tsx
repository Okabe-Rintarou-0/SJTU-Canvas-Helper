import SendRoundedIcon from "@mui/icons-material/SendRounded";
import SmartToyRoundedIcon from "@mui/icons-material/SmartToyRounded";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatDate } from "../lib/utils";

export interface FileAIChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  pending?: boolean;
  error?: boolean;
}

function TypingDots({ mine = false }: { mine?: boolean }) {
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.55,
        py: 0.5,
      }}
    >
      {[0, 1, 2].map((index) => (
        <Box
          key={index}
          sx={{
            width: 7,
            height: 7,
            borderRadius: "999px",
            bgcolor: mine ? alpha("#ffffff", 0.78) : "primary.main",
            opacity: 0.35,
            animation: "file-ai-bounce 1.1s infinite ease-in-out",
            animationDelay: `${index * 0.14}s`,
            "@keyframes file-ai-bounce": {
              "0%, 80%, 100%": {
                transform: "translateY(0)",
                opacity: 0.35,
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

function ChatBubble({
  markdownComponents,
  role,
  content,
  createdAt,
  pending,
  error,
}: FileAIChatMessage & { markdownComponents?: Components }) {
  const theme = useTheme();
  const mine = role === "user";
  const label = mine ? "你" : "AI 助教";

  return (
    <Stack
      direction={mine ? "row-reverse" : "row"}
      spacing={1.5}
      alignItems="flex-start"
    >
      <Avatar
        sx={{
          width: 40,
          height: 40,
          bgcolor: mine ? "primary.main" : alpha(theme.palette.primary.main, 0.12),
          color: mine ? "primary.contrastText" : "primary.main",
        }}
      >
        {mine ? "你" : <SmartToyRoundedIcon fontSize="small" />}
      </Avatar>

      <Box
        sx={{
          maxWidth: { xs: "100%", md: "82%" },
          px: 2,
          py: 1.5,
          borderRadius: mine ? "22px 8px 22px 22px" : "8px 22px 22px 22px",
          bgcolor: mine ? "primary.main" : alpha(theme.palette.primary.main, 0.06),
          color: mine ? "primary.contrastText" : "text.primary",
          border: "1px solid",
          borderColor: error
            ? theme.palette.error.main
            : mine
            ? alpha("#ffffff", 0.16)
            : alpha(theme.palette.primary.main, 0.1),
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
            {label}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            {pending ? <CircularProgress size={14} color={mine ? "inherit" : "primary"} /> : null}
            {error ? (
              <Chip
                size="small"
                label="出错"
                color="error"
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

        {pending && !content ? (
          <Stack spacing={0.75} alignItems="flex-start">
            <TypingDots mine={mine} />
            <Typography
              variant="body2"
              sx={{ color: mine ? alpha("#ffffff", 0.82) : "text.secondary" }}
            >
              正在生成回复…
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
              "& img": {
                maxWidth: "100%",
              },
              "& p": {
                m: 0,
              },
              "& p + p": {
                mt: 1.25,
              },
              "& ul, & ol": {
                pl: 2.5,
                my: 0.75,
              },
              "& li + li": {
                mt: 0.5,
              },
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
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </Markdown>
          </Box>
        )}
      </Box>
    </Stack>
  );
}

export default function FileAIChatModal({
  open,
  title,
  messages,
  loading,
  onClose,
  onSend,
  dialogTitle = "AI 文件会话",
  dialogDescription = "围绕同一个文件持续追问，AI 会带着当前文件上下文继续回答。",
  contextLabel = "当前文件",
  emptyText = "正在为当前文件创建第一条 AI 总结消息。",
  inputPlaceholder = "继续追问这份文件，例如：这份作业的评分点是什么？有没有截止时间或提交格式要求？",
  footerIdleText = "提问会保留在当前会话中，后续回答会继续参考这份上下文。",
  markdownComponents,
}: {
  open: boolean;
  title: string;
  messages: FileAIChatMessage[];
  loading: boolean;
  onClose: () => void;
  onSend: (message: string) => Promise<void> | void;
  dialogTitle?: string;
  dialogDescription?: string;
  contextLabel?: string;
  emptyText?: string;
  inputPlaceholder?: string;
  footerIdleText?: string;
  markdownComponents?: Components;
}) {
  const theme = useTheme();
  const [input, setInput] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  useEffect(() => {
    if (!open) {
      setInput("");
    }
  }, [open]);

  useEffect(() => {
    if (!bodyRef.current) {
      return;
    }
    if (!shouldStickToBottomRef.current) {
      return;
    }
    bodyRef.current.scrollTo({
      top: bodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  const handleScroll = () => {
    if (!bodyRef.current) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = bodyRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    shouldStickToBottomRef.current = distanceFromBottom < 80;
  };

  const handleSubmit = async () => {
    const nextInput = input.trim();
    if (!nextInput || loading) {
      return;
    }
    setInput("");
    await onSend(nextInput);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{
        sx: {
          borderRadius: "32px",
          overflow: "hidden",
          minHeight: { md: "78vh" },
        },
      }}
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack spacing={1.25}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {dialogTitle}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {dialogDescription}
              </Typography>
            </Box>
            <Chip
              icon={<SmartToyRoundedIcon />}
              label={loading ? "AI 正在回复" : "可继续追问"}
              color={loading ? "warning" : "primary"}
              variant="outlined"
            />
          </Stack>
          <Box
            sx={{
              p: 1.5,
              borderRadius: "18px",
              bgcolor: alpha(theme.palette.primary.main, 0.06),
              border: "1px solid",
              borderColor: alpha(theme.palette.primary.main, 0.12),
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {contextLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {title}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          display: "grid",
          gridTemplateRows: "minmax(0, 1fr) auto",
          gap: 2,
          p: 0,
        }}
      >
        <Box
          ref={bodyRef}
          onScroll={handleScroll}
          sx={{
            px: { xs: 2, md: 3 },
            py: 2.5,
            overflowY: "auto",
            bgcolor: alpha(theme.palette.background.default, 0.58),
          }}
        >
          {messages.length > 0 ? (
            <Stack spacing={2.2}>
              {loading ? (
                <Box
                  sx={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    display: "flex",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <Chip
                    icon={<SmartToyRoundedIcon />}
                    label="AI 正在流式生成中"
                    color="warning"
                    sx={{
                      height: 32,
                      backdropFilter: "blur(10px)",
                      bgcolor: alpha(theme.palette.background.paper, 0.92),
                      border: "1px solid",
                      borderColor: alpha(theme.palette.warning.main, 0.28),
                      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
                    }}
                  />
                </Box>
              ) : null}
              {messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  {...message}
                  markdownComponents={markdownComponents}
                />
              ))}
            </Stack>
          ) : (
            <Stack
              spacing={1.25}
              alignItems="center"
              justifyContent="center"
              sx={{ minHeight: 280, textAlign: "center" }}
            >
              <SmartToyRoundedIcon sx={{ fontSize: 40, color: "text.secondary" }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                会话即将开始
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {emptyText}
              </Typography>
            </Stack>
          )}
        </Box>

        <Box sx={{ px: { xs: 2, md: 3 }, pb: 2.5 }}>
          <Stack spacing={1.25}>
            <TextField
              multiline
              minRows={3}
              maxRows={8}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={inputPlaceholder}
              disabled={loading}
            />
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" color="text.secondary">
                {loading
                  ? "AI 正在边生成边返回内容；如果你向上翻阅历史，界面会暂时停止自动跟随。"
                  : footerIdleText}
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
      </DialogContent>
    </Dialog>
  );
}
