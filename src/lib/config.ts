import { invoke } from "@tauri-apps/api/core";
import { cloneDeep } from "lodash";
import { AppConfig, LOG_LEVEL_INFO } from "./model";
import { configSlice, configStore } from "./store";
import { consoleLog } from "./utils";

export const { updateConfig } = configSlice.actions;

let CONFIG: AppConfig | null = null;

// TODO: change it to redux
export async function getConfig(revalidate = false) {
  if (!CONFIG || revalidate) {
    CONFIG = (await invoke("get_config")) as AppConfig;
    consoleLog(LOG_LEVEL_INFO, "get config", CONFIG);
    configStore.dispatch(updateConfig(cloneDeep(CONFIG)));
  }
  return CONFIG;
}

// TODO: change it to redux
export async function saveConfig(config: AppConfig) {
  await invoke("save_config", { config });
  CONFIG = config;
  configStore.dispatch(updateConfig(cloneDeep(CONFIG)));
}
