import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { getBase64Data } from "../lib/utils";
import { Image } from "antd";

const prefixMap: Record<string, string> = {
    svg: "data:image/svg+xml;base64,",
    ico: "data:image/x-icon;base64,",
    webp: "data:image/webp;base64,",
    avif: "data:image/avif;base64,",
    jpeg: "data:image/jpeg;base64,",
    jpg: "data:image/jpeg;base64,",
    png: "data:image/png;base64,",
    gif: "data:image/gif;base64,",
    bmp: "data:image/bmp;base64,",
    tiff: "data:image/tiff;base64,"
};


export default function ImageRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;

    const base64 = prefixMap[currentDocument.fileType ?? ""] + getBase64Data(currentDocument.fileData as string);
    return <Image src={base64} />
}

ImageRenderer.fileTypes = ["svg", "ico", "avif", "webp", "jpeg", "jpg", "png", "gif", "bmp", "tiff"];
ImageRenderer.weight = 1;