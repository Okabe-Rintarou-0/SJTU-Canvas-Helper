import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { getBase64Data } from "../lib/utils";

const prefixMap: Record<string, string> = {
    svg: "data:image/svg+xml;base64,",
    ico: "data:image/x-icon;base64,",
    webp: "data:image/webp;base64,",
    avif: "data:image/avif;base64,",
}

export default function ImageRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;

    const base64 = prefixMap[currentDocument.fileType ?? ""] + getBase64Data(currentDocument.fileData as string);
    return <img src={base64} />
}

ImageRenderer.fileTypes = ["svg", "ico", "avif", "webp"];
ImageRenderer.weight = 1;