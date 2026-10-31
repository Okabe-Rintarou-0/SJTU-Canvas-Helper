import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import VideoLibraryPlayer from "../video_library_player";
import { Link, MemoryRouter } from "react-router-dom";
import RetainedVideoWorkspace from "../retained_video_workspace";
import type { CanvasVideo } from "../../lib/model";

const mocks = vi.hoisted(() => ({ download: vi.fn(), resolve: vi.fn(), port: 9999 }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({ srt: "" })) }));
vi.mock("../../lib/config", () => ({ getConfig: async () => ({ proxy_port: mocks.port }) }));
vi.mock("../../lib/video_library_tasks", () => ({ resolveRecording: mocks.resolve, recordingRequest: () => ({}), enqueueVideoTrack: mocks.download }));
const recording = { source: "canvas", videoId: "a", videoName: "第一节", courseBeginTime: "2026-09-28 08:00", playable: true } as CanvasVideo;
const tracks = [{ id: 1, rtmpUrlHdv: "https://example.test/one.mp4" }, { id: 2, rtmpUrlHdv: "https://example.test/two.mp4" }];
beforeEach(() => {
  mocks.port = 9999;
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.mocked(invoke).mockImplementation(async () => ({ srt: "" }) as never);
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
  it("guides proxy failures to port settings and retries with the updated port", async () => {
    mocks.resolve.mockResolvedValue({ source: "canvas", info: { videoPlayResponseVoList: [
      { id: 1, rtmpUrlHdv: "https://videos.sjtu.edu.cn/vod/a.mp4" },
    ] } });
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "prepare_proxy") throw new Error("Failed to download video 播放代理无法绑定 127.0.0.1:9999：error creating server listener (os error 10013)");
      return { srt: "" } as never;
    });
    render(<MemoryRouter><VideoLibraryPlayer session={{ id: "a", title: "课堂", videos: [recording] }} initialKey="canvas:a" onClose={() => {}} onSummarize={() => {}} /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "配置播放代理端口" })).toHaveAttribute("href", "/settings?focus=proxy-port");
    expect(screen.getByText("播放代理端口 9999 无法使用，请更换端口后重试。")).toBeVisible();
    expect(screen.getByText(/Error: Failed to download video/)).not.toBeVisible();
    expect(screen.queryByText(/请前往「设置/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("技术详情"));
    expect(screen.getByText(/os error 10013/)).toBeVisible();
    mocks.port = 3031;
    vi.mocked(invoke).mockImplementation(async (command: string) => command === "prepare_proxy" ? true as never : { srt: "" } as never);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("button", { name: "下载当前机位" });
    expect(document.querySelector("video")).toHaveAttribute("src", "http://localhost:3031/canvas-vod/a.mp4");
    expect(screen.queryByRole("link", { name: "配置播放代理端口" })).not.toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "prepare_proxy")).toHaveLength(2);
    fireEvent.error(document.querySelector("video")!);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "prepare_proxy")).toHaveLength(3));
  });
  it("explicitly releases media when closed, without stopping the shared proxy", async () => {
    const view = render(<VideoLibraryPlayer session={{ id: "a", title: "课堂", videos: [recording] }} initialKey="canvas:a" onClose={() => {}} onSummarize={() => {}} />);
    await screen.findByRole("button", { name: "下载当前机位" });
    const media = document.querySelector("video")!;
    await media.play(); view.unmount();
    expect(media.paused).toBe(true); expect(media).not.toHaveAttribute("src");
    expect(media.load).toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalledWith("stop_proxy");
  });

  it("does not start a proxy or fetch subtitles after the player was closed during resolution", async () => {
    let finish!: (value: unknown) => void;
    mocks.resolve.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(<VideoLibraryPlayer session={{ id: "a", title: "课堂", videos: [recording] }} initialKey="canvas:a" onClose={() => {}} onSummarize={() => {}} />);
    view.unmount();
    finish({ source: "canvas", info: { videoPlayResponseVoList: [{ id: 1, rtmpUrlHdv: "https://videos.sjtu.edu.cn/vod/a.mp4" }] } });
    await Promise.resolve(); await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("keeps the same playing or paused media element, timestamp and speed when navigating", async () => {
    const session = { id: "a", title: "课堂", videos: [recording] };
    render(<MemoryRouter initialEntries={["/video"]}>
      <Link to="/settings">离开视频</Link><Link to="/video">返回视频</Link>
      <RetainedVideoWorkspace>{() => <VideoLibraryPlayer session={session} initialKey="canvas:a" onClose={() => {}} onSummarize={() => {}} />}</RetainedVideoWorkspace>
    </MemoryRouter>);
    await screen.findByRole("button", { name: "下载当前机位" });
    const media = document.querySelector("video")!;
    media.currentTime = 123; media.playbackRate = 1.5; await media.play();
    fireEvent.click(screen.getByRole("link", { name: "离开视频" }));
    expect(document.querySelector("video")).toBe(media);
    expect(media.paused).toBe(false);
    media.currentTime = 130;
    fireEvent.click(screen.getByRole("link", { name: "返回视频" }));
    expect(document.querySelector("video")).toBe(media);
    expect(media.currentTime).toBe(130); expect(media.playbackRate).toBe(1.5);
    media.pause();
    fireEvent.click(screen.getByRole("link", { name: "离开视频" }));
    fireEvent.click(screen.getByRole("link", { name: "返回视频" }));
    expect(media.paused).toBe(true); expect(mocks.resolve).toHaveBeenCalledOnce();
  });
  it("disables its summary action when the list reports no AI materials", async () => {
    const onSummarize = vi.fn();
    render(<VideoLibraryPlayer session={{ id: "a", title: "课堂", videos: [{ ...recording, aiAvailable: false }] }} initialKey="canvas:a" onClose={() => {}} onSummarize={onSummarize} />);
    await screen.findByRole("button", { name: "下载当前机位" });
    const reads = vi.mocked(invoke).mock.calls.length;
    expect(screen.getByRole("button", { name: "总结本堂课" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "总结本堂课" }));
    expect(onSummarize).not.toHaveBeenCalled();
    expect(vi.mocked(invoke).mock.calls).toHaveLength(reads);
  });
  it("plays without fetching or displaying PPT OCR", async () => {
    await load();
    expect(invoke).not.toHaveBeenCalledWith("get_recording_slides", expect.anything());
    expect(invoke).toHaveBeenCalledWith("prepare_video_material", { request: {}, preferBefore: true, includeOcr: false });
    expect(screen.queryByRole("region", { name: "PPT 面板" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /显示 PPT|收起 PPT/ })).not.toBeInTheDocument();
  });
  it("keeps the same video mounted when minimized and seeks citations without reloading", async () => {
    const props = { session: { id: "a", title: "课堂", videos: [recording] }, initialKey: "canvas:a", onClose: () => {}, onSummarize: vi.fn() };
    const view = render(<VideoLibraryPlayer {...props} seconds={0} seekRequest="first" />);
    await screen.findByRole("button", { name: "下载当前机位" });
    expect(invoke).toHaveBeenCalledWith("prepare_video_material", { request: {}, preferBefore: true, includeOcr: false });
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
