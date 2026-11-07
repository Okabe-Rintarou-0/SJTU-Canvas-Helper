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
import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { File } from "../lib/model";
import {
  canConvertFileToPdf,
  getPdfFileName,
  isPdfFile,
  isPowerPointFile,
} from "../lib/file_conversion";
import { getFileType } from "../lib/utils";
import { BasicRenderers } from "./renderers";
import { isSessionCurrent, subscribeSession, useSessionEpoch } from "../lib/session";
import { PreviewSessionContext } from "../lib/preview_session";

type ResolvedPreview =
  | { kind: "document"; document: IDocument }
  | { kind: "window" };

interface PreviewLifetime {
  owns: () => boolean;
  urls: Set<string>;
}

function requireOwner(lifetime: PreviewLifetime) {
  if (!lifetime.owns()) throw new Error("Preview session expired");
}

async function resolveLocalDocument(file: File, lifetime: PreviewLifetime): Promise<IDocument> {
  requireOwner(lifetime);
  if (isPowerPointFile(file)) {
    const content = await invoke<number[]>("convert_pptx_to_pdf", { file });
    requireOwner(lifetime);
    const pdfBlob = new Blob([new Uint8Array(content).buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    const uri = URL.createObjectURL(pdfBlob);
    lifetime.urls.add(uri);
    return { uri, fileName: getPdfFileName(file.display_name), fileType: "pdf" };
  }

  const fileType = await getFileType(file.display_name);
  requireOwner(lifetime);
  return { uri: file.url, fileName: file.display_name, fileType };
}

async function resolvePreview(file: File, lifetime: PreviewLifetime): Promise<ResolvedPreview> {
  requireOwner(lifetime);
  if (file.url?.startsWith("blob:")) {
    return { kind: "document", document: await resolveLocalDocument(file, lifetime) };
  }
  if (canConvertFileToPdf(file) || isPdfFile(file)) {
    try {
      await invoke("open_file_preview_window", { fileId: file.id, title: file.display_name });
      requireOwner(lifetime);
      return { kind: "window" };
    } catch (onlinePreviewError) {
      requireOwner(lifetime);
      if (!isPowerPointFile(file) && !isPdfFile(file)) throw onlinePreviewError;
      return { kind: "document", document: await resolveLocalDocument(file, lifetime) };
    }
  }
  return { kind: "document", document: await resolveLocalDocument(file, lifetime) };
}

export default function PreviewModal({
  ownerSession,
  open,
  files,
  handleCancelPreview,
  title,
  footer,
  bodyStyle,
}: {
  ownerSession: number;
  open: boolean;
  files: File[];
  handleCancelPreview?: () => void;
  title?: string;
  footer?: ReactNode;
  bodyStyle?: CSSProperties;
}) {
  const theme = useTheme();
  const session = useSessionEpoch();
  const request = useMemo(() => ({ files, ownerSession, open }), [files, ownerSession, open]);
  const [resolved, setResolved] = useState<{ request: typeof request; previews: ResolvedPreview[] }>();
  const previews = useMemo(() => resolved?.request === request ? resolved.previews : [], [resolved, request]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cancelPreviewRef = useRef(handleCancelPreview);
  useLayoutEffect(() => { cancelPreviewRef.current = handleCancelPreview; }, [handleCancelPreview]);

  useEffect(() => {
    if (!open || files.length === 0 || !isSessionCurrent(ownerSession)) return;
    let cancelled = false;
    const urls = new Set<string>();
    const lifetime = { owns: () => !cancelled && isSessionCurrent(ownerSession), urls };
    const stop = () => {
      cancelled = true;
      urls.forEach((uri) => URL.revokeObjectURL(uri));
      urls.clear();
    };
    const unsubscribe = subscribeSession(() => {
      if (isSessionCurrent(ownerSession)) return;
      stop();
      setResolved(undefined);
      setLoading(false);
    });
    setResolved(undefined);
    setLoadError(null);
    setLoading(true);
    void (async () => {
      try {
        const nextPreviews = await Promise.all(files.map((file) => resolvePreview(file, lifetime)));
        if (lifetime.owns()) {
          if (nextPreviews.some((preview) => preview.kind === "window")) cancelPreviewRef.current?.();
          else setResolved({ request, previews: nextPreviews });
        }
      } catch (error) {
        if (lifetime.owns()) {
          setLoadError(String(error));
          setLoading(false);
          stop();
        }
      } finally {
        if (lifetime.owns()) setLoading(false);
      }
    })();
    return () => { unsubscribe(); stop(); };
  }, [files, open, ownerSession, request]);

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

  if (!open || session !== ownerSession) return null;

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
          <PreviewSessionContext.Provider value={ownerSession}><Box>{viewer}</Box></PreviewSessionContext.Provider>
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
