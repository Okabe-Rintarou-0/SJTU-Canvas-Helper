import DocViewer, { IDocument } from "@cyntler/react-doc-viewer";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import { pdfjs } from "react-pdf";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.js?url";

import { File } from "../lib/model";
import { getFileType } from "../lib/utils";
import { BasicRenderers } from "./renderers";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const docTypeCache = new Map<string, Promise<IDocument>>();

async function resolveDocument(file: File): Promise<IDocument> {
  const cacheKey = `${file.display_name}|${file.url}`;
  const cached = docTypeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    const fileType = await getFileType(file.display_name);
    return {
      uri: file.url,
      fileName: file.display_name,
      fileType,
    } satisfies IDocument;
  })();

  docTypeCache.set(cacheKey, task);
  return task;
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

  useEffect(() => {
    if (!open || files.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const nextDocs = await Promise.all(files.map((file) => resolveDocument(file)));
      if (!cancelled) {
        setDocs(nextDocs);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files, open]);

  const viewer = useMemo(() => {
    const body = footer ? bodyStyle : { height: "78vh", marginTop: "0px" };
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
  }, [bodyStyle, docs, files, footer]);

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
          minHeight: "88vh",
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
              label={`${docs.length || files.length} 份文档`}
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
          display: "flex",
          flexDirection: "column",
          bgcolor:
            theme.palette.mode === "dark"
              ? alpha("#020617", 0.28)
              : alpha("#eff6ff", 0.42),
        }}
      >
        <Box sx={{ flex: 1, minHeight: 0 }}>{viewer}</Box>
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
