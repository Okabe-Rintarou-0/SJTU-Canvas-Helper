import { invoke } from "@tauri-apps/api/core";
import DocViewer, { IDocument } from "@cyntler/react-doc-viewer";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";

import { File } from "../lib/model";
import {
  canConvertFileToPdf,
  getPdfFileName,
  isPdfFile,
  isPowerPointFile,
} from "../lib/file_conversion";
import { getFileType } from "../lib/utils";
import { BasicRenderers } from "./renderers";

const localDocumentCache = new Map<string, Promise<IDocument>>();

async function resolveLocalDocument(file: File): Promise<IDocument> {
  const cacheKey = `${file.display_name}|${file.url}`;
  const cached = localDocumentCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    if (isPowerPointFile(file)) {
      const content = await invoke<number[]>("convert_pptx_to_pdf", { file });
      const pdfBlob = new Blob([new Uint8Array(content).buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      return {
        uri: URL.createObjectURL(pdfBlob),
        fileName: getPdfFileName(file.display_name),
        fileType: "pdf",
      } satisfies IDocument;
    }

    const fileType = await getFileType(file.display_name);
    return {
      uri: file.url,
      fileName: file.display_name,
      fileType,
    } satisfies IDocument;
  })();

  localDocumentCache.set(cacheKey, task);
  void task.catch(() => localDocumentCache.delete(cacheKey));
  return task;
}

function isCanvasPreview(file: File) {
  return file.id > 0 && !file.external_type && !file.url?.startsWith("blob:") &&
    (canConvertFileToPdf(file) || isPdfFile(file));
}

function previewBounds(element: HTMLElement) {
  const { left, top, width, height } = element.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  return {
    x: Math.round(left * scale),
    y: Math.round(top * scale),
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function mountCanvasPreview(file: File, slot: HTMLElement) {
  const previewId = crypto.randomUUID();
  let bounds = previewBounds(slot);
  const ready = invoke<void>("open_embedded_file_preview", { fileId: file.id, previewId, bounds });
  let closed = false;
  let frame = 0;
  const scheduleResize = () => {
    if (closed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = previewBounds(slot);
      if (next.x === bounds.x && next.y === bounds.y && next.width === bounds.width && next.height === bounds.height) return;
      bounds = next;
      void invoke("resize_embedded_file_preview", { previewId, bounds }).catch(() => undefined);
    });
  };
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(scheduleResize);
  void ready.then(() => {
    if (closed) return;
    observer?.observe(slot);
    window.addEventListener("resize", scheduleResize);
    scheduleResize();
  }, () => undefined);
  return {
    ready,
    close: () => {
      closed = true;
      observer?.disconnect();
      window.removeEventListener("resize", scheduleResize);
      if (frame) cancelAnimationFrame(frame);
      void ready.then(() => invoke("close_embedded_file_preview", { previewId })).catch(() => undefined);
    },
  };
}

export default function PreviewModal({
  open,
  files,
  handleCancelPreview,
  title,
  footer,
  bodyStyle,
}: {
  open: boolean;
  files: File[];
  handleCancelPreview?: () => void;
  title?: string;
  footer?: ReactNode;
  bodyStyle?: CSSProperties;
}) {
  const theme = useTheme();
  const [docs, setDocs] = useState<IDocument[]>([]);
  const [canvasSlot, setCanvasSlot] = useState<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onlineFile = files.length === 1 && isCanvasPreview(files[0]) ? files[0] : undefined;

  useEffect(() => {
    if (!open || !files.length || (onlineFile && !canvasSlot)) return;
    let cancelled = false;
    setDocs([]);
    setLoadError(null);
    setLoading(true);
    const canvas = onlineFile && canvasSlot ? mountCanvasPreview(onlineFile, canvasSlot) : undefined;
    void (async () => {
      try {
        if (canvas && onlineFile) {
          try {
            await canvas.ready;
            return;
          } catch (error) {
            if (cancelled) return;
            if (!isPowerPointFile(onlineFile) && !isPdfFile(onlineFile)) throw error;
          }
        }
        const documents = await Promise.all(files.map(resolveLocalDocument));
        if (!cancelled) setDocs(documents);
      } catch (error) {
        if (!cancelled) setLoadError(String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      canvas?.close();
    };
  }, [open, files, onlineFile, canvasSlot]);

  const viewer = useMemo(() => {
    const body = bodyStyle ?? { height: "78vh", marginTop: "0px" };
    const key = files.map((file) => file.url).join("|");

    return (
      <DocViewer
        style={body}
        key={key}
        config={{
          header: {
            disableFileName: true,
            retainURLParams: true,
          },
        }}
        pluginRenderers={BasicRenderers}
        documents={docs}
      />
    );
  }, [bodyStyle, docs, files]);

  return (
    <Dialog
      open={open}
      onClose={handleCancelPreview}
      fullWidth
      maxWidth={false}
      PaperProps={{
        sx: {
          width: "92vw",
          maxWidth: "1400px",
          height: "88vh",
          maxHeight: "88vh",
          borderRadius: "30px",
          overflow: "hidden",
          bgcolor:
            theme.palette.mode === "dark"
              ? alpha(theme.palette.background.paper, 0.96)
              : alpha("#ffffff", 0.96),
          boxShadow:
            theme.palette.mode === "dark"
              ? "0 30px 90px rgba(2,8,23,0.55)"
              : "0 30px 90px rgba(15,23,42,0.18)",
          backdropFilter: "blur(18px)",
        },
      }}
    >
      <DialogTitle
        sx={{
          px: 3,
          py: 2.25,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "16px",
                display: "grid",
                placeItems: "center",
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: "primary.main",
                flexShrink: 0,
              }}
            >
              <InsertDriveFileRoundedIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
                {title || "文件预览"}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                共 {files.length} 个文件，可使用键盘左右键切换
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={`${files.length} 份文档`}
              variant="outlined"
              color="primary"
            />
            <IconButton aria-label="关闭文件预览" onClick={handleCancelPreview}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
        </Stack>
      </DialogTitle>

      <DialogContent
        dividers={false}
        sx={{
          px: 0,
          py: 0,
          position: "relative",
          overflowY: onlineFile && !docs.length ? "hidden" : "auto",
          bgcolor:
            theme.palette.mode === "dark"
              ? alpha("#020617", 0.28)
              : alpha("#eff6ff", 0.42),
        }}
      >
        {onlineFile && <Box ref={setCanvasSlot} aria-label="Canvas 在线预览" sx={{ position: "absolute", inset: 0, pointerEvents: "none" }} />}
        {loading ? (
          <Stack spacing={2} alignItems="center" justifyContent="center" sx={{ height: "100%" }}>
            <CircularProgress />
            <Typography color="text.secondary">
              {onlineFile ? "正在连接 Canvas 在线预览…" : "正在准备预览…"}
            </Typography>
          </Stack>
        ) : loadError ? (
          <Box sx={{ p: 3 }}>
            <Alert severity="error">
              文件预览失败：{loadError}
            </Alert>
          </Box>
        ) : docs.length > 0 ? (
          <Box>{viewer}</Box>
        ) : null}
      </DialogContent>
      {footer ? (
        <Box
          sx={{
            px: 3,
            py: 2,
            borderTop: "1px solid",
            borderColor: "divider",
            bgcolor: alpha(theme.palette.background.paper, 0.72),
          }}
        >
          {footer}
        </Box>
      ) : null}
    </Dialog>
  );
}
