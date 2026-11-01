import { invoke } from "@tauri-apps/api/core";
import { cloneDeep } from "lodash";
import { AppConfig } from "./model";
import { currentSession, invalidateSession, isSessionCurrent } from "./session";
import { configSlice, configStore } from "./store";

export const { updateConfig } = configSlice.actions;

export class StaleConfigSessionError extends Error {
  constructor() {
    super("Account session changed while loading configuration");
    this.name = "StaleConfigSessionError";
  }
}

export class ConfigReadFailure extends Error {
  constructor(readonly failureSession: number) {
    super("读取配置失败，请重试。");
    this.name = "ConfigReadFailure";
  }
}

let CONFIG: AppConfig | null = null;
// The account session this config was read for. A cached config is only valid
// while the session that produced it is still the active one.
let CONFIG_SESSION = -1;

let configQueue: Promise<void> = Promise.resolve();

function enqueueConfig<T>(operation: () => Promise<T>): Promise<T> {
  const result = configQueue.then(operation);
  configQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function isConfigOwnerCurrent(config: AppConfig): boolean {
  return typeof config.__config_owner === "string"
    && config.__config_owner === CONFIG?.__config_owner
    && CONFIG_SESSION === currentSession();
}

function invalidateConfig(): void {
  CONFIG = null;
  CONFIG_SESSION = -1;
  invalidateSession();
}

function publishConfig(config: AppConfig): void {
  if (CONFIG?.__config_owner && CONFIG.__config_owner !== config.__config_owner)
    invalidateSession();
  CONFIG = config;
  CONFIG_SESSION = currentSession();
  configStore.dispatch(updateConfig(cloneDeep(config)));
}

export async function getConfig(revalidate = false): Promise<AppConfig> {
  const session = currentSession();
  return enqueueConfig(async () => {
    if (!isSessionCurrent(session)) throw new StaleConfigSessionError();
    if (CONFIG && !revalidate && CONFIG_SESSION === session) return CONFIG;
    let config: AppConfig;
    try {
      config = await invoke("get_config") as AppConfig;
    } catch (error) {
      if (!isSessionCurrent(session)) throw new StaleConfigSessionError();
      invalidateConfig();
      throw new ConfigReadFailure(currentSession());
    }
    if (!isSessionCurrent(session)) throw new StaleConfigSessionError();
    if (typeof config.__config_owner !== "string" || !config.__config_owner) {
      invalidateConfig();
      throw new StaleConfigSessionError();
    }
    publishConfig(config);
    return config;
  });
}

export async function saveConfig(
  config: AppConfig,
  completion?: { isCurrent: () => boolean; onCommitted: () => void }
): Promise<AppConfig> {
  const session = currentSession();
  const submitted = cloneDeep(config);
  const expectedOwner = submitted.__config_owner;
  if (typeof expectedOwner !== "string" || !expectedOwner)
    throw new StaleConfigSessionError();
  const { __config_owner: _owner, ...payload } = submitted;
  return enqueueConfig(async () => {
    if (!isSessionCurrent(session) || !isConfigOwnerCurrent(submitted)
      || (completion && !completion.isCurrent())) throw new StaleConfigSessionError();
    let nextOwner: unknown;
    try {
      nextOwner = await invoke("save_config", { config: payload, expectedOwner });
    } catch (error) {
      const stale = !isSessionCurrent(session) || !isConfigOwnerCurrent(submitted)
        || String(error).includes("Stale or unavailable configuration owner");
      if (isSessionCurrent(session)) invalidateConfig();
      if (stale) throw new StaleConfigSessionError();
      throw error;
    }
    if (typeof nextOwner !== "string" || !nextOwner) {
      if (isSessionCurrent(session)) invalidateConfig();
      throw new StaleConfigSessionError();
    }
    if (!isSessionCurrent(session) || !isConfigOwnerCurrent(submitted)
      || (completion && !completion.isCurrent())) throw new StaleConfigSessionError();
    const saved: AppConfig = { ...submitted, __config_owner: nextOwner };
    publishConfig(saved);
    if (completion) {
      try {
        completion.onCommitted();
      } catch {
        console.error("Configuration completion callback failed");
      }
    }
    return saved;
  });
}

export async function listNetworkLogs() {
  return (await invoke("list_network_logs")) as import("./model").NetworkRequestLog[];
}

export async function clearNetworkLogs() {
  await invoke("clear_network_logs");
}

/** Capture a published owner synchronously, before a task can wait in a queue. */
export function captureOperationConfig(): AppConfig {
  if (!CONFIG || CONFIG_SESSION !== currentSession()
    || typeof CONFIG.__config_owner !== "string" || !CONFIG.__config_owner)
    throw new StaleConfigSessionError();
  return cloneDeep(CONFIG);
}

/** Adopt only the successor returned by this operation, never the current account. */
export function adoptOperationConfig(expectedOwner: string, session: number, next: AppConfig): number {
  if (!isSessionCurrent(session) || CONFIG_SESSION !== session
    || CONFIG?.__config_owner !== expectedOwner
    || typeof next.__config_owner !== "string" || !next.__config_owner)
    throw new StaleConfigSessionError();
  publishConfig(cloneDeep(next));
  return currentSession();
}
