import { beforeEach, expect, it, vi } from "vitest";
import { inspectSummaryScope } from "./video_summary_preflight";
import type { CanvasVideo } from "./model";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./video_library_tasks", () => ({ recordingRequest: (video: CanvasVideo) => ({ key: video.videoId }) }));
const videos = ["a", "b", "c"].map((videoId) => ({ source: "canvas", videoId, playable: true }) as CanvasVideo);
const scopes = [{ id: "day", title: "课堂", videos }];
beforeEach(() => vi.resetAllMocks());

it("distinguishes missing subtitles, already saved transcripts and failed checks without starting work", async () => {
  mocks.invoke.mockImplementation(async (_command, args) => {
    if (args.request.key === "c") throw new Error("网络错误");
    return { subtitleAvailable: false, transcriptAvailable: args.request.key === "b" };
  });
  expect(await inspectSummaryScope(scopes)).toEqual({ missing: 2, needsTranscription: 1, savedTranscripts: 1, unknown: 1 });
  expect(mocks.invoke.mock.calls.every(([command]) => command === "inspect_video_recording")).toBe(true);
});

it("offers transcription for playable legacy sources while available captions need none", async () => {
  mocks.invoke.mockImplementation(async (_command, args) => ({ subtitleAvailable: args.request.key === "a", transcriptAvailable: false }));
  expect(await inspectSummaryScope([{ ...scopes[0], videos: [videos[0], { ...videos[1], source: "legacy" }] }]))
    .toEqual({ missing: 1, needsTranscription: 1, savedTranscripts: 0, unknown: 0 });
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
