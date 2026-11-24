import { Box } from "@mui/material";
import type { Components } from "react-markdown";

import { formatVideoTimestamp, parseVideoCitation, recordingKey, type VideoSession } from "../lib/video_library";

const timestampSx = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

export function videoSummaryMarkdownComponents(
  scopes: readonly VideoSession[],
  onSeek?: (session: VideoSession, key: string, seconds: number) => void,
): Components {
  const targets = new Map<string, { session: VideoSession; section: number }>();
  for (const session of scopes) {
    for (const video of session.videos) {
      const key = recordingKey(video);
      if (!targets.has(key)) targets.set(key, { session, section: targets.size + 1 });
    }
  }

  return {
    a({ href, children }) {
      const citation = parseVideoCitation(href);
      if (!citation) return <span>{children}</span>;

      const timestamp = formatVideoTimestamp(citation.seconds);
      const target = targets.get(citation.key);
      const showSection = !!target && targets.size > 1;
      const text = showSection ? `节${target.section} · ${timestamp}` : timestamp;
      const title = target && `${target.session.title}${showSection ? ` · 第 ${target.section} 小节` : ""} · ${timestamp}`;
      if (!target || !onSeek) return <Box component="span" title={title} sx={timestampSx}>{text}</Box>;

      const label = `跳转到 ${title}`;
      return (
        <Box component="button" type="button" title={label} aria-label={label}
          onClick={() => onSeek(target.session, citation.key, citation.seconds)}
          sx={{
            display: "inline-block", font: "inherit", ...timestampSx, fontSize: "0.9em", lineHeight: 1.4,
            px: 0.6, py: 0.1, border: "1px solid", borderColor: "divider", borderRadius: 1,
            bgcolor: "transparent", color: "primary.main", cursor: "pointer",
            "&:hover": { bgcolor: "action.hover", borderColor: "primary.main" },
          }}>
          {text}
        </Box>
      );
    },
  };
}
