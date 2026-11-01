import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideoLivePlayer from "../video_live_player";
import VideoLivePanel from "../video_live_panel";
import { Link, MemoryRouter } from "react-router-dom";
import RetainedVideoWorkspace from "../retained_video_workspace";
import { resetVideoWorkspace } from "../../lib/video_workspace";
import type { CanvasLiveInfo, CanvasLiveSession } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), port: 3030, supported: true, instances: [] as {
  url: string; config: Record<string, unknown>; element?: HTMLVideoElement; destroy: ReturnType<typeof vi.fn>; stopLoad: ReturnType<typeof vi.fn>;
  onError?: (event: string, data: { fatal: boolean }) => void; liveSyncPosition: number;
}[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/config", () => ({ getConfig: async () => ({ proxy_port: mocks.port }) }));
vi.mock("hls.js", () => ({ default: class {
  static Events = { ERROR: "error" };
  static isSupported() { return mocks.supported; }
  url = ""; element?: HTMLVideoElement; liveSyncPosition = 42; destroy = vi.fn(); stopLoad = vi.fn();
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
  vi.clearAllMocks(); mocks.instances.length = 0; mocks.supported = true; mocks.port = 3030;
  Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => null });
  mocks.invoke.mockImplementation(async (command: string) => command === "get_video_live_info" ? info : true);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers();
  Reflect.deleteProperty(document, "pictureInPictureElement");
});
const props = { session, canvasCourseId: 10, onClose: () => {} };
describe("live player lifecycle", () => {
  it("offers port settings for proxy startup failures and reconnects on the saved port", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "prepare_proxy") return false;
      return info;
    });
    render(<MemoryRouter><VideoLivePlayer {...props} /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "配置播放代理端口" })).toHaveAttribute("href", "/settings?focus=proxy-port");
    expect(screen.getByText("播放代理端口 3030 无法使用，请更换端口后重试。")).toBeVisible();
    expect(screen.getByText("播放代理启动检查未通过", { exact: false })).not.toBeVisible();
    expect(screen.getAllByRole("button", { name: "重新连接" })).toHaveLength(1);
    expect(mocks.instances).toHaveLength(0);
    mocks.port = 3031;
    mocks.invoke.mockImplementation(async (command: string) => command === "get_video_live_info" ? info : true);
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await waitFor(() => expect(mocks.instances).toHaveLength(1));
    expect(mocks.instances[0].url).toContain("http://localhost:3031/canvas-stream/");
    expect(screen.queryByRole("link", { name: "配置播放代理端口" })).not.toBeInTheDocument();
  });
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
    expect(screen.getByLabelText("课堂直播播放器")).not.toBeVisible();
    expect(mocks.instances[1].destroy).toHaveBeenCalled();
  });

  it("keeps the video element, camera, volume and PiP over a break and the next lesson", async () => {
    vi.useFakeTimers();
    const next = { ...session, id: "2", beginTime: "2026-10-12 14:50" };
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<VideoLivePlayer {...props} nextSession={next} />); });
    const video = screen.getByLabelText("课堂直播播放器") as HTMLVideoElement;
    video.volume = 0.4; video.muted = true;
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "直播机位" }));
    fireEvent.click(screen.getByRole("option", { name: "课件" }));
    fireEvent.canPlay(video);
    let pip: Element | null = video;
    vi.spyOn(document, "pictureInPictureElement", "get").mockImplementation(() => pip);
    const requestPip = vi.fn(async () => { pip = video; });
    Object.defineProperty(video, "requestPictureInPicture", { configurable: true, value: requestPip });
    mocks.instances[1].destroy.mockImplementation(() => {
      pip = null;
      fireEvent(video, new Event("leavepictureinpicture"));
    });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByText(/等待下一节自动接续/)).toBeInTheDocument();
    expect(mocks.instances[1].stopLoad).toHaveBeenCalled();
    expect(mocks.instances[1].destroy).not.toHaveBeenCalled();
    expect(pip).toBe(video);
    mocks.invoke.mockImplementation(async (command: string) => command === "get_video_live_info" ? { ...info, finishTime: 90_100, serverTime: 30_100, tracks: [...info.tracks].reverse() } : true);
    await act(async () => { view.rerender(<VideoLivePlayer {...props} session={next} />); });
    expect(screen.getByLabelText("课堂直播播放器")).toBe(video);
    expect(mocks.instances[2].url).toContain("/live/b.m3u8");
    expect(screen.getByRole("combobox", { name: "直播机位" })).toHaveTextContent("课件");
    expect(video.volume).toBe(0.4); expect(video.muted).toBe(true);
    await act(async () => { fireEvent.canPlay(video); });
    expect(requestPip).toHaveBeenCalledOnce(); expect(pip).toBe(video);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("offers one-click PiP recovery if the browser requires a user gesture", async () => {
    const view = render(<VideoLivePlayer {...props} />);
    await screen.findByRole("combobox", { name: "直播机位" });
    const video = screen.getByLabelText("课堂直播播放器") as HTMLVideoElement;
    fireEvent.canPlay(video);
    let pip: Element | null = video;
    vi.spyOn(document, "pictureInPictureElement", "get").mockImplementation(() => pip);
    const requestPip = vi.fn().mockRejectedValueOnce(new DOMException("User gesture required", "NotAllowedError")).mockImplementation(async () => { pip = video; });
    Object.defineProperty(video, "requestPictureInPicture", { configurable: true, value: requestPip });
    mocks.instances[0].destroy.mockImplementation(() => { pip = null; fireEvent(video, new Event("leavepictureinpicture")); });
    view.rerender(<VideoLivePlayer {...props} session={{ ...session, id: "2" }} />);
    await waitFor(() => expect(mocks.instances).toHaveLength(2));
    fireEvent.canPlay(video);
    fireEvent.click(await screen.findByRole("button", { name: "恢复画中画" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "恢复画中画" })).not.toBeInTheDocument());
    expect(requestPip).toHaveBeenCalledTimes(2); expect(pip).toBe(video);
  });

  it("respects manual pause and a manual PiP exit when moving to another lesson", async () => {
    const view = render(<VideoLivePlayer {...props} />);
    await screen.findByRole("combobox", { name: "直播机位" });
    const video = screen.getByLabelText("课堂直播播放器") as HTMLVideoElement;
    fireEvent.canPlay(video); fireEvent.pause(video);
    vi.spyOn(document, "pictureInPictureElement", "get").mockReturnValue(null);
    const requestPip = vi.fn();
    Object.defineProperty(video, "requestPictureInPicture", { configurable: true, value: requestPip });
    fireEvent(video, new Event("leavepictureinpicture"));
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    view.rerender(<VideoLivePlayer {...props} session={{ ...session, id: "2" }} />);
    await waitFor(() => expect(mocks.instances).toHaveLength(2));
    fireEvent.canPlay(video);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(requestPip).not.toHaveBeenCalled();
  });

  it("lets the user resume when the next lesson's autoplay is blocked", async () => {
    render(<VideoLivePlayer {...props} />);
    await screen.findByRole("combobox", { name: "直播机位" });
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
    fireEvent.canPlay(screen.getByLabelText("课堂直播播放器"));
    fireEvent.click(await screen.findByRole("button", { name: "继续播放" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("retries a not-yet-open next lesson and cancels delayed attempts on close", async () => {
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<VideoLivePlayer {...props} />); });
    mocks.invoke.mockRejectedValue(new Error("直播未开始"));
    await act(async () => { view.rerender(<VideoLivePlayer {...props} session={{ ...session, id: "2" }} />); });
    expect(screen.getByText(/下一节直播暂未就绪/)).toBeInTheDocument();
    const requests = () => mocks.invoke.mock.calls.filter(([name]) => name === "get_video_live_info").length;
    const before = requests();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(requests()).toBe(before + 1);
    view.unmount();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(requests()).toBe(before + 1);
  });

  it("bounds retries when the following lesson remains unavailable", async () => {
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<VideoLivePlayer {...props} />); });
    mocks.invoke.mockRejectedValue(new Error("直播未开始"));
    await act(async () => { view.rerender(<VideoLivePlayer {...props} session={{ ...session, id: "2" }} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText("Error: 直播未开始")).toBeInTheDocument();
    const calls = mocks.invoke.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "重新连接" })).toBeEnabled();
  });

  it("restores WebKit picture-in-picture when native HLS switches lessons", async () => {
    mocks.supported = false;
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
    const view = render(<VideoLivePlayer {...props} />);
    await screen.findByRole("combobox", { name: "直播机位" });
    const video = screen.getByLabelText("课堂直播播放器") as HTMLVideoElement;
    fireEvent.canPlay(video);
    let mode = "picture-in-picture";
    const setMode = vi.fn((next: string) => { mode = next; fireEvent(video, new Event("webkitpresentationmodechanged")); });
    Object.defineProperty(video, "webkitPresentationMode", { configurable: true, get: () => mode });
    Object.assign(video, { webkitSetPresentationMode: setMode });
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(() => {
      mode = "inline"; fireEvent(video, new Event("webkitpresentationmodechanged"));
    });
    await act(async () => { view.rerender(<VideoLivePlayer {...props} session={{ ...session, id: "2" }} />); });
    expect(screen.getByLabelText("课堂直播播放器")).toBe(video);
    await act(async () => { fireEvent.canPlay(video); });
    expect(setMode).toHaveBeenCalledWith("picture-in-picture");
    expect(mode).toBe("picture-in-picture"); expect(mocks.instances).toHaveLength(0);
  });

  it("continues the actual panel's next lesson in the background and releases PiP on close", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const current = { ...session, teachingClassId: 7, enabled: true, startTime: now - 1000, finishTime: now + 2000, endTime: "2026-10-26 13:50" };
    const next = { ...current, id: "2", startTime: now + 4000, finishTime: now + 8000 };
    mocks.invoke.mockImplementation(async (command: string, args?: { courseId: string }) => {
      if (command === "get_video_live_sessions") return { sessions: [current, next], serverTime: Date.now() };
      if (command === "get_video_live_info") {
        const lesson = args?.courseId === "2" ? next : current;
        return { ...info, startTime: lesson.startTime, finishTime: lesson.finishTime, serverTime: Date.now() };
      }
      return true;
    });
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<VideoLivePanel canvasCourseId={10} refresh={0} playback="live" onPlay={() => {}} />); });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "观看直播" })[0]); });
    const video = screen.getByLabelText("课堂直播播放器");
    fireEvent.canPlay(video);
    let pip: Element | null = video;
    vi.spyOn(document, "pictureInPictureElement", "get").mockImplementation(() => pip);
    const restore = vi.fn(async () => { pip = video; });
    const exit = vi.fn(async () => { pip = null; });
    Object.defineProperty(video, "requestPictureInPicture", { configurable: true, value: restore });
    Object.defineProperty(document, "exitPictureInPicture", { configurable: true, value: exit });
    mocks.instances[0].destroy.mockImplementation(() => { pip = null; fireEvent(video, new Event("leavepictureinpicture")); });
    view.rerender(<VideoLivePanel visible={false} canvasCourseId={10} refresh={0} playback="live" onPlay={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText(/等待下一节自动接续/)).toBeInTheDocument();
    expect(pip).toBe(video);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.invoke).toHaveBeenCalledWith("get_video_live_info", { courseId: "2", canvasCourseId: 10, teachingClassId: undefined });
    expect(screen.getByLabelText("课堂直播播放器")).toBe(video);
    await act(async () => { fireEvent.canPlay(video); });
    expect(restore).toHaveBeenCalledOnce(); expect(pip).toBe(video);
    fireEvent.click(screen.getByRole("button", { name: "关闭直播" }));
    expect(exit).toHaveBeenCalledOnce(); expect(pip).toBeNull();
    const calls = mocks.invoke.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    Reflect.deleteProperty(document, "exitPictureInPicture");
  });
});
