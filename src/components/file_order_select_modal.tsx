import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  InputAdornment,
  TextField,
  Typography,
  Stack,
} from "@mui/material";
import { useEffect, useState } from "react";

import { DraggableItem, File } from "../lib/model";
import DraggableList from "./draggable_list";

export default function FileOrderSelectModal({
  files,
  open,
  handleOk,
  handleCancel,
}: {
  files: File[];
  open: boolean;
  handleOk: (files: File[], name: string) => void;
  handleCancel: () => void;
}) {
  const [items, setItems] = useState<DraggableItem[]>([]);
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    if (!open) return;
    setFileName("");
    setItems(
      files.map((file) => ({
        id: file.id.toString(),
        content: file.display_name,
        data: file,
      }))
    );
  }, [files, open]);

  const confirm = () => {
    if (items.length < 2) return;
    const base = fileName.trim().replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "_").replace(/[ .]+$/, "");
    handleOk(items.map((item) => item.data as File), (base || "merged_" + Date.now()) + ".pdf");
  };

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          borderRadius: "28px",
        },
      }}
    >
      <DialogTitle>合并文档</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField label="输出文件名" placeholder="留空使用默认文件名" value={fileName}
            onChange={(event) => setFileName(event.target.value)} fullWidth autoFocus
            slotProps={{ input: { endAdornment: <InputAdornment position="end">.pdf</InputAdornment> } }}
          />
          <Typography variant="body2" color="text.secondary">拖动文件以调整合并顺序。</Typography>
          <DraggableList items={items} onDragEnd={setItems} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={handleCancel}>取消</Button>
        <Button variant="contained" disabled={items.length < 2} onClick={confirm}>
          开始合并
        </Button>
      </DialogActions>
    </Dialog>
  );
}
