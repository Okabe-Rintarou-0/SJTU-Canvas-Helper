import { Box } from "@mui/material";
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg?url";
import baidu from "@lobehub/icons-static-svg/icons/baidu-color.svg?url";
import cohere from "@lobehub/icons-static-svg/icons/cohere-color.svg?url";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import doubao from "@lobehub/icons-static-svg/icons/doubao-color.svg?url";
import fireworksai from "@lobehub/icons-static-svg/icons/fireworks-color.svg?url";
import groq from "@lobehub/icons-static-svg/icons/groq.svg?url";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg?url";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?url";
import moonshot from "@lobehub/icons-static-svg/icons/moonshot.svg?url";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg?url";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?url";
import perplexity from "@lobehub/icons-static-svg/icons/perplexity-color.svg?url";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import tencent from "@lobehub/icons-static-svg/icons/tencent-color.svg?url";
import togetherai from "@lobehub/icons-static-svg/icons/together-color.svg?url";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?url";
import xiaomimimo from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?url";
import zhipu from "@lobehub/icons-static-svg/icons/zhipu-color.svg?url";

const providerIcons: Record<string, { url: string; monochrome?: boolean }> = {
  anthropic: { url: anthropic, monochrome: true },
  baidu: { url: baidu },
  cohere: { url: cohere },
  deepseek: { url: deepseek },
  doubao: { url: doubao },
  fireworksai: { url: fireworksai },
  groq: { url: groq, monochrome: true },
  minimax: { url: minimax },
  mistral: { url: mistral },
  moonshot: { url: moonshot, monochrome: true },
  ollama: { url: ollama, monochrome: true },
  openai: { url: openai, monochrome: true },
  perplexity: { url: perplexity },
  qwen: { url: qwen },
  tencent: { url: tencent },
  togetherai: { url: togetherai },
  xai: { url: xai, monochrome: true },
  xiaomimimo: { url: xiaomimimo, monochrome: true },
  zhipu: { url: zhipu },
};

export default function LlmBrandIcon({ provider, size }: { provider: string; size: number }) {
  const icon = providerIcons[provider];
  if (!icon) return null;
  const dimensions = { display: "inline-block", width: size, height: size, flex: `0 0 ${size}px` };
  if (icon.monochrome) {
    return <Box component="span" aria-hidden sx={{
      ...dimensions,
      bgcolor: "currentColor",
      mask: `url("${icon.url}") center / contain no-repeat`,
    }} />;
  }
  return <Box component="img" src={icon.url} alt="" sx={{ ...dimensions, objectFit: "contain" }} />;
}
