import type { AppConfig } from "./model";

export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_LLM_MODEL = "deepseek-flash";
export const LEGACY_LLM_ENTRY_NAME = "旧版 API Key";

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "") || DEFAULT_LLM_BASE_URL;
}

function normalizeLegacyModel(model: string, baseUrl: string): string {
  const trimmed = model.trim();
  if (
    !trimmed ||
    (baseUrl.toLowerCase().includes("deepseek.com") &&
      trimmed.toLowerCase() === "deepseek-chat")
  ) {
    return DEFAULT_LLM_MODEL;
  }
  return trimmed;
}

export function normalizeLlmConfigForSettings(config: AppConfig): AppConfig {
  const entries = config.llm_api_keys ?? [];
  const legacyKey = config.llm_api_key?.trim() ?? "";

  if (entries.length > 0 || !legacyKey) {
    return {
      ...config,
      llm_api_keys: entries,
      llm_active_api_key: config.llm_active_api_key ?? "",
    };
  }

  const baseUrl = normalizeBaseUrl(config.llm_base_url ?? "");
  const model = normalizeLegacyModel(config.llm_model ?? "", baseUrl);
  return {
    ...config,
    llm_api_key: legacyKey,
    llm_base_url: baseUrl,
    llm_model: model,
    llm_api_keys: [
      {
        name: LEGACY_LLM_ENTRY_NAME,
        key: legacyKey,
        base_url: baseUrl,
        model,
      },
    ],
    llm_active_api_key: LEGACY_LLM_ENTRY_NAME,
  };
}
