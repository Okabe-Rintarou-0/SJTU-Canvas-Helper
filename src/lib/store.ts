import { invoke } from "@tauri-apps/api";
import { AppConfig } from "./model";

let CONFIG: AppConfig | null = null;

export async function getConfig(revalidate = false) {
    if (!CONFIG || revalidate) {
        CONFIG = await invoke("get_config") as AppConfig;
    }
    return CONFIG;
}

export async function saveConfig(config: AppConfig) {
    await invoke("save_config", { config });
    CONFIG = config;
}