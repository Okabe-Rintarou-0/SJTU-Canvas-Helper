import { invoke } from "@tauri-apps/api/core";
import type { AccountInfo } from "./model";

export type DataCategory = "cache" | "history" | "state";
export interface DataRecord<T> { key: string; version: number; updatedAt: string; value: T }
export interface DataOverview {
  directory: string;
  totalBytes: number;
  categories: { category: DataCategory; bytes: number; files: number }[];
}
export interface DataChange { account: string; category?: DataCategory; collection?: string }
const listeners = new Set<(change: DataChange) => void>();
export function subscribeAppData(listener: (change: DataChange) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function currentDataAccount(): Promise<string> {
  const info = await invoke<AccountInfo>("read_account_info");
  if (!info || typeof info.current_account !== "string") throw new Error("无法读取当前数据账号");
  return info.current_account;
}

export async function appDataRequest<R>(account: string, request: { op: string; [key: string]: unknown }): Promise<R> {
  const result = await invoke<R>("app_data", { account, request });
  if (["put", "delete", "clear", "relocate"].includes(request.op)) {
    const change = { account, category: request.category as DataCategory | undefined, collection: request.collection as string | undefined };
    listeners.forEach((listener) => {
      try { listener(change); } catch { /* A subscriber cannot undo a successful write. */ }
    });
  }
  return result;
}

/** Real JSON persistence for any feature. Bind an explicit account once per task.
 * Each collection owns its schema version, validation and optional upgrade path.
 * Unsupported future versions fail instead of being overwritten or discarded.
 */
export function defineDataCollection<T>(options: {
  category: DataCategory;
  name: string;
  version: number;
  validate: (value: unknown) => value is T;
  migrate?: (value: unknown, version: number) => T;
}) {
  const { category, name: collection, version, validate, migrate } = options;
  if (!/^[a-z0-9_-]{1,80}$/.test(collection) || !Number.isInteger(version) || version < 1) {
    throw new Error("应用数据集合名称或版本无效");
  }
  return {
    forAccount(account: string) {
      const request = <R>(op: string, fields = {}) => appDataRequest<R>(account, { op, category, collection, ...fields });
      const decode = async (record: DataRecord<unknown>): Promise<DataRecord<T>> => {
        if (record.version > version) throw new Error(`${collection} 数据版本较新，请升级应用`);
        let value = record.value;
        if (record.version < version) {
          if (!migrate) throw new Error(`${collection} 数据需要升级`);
          value = migrate(value, record.version);
          if (!validate(value)) throw new Error(`${collection} 数据升级失败`);
          return request<DataRecord<T>>("put", { key: record.key, version, value });
        }
        if (!validate(value)) throw new Error(`${collection} 数据格式无效`);
        return { ...record, value };
      };
      return {
        async get(key: string): Promise<T | undefined> {
          const record = await request<DataRecord<unknown> | null>("get", { key });
          return record ? (await decode(record)).value : undefined;
        },
        async list(): Promise<DataRecord<T>[]> {
          const records = await request<DataRecord<unknown>[]>("list");
          return Promise.all(records.map(decode));
        },
        async set(key: string, value: T, ifAbsent = false): Promise<T> {
          if (!validate(value)) throw new Error(`${collection} 数据格式无效`);
          return (await decode(await request<DataRecord<unknown>>("put", { key, version, value, if_absent: ifAbsent }))).value;
        },
        remove: (key: string) => request<void>("delete", { key }),
        clear: () => request<void>("clear"),
      };
    },
  };
}
