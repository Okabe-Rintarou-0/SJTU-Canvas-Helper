import { useState } from "react";
import { Alert, Box, Button, Collapse, Stack, Typography } from "@mui/material";
import type { VideoSummarySource } from "../lib/video_summary_sources";
import { sourceCoverage } from "../lib/video_summary_sources";

const sectionLabel = (item: VideoSummarySource) => item.title.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/)?.[0] ?? item.title;

export default function VideoSummarySources({ sources, legacyCoverage }: { sources?: VideoSummarySource[]; legacyCoverage: string }) {
  const [open, setOpen] = useState(false);
  const missing = sources?.filter((item) => !item.included) ?? [];
  if (!sources?.length && !legacyCoverage) return null;
  return <Stack spacing={1} sx={{ width: "100%" }}>
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
      <Typography variant="body2">{sources?.length ? sourceCoverage(sources) : "历史总结"}</Typography>
      <Button size="small" aria-expanded={open} onClick={() => setOpen(!open)}>查看资料</Button>
    </Stack>
    {!!missing.length && <Alert severity="warning">未纳入本次总结：{missing.slice(0, 2).map(sectionLabel).join("、")}{missing.length > 2 ? ` 等 ${missing.length} 小节` : ""}。可重新生成以重试。</Alert>}
    {!sources?.length && legacyCoverage.includes("未覆盖小节：") && <Alert severity="warning">此历史总结有小节未纳入。可重新生成以重试。</Alert>}
    <Collapse in={open}>
      {sources?.length ? <Stack spacing={1.5}>
        {sources.map((item) => <Box key={item.key}>
          <Typography variant="body2">{sectionLabel(item)}</Typography>
          <Typography variant="caption" color={item.included ? "text.secondary" : "warning.main"}>
            {item.included ? `已纳入 · ${item.sources.map((source) => source === "课堂音频" ? "音频转录" : source).join("、")}` : "未获取到可用资料"}
          </Typography>
          {!!item.warnings.length && <Box component="details" sx={{ fontSize: 12, color: "text.secondary", mt: 0.5 }}>
            <summary>技术详情</summary>
            {item.warnings.map((warning, i) => <Box key={i} sx={{ overflowWrap: "anywhere" }}>{warning}</Box>)}
          </Box>}
        </Box>)}
      </Stack> : <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>{legacyCoverage}</Typography>}
    </Collapse>
  </Stack>;
}
