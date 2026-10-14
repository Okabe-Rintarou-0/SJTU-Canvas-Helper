import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Box } from "@mui/material";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/cjs/styles/prism";
import remarkGfm from "remark-gfm";

import styles from "../css/markdown.module.css";
import { decodeBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

export default function MarkdownRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  if (!currentDocument) {
    return null;
  }

  const data = decodeBase64Data(currentDocument.fileData as string);

  return (
    <RendererShell
      title={currentDocument.fileName ?? "Markdown"}
      subtitle="Markdown preview"
      fileType={currentDocument.fileType}
      icon={<ArticleRoundedIcon />}
      headerMode="none"
      contentSx={{ p: 0 }}
    >
      <Box className={`${styles.markdownContainer} ${styles.markdown}`}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || "");

              return match ? (
                <SyntaxHighlighter
                  style={dracula}
                  PreTag="div"
                  language={match[1]}
                  {...props}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              ) : (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {data}
        </Markdown>
      </Box>
    </RendererShell>
  );
}

MarkdownRenderer.fileTypes = ["md"];
MarkdownRenderer.weight = 2;
