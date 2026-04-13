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
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.js?url";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { base64ToBuffer, getBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export default function PdfRenderer(props: DocRendererProps) {
    const currentDocument = props.mainState.currentDocument;
    const containerRef = useRef<HTMLDivElement>(null);
    const [numPages, setNumPages] = useState(0);
    const [pageWidth, setPageWidth] = useState(900);
    const [scale, setScale] = useState(1);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);

    if (!currentDocument || currentDocument.fileData === undefined) return null;

    const data = useMemo(
        () => base64ToBuffer(getBase64Data(currentDocument.fileData as string)),
        [currentDocument.fileData]
    );

    useEffect(() => {
        const pdfBlob = new Blob([data], { type: "application/pdf" });
        const nextBlobUrl = URL.createObjectURL(pdfBlob);
        setBlobUrl(nextBlobUrl);

        return () => {
            URL.revokeObjectURL(nextBlobUrl);
        };
    }, [data]);

    useEffect(() => {
        const updateWidth = () => {
            const nextWidth = containerRef.current?.clientWidth ?? 900;
            setPageWidth(Math.max(320, Math.floor(nextWidth - 32)));
        };

        updateWidth();

        const observer = new ResizeObserver(updateWidth);
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        window.addEventListener("resize", updateWidth);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updateWidth);
        };
    }, []);

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
                spacing={2}
                sx={{
                    width: "100%",
                    height: "100%",
                    minHeight: 480,
                    overflow: "auto",
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

                <Document
                    file={blobUrl ?? undefined}
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
                    onLoadSuccess={({ numPages: nextNumPages }) => setNumPages(nextNumPages)}
                >
                    <Stack spacing={2.5} alignItems="center">
                        {Array.from({ length: numPages }, (_, index) => (
                            <Box
                                key={`page_${index + 1}`}
                                sx={{
                                    width: "100%",
                                    display: "grid",
                                    placeItems: "center",
                                }}
                            >
                                <Page
                                    pageNumber={index + 1}
                                    width={Math.floor(pageWidth * scale)}
                                    renderAnnotationLayer
                                    renderTextLayer
                                />
                            </Box>
                        ))}
                    </Stack>
                </Document>
            </Stack>
        </RendererShell>
    );
}

PdfRenderer.fileTypes = ['pdf'];
PdfRenderer.weight = 1;
