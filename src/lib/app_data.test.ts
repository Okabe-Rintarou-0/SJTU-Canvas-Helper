import { beforeEach, expect, it, vi } from "vitest";
import { defineDataCollection, subscribeAppData } from "./app_data";
import { createDataMock } from "../test/app_data_mock";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const data = createDataMock();
const valid = (value: unknown): value is { seconds: number } => !!value && typeof value === "object" && "seconds" in value && typeof value.seconds === "number";
beforeEach(() => { data.reset(); mocks.invoke.mockImplementation(async (_, args) => data.invoke(args)); });

it("stores playback-shaped state and local AI artifacts through the same usable API", async () => {
  const positions = defineDataCollection({ category: "state", name: "video-positions", version: 1, validate: valid });
  const state = positions.forAccount("Default");
  await state.set("course:10/video:a", { seconds: 83.5 });
  const reopened = defineDataCollection({ category: "state", name: "video-positions", version: 1, validate: valid }).forAccount("Default");
  expect(await reopened.get("course:10/video:a")).toEqual({ seconds: 83.5 });
  const artifacts = defineDataCollection({ category: "history", name: "local-ai-refinements", version: 1, validate: (v: unknown): v is string => typeof v === "string" }).forAccount("Default");
  await artifacts.set("draft", "精校后的中文内容");
  expect(await artifacts.get("draft")).toBe("精校后的中文内容");
  await artifacts.clear();
  expect(await state.get("course:10/video:a")).toEqual({ seconds: 83.5 });
});

it("validates schema, upgrades old records, and rejects unknown future versions", async () => {
  const old = defineDataCollection({ category: "state", name: "positions", version: 1, validate: valid }).forAccount("Default");
  await old.set("a", { seconds: 20 });
  const next = defineDataCollection({ category: "state", name: "positions", version: 2, validate: valid,
    migrate: (value) => ({ seconds: (value as { seconds: number }).seconds + 1 }) }).forAccount("Default");
  expect(await next.get("a")).toEqual({ seconds: 21 });
  expect((await next.list())[0].version).toBe(2);
  await expect(old.get("a")).rejects.toThrow("数据版本较新");
  await expect(old.set("a", { seconds: 1 })).rejects.toThrow("禁止用旧版");
  await expect(next.set("b", { seconds: "bad" } as unknown as { seconds: number })).rejects.toThrow("数据格式无效");
});

it("pins account ownership and emits changes only after persistence succeeds", async () => {
  const listener = vi.fn(); const unsubscribe = subscribeAppData(listener);
  try {
    const bound = defineDataCollection({ category: "state", name: "positions", version: 1, validate: valid }).forAccount("Default");
    await bound.set("a", { seconds: 1 });
    expect(listener).toHaveBeenCalledWith({ account: "Default", category: "state", collection: "positions" });
    data.switchAccount("Study");
    await expect(bound.set("a", { seconds: 2 })).rejects.toThrow("账号已切换");
    expect(listener).toHaveBeenCalledTimes(1);
  } finally { unsubscribe(); }
});
