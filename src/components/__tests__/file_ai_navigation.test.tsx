import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import FilesPage from "../../page/files";
import { fileAISession } from "../../lib/file_ai_session";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), noop: vi.fn(), empty: [],
  files: [{ id: 12, key: "file", uuid: "file", display_name: "作业.pdf", url: "https://example.com/file", size: 20 }],
  messages: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../lib/task_runtime", () => ({ enqueueTask: vi.fn() }));
vi.mock("../../lib/upload_tasks", () => ({ createCloudUploadTask: vi.fn() }));
vi.mock("../../lib/task_hooks", () => ({ useLegacyTasks: () => mocks.empty }));
vi.mock("../../lib/file_conversion", () => ({ canConvertFileToPdf: () => false, getOutputFile: vi.fn() }));
vi.mock("../../lib/hooks", () => ({
  useCourses: () => ({ data: mocks.empty }), useSelectedCourse: () => ({ selectedCourseId: -1, setSelectedCourseId: mocks.noop }),
  useExternalFiles: () => ({ data: mocks.files }), useBaseURL: () => ({ data: "https://example.com" }),
  useMerger: () => ({ merger: null, mergePDFs: mocks.noop }),
  usePreview: () => ({ previewer: null, onHoverEntry: mocks.noop, onLeaveEntry: mocks.noop, setPreviewEntry: mocks.noop, setEntries: mocks.noop }),
}));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages] }));
vi.mock("../../lib/utils", () => ({ formatDate: (value: string) => value, formatSize: () => "20 B", getFileIcon: () => null,
  isMergableFileType: () => false, consoleLog: vi.fn(), scrollToTop: vi.fn() }));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../page_task_lists", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: () => null }));
vi.mock("../file_download_table", () => ({ default: () => null }));
vi.mock("../file_order_select_modal", () => ({ default: () => null }));

afterEach(() => { cleanup(); fileAISession.reset(); vi.restoreAllMocks(); });

it("restores the real file conversation after leaving, including chunks received in the background", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  const handlers = new Map<string, (event: { payload: Record<string, string> }) => void>();
  mocks.listen.mockImplementation(async (event, handler) => { handlers.set(event, handler); return () => handlers.delete(event); });
  mocks.invoke.mockResolvedValue(undefined);
  const view = render(<FilesPage />);
  fireEvent.click(screen.getByRole("button", { name: "AI 总结" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("start_file_chat_stream", expect.anything()));
  const requestId = mocks.invoke.mock.calls[0][1].requestId;
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  view.unmount();
  handlers.get("file_ai_chat://chunk")!({ payload: { request_id: requestId, chunk: "后台片段" } });
  const returned = render(<FilesPage />);
  expect(screen.getByText("后台片段")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  act(() => handlers.get("file_ai_chat://done")!({ payload: { request_id: requestId, content: "完整文件总结" } }));
  expect(screen.getByText("完整文件总结")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText(/继续追问这份文件/), { target: { value: "未发送的追问" } });
  returned.unmount(); render(<FilesPage />);
  expect(screen.getByPlaceholderText(/继续追问这份文件/)).toHaveValue("未发送的追问");
  expect(mocks.invoke).toHaveBeenCalledOnce();
});
