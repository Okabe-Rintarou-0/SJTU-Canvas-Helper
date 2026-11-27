import type { Root } from "hast";
import type { PhrasingContent, Root as MarkdownRoot } from "mdast";
import Markdown from "react-markdown";
import type { Components, Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { SKIP, visit } from "unist-util-visit";
import "katex/dist/katex.min.css";

import styles from "../css/markdown.module.css";

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: Options["rehypePlugins"] = [[rehypeKatex, { errorColor: "inherit" }]];
const inlineFormula = /^\$((?:\\.|[^\\$\r\n])+)\$$/;

function rehypeRecoverWrappedMath() {
  return (tree: Root) => {
    visit(tree, "element", (node, _, parent) => {
      if (node.tagName !== "code" || node.properties.className || (parent?.type === "element" && parent.tagName === "pre")) return;
      const [child] = node.children;
      if (node.children.length !== 1 || child.type !== "text") return;
      const formula = inlineFormula.exec(child.value)?.[1];
      if (!formula?.trim()) return;
      node.properties.className = ["math-inline"];
      child.value = formula;
    });
  };
}

function remarkRecoverCjkStrong() {
  return (tree: MarkdownRoot, file: { value: unknown }) => {
    const source = String(file.value);
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index === undefined || parent.type === "link" || parent.type === "linkReference") return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || source.slice(start, end) !== node.value) return;

      // CommonMark treats the closing delimiter as an opener when punctuation
      // inside the bold span touches the following word in compact CJK prose.
      const pattern = /(?<!\*)\*\*([^*\r\n]+?[。！？：；，、])[ \t]*\*\*(?=[\p{L}\p{N}])/gu;
      const parts: PhrasingContent[] = [];
      let offset = 0;
      for (const match of node.value.matchAll(pattern)) {
        if (match.index > offset) parts.push({ type: "text", value: node.value.slice(offset, match.index) });
        parts.push({ type: "strong", children: [{ type: "text", value: match[1] }] });
        offset = match.index + match[0].length;
      }
      if (parts.length === 0) return;
      if (offset < node.value.length) parts.push({ type: "text", value: node.value.slice(offset) });
      (parent.children as PhrasingContent[]).splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}

const remarkFilePlugins = [...remarkPlugins, remarkRecoverCjkStrong];

const rehypeAssistantPlugins = [rehypeRecoverWrappedMath, ...rehypePlugins];

export default function MarkdownContent({ children, components, recoverWrappedMath = false, recoverCjkStrong = false }: {
  children: string;
  components?: Components;
  recoverWrappedMath?: boolean;
  recoverCjkStrong?: boolean;
}) {
  return (
    <div className={styles.content}>
      <Markdown remarkPlugins={recoverCjkStrong ? remarkFilePlugins : remarkPlugins} rehypePlugins={recoverWrappedMath ? rehypeAssistantPlugins : rehypePlugins} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
