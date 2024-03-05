import { DocRendererProps } from "@cyntler/react-doc-viewer";
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import styles from "../css/markdown.module.css"
import { dracula } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Card } from "antd";
import { decodeBase64Data } from "../lib/utils";

export default function MarkdownRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const data = decodeBase64Data(currentDocument.fileData as string);

    return <Card className={styles.markdown_container}>
        <Markdown remarkPlugins={[remarkGfm]}
            className={styles.markdown}
            components={{
                code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');

                    return !inline && match ? (
                        <SyntaxHighlighter style={dracula} PreTag="div" language={match[1]} {...props}>
                            {String(children).replace(/\n$/, '')}
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
    </Card>
}

MarkdownRenderer.fileTypes = ["md"]
MarkdownRenderer.weight = 2;