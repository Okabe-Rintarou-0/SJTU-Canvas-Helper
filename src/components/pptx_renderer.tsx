import type { DocRenderer, DocRendererProps } from "@cyntler/react-doc-viewer";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import { Box, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import { useContext, useEffect, useRef, useState } from "react";

import type { SlideRequest, SlideResponse } from "../lib/pptx_preview_worker";
import { PreviewErrorContext } from "./preview_error";

export default function PptxRenderer({ mainState: { currentDocument } }: DocRendererProps) {
  return currentDocument && <SlidePreview key={currentDocument.uri} uri={currentDocument.uri} />;
}

function SlidePreview({ uri }: { uri: string }) {
  const reportFailure = useContext(PreviewErrorContext);
  const worker = useRef<Worker>();
  const [slide, setSlide] = useState<{ index: number; total: number; url: string }>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let preview: Worker;
    try {
      preview = new Worker(new URL("../lib/pptx_preview_worker.ts", import.meta.url), { type: "module" });
    } catch {
      reportFailure?.();
      return;
    }
    let objectUrl: string | undefined;
    worker.current = preview;
    preview.onmessage = ({ data }: MessageEvent<SlideResponse>) => {
      if ("failed" in data) {
        reportFailure?.();
        return;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(new Blob([data.svg], { type: "image/svg+xml" }));
      setSlide({ index: data.index, total: data.total, url: objectUrl });
      setLoading(false);
    };
    preview.onerror = () => reportFailure?.();
    preview.postMessage({ uri } satisfies SlideRequest);
    return () => {
      preview.terminate();
      worker.current = undefined;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, reportFailure]);

  const showPage = (index: number) => {
    setLoading(true);
    worker.current?.postMessage({ index } satisfies SlideRequest);
  };

  return (
    <Stack sx={{ width: "100%", minHeight: 0 }}>
      {slide && (
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center"
          sx={{ flexShrink: 0, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
          <IconButton aria-label="上一页幻灯片" disabled={loading || slide.index === 0}
            onClick={() => showPage(slide.index - 1)}><ChevronLeftRoundedIcon /></IconButton>
          <Typography variant="body2" aria-live="polite">{slide.index + 1} / {slide.total}</Typography>
          <IconButton aria-label="下一页幻灯片" disabled={loading || slide.index + 1 === slide.total}
            onClick={() => showPage(slide.index + 1)}><ChevronRightRoundedIcon /></IconButton>
        </Stack>
      )}
      <Box sx={{ position: "relative", flex: 1, minHeight: 0, p: 1.5, display: "grid", placeItems: "center" }}>
        {slide && <Box component="img" src={slide.url}
          alt={`第 ${slide.index + 1} 页幻灯片`} onError={reportFailure}
          sx={{ display: "block", width: "100%", height: "100%", minHeight: 0, objectFit: "contain" }} />}
        {loading && <CircularProgress size={28} aria-label="正在读取幻灯片" sx={{ position: "absolute" }} />}
      </Box>
    </Stack>
  );
}

PptxRenderer.fileTypes = ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"];
PptxRenderer.weight = 1;
PptxRenderer.fileLoader = (({ fileLoaderComplete }) => fileLoaderComplete()) satisfies NonNullable<DocRenderer["fileLoader"]>;
