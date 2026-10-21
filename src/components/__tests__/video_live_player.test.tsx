import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideoLivePlayer from "../video_live_player";
import { Link, MemoryRouter } from "react-router-dom";
import RetainedVideoWorkspace from "../retained_video_workspace";
import { resetVideoWorkspace } from "../../lib/video_workspace";
import type { CanvasLiveInfo, CanvasLiveSession } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), supported: true, instances: [] as {
  url: string; config: Record<string, unknown>; element?: HTMLVideoElement; destroy: ReturnType<typeof vi.fn>;
  onError?: (event: string, data: { fatal: boolean }) => void; liveSyncPosition: number;
}[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/config", () => ({ getConfig: async () => ({ proxy_port: 3030 }) }));
vi.mock("hls.js", () => ({ default: class {
  static Events = { ERROR: "error" };
  static isSupported() { return mocks.supported; }
  url = ""; element?: HTMLVideoElement; liveSyncPosition = 42; destroy = vi.fn();
  onError?: (event: string, data: { fatal: boolean }) => void;
  constructor(public config: Record<string, unknown>) { mocks.instances.push(this); }
  loadSource(url: string) { this.url = url; }
  attachMedia(element: HTMLVideoElement) { this.element = element; }
  on(_event: string, callback: (event: string, data: { fatal: boolean }) => void) { this.onError = callback; }
} }));
const session = { id: "1", title: "测试课程", beginTime: "2026-10-12 13:55" } as CanvasLiveSession;
const info: CanvasLiveInfo = { startTime: 100, finishTime: 30_100, serverTime: 100, tracks: [
  { name: "老师", url: "https://mss2.sjtu.edu.cn/live/a.m3u8?auth_key=abc" },
  { name: "课件", url: "https://mss2.sjtu.edu.cn/live/b.m3u8?auth_key=xyz" },
] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.instances.length = 0; mocks.supported = true;
  mocks.invoke.mockImplementation(async (command: string) => command === "get_video_live_info" ? info : true);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const props = { session, canvasCourseId: 10, onClose: () => {} };
describe("live player lifecycle", () => {
  it("keeps the media and HLS connection through navigation, releasing them on account reset", async () => {
    render(<MemoryRouter initialEntries={["/video"]}>
      <Link to="/settings">离开视频</Link><Link to="/video">返回视频</Link>
      <RetainedVideoWorkspace>{() => <VideoLivePlayer {...props} />}</RetainedVideoWorkspace>
    </MemoryRouter>);
    await screen.findByRole("combobox", { name: "直播机位" });
    const media = document.querySelector("video");
    const hls = mocks.instances[0];
    fireEvent.click(screen.getByRole("link", { name: "离开视频" }));
    expect(media).toBeInTheDocument(); expect(media).not.toBeVisible();
    expect(hls.destroy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "返回视频" }));
    expect(document.querySelector("video")).toBe(media);
    expect(media).toBeVisible(); expect(mocks.instances).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: "离开视频" }));
    act(() => resetVideoWorkspace());
    expect(hls.destroy).toHaveBeenCalledOnce(); expect(media).not.toBeInTheDocument();
  });
  it("plays through the proxy, switches camera, goes live, and destroys HLS on close", async () => {
    const view = render(<VideoLivePlayer {...props} />);
    await screen.findByRole("combobox", { name: "直播机位" });
    expect(mocks.instances[0].url).toBe("http://localhost:3030/canvas-stream/mss2.sjtu.edu.cn/live/a.m3u8?auth_key=abc");
    expect(mocks.instances[0].config).toMatchObject({ maxBufferLength: 30, maxMaxBufferLength: 30, backBufferLength: 30, frontBufferFlushThreshold: 30 });
    expect(mocks.invoke).toHaveBeenCalledWith("prepare_proxy");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "直播机位" }));
    fireEvent.click(screen.getByRole("option", { name: "课件" }));
    expect(mocks.instances[0].destroy).toHaveBeenCalled();
    expect(mocks.instances[1].url).toContain("/live/b.m3u8?auth_key=xyz");
    fireEvent.click(screen.getByRole("button", { name: "回到直播" }));
    expect(document.querySelector("video")!.currentTime).toBe(42);
    view.unmount(); expect(mocks.instances[1].destroy).toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("stop_proxy");
  });
  it("refreshes signed playback info after a fatal connection error", async () => {
    render(<VideoLivePlayer {...props} />);
    await screen.findByRole("combobox", { name: "直播机位" });
    act(() => mocks.instances[0].onError?.("error", { fatal: true }));
    expect(screen.getByText(/直播连接中断/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await screen.findByRole("combobox", { name: "直播机位" });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_video_live_info")).toHaveLength(2);
    expect(screen.queryByText(/直播连接中断/)).not.toBeInTheDocument();
  });
  it("ends on the service deadline even when the camera changes", async () => {
    vi.useFakeTimers();
    await act(async () => { render(<VideoLivePlayer {...props} />); });
    expect(screen.getByRole("combobox", { name: "直播机位" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(20_000));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "直播机位" }));
    fireEvent.click(screen.getByRole("option", { name: "课件" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText(/本节直播已结束/)).toBeInTheDocument();
    expect(screen.queryByLabelText("课堂直播播放器")).not.toBeInTheDocument();
    expect(mocks.instances[1].destroy).toHaveBeenCalled();
  });
});
