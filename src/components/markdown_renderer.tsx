import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { decode } from "js-base64"
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import "../css/markdown.css"
import { dracula } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Card } from "antd";

export default function MarkdownRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const base64 = (currentDocument.fileData as string).split(',')[1];
    const data = decode(base64);

    return <Card className="markdown-container">
        <Markdown remarkPlugins={[remarkGfm]}
            className="markdown"
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