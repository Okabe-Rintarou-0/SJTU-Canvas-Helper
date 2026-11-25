import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import VideoPage from "../../page/video";
import { Link, MemoryRouter } from "react-router-dom";
import RetainedVideoWorkspace from "../retained_video_workspace";
import { videoSummarySession } from "../../lib/video_summary_session";
import { createDataMock } from "../../test/app_data_mock";
import { taskManager } from "../../lib/task_manager";

import { videoTopicIndex } from "../../lib/video_topics";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), exports: vi.fn(), open: vi.fn(), saveMaterial: vi.fn(),
  centerOnly: undefined as boolean | undefined,
  cleanUpPpt: false,
  generateTopics: false,
  realCourseSelect: false,
  missingKeys: [] as string[],
  unknownKeys: [] as string[],
  courses: [{ id: 10, name: "测试课程", course_code: "TEST", teachers: [], term: { id: 1, name: "2026-2027 秋" }, enrollments: [] }],
  messages: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, ...args: [Parameters<typeof dataMock.invoke>[0]?]) => command === "app_data" ? dataMock.invoke(args[0]!) : mocks.invoke(command, ...args), Channel: class { onmessage = () => {}; } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../lib/hooks", () => ({ useConfigSelector: (selector: (state: unknown) => unknown) => selector({ config: { data: { experimental_task_center_only: mocks.centerOnly, experimental_ppt_cleanup: mocks.cleanUpPpt, experimental_video_topics: mocks.generateTopics } } }), useCourses: () => ({ data: mocks.courses, mutate: vi.fn() }) }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages, null] }));
vi.mock("../../lib/video_library_tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/video_library_tasks")>()),
  enqueueVideoExports: mocks.exports,
  saveRecordingMaterial: mocks.saveMaterial,
  recordingRequest: (video: { videoId: string }, title: string) => ({ key: `canvas:${video.videoId}`, title, candidates: [video] }),
}));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../course_select", async (importOriginal) => {
  const { default: CourseSelect } = await importOriginal<typeof import("../course_select")>();
  return { default: (props: Parameters<typeof CourseSelect>[0]) => mocks.realCourseSelect
    ? <CourseSelect {...props} /> : <button onClick={() => props.onChange?.(10)}>选择测试课程</button> };
});
vi.mock("../task_popover", () => ({ default: () => <div data-testid="task-center" /> }));
vi.mock("../video_aggregator", () => ({ default: () => <div>合成工具内容</div> }));
vi.mock("../video_live_player", () => ({
  default: ({ session, onClose }: Parameters<typeof import("../video_live_player").default>[0]) => <div>
    <video data-testid="live-media" data-session={session.id} />
    <button onClick={onClose}>测试关闭直播</button>
  </div>,
}));
vi.mock("../video_library_player", () => ({ default: ({ initialKey, seconds, onClose, onMiniChange }: { initialKey: string; seconds: number; onClose: () => void; onMiniChange: (mini: boolean) => void }) => <div data-recording={initialKey} data-seconds={seconds}>播放器内容<button onClick={onClose}>测试关闭播放器</button><button onClick={() => onMiniChange(true)}>测试迷你播放</button></div> }));
vi.mock("../file_ai_chat_modal", async () => {
  const { default: MarkdownContent } = await import("../markdown_content");
  return { default: ({ open, dialogDescription, messages, onSend, markdownComponents, restoredMessageCount = 0 }: Parameters<typeof import("../file_ai_chat_modal").default>[0]) => open ? (
    <div data-testid="chat">
      {dialogDescription}
      {messages.map((message, index) => (
        <MarkdownContent key={message.id} components={markdownComponents} recoverWrappedMath={message.role === "assistant" && index >= restoredMessageCount}>
          {message.content}
        </MarkdownContent>
      ))}
      <button onClick={() => onSend("解释解析树")}>测试追问</button>
    </div>
  ) : null };
});

const dataMock = createDataMock();

const videos = [
  { videoId: "a", courseBeginTime: "2026-09-28 08:00", courseEndTime: "2026-09-28 08:45" },
  { videoId: "b", courseBeginTime: "2026-09-28 08:55", courseEndTime: "2026-09-28 09:40" },
  { videoId: "c", courseBeginTime: "2026-09-29 14:00", courseEndTime: "2026-09-29 14:45" },
].map((video) => ({ ...video, source: "canvas", weekNumber: 4, videoName: `录像${video.videoId}`, userName: "教师", classroomName: "教室", playable: true, availability: "ready", availabilityLabel: "可播放" }));
const testCourse = mocks.courses[0];
const secondCourse = { ...testCourse, id: 11, name: "另一门课程" };
beforeEach(() => {
  mocks.courses = [testCourse];
  videoSummarySession.reset();
  vi.clearAllMocks(); dataMock.reset(); localStorage.clear(); mocks.centerOnly = undefined;
  dataMock.switchAccount("test-account");
  mocks.cleanUpPpt = false;
  mocks.generateTopics = false;
  mocks.realCourseSelect = false; mocks.missingKeys = []; mocks.unknownKeys = [];
  mocks.open.mockResolvedValue("D:/导出"); mocks.exports.mockResolvedValue(2); mocks.saveMaterial.mockResolvedValue(true);
  mocks.invoke.mockImplementation(async (command: string, args?: { request: { key: string; title: string } }) => {
    if (command === "read_account_info") return { current_account: "test-account", all_accounts: [] };
    if (command === "login_canvas_website") return;
    if (command === "download_directory") return "D:/下载";
    if (command === "get_video_play_info") return { videoPlayResponseVoList: [{ id: 1 }] };
    if (command === "list_video_space_courses" || command === "get_legacy_videos") return [];
    if (command === "get_canvas_videos") return videos;
    if (command === "get_video_live_sessions") return { sessions: [], serverTime: Date.now() };
    if (command === "inspect_video_recording") {
      if (mocks.unknownKeys.includes(args!.request.key)) throw new Error("网络错误");
      return { subtitleAvailable: !mocks.missingKeys.includes(args!.request.key), transcriptAvailable: false };
    }
    if (command === "prepare_video_material") return { key: args!.request.key, title: args!.request.title, text: "字幕正文", subtitleAvailable: true, srt: "字幕", warnings: [] };
    if (command === "chat_video_materials") return "整堂课总结";
    throw new Error(command);
  });
});
afterEach(cleanup);
async function load() {
  const view = render(<VideoPage />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_video_space_courses"));
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "选择测试课程" }));
  await screen.findByText("2 小节");
  return view;
}
async function beginSummary(name: string | RegExp = /开始总结|转录音频后总结|查看总结/) {
  const dialog = await screen.findByRole("dialog", { name: /^总结所选/ });
  const button = await waitFor(() => {
    const currentButton = within(dialog).getByRole("button", { name });
    expect(currentButton).toBeEnabled();
    return currentButton;
  });
  fireEvent.click(button);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
}

describe("video library workflows", () => {
  it.each(["resolve", "reject"])("ignores results from a previous course when its recording requests %s", async (outcome) => {
    mocks.realCourseSelect = true;
    mocks.courses = [testCourse, secondCourse];
    const original = mocks.invoke.getMockImplementation()!;
    let complete!: () => void;
    mocks.invoke.mockImplementation((command, args) => {
      if (command !== "get_canvas_videos") return original(command, args);
      if (args.courseId !== 10) return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        complete = () => outcome === "resolve" ? resolve(videos) : reject(new Error("旧课程请求失败"));
      });
    });
    render(<VideoPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    fireEvent.mouseDown(screen.getByPlaceholderText("请选择或搜索课程…"));
    fireEvent.click(await screen.findByRole("option", { name: /测试课程/ }));
    await waitFor(() => expect(complete).toBeDefined());
    expect(screen.getByRole("progressbar", { name: "正在读取录像" })).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "课程" }));
    fireEvent.click(await screen.findByRole("option", { name: /另一门课程/ }));
    await waitFor(() => expect(screen.queryByRole("progressbar", { name: "正在读取录像" })).not.toBeInTheDocument());
    await act(async () => complete());
    expect(screen.queryByRole("progressbar", { name: "正在读取录像" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
    expect(screen.queryByText("2 小节")).not.toBeInTheDocument();
    expect(screen.queryByText(/读取录像失败/)).not.toBeInTheDocument();

    mocks.invoke.mockImplementation(original);
    fireEvent.mouseDown(screen.getByPlaceholderText("请选择或搜索课程…"));
    fireEvent.click(await screen.findByRole("option", { name: /测试课程/ }));
    await screen.findByText("2 小节");
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  });

  it.each(["ready", "required"])("keeps live playback mounted while refreshing and login becomes %s", async (outcome) => {
    const original = mocks.invoke.getMockImplementation()!;
    const now = Date.now();
    mocks.invoke.mockImplementation((command, args) => command === "get_video_live_sessions"
      ? Promise.resolve({ serverTime: now, sessions: [{
        id: "live-a", teachingClassId: 80, enabled: true,
        startTime: now - 60_000, finishTime: now + 600_000,
        beginTime: "2026-11-19 08:00", endTime: "2026-11-19 08:45",
        teacherName: "教师", classroomName: "教室",
      }] }) : original(command, args));
    render(<MemoryRouter><VideoPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选择测试课程" }));
    await screen.findByText("2 小节");
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    fireEvent.click(await screen.findByRole("button", { name: "观看直播" }));
    const media = screen.getByTestId("live-media") as HTMLVideoElement;
    media.currentTime = 42;
    media.playbackRate = 1.5;

    const withLive = mocks.invoke.getMockImplementation()!;
    let completeLogin!: () => void;
    mocks.invoke.mockImplementation((command, args) => command === "login_canvas_website"
      ? new Promise<void>((resolve, reject) => {
        completeLogin = () => outcome === "ready" ? resolve() : reject(new Error("登录检查失败"));
      }) : withLive(command, args));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("progressbar", { name: "检查视频登录" });
    const mediaDuringRefresh = screen.queryByTestId("live-media");
    expect(screen.getByRole("button", { name: "观看直播" })).toBeDisabled();
    await act(async () => completeLogin());
    await waitFor(() => expect(screen.queryByRole("progressbar", { name: "检查视频登录" })).not.toBeInTheDocument());
    expect(mediaDuringRefresh).toBe(media);
    expect(screen.getByTestId("live-media")).toBe(media);
    expect(media.currentTime).toBe(42);
    expect(media.playbackRate).toBe(1.5);
    expect(screen.getByRole("button", { name: "观看直播" })).toHaveProperty("disabled", outcome === "required");
    await waitFor(() => expect(screen.queryByRole("progressbar", { name: "正在读取直播" })).not.toBeInTheDocument());

    mocks.realCourseSelect = true;
    mocks.courses = [testCourse, secondCourse];
    mocks.invoke.mockImplementation(withLive);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "课程" }));
    fireEvent.click(await screen.findByRole("option", { name: /另一门课程/ }));
    expect(screen.queryByTestId("live-media")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByPlaceholderText("请选择或搜索课程…"));
    fireEvent.click(await screen.findByRole("option", { name: /测试课程/ }));
    await screen.findByRole("button", { name: "观看直播" });
    expect(screen.queryByTestId("live-media")).not.toBeInTheDocument();
  });

  it("shows recordings while another source is pending and reuses requests when the catalog adds that source", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    let finishCatalog!: (courses: typeof mocks.courses) => void;
    let finishCanvas!: (recordings: typeof videos) => void;
    let finishSpace!: (recordings: unknown[]) => void;
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "list_video_space_courses") return new Promise((resolve) => { finishCatalog = resolve; });
      if (command === "get_canvas_videos") return new Promise((resolve) => { finishCanvas = resolve; });
      if (command === "get_video_space_videos") return new Promise((resolve) => { finishSpace = resolve; });
      return original(command, args);
    });
    render(<VideoPage />);
    await waitFor(() => expect(finishCatalog).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "选择测试课程" }));
    await act(async () => finishCatalog([{ ...mocks.courses[0], id: 80 }]));
    expect(mocks.invoke).toHaveBeenCalledWith("get_video_space_videos", { teachingClassId: 80 });
    expect(screen.getByRole("progressbar", { name: "正在读取录像" })).toBeVisible();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_canvas_videos")).toHaveLength(1);
    await act(async () => finishCanvas(videos));
    expect(screen.getByText("2 小节")).toBeVisible();
    await act(async () => finishSpace([]));
    expect(screen.queryByRole("progressbar", { name: "正在读取录像" })).not.toBeInTheDocument();
  });

  it("downloads directly to the configured root", async () => {
    await load();
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "下载" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(await dialog.findByRole("checkbox", { name: "机位 1（教师）" })).toBeChecked();
    fireEvent.click(dialog.getByRole("button", { name: "下载" }));
    await waitFor(() => expect(mocks.exports).toHaveBeenCalledOnce());
    expect(mocks.exports.mock.calls[0][2]).toBe("D:/下载");
    expect(mocks.exports.mock.calls[0][3]).toEqual({ id: "10", name: "测试课程", term: "2026-2027 秋" });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("hides the topic column when disabled and restores saved topics when enabled", async () => {
    await videoTopicIndex.forAccount("test-account").set("canvas:a", { topic: "语法分析", sourceHash: "old", policy: "v7" });
    const view = await load();
    const table = screen.getByRole("table", { name: "课堂资料库" });
    expect(within(table).queryByRole("columnheader", { name: "课堂主题" })).not.toBeInTheDocument();
    expect(within(table).queryByText("语法分析")).not.toBeInTheDocument();
    mocks.generateTopics = true;
    view.rerender(<VideoPage />);
    expect(within(table).getByRole("columnheader", { name: "课堂主题" })).toBeVisible();
    expect(await within(table).findByText("语法分析")).toBeVisible();
    mocks.generateTopics = false;
    view.rerender(<VideoPage />);
    expect(within(table).queryByRole("columnheader", { name: "课堂主题" })).not.toBeInTheDocument();
    expect(within(table).queryByText("语法分析")).not.toBeInTheDocument();
  });

  it("shows summary-generated topics in the recording list", async () => {
    mocks.generateTopics = true;
    await load();
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, ...args) => command === "chat_video_materials"
      ? '总结正文。\n<video-topics>[{"key":"canvas:a","topic":"语法分析"},{"key":"canvas:b","topic":"项目集构造"}]</video-topics>' : original(command, ...args));
    const container = screen.getByText("2026-09-28").closest("tr")!;
    fireEvent.click(within(container).getByRole("button", { name: "AI 总结" }));
    await beginSummary();
    await screen.findByText(/已保存到本地/);
    expect(screen.getByTestId("chat")).not.toHaveTextContent("video-topics");
    await waitFor(() => expect(screen.getAllByText(/语法分析/).some((item) => item.closest("td"))).toBe(true));
    await waitFor(() => expect(screen.getAllByText(/项目集构造/).some((item) => item.closest("td"))).toBe(true));
    expect(screen.getByRole("columnheader", { name: "课堂主题" })).toBeVisible();
  });

  it("offers a retry rather than claiming subtitles are absent when inspection fails", async () => {
    await load(); mocks.unknownKeys = ["canvas:a"];
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    expect(await screen.findByText("1 小节的字幕状态检查失败。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "转录音频后总结" })).not.toBeInTheDocument();
    mocks.unknownKeys = []; mocks.missingKeys = ["canvas:a"];
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("button", { name: "转录音频后总结" })).toBeEnabled();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "transcribe_video_material")).toBe(false);
  });
  it("keeps incomplete coverage visible while folding detailed material diagnostics", async () => {
    await load();
    mocks.missingKeys = ['canvas:b'];
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, ...args) => command === "prepare_video_material" && args[0].request.key === "canvas:b"
      ? { key: "canvas:b", title: "第二小节", text: "", srt: "", subtitleAvailable: false, warnings: ["没有字幕"] } : original(command, ...args));
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    await beginSummary("仅用现有资料总结");
    await waitFor(() => expect(screen.getByText("未纳入本次总结：2026-09-28 08:55。可重新生成以重试。")).toBeVisible());
    expect(await screen.findByRole("button", { name: "查看资料" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "查看资料" }));
    expect(await screen.findByText("未获取到可用资料")).toBeVisible();
    expect(screen.getByText("没有字幕")).not.toBeVisible();
  });
  it("loads saved topics into listing and search", async () => {
    mocks.generateTopics = true;
    await videoTopicIndex.forAccount("test-account").set("canvas:a", { topic: "语法分析与项目集", sourceHash: "s", policy: "v7" });
    await load();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索课堂" }), { target: { value: "项目集" } });
    await waitFor(() => expect(screen.getAllByText("语法分析与项目集").some((item) => item.closest("tr") || item.closest("li"))).toBe(true));
    expect(screen.getByRole("checkbox", { name: "选择小节 录像a" })).toBeEnabled();
    expect(screen.queryByRole("checkbox", { name: "选择小节 录像b" })).not.toBeInTheDocument();
  });

  it("lets the user summarize existing material without starting a new transcription", async () => {
    await load();
    mocks.missingKeys = ['canvas:a', 'canvas:b'];
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, ...args) => command === "prepare_video_material"
      ? { key: "a", title: "课堂", text: "PPT 文字", srt: "", subtitleAvailable: false, ocrAvailable: true, warnings: [] } : original(command, ...args));
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    await beginSummary("仅用现有资料总结");
    await screen.findByText(/已保存到本地/);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "transcribe_video_material")).toBe(false);
    expect(videoSummarySession.getSnapshot().cacheEntry?.transcribeMissing).toBe(false);
  });






  it("summarizes directly without a separate proofreading step", async () => {
    await load();
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    await beginSummary();
    await screen.findByText(/整堂课总结/);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "proofread_video_subtitles")).toBe(false);
    expect(screen.queryByText("播放器内容")).not.toBeInTheDocument();
  });
  it("updates download progress without resetting an unselected course list", async () => {
    mocks.realCourseSelect = true;
    const originalCourses = mocks.courses;
    mocks.courses = Array.from({ length: 40 }, (_, index) => ({
      ...originalCourses[0], id: 10 + index, name: `测试课程 ${index + 1}`,
    }));
    let finish!: () => void;
    const job = new Promise<void>((resolve) => { finish = resolve; });
    taskManager.enqueue({ id: "course-scroll", name: "测试下载", kind: "video", source: "video",
      event: { channel: "video_download://progress", id: "course-scroll" }, run: () => job });
    const view = render(<VideoPage />);
    try {
      await waitFor(() => expect(screen.getByPlaceholderText("请选择或搜索课程…")).toBeEnabled());
      await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
      fireEvent.mouseDown(screen.getByPlaceholderText("请选择或搜索课程…"));
      const list = screen.getByRole("listbox");
      list.scrollTop = 480;
      fireEvent.scroll(list);
      for (const progress of [10, 20, 30]) {
        act(() => taskManager.progress("video_download://progress", "course-scroll", progress, 100));
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(progress));
        expect(screen.getByRole("listbox")).toBe(list);
        expect(list.scrollTop).toBe(480);
      }
      fireEvent.click(within(list).getByRole("option", { name: /测试课程 40/ }));
      await screen.findByText("2 小节");
      expect(mocks.invoke).toHaveBeenCalledWith("get_canvas_videos", { courseId: 49 });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    } finally {
      view.unmount();
      await act(async () => { finish(); await job; });
      taskManager.remove("course-scroll");
      mocks.courses = originalCourses;
    }
  }, 15_000);
  it("shows recovery steps only when Token login and extra login both fail", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => command === "login_canvas_website"
      ? Promise.reject(new Error("both authentication methods failed")) : original(command, args));
    render(<MemoryRouter><VideoPage /></MemoryRouter>);
    expect(await screen.findByText(/Canvas Token 登录失败，额外登录态也不可用/)).toBeVisible();
    expect(screen.getByRole("link", { name: "前往设置" })).toHaveAttribute("href", "/settings");
    expect(mocks.invoke.mock.calls.some(([command]) => command === "list_video_space_courses")).toBe(false);
    mocks.invoke.mockImplementation(original);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_video_space_courses"));
    expect(screen.queryByText(/Canvas Token 登录失败，额外登录态也不可用/)).not.toBeInTheDocument();
  });
  it("keeps the selected course, filters and current recording when visiting another page", async () => {
    render(<MemoryRouter initialEntries={["/video"]}>
      <Link to="/settings">去设置</Link><Link to="/video">回到视频</Link>
      <RetainedVideoWorkspace>{(active) => <VideoPage active={active} />}</RetainedVideoWorkspace>
    </MemoryRouter>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_video_space_courses"));
    // A started request does not mean the merged course list has settled.
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "选择测试课程" }));
    await screen.findByText("2 小节");
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "播放" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索课堂" }), { target: { value: "2026-09-28" } });
    const player = screen.getByText("播放器内容");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_canvas_videos")).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "去设置" })); });
    expect(player).toBeInTheDocument(); expect(player).not.toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "回到视频" })); });
    expect(screen.getByRole("textbox", { name: "搜索课堂" })).toHaveValue("2026-09-28");
    expect(screen.getByText("播放器内容")).toBe(player);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_canvas_videos")).toHaveLength(1);
  });
  it("keeps playable recordings eligible for transcription without probing materials", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => command === "get_canvas_videos"
      ? Promise.resolve(videos.map((video) => ({ ...video, playable: video.videoId !== "c", aiAvailable: video.videoId === "c" })))
      : original(command, args));
    await load();
    const reads = mocks.invoke.mock.calls.length;
    const unavailableDay = screen.getByText("2026-09-28").closest("tr")!;
    expect(within(unavailableDay).getByRole("button", { name: "播放" })).toBeEnabled();
    expect(within(unavailableDay).getByRole("button", { name: "AI 总结" })).toBeEnabled();
    expect(within(screen.getByText("2026-09-29").closest("tr")!).getByRole("button", { name: "AI 总结" })).toBeEnabled();
    expect(within(screen.getByText("2026-09-29").closest("tr")!).getByRole("button", { name: "播放" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /展开日期 2026-09-28/ }));
    const lesson = screen.getByRole("checkbox", { name: "选择小节 录像a" });
    const row = lesson.closest("tr")!;
    expect(within(row).getByRole("button", { name: "播放" })).toBeEnabled();
    expect(within(row).getByRole("button", { name: "AI 总结" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /开始总结|转录音频后总结|查看总结/ })).not.toBeInTheDocument();
    fireEvent.click(lesson);
    expect(screen.getByRole("button", { name: "AI 总结…" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /选择日期 2026-09-29/ }));
    expect(screen.getByRole("button", { name: "AI 总结…" })).toBeEnabled();
    expect(mocks.invoke.mock.calls).toHaveLength(reads);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "prepare_video_material")).toBe(false);
  });
  it("keeps summary enabled when another source has AI materials even without playback", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "get_canvas_videos") return Promise.resolve(videos.map((video) => ({ ...video, playable: false, aiAvailable: false,
        alternatives: video.videoId === "a" ? [{ ...video, source: "videoSpace", playable: false, aiAvailable: true }] : [],
      })));
      return original(command, args);
    });
    await load();
    const reads = mocks.invoke.mock.calls.length;
    expect(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /展开日期 2026-09-28/ }));
    const available = screen.getByRole("checkbox", { name: "选择小节 录像a" });
    const unavailable = screen.getByRole("checkbox", { name: "选择小节 录像b" });
    expect(within(available.closest("tr")!).getByRole("button", { name: "播放" })).toBeDisabled();
    expect(within(available.closest("tr")!).getByRole("button", { name: "AI 总结" })).toBeEnabled();
    expect(within(unavailable.closest("tr")!).getByRole("button", { name: "AI 总结" })).toBeDisabled();
    fireEvent.click(available);
    expect(screen.getByRole("button", { name: "AI 总结…" })).toBeEnabled();
    fireEvent.click(unavailable);
    fireEvent.click(available);
    expect(screen.getByRole("button", { name: "AI 总结…" })).toBeDisabled();
    expect(mocks.invoke.mock.calls).toHaveLength(reads);
  });
  it("restores an in-flight summary after navigation and completes caching without the page", async () => {
    const view = await load();
    let finish!: (value: string) => void;
    let chunk!: (value: string) => void;
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "chat_video_materials") return new Promise<string>((resolve) => { finish = resolve; chunk = args.onChunk.onmessage; });
      return original(command, args);
    });
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    await beginSummary();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("chat_video_materials", expect.anything()));
    view.unmount();
    act(() => chunk("后台生成的内容"));
    const returned = render(<VideoPage />);
    expect(await screen.findByTestId("chat")).toHaveTextContent("后台生成的内容");
    expect(screen.getByRole("button", { name: "重新生成" })).toBeDisabled();
    returned.unmount();
    await act(async () => finish("离开页面后完成的总结"));
    render(<VideoPage />);
    expect(await screen.findByTestId("chat")).toHaveTextContent("离开页面后完成的总结");
    expect(screen.getByText(/已保存到本地/)).toBeInTheDocument();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "chat_video_materials")).toHaveLength(1);
  });
  it("keeps a running summary attached to its course when switching courses", async () => {
    const courses = mocks.courses;
    mocks.courses = [...courses, { ...courses[0], id: 11, name: "另一门课", course_code: "OTHER" }];
    mocks.realCourseSelect = true;
    const original = mocks.invoke.getMockImplementation()!;
    let finish!: (value: string) => void;
    mocks.invoke.mockImplementation((command, args) => command === "chat_video_materials"
      ? new Promise((resolve) => { finish = resolve; }) : original(command, args));
    render(<VideoPage />);
    const picker = screen.getByPlaceholderText("请选择或搜索课程…");
    const choose = (name: RegExp) => {
      fireEvent.mouseDown(picker);
      fireEvent.click(screen.getByRole("option", { name }));
    };
    try {
      await waitFor(() => expect(picker).toBeEnabled());
      choose(/测试课程/);
      const date = await screen.findByText("2026-09-28");
      fireEvent.click(within(date.closest("tr")!).getByRole("button", { name: "AI 总结" }));
      await beginSummary();
      await waitFor(() => expect(finish).toBeDefined());
      choose(/另一门课/);
      expect(screen.queryByTestId("chat")).not.toBeInTheDocument();
      await act(async () => finish("第一门课的总结"));
      expect(screen.queryByRole("button", { name: /上次总结|已保存总结/ })).not.toBeInTheDocument();
      choose(/测试课程/);
      fireEvent.click(screen.getByRole("button", { name: "上次总结" }));
      expect(screen.getByTestId("chat")).toHaveTextContent("第一门课的总结");
    } finally {
      mocks.courses = courses;
    }
  });
  it("separates summary and material caches when animation simplification changes", async () => {
    const view = await load();
    const summarize = async () => {
      fireEvent.click(await within(screen.getByText("2026-09-28").closest("tr")!).findByRole("button", { name: "AI 总结" }));
      await beginSummary();
      await screen.findByText(/已.*本地历史|已保存到本地/);
    };
    await summarize();
    let calls = mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material");
    expect(calls).toHaveLength(2);
    expect(calls.every(([, args]) => args.cleanUpPpt === false)).toBe(true);
    mocks.cleanUpPpt = true;
    view.rerender(<VideoPage />);
    await summarize();
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material")).toHaveLength(4));
    calls = mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material");
    expect(calls.slice(2).every(([, args]) => args.cleanUpPpt === true)).toBe(true);
    await screen.findByText(/已保存到本地/);
    mocks.cleanUpPpt = false;
    view.rerender(<VideoPage />);
    await summarize();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material")).toHaveLength(4);
  });
  it("summarizes OCR-only recordings and retains the same OCR evidence for follow-up questions", async () => {
    await load();
    mocks.missingKeys = ['canvas:a', 'canvas:b'];
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "prepare_video_material") return Promise.resolve({ key: args.request.key, title: args.request.title, text: "[00:00:10](#video=canvas%3Aa&t=10) [PPT OCR] 解析树", subtitleAvailable: false, ocrAvailable: true, srt: "", warnings: ["缺少字幕"] });
      if (command === "chat_video_materials") return Promise.resolve("公式 $x^2$，见 [00:00:10](#video=canvas%3Aa&t=10) 和 [00:00:10](#video=canvas%3Ab&t=10)。");
      return original(command, args);
    });
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    await beginSummary("仅用现有资料总结");
    await screen.findByText(/已保存到本地/);
    expect(screen.getByText("已覆盖 2 / 2 小节")).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "查看资料" }));
    expect(await screen.findAllByText("已纳入 · 课件文字")).toHaveLength(2);
    const initial = mocks.invoke.mock.calls.find(([command]) => command === "chat_video_materials")![1].text;
    expect(initial).toContain("[PPT OCR] 解析树");
    expect(initial).toContain("#video=canvas%3Aa&t=10");
    expect(screen.getByTestId("chat").querySelector("math annotation")?.textContent).toBe("x^2");
    expect(screen.getByText("节1 · 00:00:10")).toBeVisible();
    const secondCitation = screen.getByRole("button", { name: /跳转到 .*第 2 小节 · 00:00:10/ });
    expect(secondCitation).toHaveTextContent("节2 · 00:00:10");
    fireEvent.click(secondCitation);
    const player = await screen.findByText("播放器内容");
    expect(player).toHaveAttribute("data-recording", "canvas:b");
    expect(player).toHaveAttribute("data-seconds", "10");
    const reads = mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material").length;
    fireEvent.click(await screen.findByRole("button", { name: "测试追问" }));
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === "chat_video_materials")).toHaveLength(2));
    const followup = mocks.invoke.mock.calls.filter(([command]) => command === "chat_video_materials")[1][1];
    expect(followup.text).toBe(initial);
    expect(followup.messages.at(-1)).toMatchObject({ role: "user", content: "解释解析树" });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material")).toHaveLength(reads);
  });
  it("uses untimed audio transcription for summaries when Canvas subtitles are missing", async () => {
    await load();
    mocks.missingKeys = ['canvas:a', 'canvas:b'];
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => {
      if (command === "prepare_video_material") return Promise.resolve({ key: args.request.key, title: args.request.title, text: "PPT 补充", subtitleAvailable: false, ocrAvailable: true, srt: "", warnings: [] });
      if (command === "transcribe_video_material") return Promise.resolve({ key: args.request.key, title: args.request.title, text: "校内 AI 音视频转录（无时间戳）\n教师解释解析树", transcriptAvailable: true, subtitleAvailable: false, srt: "", warnings: [] });
      return original(command, args);
    });
    fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    await beginSummary();
    await screen.findByText(/已保存到本地/);
    const text = mocks.invoke.mock.calls.find(([command]) => command === "chat_video_materials")![1].text;
    expect(text).toContain("教师解释解析树");
    expect(text).toContain("PPT 补充");
    expect(text).toContain("已覆盖 2 / 2 小节");
    expect(text).not.toContain("#video=");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "transcribe_video_material")).toHaveLength(2);
  });
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
    fireEvent.click(dialog.getByRole("checkbox", { name: "PPT PDF" }));
    expect(dialog.getByRole("combobox", { name: "PPT 输出" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "单独下载 ▾" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "另存为…" })).not.toBeInTheDocument();
    expect(await dialog.findByRole("checkbox", { name: "机位 1（教师）" })).toBeChecked();
    mocks.open.mockResolvedValueOnce(null);
    fireEvent.click(dialog.getByRole("button", { name: "另存为" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
    await waitFor(() => expect(dialog.getByRole("button", { name: "另存为" })).toBeEnabled());
    expect(mocks.exports).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "另存为" }));
    await waitFor(() => expect(mocks.exports).toHaveBeenCalledOnce());
    const [scopes, options, directory] = mocks.exports.mock.calls[0];
    expect(scopes[0].videos.map((v: { videoId: string }) => v.videoId)).toEqual(["a", "b"]);
    expect(options).toMatchObject({ pptPerSession: true, tracks: "all" }); expect(directory).toBe("D:/导出");
    expect(mocks.exports.mock.calls[0][3]).toEqual({ id: "10", name: "测试课程", term: "2026-2027 秋" });
    expect(mocks.invoke).toHaveBeenCalledWith("download_directory", { kind: "root" });
    expect(mocks.open).toHaveBeenCalledTimes(2);
  });
  it("downloads the selected camera numbers across recordings with different camera counts", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => command === "get_video_play_info"
      ? Promise.resolve({ videoPlayResponseVoList: Array.from({ length: args.videoId === "a" ? 2 : 3 }, (_, id) => ({ id })) })
      : original(command, args));
    await load();
    fireEvent.click(screen.getByRole("checkbox", { name: /选择日期 2026-09-28/ }));
    fireEvent.click(screen.getByRole("button", { name: "下载…" }));
    const dialog = within(screen.getByRole("dialog"));
    const screenTrack = await dialog.findByRole("checkbox", { name: "机位 2（屏幕）" });
    const teacherTrack = dialog.getByRole("checkbox", { name: "机位 1（教师）" });
    const thirdTrack = dialog.getByRole("checkbox", { name: "机位 3" });
    expect(dialog.queryByRole("combobox", { name: "视频机位" })).not.toBeInTheDocument();
    for (const track of [teacherTrack, screenTrack, thirdTrack]) expect(track).toBeChecked();
    fireEvent.click(teacherTrack);
    fireEvent.click(screenTrack);
    fireEvent.click(thirdTrack);
    const downloadButton = dialog.getByRole("button", { name: "下载" });
    expect(downloadButton).toBeDisabled();
    fireEvent.click(screenTrack);
    fireEvent.click(thirdTrack);
    fireEvent.click(downloadButton);
    await waitFor(() => expect(mocks.exports).toHaveBeenCalledWith(
      expect.any(Array), expect.objectContaining({ tracks: [2, 3] }), "D:/下载", expect.any(Object),
    ));
  });
  it.each(["ppt", "subtitle"] as const)("saves a single %s to a chosen file and preserves the dialog on cancellation", async (kind) => {
    await load();
    fireEvent.click(screen.getByRole("button", { name: /展开日期 2026-09-28/ }));
    const row = screen.getByRole("checkbox", { name: "选择小节 录像a" }).closest("tr")!;
    expect(within(row).getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "AI 总结" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "下载" }));
    const dialog = within(screen.getByRole("dialog", { name: "下载小节资料" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "视频" }));
    expect(dialog.getByRole("button", { name: "下载" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "另存为" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("checkbox", { name: kind === "ppt" ? "PPT PDF" : "字幕" }));
    mocks.saveMaterial.mockResolvedValueOnce(false);
    fireEvent.click(dialog.getByRole("button", { name: "另存为" }));
    await waitFor(() => expect(mocks.saveMaterial).toHaveBeenCalledOnce());
    await waitFor(() => expect(dialog.getByRole("button", { name: "另存为" })).toBeEnabled());
    expect(mocks.exports).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "另存为" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.saveMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: "a" }), kind, { id: "10", name: "测试课程", term: "2026-2027 秋" });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("shows week and source without material probes or a redundant task button", async () => {
    await load();
    expect(screen.getByRole("button", { name: "第 4 周 · 星期一" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第 4 周 · 星期二" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /展开日期 2026-09-28/ }));
    const section = screen.getByRole("checkbox", { name: "选择小节 录像a" }).closest("tr")!;
    fireEvent.mouseOver(within(section).getByText("08:00–08:45"));
    expect(await screen.findByRole("tooltip", { name: "录像a · 教室 · 来源 Canvas" })).toBeInTheDocument();
    expect(screen.queryByText(/待检查|按需读取/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^下载任务/ })).not.toBeInTheDocument();
    expect(mocks.invoke.mock.calls.some(([command]) => command === "prepare_video_material")).toBe(false);
  });
  it("restores persisted summaries without another request and explicitly regenerates", async () => {
    await load();
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((command, args) => command === "chat_video_materials" ? "整堂课总结 `$P$`" : original(command, args));
    const openSummary = () => fireEvent.click(within(screen.getByText("2026-09-28").closest("tr")!).getByRole("button", { name: "AI 总结" }));
    openSummary();
    await beginSummary();
    await screen.findByText(/已保存到本地/);
    expect(screen.getByTestId("chat").querySelector("math annotation")?.textContent).toBe("P");
    const calls = mocks.invoke.mock.calls.filter(([c]) => c === "chat_video_materials").length;
    cleanup();
    await load();
    fireEvent.click(await screen.findByRole("button", { name: "已保存总结 · 1" }));
    const history = within(screen.getByRole("dialog", { name: "本课程的已保存总结" }));
    expect(history.getByText("录像a")).toBeVisible();
    expect(history.getByText("录像b")).toBeVisible();
    expect(history.getByText("2026-09-28 08:00 — 2026-09-28 08:45")).toBeVisible();
    expect(history.getByText("2026-09-28 08:55 — 2026-09-28 09:40")).toBeVisible();
    expect(history.queryByText("录像c")).not.toBeInTheDocument();
    fireEvent.click(history.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    openSummary();
    expect(screen.getByRole("dialog", { name: "总结所选 2 小节" })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "查看总结" }));
    await screen.findByText(/已读取本地历史/);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("chat")).toHaveTextContent("整堂课总结");
    expect(within(screen.getByTestId("chat")).getByText("$P$", { selector: "code" })).toBeVisible();
    expect(mocks.invoke.mock.calls.filter(([c]) => c === "chat_video_materials")).toHaveLength(calls);
    const row = screen.getByText("2026-09-28").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "播放" }));
    expect(screen.getByText("播放器内容")).toBeInTheDocument();
    expect(screen.getByTestId("chat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    await waitFor(() => expect(mocks.invoke.mock.calls.filter(([c]) => c === "chat_video_materials")).toHaveLength(calls + 1));
    await screen.findByText(/已保存到本地/);
    expect(screen.getByTestId("chat").querySelector("math annotation")?.textContent).toBe("P");
    fireEvent.click(screen.getByRole("button", { name: "删除历史" }));
    expect(await screen.findByText(/本地历史已删除/)).toBeInTheDocument();
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
    await beginSummary();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("chat_video_materials", expect.anything()));
    act(() => report("正在压缩字幕 · 第 1 轮 · 第 2/3 段"));
    expect(screen.getByTestId("chat")).toHaveTextContent("第 2/3 段");
    act(() => report("正在思考"));
    expect(screen.getByTestId("chat")).toHaveTextContent("正在思考");
    act(() => report("正在生成正文"));
    expect(screen.getByTestId("chat")).toHaveTextContent("正在生成正文");
    await act(async () => finish("完成总结"));
    await screen.findByText(/已保存到本地/);
  });
  it("summarizes selected materials with OCR without downloading images", async () => {
    await load();
    fireEvent.click(screen.getByRole("checkbox", { name: /选择日期 2026-09-28/ }));
    fireEvent.click(screen.getByRole("button", { name: "AI 总结…" }));
    expect(screen.queryByRole("checkbox", { name: "AI 音视频转录" })).not.toBeInTheDocument();
    expect(screen.queryByText(/优先采用 Canvas 精校字幕|直接结合字幕上下文/)).not.toBeInTheDocument();
    await beginSummary();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("chat_video_materials", expect.anything()));
    const calls = mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material");
    expect(calls.map(([, args]) => args.request.key)).toEqual(["canvas:a", "canvas:b"]);
    expect(calls.every(([, args]) => args.cleanUpPpt === false)).toBe(true);
    await screen.findByText("已覆盖 2 / 2 小节");
  });
});
