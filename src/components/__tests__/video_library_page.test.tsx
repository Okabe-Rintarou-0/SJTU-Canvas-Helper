import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import VideoPage from "../../page/video";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), exports: vi.fn(), open: vi.fn(),
  centerOnly: undefined as boolean | undefined,
  courses: [{ id: 10, name: "测试课程", course_code: "TEST", teachers: [], term: { id: 1, name: "2026-2027 秋" }, enrollments: [] }],
  messages: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class { onmessage = () => {}; } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../lib/hooks", () => ({ useConfigSelector: (selector: (state: unknown) => unknown) => selector({ config: { data: { experimental_task_center_only: mocks.centerOnly } } }), useCourses: () => ({ data: mocks.courses, mutate: vi.fn() }) }));
vi.mock("../../lib/task_hooks", () => ({ useTasks: () => [] }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages, null] }));
vi.mock("../../lib/video_library_tasks", () => ({
  enqueueVideoExports: mocks.exports,
  recordingRequest: (video: { videoId: string }, title: string) => ({ key: `canvas:${video.videoId}`, title, candidates: [video] }),
}));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: ({ onChange }: { onChange: (id: number) => void }) => <button onClick={() => onChange(10)}>选择测试课程</button> }));
vi.mock("../task_popover", () => ({ default: () => <div data-testid="task-center" /> }));
vi.mock("../video_aggregator", () => ({ default: () => <div>合成工具内容</div> }));
vi.mock("../video_library_player", () => ({ default: () => <div>播放器内容</div> }));
vi.mock("../file_ai_chat_modal", () => ({ default: ({ open, dialogDescription, messages }: { open: boolean; dialogDescription: string; messages: { content: string }[] }) => open ? <div data-testid="chat">{dialogDescription}{messages.map((m, i) => <p key={i}>{m.content}</p>)}</div> : null }));

const videos = [
  { videoId: "a", courseBeginTime: "2026-09-28 08:00", courseEndTime: "2026-09-28 08:45" },
  { videoId: "b", courseBeginTime: "2026-09-28 08:55", courseEndTime: "2026-09-28 09:40" },
  { videoId: "c", courseBeginTime: "2026-09-29 14:00", courseEndTime: "2026-09-29 14:45" },
].map((video) => ({ ...video, source: "canvas", weekNumber: 4, videoName: `录像${video.videoId}`, userName: "教师", classroomName: "教室", playable: true, availability: "ready", availabilityLabel: "可播放" }));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.centerOnly = undefined;
  mocks.open.mockResolvedValue("D:/导出"); mocks.exports.mockResolvedValue(2);
  mocks.invoke.mockImplementation(async (command: string, args?: { request: { key: string; title: string } }) => {
    if (command === "read_account_info") return { current_account: "test-account", all_accounts: [] };
    if (command === "login_canvas_website") return;
    if (command === "list_video_space_courses" || command === "get_legacy_videos") return [];
    if (command === "get_canvas_videos") return videos;
    if (command === "prepare_video_material") return { key: args!.request.key, title: args!.request.title, text: "字幕正文", subtitleAvailable: true, srt: "字幕", warnings: [] };
    if (command === "chat_video_materials") return "整堂课总结";
    throw new Error(command);
  });
});
afterEach(cleanup);
async function load() {
  render(<VideoPage />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_video_space_courses"));
  fireEvent.click(screen.getByRole("button", { name: "选择测试课程" }));
  await screen.findByText("2 小节");
}
describe("video library workflows", () => {
  it("keeps player and advanced tools out of the initial library", async () => {
    await load();
    expect(screen.queryByText("播放器内容")).not.toBeInTheDocument();
    expect(screen.queryByText("合成工具内容")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载…" })).not.toBeInTheDocument();
  });
  it("uses page tasks by default and leaves the experimental center to the global layout", () => {
    const view = render(<VideoPage />);
    expect(screen.getByRole("table", { name: "视频下载任务" })).toBeInTheDocument();
    expect(screen.queryByTestId("task-center")).not.toBeInTheDocument();
    mocks.centerOnly = true; view.rerender(<VideoPage />);
    expect(screen.queryByRole("table", { name: "视频下载任务" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-center")).not.toBeInTheDocument();
    mocks.centerOnly = false; view.rerender(<VideoPage />);
    expect(screen.getByRole("table", { name: "视频下载任务" })).toBeInTheDocument();
    expect(screen.queryByTestId("task-center")).not.toBeInTheDocument();
  });
  it("groups by date and keeps date selection and collapsed lessons consistent", async () => {
    await load();
    const day = screen.getByText("2026-09-28").closest("tr")!;
    expect(day).toHaveAttribute("data-level", "date");
    fireEvent.click(within(day).getByRole("checkbox"));
    expect(screen.getByText("已选 1 堂课 · 2 小节")).toBeInTheDocument();
    expect(document.querySelector('[data-level="session"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /展开日期 2026-09-28/ }));
    const lesson = screen.getByRole("checkbox", { name: "选择小节 录像a" });
    expect(lesson.closest("tr")).toHaveAttribute("data-level", "recording");
    expect(lesson).toBeChecked();
    fireEvent.click(lesson);
    expect(within(day).getByRole("checkbox")).toHaveAttribute("data-indeterminate", "true");
    fireEvent.click(screen.getByRole("button", { name: /收起日期 2026-09-28/ }));
    expect(screen.queryByRole("checkbox", { name: "选择小节 录像b" })).not.toBeInTheDocument();
    expect(screen.getByText("已选 1 堂课 · 1 小节")).toBeInTheDocument();
  });
  it("downloads an entire class once and retains hidden selected lessons", async () => {
    await load();
    fireEvent.click(screen.getByRole("checkbox", { name: /选择日期 2026-09-28/ }));
    expect(screen.getByText("已选 1 堂课 · 2 小节")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索课堂" }), { target: { value: "2026-09-29" } });
    expect(screen.getByText("其中 2 小节不在当前筛选结果中")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载…" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("checkbox", { name: "PPT 切片 PDF" }));
    expect(dialog.getByRole("combobox", { name: "PPT 输出" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "单独下载 ▾" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "另存为…" })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "选择目录并下载" }));
    await waitFor(() => expect(mocks.exports).toHaveBeenCalledOnce());
    const [scopes, options, directory] = mocks.exports.mock.calls[0];
    expect(scopes[0].videos.map((v: { videoId: string }) => v.videoId)).toEqual(["a", "b"]);
    expect(options.pptPerSession).toBe(true); expect(directory).toBe("D:/导出");
    expect(mocks.open).toHaveBeenCalledOnce();
  });
  it("keeps single-recording download and save-as controls available", async () => {
    await load();
    fireEvent.click(screen.getByRole("button", { name: /展开日期 2026-09-28/ }));
    const row = screen.getByRole("checkbox", { name: "选择小节 录像a" }).closest("tr")!;
    expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual(["播放", "下载", "AI 总结"]);
    fireEvent.click(within(row).getByRole("button", { name: "下载" }));
    const footer = screen.getByRole("button", { name: "取消" }).parentElement!;
    expect(within(footer).getByRole("button", { name: "选择机位下载…" })).toBeInTheDocument();
    expect(screen.queryByText("单节下载选项")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "PPT 切片 PDF" }));
    expect(screen.queryByRole("combobox", { name: "PPT 输出" })).not.toBeInTheDocument();
    fireEvent.click(within(footer).getByRole("button", { name: "单独下载 ▾" }));
    expect(screen.getByRole("menuitem", { name: "选择机位下载…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "PPT 另存为…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "字幕另存为…" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "视频" }));
    expect(screen.queryByRole("combobox", { name: "视频机位" })).not.toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "另存为…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "单独下载 ▾" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "字幕" }));
    fireEvent.click(within(footer).getByRole("button", { name: "单独下载 ▾" }));
    expect(screen.getByRole("menuitem", { name: "字幕另存为…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "选择机位下载…" })).not.toBeInTheDocument();
  });
  it("shows week and source without material probes or a redundant task button", async () => {
    await load();
    expect(screen.getByRole("button", { name: "第 4 周 · 星期一" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第 4 周 · 星期二" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "来源" })).toBeInTheDocument();
    expect(screen.queryByText(/待检查|按需读取/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^下载任务/ })).not.toBeInTheDocument();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "prepare_video_material")).toBe(false);
  });
  it("restores persisted summaries without another request and explicitly regenerates", async () => {
    await load();
    const openSummary = () => fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    openSummary();
    fireEvent.click(screen.getByRole("button", { name: "开始总结" }));
    await screen.findByText(/已缓存到本地/);
    const calls = mocks.invoke.mock.calls.filter(([c]) => c === "chat_video_materials").length;
    cleanup();
    await load();
    openSummary();
    await screen.findByText(/已读取本地缓存/);
    expect(screen.getByTestId("chat")).toHaveTextContent("整堂课总结");
    expect(mocks.invoke.mock.calls.filter(([c]) => c === "chat_video_materials")).toHaveLength(calls);
    const row = screen.getByText("2026-09-28").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "播放" }));
    expect(screen.getByText("播放器内容")).toBeInTheDocument();
    expect(screen.getByTestId("chat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([c]) => c === "chat_video_materials")).toHaveLength(calls + 1));
    await screen.findByText(/已缓存到本地/);
    fireEvent.click(screen.getByRole("button", { name: "删除缓存" }));
    expect(screen.getByText(/本地缓存已删除/)).toBeInTheDocument();
  });
  it("shows backend compression and thinking stages before streaming the answer", async () => {
    await load();
    let report: (stage: string) => void = () => {};
    let finish: (value: string) => void = () => {};
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "chat_video_materials") return new Promise<string>((resolve) => { report = args.onStatus.onmessage; finish = resolve; });
      return original(command, args);
    });
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    fireEvent.click(screen.getByRole("button", { name: "开始总结" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("chat_video_materials", expect.anything()));
    act(() => report("正在压缩字幕 · 第 1 轮 · 第 2/3 段"));
    expect(screen.getByTestId("chat")).toHaveTextContent("第 2/3 段");
    act(() => report("正在思考"));
    expect(screen.getByTestId("chat")).toHaveTextContent("正在思考");
    act(() => report("正在生成正文"));
    expect(screen.getByTestId("chat")).toHaveTextContent("正在生成正文");
    await act(async () => finish("完成总结"));
    await screen.findByText(/已缓存到本地/);
  });
  it("summarizes all selected subtitles without requesting images or PPT", async () => {
    await load();
    fireEvent.click(screen.getByRole("checkbox", { name: /选择日期 2026-09-28/ }));
    fireEvent.click(screen.getByRole("button", { name: "AI 总结…" }));
    expect(screen.getByText(/PPT 不作为 AI 输入/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始总结" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("chat_video_materials", expect.anything()));
    const calls = mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material");
    expect(calls.map(([, args]) => args.request.key)).toEqual(["canvas:a", "canvas:b"]);
    expect(calls.every(([, args]) => Object.keys(args).join() === "request")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("2/2 小节字幕可用"));
  });
});
