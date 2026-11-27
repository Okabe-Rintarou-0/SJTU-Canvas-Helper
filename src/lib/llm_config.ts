import type { AppConfig } from "./model";

export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_LLM_MODEL = "deepseek-flash";
export const ZHIYUAN_LLM_BASE_URL = "https://models.sjtu.edu.cn/api/v1";
export const ZHIYUAN_LLM_DEFAULT_MODEL = "deepseek-reasoner";
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

export function createAiDraft(config: AppConfig) {
  const normalized = normalizeLlmConfigForSettings(config);
  const active = normalized.llm_api_keys.find((entry) => entry.name === normalized.llm_active_api_key);
  return {
    name: active?.name ?? "",
    key: active?.key ?? "",
    baseUrl: active?.base_url ?? "",
    model: active?.model ?? "",
    modelEdited: false,
    imported: false,
  };
}

export type AiDraft = ReturnType<typeof createAiDraft>;

export function saveAiDraft(config: AppConfig, draft: AiDraft): AppConfig {
  if (!draft.modelEdited) return config;
  const key = draft.key.trim();
  const baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
  const model = draft.model.trim();
  if (!key || !baseUrl || !model) throw new Error("请填写 API Key、接口地址和模型名称。");
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error("请填写有效的模型接口地址。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("请填写有效的模型接口地址。");
  }
  const normalized = normalizeLlmConfigForSettings(config);
  const entries = normalized.llm_api_keys;
  const name = draft.name || (baseUrl === ZHIYUAN_LLM_BASE_URL ? "交大致远一号" : "向导 API Key");
  const existing = entries.find((entry) => entry.name === name
    && (Boolean(draft.name) || entry.base_url === baseUrl));
  let newName = name;
  for (let index = 2; !existing && entries.some((entry) => entry.name === newName); index++) {
    newName = name + " " + index;
  }
  const entry = { name: newName, key, base_url: baseUrl, model };
  return {
    ...normalized,
    llm_api_keys: existing ? entries.map((item) => item === existing ? entry : item) : [...entries, entry],
    llm_active_api_key: newName,
    llm_api_key: key,
    llm_base_url: baseUrl,
    llm_model: model,
  };
}
