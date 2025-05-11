import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Viewer } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';
import "react-ipynb-renderer/dist/styles/darkbronco.css";
import { base64ToBuffer, getBase64Data } from "../lib/utils";


export default function PdfRenderer(props: DocRendererProps) {
    let currentDocument = props.mainState.currentDocument;
    if (!currentDocument || currentDocument.fileData === undefined) return null;
    const data = base64ToBuffer(getBase64Data(currentDocument.fileData as string));

    return <Viewer fileUrl={data} />
}

PdfRenderer.fileTypes = ['pdf'];
PdfRenderer.weight = 1;