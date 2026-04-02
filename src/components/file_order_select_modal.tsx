import {
  Alert,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
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
  handleOk: (items: DraggableItem[]) => void;
  handleCancel: () => void;
}) {
  const [items, setItems] = useState<DraggableItem[]>([]);

  useEffect(() => {
    setItems(
      files.map((file) => ({
        id: file.id.toString(),
        content: file.display_name,
        data: file,
      }))
    );
  }, [files]);

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
      <DialogTitle>指定合并顺序</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info" sx={{ borderRadius: "16px" }}>
            您可以拖拽文件名称以调整合并顺序。
          </Alert>
          <DraggableList items={items} onDragEnd={setItems} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={handleCancel}>取消</Button>
        <Button variant="contained" onClick={() => handleOk(items)}>
          确认顺序
        </Button>
      </DialogActions>
    </Dialog>
  );
}
