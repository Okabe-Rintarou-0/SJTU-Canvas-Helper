import type { AppConfig } from "./model";

export const DEFAULT_VIDEO_SUMMARY_PROMPT = "按主题组织精炼的 Markdown 笔记，优先解释概念、结论和联系。列出主要知识点、作业、测验、考试及通知。每个知识点通常只引用 1 个最相关的资料位置，必要时最多 2 个；不逐句堆叠时间戳。";
export const DEFAULT_VIDEO_CONTEXT_TOKENS = 256_000;
export const DEFAULT_VIDEO_OUTPUT_TOKENS = 32_768;
export const MIN_VIDEO_CONTEXT_TOKENS = 4_096;
export const MAX_VIDEO_CONTEXT_TOKENS = 2_097_152;

export interface VideoSummaryOptions {
  prompt: string;
  contextTokens: number;
  outputTokens: number;
}

export function videoSummaryOptions(config?: Partial<AppConfig>): VideoSummaryOptions {
  return {
    prompt: config?.video_summary_prompt?.trim() || DEFAULT_VIDEO_SUMMARY_PROMPT,
    contextTokens: config?.video_summary_context_tokens ?? DEFAULT_VIDEO_CONTEXT_TOKENS,
    outputTokens: config?.video_summary_output_tokens ?? DEFAULT_VIDEO_OUTPUT_TOKENS,
  };
}

export function videoSummaryOptionsError(options: VideoSummaryOptions): string {
  if (!Number.isInteger(options.contextTokens) || options.contextTokens < MIN_VIDEO_CONTEXT_TOKENS || options.contextTokens > MAX_VIDEO_CONTEXT_TOKENS) {
    return `上下文容量须为 ${MIN_VIDEO_CONTEXT_TOKENS}–${MAX_VIDEO_CONTEXT_TOKENS} 之间的整数。`;
  }
  if (!Number.isInteger(options.outputTokens) || options.outputTokens < 256 || options.outputTokens > options.contextTokens / 2) {
    return "输出预留须为至少 256 的整数，且不超过上下文容量的一半。";
  }
  return "";
}
