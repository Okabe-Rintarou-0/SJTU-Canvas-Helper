import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSummaryCache, writeSummaryCache, deleteSummaryCache, summaryCacheKey, type VideoSummaryCache } from "./video_summary_cache";
import type { CanvasVideo } from "./model";
const scopes = [{ id: "day", title: "课堂", videos: [{ source: "canvas", videoId: "a", videoName: "录像", playable: true, courseBeginTime: "2026-09-28 08:00", courseEndTime: "2026-09-28 08:45" } as CanvasVideo] }];
const entry: VideoSummaryCache = { key: "key", namespace: "account-course-model", title: "课程", scopes, organization: "combined", text: "字幕", coverage: "1/1", savedAt: "2026-09-29T00:00:00Z", messages: [{ id: "m", role: "assistant", content: "总结", createdAt: "2026-09-29T00:00:00Z" }] };
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe("video summary persistence", () => {
  it("rebuilds old contexts after OCR adaptation and material format changes", () => {
    localStorage.setItem("video-material-summaries-v2", JSON.stringify([entry]));
    localStorage.setItem("video-material-summaries-v3", JSON.stringify([entry]));
    localStorage.setItem("video-material-summaries-v5", JSON.stringify([entry]));
    expect(readSummaryCache()).toEqual([]);
    expect(writeSummaryCache({ ...entry, text: "完整 OCR 上下文" })).toBe(true);
    expect(readSummaryCache()[0].text).toBe("完整 OCR 上下文");
  });
  it("isolates account/course/model, recording set and organization", () => {
    const key = summaryCacheKey("a", scopes, "combined");
    expect(summaryCacheKey("b", scopes, "combined")).not.toBe(key);
    expect(summaryCacheKey("a", scopes, "sessions")).not.toBe(key);
    expect(summaryCacheKey("a", [{ ...scopes[0], videos: [{ ...scopes[0].videos[0], videoId: "b" }] }], "combined")).not.toBe(key);
    expect(summaryCacheKey("a", [{ ...scopes[0], title: "不同入口标题" }], "combined")).toBe(key);
  });
  it("persists the complete conversation and context, replaces matching entries and deletes explicitly", () => {
    expect(writeSummaryCache(entry)).toBe(true);
    expect(readSummaryCache()).toEqual([entry]);
    writeSummaryCache({ ...entry, text: "更新字幕" });
    expect(readSummaryCache()).toHaveLength(1);
    expect(readSummaryCache()[0].text).toBe("更新字幕");
    expect(deleteSummaryCache(entry.key)).toBe(true);
    expect(readSummaryCache()).toEqual([]);
  });
  it("bounds storage and tolerates corrupt or unavailable storage", () => {
    for (let i = 0; i < 15; i++) writeSummaryCache({ ...entry, key: String(i) });
    expect(readSummaryCache()).toHaveLength(12);
    expect(readSummaryCache()[0].key).toBe("14");
    expect(writeSummaryCache({ ...entry, text: "中".repeat(1_100_000) })).toBe(false);
    localStorage.setItem("video-material-summaries-v6", "{bad json");
    expect(readSummaryCache()).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(writeSummaryCache(entry)).toBe(false);
  });
});
