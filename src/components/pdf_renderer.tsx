import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import ZoomInRoundedIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutRoundedIcon from "@mui/icons-material/ZoomOutRounded";
import {
    Box,
    Button,
    CircularProgress,
    Stack,
    Typography,
} from "@mui/material";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.js?url";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { base64ToBuffer, getBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";
import { getPdfAnchoredTop, getPdfPageLayout, getPdfPageWindow } from "../lib/pdf_page_window";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export default function PdfRenderer(props: DocRendererProps) {
    const currentDocument = props.mainState.currentDocument;
    const hasData = currentDocument?.fileData !== undefined;
    const data = useMemo(
        () => base64ToBuffer(getBase64Data(currentDocument?.fileData as string ?? "")),
        [currentDocument?.fileData]
    );
    const [resource, setResource] = useState<{ data: ReturnType<typeof base64ToBuffer>; url: string } | null>(null);

    useEffect(() => {
        if (!hasData) return;
        const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
        setResource({ data, url });
        return () => URL.revokeObjectURL(url);
    }, [data, hasData]);

    // Never show the previous document while its replacement URL is being created.
    // A keyed viewer also scopes metadata, observers and pending frames to one PDF.
    if (!currentDocument || !hasData || resource?.data !== data) return null;
    return <PdfViewer key={resource.url} currentDocument={currentDocument} blobUrl={resource.url} />;
}

function PdfViewer({ currentDocument, blobUrl }: {
    currentDocument: NonNullable<DocRendererProps["mainState"]["currentDocument"]>;
    blobUrl: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const pagesRef = useRef<HTMLDivElement>(null);
    const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
    const [ratios, setRatios] = useState<number[]>([]);
    const [scale, setScale] = useState(1);
    const [viewport, setViewport] = useState({ top: 0, height: 0, width: 900 });
    const width = Math.floor(viewport.width * scale);
    const layout = useMemo(() => getPdfPageLayout(ratios, width), [ratios, width]);
    const layoutRef = useRef(layout);
    const viewportRef = useRef(viewport);
    const pagesTopRef = useRef(0);
    const pageCountRef = useRef(0);
    const pendingPageRef = useRef<number | null>(null);
    const programmaticScrollRef = useRef<number | null>(null);
    const range = getPdfPageWindow(layout.offsets, viewport.top, viewport.height);
    const numPages = pdf?.numPages ?? 0;

    useEffect(() => {
        if (!pdf) return;
        let active = true;
        setRatios([]);
        // Read dimensions serially, without rendering pages or fanning out promises.
        // Show the first page immediately, then append exact geometry in small batches.
        async function readDimensions() {
            const nextRatios: number[] = [];
            let fallbackRatio = Math.SQRT2;
            let hasReadablePage = false;
            for (let pageNumber = 1; pageNumber <= pdf!.numPages; pageNumber++) {
                if (!active) return;
                let ratio = fallbackRatio;
                let readable = false;
                try {
                    const page = await pdf!.getPage(pageNumber);
                    if (!active) return;
                    const { width, height } = page.getViewport({ scale: 1 });
                    if (width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) && Number.isFinite(height / width)) {
                        ratio = height / width;
                        readable = true;
                    }
                } catch {
                    // Keep a bounded placeholder for this page; React-PDF displays
                    // its own page error. A damaged page must not hide healthy ones.
                    if (!active) return;
                }
                const firstReadablePage = readable && !hasReadablePage;
                if (firstReadablePage) fallbackRatio = ratio;
                hasReadablePage ||= readable;
                nextRatios.push(ratio);
                // If page 1 is damaged, expose the first readable successor too,
                // without waiting for the rest of the document's metadata.
                // Exact prefixes only append pages; previously published offsets stay put.
                if (pageNumber === 1 || firstReadablePage || pageNumber % 16 === 0) setRatios([...nextRatios]);
            }
            if (active) setRatios(nextRatios);
        }
        void readDimensions();
        // Document owns the PDF worker/loading task. Its cleanup destroys that task;
        // this guard only stops our metadata loop and ignores any late result.
        return () => { active = false; };
    }, [pdf]);

    const measure = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const pagesTop = pagesRef.current
            ? pagesRef.current.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
            : 0;
        const next = {
            top: container.scrollTop - pagesTop,
            height: container.clientHeight,
            width: Math.max(320, Math.floor(container.clientWidth - 32)),
        };
        // A taller viewport can clamp scrollTop even without changing page sizes.
        // Record that browser adjustment before its queued scroll event arrives.
        if (next.height !== viewportRef.current.height) {
            programmaticScrollRef.current = container.scrollTop;
        }
        pagesTopRef.current = pagesTop;
        // A width change will replace page geometry on the next commit. Retain the
        // old logical position until that layout effect maps it to the new sizes.
        viewportRef.current = { ...next, top: next.width === viewportRef.current.width ? next.top : viewportRef.current.top };
        setViewport((previous) => previous.top === next.top && previous.height === next.height && previous.width === next.width
            ? previous : next);
    }, []);

    const scrollToPage = useCallback((pageIndex: number) => {
        const container = containerRef.current;
        const pages = pagesRef.current;
        const offset = layoutRef.current.offsets[pageIndex];
        if (!container || !pages || offset === undefined) return false;
        const pagesTop = pages.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        container.scrollTop = pagesTop + offset;
        programmaticScrollRef.current = container.scrollTop;
        measure();
        return true;
    }, [measure]);

    useLayoutEffect(() => {
        const previous = layoutRef.current;
        const previousTop = viewportRef.current.top;
        layoutRef.current = layout;
        pageCountRef.current = numPages;
        const pending = pendingPageRef.current;
        if (pending !== null && scrollToPage(pending)) {
            pendingPageRef.current = null;
            return;
        }
        const container = containerRef.current;
        const pages = pagesRef.current;
        if (previous !== layout && previous.offsets.length && container && pages) {
            const pagesTop = pages.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
            container.scrollTop = pagesTop + getPdfAnchoredTop(previous, layout, previousTop);
            // Geometry can clamp this assignment at the prefix boundary. Its actual
            // scroll event is programmatic, not a cancellation of the pending link.
            programmaticScrollRef.current = container.scrollTop;
        }
        measure();
    }, [layout, numPages, measure, scrollToPage]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let active = true;
        let frame: number | null = null;
        const schedule = () => {
            if (!active || frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                if (active) measure();
            });
        };
        const onScroll = () => {
            // Ignore the queued event from our own jump: a newer link may already
            // be pending. A different scroll position reflects newer scroll intent.
            const resized = container.clientHeight !== viewportRef.current.height;
            if (!resized && programmaticScrollRef.current !== container.scrollTop) pendingPageRef.current = null;
            programmaticScrollRef.current = null;
            // Capture position without a layout read, even if zoom happens before RAF.
            viewportRef.current = { ...viewportRef.current, top: container.scrollTop - pagesTopRef.current };
            schedule();
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(container);
        container.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", schedule);
        return () => {
            active = false;
            observer.disconnect();
            container.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", schedule);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [measure]);

    // React-PDF 7.5's link service keeps the initial callback: read current geometry
    // through refs so links to unmounted pages also work after zoom and resize.
    const jumpToPage = useCallback(({ pageIndex }: { pageIndex: number }) => {
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCountRef.current) return;
        // First-page links can be clicked before the rest of the geometry exists.
        // Keep only the latest valid target, scoped to this keyed document viewer.
        pendingPageRef.current = scrollToPage(pageIndex) ? null : pageIndex;
    }, [scrollToPage]);

    return (
        <RendererShell
            title={currentDocument.fileName ?? "PDF"}
            subtitle="PDF document"
            fileType={currentDocument.fileType}
            icon={<PictureAsPdfRoundedIcon />}
            headerMode="compact"
            actions={
                <Stack direction="row" spacing={1}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ZoomOutRoundedIcon />}
                        onClick={() => setScale((prev) => Math.max(0.75, Number((prev - 0.1).toFixed(2))))}
                    >
                        缩小
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ZoomInRoundedIcon />}
                        onClick={() => setScale((prev) => Math.min(2.5, Number((prev + 0.1).toFixed(2))))}
                    >
                        放大
                    </Button>
                </Stack>
            }
            contentSx={{ p: 0, minHeight: 480, overflow: "hidden" }}
        >
            <Stack
                ref={containerRef}
                data-pdf-scroll
                spacing={2}
                sx={{
                    width: "100%",
                    height: "100%",
                    minHeight: 480,
                    overflow: "auto",
                    overflowAnchor: "none",
                    "& > .react-pdf__Document": { flexShrink: 0 },
                    p: 2,
                    background: "linear-gradient(180deg, rgba(15,23,42,0.04) 0%, rgba(15,23,42,0.08) 100%)",
                }}
            >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" color="text.secondary">
                        {numPages > 0 ? `共 ${numPages} 页` : "正在载入 PDF…"}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        缩放 {Math.round(scale * 100)}%
                    </Typography>
                </Stack>

                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    为降低内存占用，仅加载附近页面；⌘F / Ctrl+F 和跨页文本选择仅覆盖已加载页面。
                </Typography>
                <Document
                    file={blobUrl}
                    onItemClick={jumpToPage}
                    loading={
                        <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
                            <CircularProgress />
                        </Box>
                    }
                    error={
                        <Typography color="error" sx={{ py: 4 }}>
                            PDF 载入失败，请稍后重试。
                        </Typography>
                    }
                    onLoadSuccess={setPdf}
                >
                    {ratios.length === 0 ? (
                        <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
                            <CircularProgress aria-label="正在读取 PDF 页面尺寸" />
                        </Box>
                    ) : (
                        <Box
                            ref={pagesRef}
                            data-pdf-pages
                            style={{ height: layout.height, minWidth: width }}
                            sx={{ position: "relative", width: "100%" }}
                        >
                            {layout.offsets.slice(range.start, range.end).map((top, index) => (
                                <Box
                                    key={range.start + index}
                                    style={{ top }}
                                    sx={{ position: "absolute", width: "100%", display: "grid", placeItems: "center" }}
                                >
                                    <Page
                                        pageNumber={range.start + index + 1}
                                        width={width}
                                        renderAnnotationLayer
                                        renderTextLayer
                                    />
                                </Box>
                            ))}
                        </Box>
                    )}
                </Document>
                {ratios.length > 0 && ratios.length < numPages ? (
                    <Typography role="status" variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                        正在准备其余 PDF 页面…
                    </Typography>
                ) : null}
            </Stack>
        </RendererShell>
    );
}

PdfRenderer.fileTypes = ['pdf'];
PdfRenderer.weight = 1;
