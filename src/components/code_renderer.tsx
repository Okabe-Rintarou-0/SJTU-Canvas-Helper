import { DocRendererProps } from "@cyntler/react-doc-viewer";
import Highlight from "react-highlight";
import { CODE_LIKE_EXTENSIONS } from "../lib/constants";
import { decodeBase64Data } from "../lib/utils";

export default function CodeRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const data = decodeBase64Data(currentDocument.fileData as string);

    return <Highlight className={currentDocument.fileType} >{data}</Highlight>
}

CodeRenderer.fileTypes = CODE_LIKE_EXTENSIONS;
CodeRenderer.weight = 1;