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

type ResolvedPreview =
  | { kind: "document"; document: IDocument }
  | { kind: "window" };

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

async function resolvePreview(file: File): Promise<ResolvedPreview> {
  if (file.url?.startsWith("blob:")) {
    return { kind: "document", document: await resolveLocalDocument(file) };
  }
  if (canConvertFileToPdf(file) || isPdfFile(file)) {
    try {
      await invoke("open_file_preview_window", {
        fileId: file.id,
        title: file.display_name,
      });
      return { kind: "window" };
    } catch (onlinePreviewError) {
      if (!isPowerPointFile(file) && !isPdfFile(file)) {
        throw onlinePreviewError;
      }

      return {
        kind: "document",
        document: await resolveLocalDocument(file),
      };
    }
  }

  return { kind: "document", document: await resolveLocalDocument(file) };
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
  const [previews, setPreviews] = useState<ResolvedPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || files.length === 0) {
      return;
    }

    let cancelled = false;
    setPreviews([]);
    setLoadError(null);
    setLoading(true);
    void (async () => {
      try {
        const nextPreviews = await Promise.all(
          files.map((file) => resolvePreview(file))
        );
        if (!cancelled) {
          if (nextPreviews.some((preview) => preview.kind === "window")) {
            handleCancelPreview?.();
          } else {
            setPreviews(nextPreviews);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, handleCancelPreview, open]);

  const docs = useMemo(
    () =>
      previews.flatMap((preview) =>
        preview.kind === "document" ? [preview.document] : []
      ),
    [previews]
  );
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
              label={`${previews.length || files.length} 份文档`}
              variant="outlined"
              color="primary"
            />
            <IconButton onClick={handleCancelPreview}>
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
          overflowY: "auto",
          bgcolor:
            theme.palette.mode === "dark"
              ? alpha("#020617", 0.28)
              : alpha("#eff6ff", 0.42),
        }}
      >
        {loading ? (
          <Stack spacing={2} alignItems="center" justifyContent="center" sx={{ minHeight: 480 }}>
            <CircularProgress />
            <Typography color="text.secondary">
              {files.some(
                (file) => canConvertFileToPdf(file) || isPdfFile(file)
              )
                ? "正在连接 Canvas 在线预览…"
                : "正在准备预览…"}
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
      </DialogContent>
    </Dialog>
  );
}
