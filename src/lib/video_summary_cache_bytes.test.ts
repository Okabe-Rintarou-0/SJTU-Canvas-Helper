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
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
function storageFixture() {
  vi.stubGlobal("localStorage", { getItem: () => null });
  let saved: unknown;
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "read_account_info") return { current_account: "Default" };
    if (args.request.op === "put") {
      saved = structuredClone({ key: args.request.key, version: 1, value: args.request.value });
      return saved;
    }
    if (args.request.op === "list") return saved ? [saved] : [];
    throw new Error("Unexpected data operation");
  });
  return { value: () => saved };
}
it("retains complete Unicode contexts beyond the former localStorage byte cap", async () => {
  storageFixture();
  expect(new Blob(["中"]).size).toBe(3);
  // Upstream now uses durable history instead of an evicting 3 MB cache.
  // Keep the old boundary inputs, but verify lossless persistence under its new contract.
  for (const count of [999_000, 1_100_000]) {
    const text = "中".repeat(count);
    expect(await writeSummaryCache({ ...entry, text })).toBe(true);
    expect((await readSummaryCache())[0].text).toBe(text);
  }
});
it("preserves the saved Unicode context when a later durable write fails", async () => {
  const storage = storageFixture();
  const text = "中".repeat(999_000);
  expect(await writeSummaryCache({ ...entry, text })).toBe(true);
  const original = structuredClone(storage.value());
  mocks.invoke.mockRejectedValueOnce(new Error("disk unavailable"));
  expect(await writeSummaryCache({ ...entry, text: "中".repeat(1_100_000) }, "Default")).toBe(false);
  expect(storage.value()).toEqual(original);
  expect((await readSummaryCache())[0].text).toBe(text);
});
