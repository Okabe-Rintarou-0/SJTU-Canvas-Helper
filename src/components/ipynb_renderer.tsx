import DataObjectRoundedIcon from "@mui/icons-material/DataObjectRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { decodeBase64Data } from "../lib/utils";
import { IpynbRenderer, IpynbType } from "react-ipynb-renderer";
import "react-ipynb-renderer/dist/styles/darkbronco.css";
import RendererShell from "./renderer_shell";

export default function JupiterNotebookRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument || currentDocument.fileData === undefined) return null;
    const data = JSON.parse(decodeBase64Data(currentDocument.fileData as string));

    return (
        <RendererShell
            title={currentDocument.fileName ?? "Notebook"}
            subtitle="Jupyter Notebook preview"
            fileType={currentDocument.fileType}
            icon={<DataObjectRoundedIcon />}
        >
            <IpynbRenderer ipynb={data as IpynbType} />
        </RendererShell>
    );
}

JupiterNotebookRenderer.fileTypes = ['ipynb'];
JupiterNotebookRenderer.weight = 1;
