import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import VideoPage from "../../page/video";
import { taskManager, type TaskSource } from "../../lib/task_manager";
import { videoSummarySession } from "../../lib/video_summary_session";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  centerOnly: false,
  courses: Array.from({ length: 40 }, (_, index) => ({
    id: index + 1, name: `课程 ${index + 1}`, course_code: `TEST${index + 1}`,
    teachers: [], enrollments: [], term: { id: 1, name: "2026-2027 秋" },
  })),
  messages: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class { onmessage = () => {}; } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../lib/hooks", () => ({
  useConfigSelector: (selector: (state: unknown) => unknown) => selector({ config: { data: { experimental_task_center_only: mocks.centerOnly } } }),
  useCourses: () => ({ data: mocks.courses, mutate: vi.fn() }),
}));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages, null] }));
vi.mock("../../lib/video_library_tasks", () => ({
  enqueueVideoExports: vi.fn(), saveRecordingMaterial: vi.fn(), recordingRequest: vi.fn(),
}));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../video_aggregator", () => ({ default: () => null }));
vi.mock("../video_library_player", () => ({ default: () => null }));
vi.mock("../video_live_panel", () => ({ default: () => null }));
vi.mock("../video_track_downloads", () => ({ default: () => null }));
vi.mock("../file_ai_chat_modal", () => ({ default: () => null }));

const pending: { id: string; finish: () => void }[] = [];
function startTask(source: TaskSource) {
  const id = `scroll-${source}`;
  const channel = source === "video" ? "video_download://progress" : "download://progress";
  taskManager.enqueue({
    id, name: id, source, kind: source === "video" ? "video" : "file", event: { channel, id },
    run: () => new Promise<void>((finish) => pending.push({ id, finish })),
  });
  return { id, channel };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  videoSummarySession.reset();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "read_account_info") return { current_account: "test-account", all_accounts: [] };
    if (command === "login_canvas_website") return;
    if (["list_video_space_courses", "get_canvas_videos", "get_legacy_videos"].includes(command)) return [];
    throw new Error(command);
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => { pending.forEach(({ finish }) => finish()); });
  pending.splice(0).forEach(({ id }) => taskManager.remove(id));
  vi.restoreAllMocks();
});

it.each([false, true])("keeps the course popup scroll during downloads (task center only: %s)", async (centerOnly) => {
  mocks.centerOnly = centerOnly;
  const video = startTask("video");
  const file = startTask("files");
  render(<MemoryRouter><VideoPage /></MemoryRouter>);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_video_space_courses"));
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());

  const input = screen.getByRole("combobox", { name: "" });
  // JSDOM has no layout. Supply Popper's anchor geometry, then inspect DOM
  // identity and scrollTop; this is not a native wheel/WebView test.
  const anchor = input.closest(".MuiInputBase-root")!;
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 56));
  fireEvent.mouseDown(input);
  const listbox = await screen.findByRole("listbox");
  expect(within(listbox).getAllByRole("option")).toHaveLength(40);
  listbox.scrollTop = 640;

  for (const [task, progress] of [[video, 25], [file, 25], [video, 75], [file, 75]] as const) {
    await act(async () => taskManager.progress(task.channel, task.id, progress, 100));
    expect(taskManager.getSnapshot().find(({ id }) => id === task.id)?.progress).toBe(progress);
    expect(screen.getByRole("listbox")).toBe(listbox);
    expect(listbox).toBeInTheDocument();
    expect(listbox.scrollTop).toBe(640);
    if (centerOnly) {
      expect(screen.queryByRole("table", { name: "视频下载任务" })).not.toBeInTheDocument();
    } else {
      const table = screen.getByRole("table", { name: "视频下载任务" });
      expect(within(table).getByText(video.id)).toBeInTheDocument();
      expect(within(table).queryByText(file.id)).not.toBeInTheDocument();
      const videoProgress = taskManager.getSnapshot().find(({ id }) => id === video.id)!.progress;
      expect(within(table).getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(videoProgress));
    }
  }

  fireEvent.change(input, { target: { value: "课程 27" } });
  fireEvent.click(await screen.findByRole("option", { name: /课程 27/ }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("get_canvas_videos", { courseId: 27 }));
  expect(screen.getByText("当前已选：课程 27")).toBeInTheDocument();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
