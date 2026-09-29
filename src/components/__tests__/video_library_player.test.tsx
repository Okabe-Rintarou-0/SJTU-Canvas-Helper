import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import VideoLibraryPlayer from "../video_library_player";
import type { CanvasVideo } from "../../lib/model";

const mocks = vi.hoisted(() => ({ download: vi.fn(), resolve: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({ srt: "" })) }));
vi.mock("../../lib/config", () => ({ getConfig: async () => ({ proxy_port: 9999 }) }));
vi.mock("../../lib/video_library_tasks", () => ({ resolveRecording: mocks.resolve, recordingRequest: () => ({}), enqueueVideoTrack: mocks.download }));
const recording = { source: "canvas", videoId: "a", videoName: "第一节", courseBeginTime: "2026-09-28 08:00", playable: true } as CanvasVideo;
const tracks = [{ id: 1, rtmpUrlHdv: "https://example.test/one.mp4" }, { id: 2, rtmpUrlHdv: "https://example.test/two.mp4" }];
beforeEach(() => {
  mocks.resolve.mockResolvedValue({ source: "canvas", info: { videoPlayResponseVoList: tracks } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, "paused", { configurable: true, value: false }); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, "paused", { configurable: true, value: true }); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
async function load() {
  render(<VideoLibraryPlayer session={{ id: "a", title: "课堂", videos: [recording] }} initialKey="canvas:a" onClose={() => {}} onSummarize={() => {}} />);
  await screen.findByRole("button", { name: "下载当前机位" });
}
describe("video player compatibility", () => {
  it("keeps the same video mounted when minimized and seeks citations without reloading", async () => {
    const props = { session: { id: "a", title: "课堂", videos: [recording] }, initialKey: "canvas:a", onClose: () => {}, onSummarize: vi.fn() };
    const view = render(<VideoLibraryPlayer {...props} seconds={0} seekRequest="first" />);
    await screen.findByRole("button", { name: "下载当前机位" });
    expect(invoke).toHaveBeenCalledWith("prepare_video_material", { request: {}, preferBefore: true });
    const video = document.querySelector("video")!;
    video.currentTime = 35;
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "迷你播放" }));
    expect(document.querySelector("video")).toBe(video);
    expect(video.currentTime).toBe(35);
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    view.rerender(<VideoLibraryPlayer {...props} seconds={90} seekRequest="citation" />);
    expect(document.querySelector("video")).toBe(video);
    expect(video.currentTime).toBe(90);
    expect(mocks.resolve).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "总结本堂课" }));
    expect(props.onSummarize).toHaveBeenCalledOnce();
    expect(document.querySelector("video")).toBe(video);
  });
  it("uses the citation time when switching recordings after a track change", async () => {
    const props = { session: { id: "a", title: "课堂", videos: [recording, { ...recording, videoId: "b" }] }, onClose: () => {}, onSummarize: () => {} };
    const view = render(<VideoLibraryPlayer {...props} initialKey="canvas:a" seconds={0} seekRequest="first" />);
    await screen.findByRole("button", { name: "下载当前机位" });
    document.querySelector("video")!.currentTime = 40;
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "主机位" }));
    fireEvent.click(screen.getByRole("option", { name: "机位 2" }));
    view.rerender(<VideoLibraryPlayer {...props} initialKey="canvas:b" seconds={12} seekRequest="next" />);
    await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2));
    await screen.findByRole("button", { name: "下载当前机位" });
    fireEvent.loadedMetadata(document.querySelector("video")!);
    expect(document.querySelector("video")!.currentTime).toBe(12);
  });
  it("downloads any selected track independently", async () => {
    await load();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "主机位" }));
    fireEvent.click(screen.getByRole("option", { name: "机位 2" }));
    fireEvent.click(screen.getByRole("button", { name: "下载当前机位" }));
    expect(mocks.download).toHaveBeenCalledWith(recording, tracks[1], 1);
  });
  it("swaps unsynchronized screens while preserving their individual playback states", async () => {
    await load();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "副屏" }));
    fireEvent.click(screen.getByRole("option", { name: "机位 2" }));
    fireEvent.click(screen.getByRole("button", { name: "播放设置" }));
    fireEvent.click(await screen.findByLabelText("双屏同步"));
    const before = document.querySelectorAll("video");
    before[0].currentTime = 40; before[0].playbackRate = 1.5; before[0].pause();
    before[1].currentTime = 90; before[1].playbackRate = 2; await before[1].play();
    fireEvent.click(screen.getByRole("button", { name: "交换主副屏" }));
    const after = document.querySelectorAll("video");
    fireEvent.loadedMetadata(after[0]); fireEvent.loadedMetadata(after[1]);
    await waitFor(() => expect(after[0].currentTime).toBe(90));
    expect(after[0].playbackRate).toBe(2); expect(after[0].paused).toBe(false);
    expect(after[1].currentTime).toBe(40); expect(after[1].playbackRate).toBe(1.5); expect(after[1].paused).toBe(true);
    expect(screen.getByRole("slider", { name: "副屏大小" })).toHaveAttribute("min", "0");
    expect(screen.getByRole("slider", { name: "副屏透明度" })).toHaveAttribute("min", "0.1");
  });
});
