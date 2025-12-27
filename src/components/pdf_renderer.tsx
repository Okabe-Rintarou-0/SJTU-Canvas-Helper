import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Viewer } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';
import { Card } from "antd";
import { base64ToBuffer, getBase64Data } from "../lib/utils";

export default function PdfRenderer(props: DocRendererProps) {
    let currentDocument = props.mainState.currentDocument;
    if (!currentDocument || currentDocument.fileData === undefined) return null;
    const data = base64ToBuffer(getBase64Data(currentDocument.fileData as string));
    return (
        <Card style={{
            width: "100%",
            height: "100%",
            minWidth: 1000,
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
            overflow: "scroll"
        }}>
            <div style={{
                width: "100%",
                height: "calc(100% - 24px)",
                overflow: "auto"
            }}>
                <Viewer fileUrl={data} />
            </div>
        </Card>
    );
}

PdfRenderer.fileTypes = ['pdf'];
PdfRenderer.weight = 1;