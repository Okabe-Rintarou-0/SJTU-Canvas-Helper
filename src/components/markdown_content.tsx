import type { Root } from "hast";
import Markdown from "react-markdown";
import type { Components, Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
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

const rehypeAssistantPlugins = [rehypeRecoverWrappedMath, ...rehypePlugins];

export default function MarkdownContent({ children, components, recoverWrappedMath = false }: {
  children: string;
  components?: Components;
  recoverWrappedMath?: boolean;
}) {
  return (
    <div className={styles.content}>
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={recoverWrappedMath ? rehypeAssistantPlugins : rehypePlugins} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
