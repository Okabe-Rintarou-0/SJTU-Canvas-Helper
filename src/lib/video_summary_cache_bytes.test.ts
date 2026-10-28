// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readSummaryCache, writeSummaryCache, type VideoSummaryCache } from "./video_summary_cache";
import type { CanvasVideo } from "./model";

// Byte-budget checks need native UTF-8 Blob accounting, not jsdom's expensive
// multi-megabyte Blob emulation. DOM storage behavior remains in the sibling suite.
const entry: VideoSummaryCache = {
  key: "large", namespace: "account-course-model", title: "课程", organization: "combined",
  text: "字幕", coverage: "1/1", savedAt: "2026-09-29T00:00:00Z", messages: [],
  scopes: [{ id: "day", title: "课堂", videos: [{ source: "canvas", videoId: "a", videoName: "录像",
    playable: true, courseBeginTime: "2026-09-28 08:00", courseEndTime: "2026-09-28 08:45" } as CanvasVideo] }],
};
afterEach(() => vi.unstubAllGlobals());
function storageFixture() {
  let saved = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ ...entry, key: String(i) })));
  const setItem = vi.fn((_key: string, value: string) => { saved = value; });
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => saved), setItem });
  return { setItem, value: () => saved };
}
it("rejects the unchanged oversized Unicode context without overwriting saved summaries", () => {
  const storage = storageFixture();
  const original = storage.value();
  expect(new Blob(["中"]).size).toBe(3);
  expect(readSummaryCache()).toHaveLength(12);
  expect(writeSummaryCache({ ...entry, text: "中".repeat(1_100_000) })).toBe(false);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.value()).toBe(original);
});
it("keeps a complete near-limit Unicode context within the real byte cap", () => {
  const storage = storageFixture();
  const text = "中".repeat(999_000);
  expect(writeSummaryCache({ ...entry, text })).toBe(true);
  expect(readSummaryCache()[0].text).toBe(text);
  expect(new Blob([storage.value()]).size).toBeLessThanOrEqual(3_000_000);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});
