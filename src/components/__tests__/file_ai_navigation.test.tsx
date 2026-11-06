import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import FilesPage from "../../page/files";
import { fileAISession } from "../../lib/file_ai_session";
import type { Course, DraggableItem } from "../../lib/model";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), noop: vi.fn(), mergePDFs: vi.fn(), empty: [], courses: [] as Course[], selectedCourseId: -1,
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
  useCourses: () => ({ data: mocks.courses }), useSelectedCourse: () => ({ selectedCourseId: mocks.selectedCourseId, setSelectedCourseId: mocks.noop }),
  useExternalFiles: () => ({ data: mocks.empty }), useBaseURL: () => ({ data: "https://example.com" }),
  useMerger: () => ({ merger: null, mergePDFs: mocks.mergePDFs }),
  usePreview: () => ({ resetPreview: mocks.noop, previewer: null, onHoverEntry: mocks.noop, onLeaveEntry: mocks.noop, setPreviewEntry: mocks.noop, setEntries: mocks.noop }),
}));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages] }));
vi.mock("../../lib/utils", () => ({ formatDate: (value: string) => value, formatSize: () => "20 B", getFileIcon: () => null,
  isMergableFileType: (name: string) => name.endsWith(".pdf"), consoleLog: vi.fn(), scrollToTop: vi.fn() }));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../page_task_lists", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: () => null }));
vi.mock("../file_download_table", () => ({ default: () => null }));
vi.mock("../draggable_list", () => ({ default: ({ items, onDragEnd }: { items: DraggableItem[]; onDragEnd: (items: DraggableItem[]) => void }) => <div>
  <span data-testid="merge-order">{items.map((item) => item.content).join(",")}</span>
  <button onClick={() => onDragEnd([...items].reverse())}>调换顺序</button>
</div> }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.courses.splice(0); mocks.selectedCourseId = -1;
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "list_course_folders") return [{ id: 1, name: "course files", full_name: "course files", parent_folder_id: null }];
    if (command === "list_my_folders") return [{ id: 1, name: "my files", full_name: "my files", parent_folder_id: null }];
    if (command === "list_folder_folders") return [];
    if (command === "list_folder_files") return mocks.files;
    return undefined;
  });
});

afterEach(() => { cleanup(); fileAISession.reset(); vi.restoreAllMocks(); });

it("keeps the user's PDF merge order across unrelated file page updates", async () => {
  mocks.files.push({ ...mocks.files[0], id: 13, key: "second", uuid: "second", display_name: "第二份.pdf" });
  mocks.mergePDFs.mockClear();
  try {
    const view = render(<FilesPage />);
    fireEvent.click(screen.getByRole("tab", { name: "我的文件" }));
    await screen.findByText("作业.pdf");
    for (const name of ["作业.pdf", "第二份.pdf"]) {
      fireEvent.click(within(screen.getByText(name).closest("tr")!).getByRole("checkbox"));
    }
    fireEvent.click(screen.getByRole("button", { name: "合并 Word/PDF/PPTX" }));
    fireEvent.click(screen.getByRole("button", { name: "调换顺序" }));
    expect(screen.getByTestId("merge-order")).toHaveTextContent("第二份.pdf,作业.pdf");
    view.rerender(<FilesPage />);
    expect(screen.getByTestId("merge-order")).toHaveTextContent("第二份.pdf,作业.pdf");
    fireEvent.click(screen.getByRole("button", { name: "确认顺序" }));
    expect(mocks.mergePDFs).toHaveBeenCalledWith([mocks.files[1], mocks.files[0]]);
  } finally {
    mocks.files.pop();
  }
}, 15_000);

it("restores the real file conversation after leaving, including chunks received in the background", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  const handlers = new Map<string, (event: { payload: Record<string, string> }) => void>();
  mocks.listen.mockImplementation(async (event, handler) => { handlers.set(event, handler); return () => handlers.delete(event); });
  const view = render(<FilesPage />);
  fireEvent.click(screen.getByRole("tab", { name: "我的文件" }));
  await screen.findByText("作业.pdf");
  fireEvent.click(screen.getByRole("button", { name: "AI 总结" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("start_file_chat_stream", expect.anything()));
  const requestId = mocks.invoke.mock.calls.find(([command]) => command === "start_file_chat_stream")![1].requestId;
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
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "start_file_chat_stream")).toHaveLength(1);
  expect(mocks.invoke).toHaveBeenCalledWith("list_my_folders");
  expect(mocks.invoke).toHaveBeenCalledWith("list_folder_files", { folderId: 1 });
});


it("closes the real merge-order dialog when the shared course selection changes", async () => {
  mocks.courses.push({ id: 7, name: "Course A", term: { name: "2026" } } as Course, { id: 8, name: "Course B", term: { name: "2026" } } as Course);
  mocks.selectedCourseId = 7;
  mocks.files.push({ ...mocks.files[0], id: 13, key: "second", uuid: "second", display_name: "第二份.pdf" });
  try {
    const view = render(<FilesPage />); await screen.findByText("作业.pdf");
    for (const name of ["作业.pdf", "第二份.pdf"]) fireEvent.click(within(screen.getByText(name).closest("tr")!).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "合并 Word/PDF/PPTX" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    mocks.selectedCourseId = 8; view.rerender(<FilesPage />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.mergePDFs).not.toHaveBeenCalled();
  } finally { mocks.files.pop(); }
});
