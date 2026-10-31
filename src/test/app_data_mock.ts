import type { DataRecord } from "../lib/app_data";

/** In-memory IPC double; filesystem semantics are covered by Rust store tests. */
export function createDataMock() {
  const records = new Map<string, DataRecord<unknown>>();
  let account = "Default";
  const calls: { account: string; request: Record<string, unknown> }[] = [];
  return {
    records, calls,
    reset() { records.clear(); calls.length = 0; account = "Default"; },
    switchAccount(next: string) { account = next; },
    async invoke(args: { account: string; request: Record<string, unknown> }) {
      if (args.account !== account) throw new Error("账号已切换");
      calls.push(structuredClone(args));
      const r = args.request;
      const prefix = JSON.stringify([account, r.category, r.collection]);
      const key = `${prefix}:${r.key}`;
      if (r.op === "get") return structuredClone(records.get(key) ?? null);
      if (r.op === "list") return structuredClone([...records].filter(([k]) => k.startsWith(`${prefix}:`)).map(([, value]) => value));
      if (r.op === "put") {
        const existing = records.get(key);
        if (existing && r.if_absent) return structuredClone(existing);
        if (existing && existing.version > Number(r.version)) throw new Error("禁止用旧版数据覆盖新版记录");
        const record = { key: String(r.key), version: Number(r.version), value: structuredClone(r.value), updatedAt: new Date().toISOString() };
        records.set(key, record);
        return structuredClone(record);
      }
      if (r.op === "delete") records.delete(key);
      if (r.op === "clear") {
        for (const k of records.keys()) {
          const scope = JSON.parse(k.slice(0, k.indexOf("]:") + 1));
          if (scope[0] === account && scope[1] === r.category && (!r.collection || scope[2] === r.collection)) records.delete(k);
        }
      }
      if (r.op === "overview") return {
        directory: "D:\\应用数据", totalBytes: records.size * 1024,
        categories: ["cache", "history", "state"].map((category) => ({ category, files: [...records.keys()].filter((k) => k.startsWith(JSON.stringify([account, category]).slice(0, -1) + ",")).length, bytes: 1024 })),
      };
      if (r.op === "relocate") return { previousDirectory: "D:\\原应用数据" };
      return null;
    },
  };
}
