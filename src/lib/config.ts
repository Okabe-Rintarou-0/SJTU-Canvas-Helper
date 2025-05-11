import { invoke } from "@tauri-apps/api";
import { AppConfig } from "./model";
import { configSlice, configStore } from "./store";

export const { updateConfig } = configSlice.actions

let CONFIG: AppConfig | null = null;

// TODO: change it to redux
export async function getConfig(revalidate = false) {
    if (!CONFIG || revalidate) {
        CONFIG = await invoke("get_config") as AppConfig;
        configStore.dispatch(updateConfig(CONFIG));
    }
    return CONFIG;
}

// TODO: change it to redux
export async function saveConfig(config: AppConfig) {
    await invoke("save_config", { config });
    CONFIG = config;
    configStore.dispatch(updateConfig(CONFIG));
}


