import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VideoLivePanel from "../video_live_panel";
import type { CanvasLiveList } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../video_live_player", () => ({ default: ({ session, onClose }: { session: { id: string }; onClose: () => void }) => <div data-testid="live-player">直播 {session.id}<button onClick={onClose}>关闭直播</button></div> }));
const now = Date.now();
const list: CanvasLiveList = { serverTime: now, sessions: [
  { id: "live", teachingClassId: 2, title: "课程", teacherName: "老师", classroomName: "教室", beginTime: "2026-10-12 13:55", endTime: "2026-10-12 14:50", startTime: now - 60_000, finishTime: now + 600_000, enabled: true },
  { id: "next", teachingClassId: 2, title: "课程", teacherName: "老师", classroomName: "教室", beginTime: "2026-10-12 14:50", endTime: "2026-10-12 15:45", startTime: now + 600_000, finishTime: now + 1200_000, enabled: true },
] };
beforeEach(() => { vi.clearAllMocks(); mocks.invoke.mockResolvedValue(list); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("live course panel", () => {
  it("pauses list polling off-page while keeping the live player mounted", async () => {
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<VideoLivePanel canvasCourseId={10} refresh={0} playback="live" onPlay={() => {}} />); });
    fireEvent.click(screen.getAllByRole("button", { name: "观看直播" })[0]);
    const player = screen.getByTestId("live-player");
    view.rerender(<VideoLivePanel visible={false} canvasCourseId={10} refresh={0} playback="live" onPlay={() => {}} />);
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(mocks.invoke).toHaveBeenCalledOnce(); expect(screen.getByTestId("live-player")).toBe(player);
    await act(async () => { view.rerender(<VideoLivePanel visible canvasCourseId={10} refresh={0} playback="live" onPlay={() => {}} />); });
    expect(mocks.invoke).toHaveBeenCalledTimes(2); expect(screen.getByTestId("live-player")).toBe(player);
  });
  it("shows live and upcoming sections and prevents playing an upcoming section", async () => {
    const onPlay = vi.fn();
    const view = render(<VideoLivePanel canvasCourseId={10} refresh={0} playback="live" onPlay={onPlay} />);
    await screen.findByText("直播中");
    expect(mocks.invoke).toHaveBeenCalledWith("get_video_live_sessions", { canvasCourseId: 10, teachingClassId: undefined });
    const buttons = screen.getAllByRole("button", { name: "观看直播" });
    expect(buttons[0]).toBeEnabled(); expect(buttons[1]).toBeDisabled();
    fireEvent.click(buttons[0]); expect(onPlay).toHaveBeenCalledOnce();
    expect(screen.getByTestId("live-player")).toHaveTextContent("直播 live");
    view.rerender(<VideoLivePanel canvasCourseId={10} refresh={0} playback="recording" onPlay={onPlay} />);
    expect(screen.queryByTestId("live-player")).not.toBeInTheDocument();
  });
  it("provides retry after a list error and shows a real empty state", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("连接失败"));
    render(<VideoLivePanel teachingClassId={2} refresh={0} playback="live" onPlay={() => {}} />);
    await screen.findByText(/读取直播失败/);
    mocks.invoke.mockResolvedValueOnce({ sessions: [], serverTime: now });
    fireEvent.click(screen.getByRole("button", { name: "刷新直播" }));
    await screen.findByText("本课程当前暂无直播安排。");
    expect(screen.queryByText(/读取直播失败/)).not.toBeInTheDocument();
  });
  it("ignores stale list requests when the course changes", async () => {
    let finish!: (value: CanvasLiveList) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise<CanvasLiveList>((resolve) => { finish = resolve; }));
    const view = render(<VideoLivePanel canvasCourseId={10} refresh={0} playback="live" onPlay={() => {}} />);
    view.rerender(<VideoLivePanel canvasCourseId={20} refresh={0} playback="live" onPlay={() => {}} />);
    await screen.findByText("直播中");
    finish({ sessions: [], serverTime: now });
    await waitFor(() => expect(screen.getByText("直播中")).toBeInTheDocument());
  });
});
