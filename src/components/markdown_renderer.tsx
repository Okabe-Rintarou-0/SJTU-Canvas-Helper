import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import type { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Box } from "@mui/material";
import { memo } from "react";

import styles from "../css/markdown.module.css";
import MarkdownContent from "./markdown_content";
import RendererShell from "./renderer_shell";

const RenderMarkdown = memo(MarkdownContent);

export default function MarkdownRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  if (!currentDocument) {
    return null;
  }

  const data = typeof currentDocument.fileData === "string" ? currentDocument.fileData : "";

  return (
    <RendererShell
      title={currentDocument.fileName ?? "Markdown"}
      subtitle="Markdown preview"
      fileType={currentDocument.fileType}
      icon={<ArticleRoundedIcon />}
      headerMode="none"
      contentSx={{ p: 0 }}
    >
      <Box className={styles.markdown} sx={{ p: 2, "& pre": { overflowX: "auto", whiteSpace: "pre", bgcolor: "action.hover", p: 1.5 } }}>
        <RenderMarkdown>{data}</RenderMarkdown>
      </Box>
    </RendererShell>
  );
}

MarkdownRenderer.fileTypes = ["md", "markdown", "text/markdown"];
MarkdownRenderer.weight = 2;
