import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { renderAsync } from "docx-preview"
import { useEffect, useRef } from "react";
import { decodeBase64DataAsBinary } from "../lib/utils";

export default function DocxRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    
    const containerRef = useRef<HTMLDivElement>(null);
    const data = decodeBase64DataAsBinary(currentDocument.fileData as string);

    useEffect(() => {
        if (containerRef.current) {
            renderAsync(data, containerRef.current);
        }
    }, [containerRef.current]);

    return <div ref={containerRef} style={{ width: "100%" }} />
}

DocxRenderer.fileTypes = ["doc"];
DocxRenderer.weight = 1;