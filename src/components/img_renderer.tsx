import { DocRendererProps } from "@cyntler/react-doc-viewer";

const prefixMap: Record<string, string> = {
    svg: "data:image/svg+xml;base64,",
    ico: "data:image/x-icon;base64,"
}

export default function ImageRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;

    const base64 = prefixMap[currentDocument.fileType ?? ""] + (currentDocument.fileData as string).split(',')[1];
    return <img src={base64} />
}

ImageRenderer.fileTypes = ["svg", "ico"];
ImageRenderer.weight = 1;