import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { renderAsync } from "docx-preview"
import { useEffect, useRef } from "react";

export default function DocxRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const containerRef = useRef<HTMLDivElement>(null);

    const base64 = (currentDocument.fileData as string).split(',')[1];
    const data = atob(base64);
    useEffect(() => {
        if (containerRef.current) {
            renderAsync(data, containerRef.current);
        }
    }, [containerRef.current]);

    return <div ref={containerRef} style={{ width: "100%" }} />
}

DocxRenderer.fileTypes = ["doc"];
DocxRenderer.weight = 1;