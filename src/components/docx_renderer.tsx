import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { renderAsync } from "docx-preview"
import { useEffect, useRef } from "react";
import { decodeBase64DataAsBinary } from "../lib/utils";
import RendererShell from "./renderer_shell";

export default function DocxRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument || !currentDocument.fileData) return null;

    const containerRef = useRef<HTMLDivElement>(null);
    const data = decodeBase64DataAsBinary(currentDocument.fileData as string);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.innerHTML = "";
            renderAsync(data, containerRef.current);
        }
    }, [data]);

    return (
        <RendererShell
            title={currentDocument.fileName ?? "Document"}
            subtitle="DOCX preview"
            fileType={currentDocument.fileType}
            icon={<ArticleRoundedIcon />}
            headerMode="none"
        >
            <div ref={containerRef} style={{ width: "100%" }} />
        </RendererShell>
    );
}

DocxRenderer.fileTypes = ["docx"];
DocxRenderer.weight = 1;
