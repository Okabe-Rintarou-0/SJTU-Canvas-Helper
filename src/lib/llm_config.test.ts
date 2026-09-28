import { describe, expect, it } from "vitest";
import type { AppConfig } from "./model";
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_MODEL,
  LEGACY_LLM_ENTRY_NAME,
  normalizeLlmConfigForSettings,
} from "./llm_config";

function legacyConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    llm_api_key: "legacy-key",
    llm_base_url: "",
    llm_model: "",
    llm_api_keys: [],
    llm_active_api_key: "",
    ...overrides,
  } as AppConfig;
}

describe("normalizeLlmConfigForSettings", () => {
  it("exposes a legacy key as an active DeepSeek entry", () => {
    const normalized = normalizeLlmConfigForSettings(legacyConfig());

    expect(normalized.llm_active_api_key).toBe(LEGACY_LLM_ENTRY_NAME);
    expect(normalized.llm_base_url).toBe(DEFAULT_LLM_BASE_URL);
    expect(normalized.llm_model).toBe(DEFAULT_LLM_MODEL);
    expect(normalized.llm_api_keys).toEqual([
      {
        name: LEGACY_LLM_ENTRY_NAME,
        key: "legacy-key",
        base_url: DEFAULT_LLM_BASE_URL,
        model: DEFAULT_LLM_MODEL,
      },
    ]);
  });

  it("migrates legacy deepseek-chat to deepseek-flash", () => {
    const normalized = normalizeLlmConfigForSettings(
      legacyConfig({
        llm_base_url: "https://api.deepseek.com/",
        llm_model: "deepseek-chat",
      })
    );

    expect(normalized.llm_model).toBe(DEFAULT_LLM_MODEL);
    expect(normalized.llm_api_keys[0].model).toBe(DEFAULT_LLM_MODEL);
  });

  it("does not rewrite existing multi-key configuration", () => {
    const entry = {
      name: "custom",
      key: "custom-key",
      base_url: "https://example.com/v1",
      model: "custom-model",
    };
    const config = legacyConfig({
      llm_api_keys: [entry],
      llm_active_api_key: "custom",
    });

    const normalized = normalizeLlmConfigForSettings(config);

    expect(normalized.llm_api_keys).toEqual([entry]);
    expect(normalized.llm_active_api_key).toBe("custom");
  });
});
