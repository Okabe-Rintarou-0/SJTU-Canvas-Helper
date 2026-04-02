import ImageRoundedIcon from "@mui/icons-material/ImageRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Box } from "@mui/material";
import { getBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

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
    return (
        <RendererShell
            title={currentDocument.fileName ?? "Image"}
            subtitle="Image preview"
            fileType={currentDocument.fileType}
            icon={<ImageRoundedIcon />}
            contentSx={{ display: "grid", placeItems: "center", minHeight: 360 }}
        >
            <Box
                component="img"
                src={base64}
                alt={currentDocument.fileName ?? "preview"}
                sx={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    borderRadius: "18px",
                    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.12)",
                }}
            />
        </RendererShell>
    );
}

ImageRenderer.fileTypes = ["svg", "ico", "avif", "webp", "jpeg", "jpg", "png", "gif", "bmp", "tiff"];
ImageRenderer.weight = 1;
