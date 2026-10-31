import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSummaryCache, writeSummaryCache, deleteSummaryCache, migrateSummaryHistory, summaryCacheKey, withSummaryModelIdentity, PPT_CLEANUP_POLICY, type VideoSummaryCache } from "./video_summary_cache";
import { createDataMock } from "../test/app_data_mock";
import type { CanvasVideo } from "./model";
import { videoSummaryOptions } from "./video_summary_config";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const data = createDataMock();
const scopes = [{ id: "day", title: "课堂", videos: [{ source: "canvas", videoId: "a", videoName: "录像", playable: true, courseBeginTime: "2026-09-28 08:00", courseEndTime: "2026-09-28 08:45" } as CanvasVideo] }];
const namespace = `${JSON.stringify(["Default", 10, "class", "课程", "学期", "model"])}:${PPT_CLEANUP_POLICY}=0`;
const entry: VideoSummaryCache = { key: "key", namespace, title: "课程", scopes, organization: "combined", text: "字幕", coverage: "1/1", savedAt: "2026-09-29T00:00:00Z", messages: [{ id: "m", role: "assistant", content: "总结", createdAt: "2026-09-29T00:00:00Z" }] };
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); data.reset();
  mocks.invoke.mockImplementation(async (command, args) => command === "read_account_info" ? { current_account: "Default" } : data.invoke(args));
});

describe("video summary history", () => {
  it.each(["ppt-cleanup-v3", PPT_CLEANUP_POLICY])("regenerates %s with the current model while retaining scope", (policy) => {
    const course = ["account", 10, "class-id", "课程", "学期"];
    const original = `${JSON.stringify([...course, "old-model"])}:${policy}=0`;
    const regenerated = withSummaryModelIdentity(original, "new-model");
    expect(regenerated).toBe(`${JSON.stringify([...course, "new-model"])}:${policy}=0`);
    expect(summaryCacheKey(regenerated, scopes, "combined")).not.toBe(summaryCacheKey(original, scopes, "combined"));
  });
  it("migrates only the current account, retains full context, and never replaces disk history", async () => {
    const other = { ...entry, key: "other", namespace: namespace.replace('"Default"', '"Study"') };
    const saved = { ...entry, preparedContext: { sourceHash: "source", text: "压缩笔记" }, summaryOptions: videoSummaryOptions() };
    localStorage.setItem("video-material-summaries-v7", JSON.stringify([saved, other, { invalid: true }]));
    expect(await readSummaryCache()).toEqual([saved]);
    expect(JSON.parse(localStorage.getItem("video-material-summaries-v7")!)).toEqual([other, { invalid: true }]);
    await writeSummaryCache({ ...saved, text: "新上下文" });
    localStorage.setItem("video-material-summaries-v7", JSON.stringify([saved]));
    expect((await readSummaryCache())[0].text).toBe("新上下文");
    expect(localStorage.getItem("video-material-summaries-v7")).toBeNull();
  });
  it("keeps legacy data on failure and retries imports without duplicates", async () => {
    localStorage.setItem("video-material-summaries-v7", JSON.stringify([entry]));
    mocks.invoke.mockRejectedValueOnce(new Error("磁盘不可用"));
    await expect(migrateSummaryHistory("Default")).rejects.toThrow("磁盘不可用");
    expect(localStorage.getItem("video-material-summaries-v7")).not.toBeNull();
    await migrateSummaryHistory("Default");
    expect(await readSummaryCache()).toEqual([entry]);
    expect(localStorage.getItem("video-material-summaries-v7")).toBeNull();
  });
  it("surfaces corrupt legacy data without deleting it", async () => {
    localStorage.setItem("video-material-summaries-v7", "{bad json");
    await expect(readSummaryCache()).rejects.toThrow("原数据已保留");
    expect(localStorage.getItem("video-material-summaries-v7")).toBe("{bad json");
  });
  it("retries safely when disk import succeeds but legacy cleanup fails", async () => {
    localStorage.setItem("video-material-summaries-v7", JSON.stringify([entry]));
    const cleanup = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => { throw new Error("storage unavailable"); });
    await expect(migrateSummaryHistory("Default")).rejects.toThrow("storage unavailable");
    expect(data.records.size).toBe(1);
    expect(localStorage.getItem("video-material-summaries-v7")).not.toBeNull();
    cleanup.mockRestore();
    await migrateSummaryHistory("Default");
    expect(await readSummaryCache()).toEqual([entry]);
    expect(data.records.size).toBe(1);
  });
  it("retains histories beyond the old cache quota and deletes explicitly", async () => {
    for (let i = 0; i < 15; i++) expect(await writeSummaryCache({ ...entry, key: String(i) })).toBe(true);
    expect(await readSummaryCache()).toHaveLength(15);
    expect(await writeSummaryCache({ ...entry, text: "中".repeat(1_100_000) })).toBe(true);
    expect((await readSummaryCache()).find((e) => e.key === entry.key)?.text.length).toBe(1_100_000);
    expect(await deleteSummaryCache(entry.key)).toBe(true);
    expect(await readSummaryCache()).toHaveLength(15);
  });
  it("isolates accounts and refuses a write after account switching", async () => {
    expect(await writeSummaryCache(entry)).toBe(true);
    data.switchAccount("Study");
    expect(await readSummaryCache("Study")).toEqual([]);
    expect(await writeSummaryCache(entry, "Study")).toBe(false);
    expect(await writeSummaryCache(entry, "Default")).toBe(false);
  });
  it("separates course/model, recording sets, organization and preferences", () => {
    const key = summaryCacheKey("a", scopes, "combined");
    expect(summaryCacheKey("b", scopes, "combined")).not.toBe(key);
    expect(summaryCacheKey("a", scopes, "sessions")).not.toBe(key);
    expect(summaryCacheKey("a", [{ ...scopes[0], videos: [{ ...scopes[0].videos[0], videoId: "b" }] }], "combined")).not.toBe(key);
    expect(summaryCacheKey("a", [{ ...scopes[0], title: "不同入口标题" }], "combined")).toBe(key);
    const options = videoSummaryOptions();
    for (const changed of [{ ...options, prompt: "详细推导" }, { ...options, contextTokens: 32768 }, { ...options, outputTokens: 4096 }]) {
      expect(summaryCacheKey("a", scopes, "combined", changed)).not.toBe(summaryCacheKey("a", scopes, "combined", options));
    }
  });
});
