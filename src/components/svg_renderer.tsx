import { DocRendererProps } from "@cyntler/react-doc-viewer";

export default function SvgRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;

    const base64 = "data:image/svg+xml;base64," + (currentDocument.fileData as string).split(',')[1];
    return <img src={base64} />
}

SvgRenderer.fileTypes = ["svg"];
SvgRenderer.weight = 1;