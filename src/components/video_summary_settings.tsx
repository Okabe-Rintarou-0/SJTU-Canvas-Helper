import { Button, Stack, TextField, Typography } from "@mui/material";
import type { AppConfig } from "../lib/model";
import { DEFAULT_VIDEO_SUMMARY_PROMPT, DEFAULT_VIDEO_CONTEXT_TOKENS, DEFAULT_VIDEO_OUTPUT_TOKENS, videoSummaryOptions, videoSummaryOptionsError } from "../lib/video_summary_config";

type Fields = Pick<AppConfig, "video_summary_prompt" | "video_summary_context_tokens" | "video_summary_output_tokens">;

export default function VideoSummarySettings({ config, onChange }: { config: Fields; onChange: (fields: Fields) => void }) {
  const options = videoSummaryOptions(config);
  const error = videoSummaryOptionsError(options);
  return <Stack spacing={2}>
    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>课堂 AI 总结</Typography>
    <TextField label="课堂总结要求" multiline minRows={4} fullWidth
      value={config.video_summary_prompt ?? DEFAULT_VIDEO_SUMMARY_PROMPT}
      onChange={(event) => onChange({ ...config, video_summary_prompt: event.target.value })}
      helperText="自定义详略、关注重点、输出结构和引用密度；留空使用默认要求。资料真实性与时间引用规则始终保留。追问以当前问题为主。" />
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <TextField label="上下文容量（tokens）" type="number" fullWidth value={options.contextTokens}
        onChange={(event) => onChange({ ...config, video_summary_context_tokens: Number(event.target.value) })}
        inputProps={{ min: 4096, max: 2097152, step: 1024 }} />
      <TextField label="输出预留（tokens）" type="number" fullWidth value={options.outputTokens}
        onChange={(event) => onChange({ ...config, video_summary_output_tokens: Number(event.target.value) })}
        inputProps={{ min: 256, max: Math.floor(options.contextTokens / 2), step: 256 }} />
    </Stack>
    <Typography variant="caption" color={error ? "error" : "text.secondary"} role={error ? "alert" : undefined}>
      {error || "默认上下文为 256,000 tokens，输出预留为 32,768 tokens，扣除安全余量后输入预算为 221,184 tokens。完整请求计入规则、要求、资料和历史，超预算才压缩。容量是应用预算，请确认模型或代理实际支持；未知模型使用通用 tokenizer 估算。输出预留是每次生成的总上限，推理模型的思考与正文共用此额度，压缩笔记也使用该额度。提高输出预留会减少输入预算。"}
    </Typography>
    <Button sx={{ alignSelf: "flex-start" }} onClick={() => onChange({ video_summary_prompt: DEFAULT_VIDEO_SUMMARY_PROMPT,
      video_summary_context_tokens: DEFAULT_VIDEO_CONTEXT_TOKENS, video_summary_output_tokens: DEFAULT_VIDEO_OUTPUT_TOKENS })}>恢复课堂总结默认设置</Button>
  </Stack>;
}
