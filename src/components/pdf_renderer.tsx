import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Viewer } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';
import { base64ToBuffer, getBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

export default function PdfRenderer(props: DocRendererProps) {
    let currentDocument = props.mainState.currentDocument;
    if (!currentDocument || currentDocument.fileData === undefined) return null;
    const data = base64ToBuffer(getBase64Data(currentDocument.fileData as string));
    return (
        <RendererShell
            title={currentDocument.fileName ?? "PDF"}
            subtitle="PDF document"
            fileType={currentDocument.fileType}
            icon={<PictureAsPdfRoundedIcon />}
            contentSx={{ p: 0, minHeight: 480 }}
        >
            <div style={{
                width: "100%",
                height: "100%",
                minHeight: 480,
                overflow: "auto"
            }}>
                <Viewer fileUrl={data} />
            </div>
        </RendererShell>
    );
}

PdfRenderer.fileTypes = ['pdf'];
PdfRenderer.weight = 1;
