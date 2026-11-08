pub mod chat;

pub(crate) const MARKDOWN_ANSWER_FORMAT: &str = r#"用 Markdown 编写展示给用户的正文。行内公式用单个美元符号包围，例如 $E=mc^2$。独立公式用成对的 $$ 包围，两个定界符分别独占一行，公式块前后留空行，例如：

$$
\frac{a}{b}
$$

使用 KaTeX 支持的数学命令。公式及其定界符直接写在正文中，禁止用反引号包裹，也不要放进代码块。程序代码仍用 Markdown 的行内代码或代码块。普通美元符号写作 \$。引用链接保持 Markdown 格式。"#;
