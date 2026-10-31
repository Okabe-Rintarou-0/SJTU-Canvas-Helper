import { Box, Link } from "@mui/material";
import Markdown from "react-markdown";

/** Keep release-note formatting inline within the surrounding list item. */
export function ChangeLogText({ children }: { children: string }) {
  return (
    <Box component="span" sx={{
      "& strong": { color: "text.primary", fontWeight: 700 },
      "& code": {
        fontFamily: "monospace", fontSize: "0.95em",
        bgcolor: "action.hover", borderRadius: 0.5, px: 0.5,
      },
    }}>
      <Markdown
        allowedElements={["p", "strong", "em", "code", "a", "br"]}
        unwrapDisallowed
        skipHtml
        components={{
          p: ({ children }) => <>{children}</>,
          a: ({ href, children }) => (
            <Link href={href} target="_blank" rel="noreferrer">{children}</Link>
          ),
        }}
      >
        {children}
      </Markdown>
    </Box>
  );
}
