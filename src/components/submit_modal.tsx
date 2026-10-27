import UploadRoundedIcon from "@mui/icons-material/UploadRounded";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { path } from "@tauri-apps/api";
import { invoke } from "@tauri-apps/api/core";
import { DialogFilter, open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { useAppMessage } from "../lib/message";

interface SubmitParam {
  filePaths: string[];
  comment?: string;
}

function FilesSelector({
  value,
  onChange,
  allowed_extensions,
}: {
  allowed_extensions: string[];
  value?: string[];
  onChange?: (value: string[]) => void;
}) {
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [fileBaseNames, setFileBaseNames] = useState<string[]>([]);
  const [messageApi] = useAppMessage();

  useEffect(() => {
    setFilePaths(value ?? []);
  }, [value]);

  useEffect(() => {
    Promise.all(filePaths.map(async (filePath) => path.basename(filePath))).then(
      (names) => setFileBaseNames(names)
    );
  }, [filePaths]);

  const handleSelectFiles = async () => {
    const filters: DialogFilter[] = allowed_extensions.length
      ? [
          {
            name: `所有文件(${allowed_extensions.join(",")})`,
            extensions: allowed_extensions,
          },
          ...allowed_extensions.map((extension) => ({
            name: extension,
            extensions: [extension],
          })),
        ]
      : [{ name: "所有文件(*)", extensions: ["*"] }];

    const selected = await open({ multiple: true, filters });
    if (selected == null) {
      messageApi.warning("未选中文件⚠️！", 1);
      return;
    }

    const nextPaths = [...filePaths, ...(Array.isArray(selected) ? selected : [selected])];
    setFilePaths(nextPaths);
    onChange?.(nextPaths);
  };

  const handleRemove = (index: number) => {
    const nextPaths = filePaths.filter((_, currentIndex) => currentIndex !== index);
    setFilePaths(nextPaths);
    onChange?.(nextPaths);
  };

  return (
    <Stack spacing={2}>
      <Button variant="outlined" startIcon={<UploadRoundedIcon />} onClick={handleSelectFiles}>
        选择上传文件
      </Button>
      <List dense sx={{ border: "1px solid", borderColor: "divider", borderRadius: "18px" }}>
        {fileBaseNames.length > 0 ? (
          fileBaseNames.map((fileBaseName, index) => (
            <ListItem
              key={`${fileBaseName}-${index}`}
              secondaryAction={
                <Button color="error" size="small" onClick={() => handleRemove(index)}>
                  删除
                </Button>
              }
            >
              <ListItemText primary={fileBaseName} />
            </ListItem>
          ))
        ) : (
          <ListItem>
            <ListItemText primary="暂未选择任何文件" />
          </ListItem>
        )}
      </List>
    </Stack>
  );
}

export function SubmitModal({
  open: visible,
  onCancel,
  onSubmit,
  allowed_extensions,
  courseId,
  assignmentId,
}: {
  open: boolean;
  allowed_extensions: string[];
  courseId: number;
  assignmentId: number;
  onCancel?: () => void;
  onSubmit?: () => void;
}) {
  const [messageApi] = useAppMessage();
  const [formData, setFormData] = useState<SubmitParam>({ filePaths: [], comment: "" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) {
      setFormData({ filePaths: [], comment: "" });
      setSubmitting(false);
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (formData.filePaths.length === 0) {
      messageApi.warning("请至少上传一个文件");
      return;
    }

    try {
      setSubmitting(true);
      messageApi.open({
        key: "submitting",
        type: "loading",
        content: "正在提交中，请耐心等待...",
      });
      await invoke("submit_assignment", {
        courseId,
        assignmentId,
        filePaths: formData.filePaths,
        comment: formData.comment || undefined,
      });
      messageApi.destroy("submitting");
      messageApi.success("提交成功");
      onSubmit?.();
    } catch (e) {
      messageApi.destroy("submitting");
      messageApi.error(`提交失败：${e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={visible} onClose={onCancel} fullWidth maxWidth="md">
      <DialogTitle>提交作业</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">文件</Typography>
            <FilesSelector
              allowed_extensions={allowed_extensions}
              value={formData.filePaths}
              onChange={(filePaths) => setFormData((prev) => ({ ...prev, filePaths }))}
            />
          </Stack>
          <TextField
            label="评论"
            placeholder="输入评论"
            multiline
            minRows={4}
            value={formData.comment ?? ""}
            onChange={(event) =>
              setFormData((prev) => ({ ...prev, comment: event.target.value }))
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={submitting}>
          提交
        </Button>
      </DialogActions>
    </Dialog>
  );
}
