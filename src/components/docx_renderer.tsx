import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { renderAsync } from "docx-preview"
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { decodeBase64DataAsBinary } from "../lib/utils";
import Alert from "@mui/material/Alert";
import { PreviewErrorContext } from "./preview_error";
import RendererShell from "./renderer_shell";

export default function DocxRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const onError = useContext(PreviewErrorContext);
    const [failed, setFailed] = useState(false);
    const fileData = currentDocument?.fileData;
    const data = useMemo(() => typeof fileData === "string" ? decodeBase64DataAsBinary(fileData) : fileData, [fileData]);

    useEffect(() => {
        if (!containerRef.current || !data) return;
        const content = document.createElement("div");
        containerRef.current.replaceChildren(content);
        setFailed(false);
        let active = true;
        void renderAsync(data, content).catch(() => {
            if (!active) return;
            setFailed(true);
            onError?.();
        });
        return () => { active = false; content.remove(); };
    }, [data, onError]);

    if (!currentDocument || !currentDocument.fileData) return null;

    return (
        <RendererShell
            title={currentDocument.fileName ?? "Document"}
            subtitle="DOCX preview"
            fileType={currentDocument.fileType}
            icon={<ArticleRoundedIcon />}
            headerMode="none"
        >
            {failed && <Alert severity="error">Word 文档无法预览。</Alert>}
            <div ref={containerRef} style={{ width: "100%" }} />
        </RendererShell>
    );
}

DocxRenderer.fileTypes = ["docx"];
DocxRenderer.weight = 1;
