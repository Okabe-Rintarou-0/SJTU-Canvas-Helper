import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Avatar,
  Box,
  Button,
  Divider,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useRef } from "react";

import { useBaseURL } from "../lib/hooks";
import { AppMessageApi } from "../lib/message";
import { Attachment, Entry, LOG_LEVEL_ERROR, User } from "../lib/model";
import { attachmentToFile, consoleLog, formatDate } from "../lib/utils";

export default function CommentPanel({
  attachment,
  assignmentId,
  courseId,
  showInput,
  me,
  onRefresh,
  onFocus,
  onBlur,
  onHoverEntry,
  onLeaveEntry,
  messageApi,
}: {
  attachment: Attachment;
  assignmentId: number;
  courseId: number;
  showInput: boolean;
  me?: User;
  onRefresh?: (userId: number) => Promise<void>;
  onFocus?: () => void;
  onBlur?: () => void;
  onHoverEntry?: (entry: Entry) => void;
  onLeaveEntry?: () => void;
  onPreviewEntry?: (entry: Entry) => void;
  messageApi: AppMessageApi;
}) {
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  const baseURL = useBaseURL();

  const handleCommentSubmission = async (currentAttachment: Attachment) => {
    const comment = commentInputRef.current?.value;
    if (!comment) {
      messageApi.warning("评论不得为空！");
      return;
    }
    try {
      await invoke("update_grade", {
        courseId,
        assignmentId,
        studentId: currentAttachment.user_id,
        grade: currentAttachment.grade ?? "",
        comment,
      });
      messageApi.success("评论成功！🎉", 0.5);
      if (commentInputRef.current) {
        commentInputRef.current.value = "";
      }
      await onRefresh?.(currentAttachment.user_id);
    } catch (e) {
      consoleLog(LOG_LEVEL_ERROR, e);
      messageApi.error(e as string);
    }
  };

  const handleDeleteComment = async (commentId: number, currentAttachment: Attachment) => {
    try {
      await invoke("delete_submission_comment", {
        courseId,
        assignmentId,
        studentId: currentAttachment.user_id,
        commentId,
      });
      await onRefresh?.(currentAttachment.user_id);
      messageApi.success("删除成功！🎉", 0.5);
    } catch (e) {
      consoleLog(LOG_LEVEL_ERROR, e);
      messageApi.error(e as string);
    }
  };

  return (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">评论区</Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshRoundedIcon />}
          onClick={() => onRefresh?.(attachment.user_id)}
        >
          刷新评论
        </Button>
      </Stack>

      {attachment.comments.length > 0 ? (
        <>
          <Divider />
          <List sx={{ width: "100%" }}>
            {attachment.comments.map((comment) => (
              <ListItem
                key={comment.id}
                alignItems="flex-start"
                disableGutters
                secondaryAction={
                  comment.author_id === me?.id ? (
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteOutlineRoundedIcon />}
                      onClick={() => void handleDeleteComment(comment.id, attachment)}
                    >
                      删除
                    </Button>
                  ) : undefined
                }
                sx={{
                  px: 0,
                  py: 1.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  alignItems: "flex-start",
                }}
              >
                <ListItemAvatar>
                  <Avatar src={baseURL.data + comment.avatar_path} />
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle2">{comment.author_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatDate(comment.created_at)}
                      </Typography>
                    </Stack>
                  }
                  secondary={
                    <Stack spacing={1} sx={{ mt: 0.75 }}>
                      <Typography variant="body2" color="text.primary">
                        {comment.comment}
                      </Typography>
                      {comment.attachments.length > 0 ? (
                        <Stack direction="row" spacing={1} flexWrap="wrap">
                          {comment.attachments.map((commentAttachment) => (
                            <Box
                              key={commentAttachment.id}
                              component="a"
                              href={commentAttachment.preview_url}
                              onMouseEnter={() =>
                                onHoverEntry?.(attachmentToFile(commentAttachment))
                              }
                              onMouseLeave={() => onLeaveEntry?.()}
                              sx={{
                                color: "primary.main",
                                textDecoration: "none",
                                fontSize: 14,
                              }}
                            >
                              {commentAttachment.display_name}
                            </Box>
                          ))}
                        </Stack>
                      ) : null}
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        </>
      ) : null}

      {showInput ? (
        <>
          <Divider />
          <TextField
            multiline
            minRows={3}
            placeholder="请输入评论"
            inputRef={commentInputRef}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <Button variant="contained" onClick={() => void handleCommentSubmission(attachment)}>
            发表评论
          </Button>
        </>
      ) : null}
    </Stack>
  );
}
