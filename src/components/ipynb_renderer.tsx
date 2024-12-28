import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { decodeBase64Data } from "../lib/utils";
import { IpynbRenderer, IpynbType } from "react-ipynb-renderer";
import "react-ipynb-renderer/dist/styles/darkbronco.css";

export default function JupiterNotebookRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument || currentDocument.fileData === undefined) return null;
    const data = JSON.parse(decodeBase64Data(currentDocument.fileData as string));

    return <IpynbRenderer ipynb={data as IpynbType} />
}

JupiterNotebookRenderer.fileTypes = ['ipynb'];
JupiterNotebookRenderer.weight = 1;