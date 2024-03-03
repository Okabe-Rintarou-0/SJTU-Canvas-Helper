import { DocRendererProps } from "@cyntler/react-doc-viewer";
import Highlight from "react-highlight";
import { decode } from "js-base64"
import { CODE_LIKE_EXTENSIONS } from "../lib/constants";

export default function CodeRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const base64 = (currentDocument.fileData as string).split(',')[1];
    const data = decode(base64);

    return <Highlight className={currentDocument.fileType} >{data}</Highlight>
}

CodeRenderer.fileTypes = CODE_LIKE_EXTENSIONS;
CodeRenderer.weight = 1;