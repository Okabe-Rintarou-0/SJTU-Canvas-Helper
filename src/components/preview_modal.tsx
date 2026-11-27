import { invoke } from "@tauri-apps/api/core";
import DocViewer, { type IDocument } from "@cyntler/react-doc-viewer";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { File } from "../lib/model";
import {
  canConvertFileToPdf,
  getPdfFileName,
  isPdfFile,
} from "../lib/file_conversion";
import { getFileType } from "../lib/utils";
import { PreviewErrorContext } from "./preview_error";
import {
  createPreviewRenderers,
  fetchPreviewSample,
  isPreviewText,
  knownPreviewType,
  textPreviewType,
} from "./preview_file_loader";
import PreviewUnavailable from "./preview_unavailable";
import { BasicRenderers } from "./renderers";

type PreviewMode = "canvas" | "local";
type PreviewAttempt = {
  mode: PreviewMode;
  failed: PreviewMode[];
  exhausted?: boolean;
};

function needsOfficeConversion(file: File) {
  return /\.(?:doc|ppt)$/i.test(file.display_name);
}

async function resolveLocalDocument(file: File, signal: AbortSignal, objectUrls: string[]): Promise<IDocument> {
  if (!file.url) throw new Error("File URL unavailable");
  if (needsOfficeConversion(file)) {
    const content = await invoke<number[]>("convert_pptx_to_pdf", { file });
    signal.throwIfAborted();
    const uri = URL.createObjectURL(new Blob([Uint8Array.from(content)], { type: "application/pdf" }));
    objectUrls.push(uri);
    return { uri, fileName: getPdfFileName(file.display_name), fileType: "pdf" };
  }

  const extension = isPdfFile(file) ? "pdf" : await getFileType(file.display_name);
  let fileType = knownPreviewType(extension, file["content-type"] ?? "", BasicRenderers);
  let uri = file.url;
  const canReadThroughCanvas = file.id > 0 && !file.external_type && /^https?:\/\//i.test(uri);

  if (!fileType && file.external_type !== "Link") {
    const canvasSample = canReadThroughCanvas
      ? await invoke<ArrayBuffer>("read_canvas_preview_file", { fileId: file.id, sampleOnly: true }).catch(() => undefined)
      : undefined;
    signal.throwIfAborted();
    const sample = canvasSample === undefined
      ? await fetchPreviewSample(uri, signal).catch(() => undefined)
      : new Uint8Array(canvasSample);
    signal.throwIfAborted();
    if (sample && isPreviewText(sample)) fileType = "txt";
  }

  if (fileType && textPreviewType(fileType) && canReadThroughCanvas) {
    // Canvas download redirects can be blocked by the WebView's cross-origin policy.
    const content = await invoke<ArrayBuffer>("read_canvas_preview_file", { fileId: file.id })
      .catch(() => undefined);
    signal.throwIfAborted();
    if (content !== undefined) {
      uri = URL.createObjectURL(new Blob([content]));
      objectUrls.push(uri);
    }
  }
  return { uri, fileName: file.display_name, fileType: fileType ?? extension };
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
  const opening = invoke<void>("open_embedded_file_preview", { fileId: file.id, previewId, bounds });
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
  const ready = opening.then(async () => {
    if (closed) return;
    bounds = previewBounds(slot);
    await invoke("resize_embedded_file_preview", { previewId, bounds });
    if (closed) return;
    observer?.observe(slot);
    window.addEventListener("resize", scheduleResize);
    scheduleResize();
  });
  return {
    ready,
    close: () => {
      closed = true;
      observer?.disconnect();
      window.removeEventListener("resize", scheduleResize);
      if (frame) cancelAnimationFrame(frame);
      void opening.then(() => invoke("close_embedded_file_preview", { previewId })).catch(() => undefined);
    },
  };
}

interface PreviewModalProps {
  open: boolean;
  files: File[];
  handleCancelPreview?: () => void;
  title?: string;
  footer?: ReactNode;
  bodyStyle?: CSSProperties;
}

export default function PreviewModal(props: PreviewModalProps) {
  const key = JSON.stringify(props.files.map(({ id, display_name, url }) => [id, display_name, url]));
  return <PreviewDialog key={key} {...props} />;
}

function PreviewDialog({ open, files, handleCancelPreview, title, footer, bodyStyle }: PreviewModalProps) {
  const theme = useTheme();
  const primaryFile = files[0];
  const onlineFile = files.length === 1 && isCanvasPreview(primaryFile) ? primaryFile : undefined;
  const [canvasSlot, setCanvasSlot] = useState<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState<PreviewAttempt>(() => ({
    mode: onlineFile && /\.doc$/i.test(onlineFile.display_name) ? "canvas" : "local",
    failed: [],
  }));
  const [loaded, setLoaded] = useState<{ attempt: PreviewAttempt; docs: IDocument[] }>();
  const ready = loaded?.attempt === attempt;
  const showCanvas = attempt.mode === "canvas" && !attempt.exhausted;
  const docs = ready ? loaded.docs : undefined;

  const fail = useCallback((mode: PreviewMode) => {
    setAttempt((current) => {
      if (current.mode !== mode || current.exhausted) return current;
      const failed = [...current.failed, mode];
      const alternative = mode === "canvas" ? "local" : "canvas";
      if (!failed.includes(alternative) && (alternative === "local" || onlineFile)) {
        return { mode: alternative, failed };
      }
      return { ...current, failed, exhausted: true };
    });
  }, [onlineFile]);
  const failLocal = useCallback(() => fail("local"), [fail]);
  const renderers = useMemo(() => createPreviewRenderers(BasicRenderers, failLocal), [failLocal]);

  useEffect(() => {
    if (!open || !showCanvas || !onlineFile || !canvasSlot) return;
    let active = true;
    const canvas = mountCanvasPreview(onlineFile, canvasSlot);
    void canvas.ready.then(() => {
      if (active) setLoaded({ attempt, docs: [] });
    }).catch(() => { if (active) fail("canvas"); });
    return () => { active = false; canvas.close(); };
  }, [open, showCanvas, onlineFile, canvasSlot, attempt, fail]);

  useEffect(() => {
    if (!open || !files.length || attempt.mode !== "local" || attempt.exhausted) return;
    const controller = new AbortController();
    const objectUrls: string[] = [];
    void Promise.all(files.map((file) => resolveLocalDocument(file, controller.signal, objectUrls)))
      .then((docs) => { if (!controller.signal.aborted) setLoaded({ attempt, docs }); })
      .catch(() => { if (!controller.signal.aborted) failLocal(); });
    return () => {
      controller.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [open, files, attempt, failLocal]);

  const switchMode = () => {
    setAttempt(({ mode, failed }) => {
      const next = mode === "canvas" ? "local" : "canvas";
      return { mode: next, failed: failed.filter((value) => value !== next) };
    });
  };

  const viewerConfig = useMemo(() => ({
    header: { disableHeader: files.length === 1, disableFileName: true, retainURLParams: true },
    noRenderer: { overrideComponent: PreviewUnavailable },
  }), [files.length]);

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
          "& [data-preview-surface]": { border: 0, borderRadius: 0 },
        },
      }}
    >
      <DialogTitle
        sx={{
          px: 3,
          py: 1.25,
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
              {files.length > 1 && <Typography variant="body2" color="text.secondary" noWrap>
                共 {files.length} 个文件
              </Typography>}
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            {onlineFile && (
              <Button size="small" onClick={switchMode} sx={{ flexShrink: 0 }}>
                {attempt.mode === "canvas" ? "使用内置预览" : "使用 Canvas 预览"}
              </Button>
            )}
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
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
          bgcolor:
            theme.palette.mode === "dark"
              ? alpha("#020617", 0.28)
              : alpha("#eff6ff", 0.42),
        }}
      >
        {showCanvas && <Box ref={setCanvasSlot} aria-label="Canvas 在线预览" sx={{ position: "absolute", inset: 0, pointerEvents: "none" }} />}
        {attempt.exhausted ? (
          <PreviewUnavailable
            fileName={primaryFile?.display_name ?? ""}
            document={primaryFile?.url ? { uri: primaryFile.url } : undefined}
            failed
          />
        ) : !ready ? (
          <Stack spacing={2} alignItems="center" justifyContent="center" sx={{ flex: 1 }}>
            <CircularProgress />
            <Typography color="text.secondary">
              {showCanvas
                ? "正在连接 Canvas 在线预览…"
                : primaryFile && /\.ppt$/i.test(primaryFile.display_name)
                  ? "正在将旧版 PowerPoint 转换为 PDF…"
                  : "正在准备预览…"}
            </Typography>
          </Stack>
        ) : docs?.length ? (
          <PreviewErrorContext.Provider value={failLocal}>
            <DocViewer
              style={{ flex: 1, minHeight: 0, backgroundColor: "transparent", ...bodyStyle }}
              config={viewerConfig}
              pluginRenderers={renderers}
              documents={docs}
            />
          </PreviewErrorContext.Provider>
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
