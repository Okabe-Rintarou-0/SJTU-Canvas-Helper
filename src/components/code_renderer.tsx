import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { useTheme } from "@mui/material/styles";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coy, oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { CODE_LIKE_EXTENSIONS } from "../lib/constants";
import { decodeBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

export default function CodeRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument || currentDocument.fileData === undefined) return null;
    const theme = useTheme();
    const data = decodeBase64Data(currentDocument.fileData as string);

    return (
        <RendererShell
            title={currentDocument.fileName ?? "Code"}
            subtitle="Source preview"
            fileType={currentDocument.fileType}
            icon={<CodeRoundedIcon />}
            contentSx={{ p: 0 }}
        >
            <SyntaxHighlighter
                language={currentDocument.fileType}
                style={theme.palette.mode === "dark" ? oneDark : coy}
                showLineNumbers
                customStyle={{
                    margin: 0,
                    minHeight: "100%",
                    borderRadius: 16,
                    padding: "20px",
                    background: "transparent",
                }}
            >
                {data}
            </SyntaxHighlighter>
        </RendererShell>
    );
}

CodeRenderer.fileTypes = CODE_LIKE_EXTENSIONS;
CodeRenderer.weight = 1;
