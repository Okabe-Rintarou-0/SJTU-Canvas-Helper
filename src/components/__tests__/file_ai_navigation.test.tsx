import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import FilesPage from "../../page/files";
import { fileAISession } from "../../lib/file_ai_session";
import type { Course, DraggableItem } from "../../lib/model";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), enqueueTask: vi.fn(), enqueuePDFMerge: vi.fn(), noop: vi.fn(), empty: [],
  courses: [] as Course[], selectedCourseId: -1,
  files: [{ id: 12, key: "file", uuid: "file", display_name: "作业.pdf", url: "https://example.com/file", size: 20 }],
  messages: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../lib/task_runtime", () => ({ enqueueTask: mocks.enqueueTask }));
vi.mock("../../lib/task_hooks", () => ({ useLegacyTasks: () => mocks.empty, useTasks: () => mocks.empty }));
vi.mock("../../lib/pdf_tasks", () => ({ enqueuePDFMerge: mocks.enqueuePDFMerge }));
vi.mock("../../lib/hooks", () => ({
  useCourses: () => ({ data: mocks.courses }), useSelectedCourse: () => ({ selectedCourseId: mocks.selectedCourseId, setSelectedCourseId: mocks.noop }),
  useExternalFiles: () => ({ data: mocks.files }), useBaseURL: () => ({ data: "https://example.com" }),
  usePreview: () => ({ previewer: null, onHoverEntry: mocks.noop, onLeaveEntry: mocks.noop, setPreviewEntry: mocks.noop, setEntries: mocks.noop }),
}));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages] }));
vi.mock("../../lib/utils", () => ({ formatDate: (value: string) => value, formatSize: () => "20 B", getFileIcon: () => null,
  formatCompactDate: (value?: string) => value?.slice(0, 10) ?? "",
  isMergableFileType: (name: string) => name.endsWith(".pdf"), consoleLog: vi.fn(), scrollToTop: vi.fn() }));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../page_task_lists", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: () => null }));
vi.mock("../file_download_table", () => ({ default: () => null }));
vi.mock("../draggable_list", () => ({ default: ({ items, onDragEnd }: { items: DraggableItem[]; onDragEnd: (items: DraggableItem[]) => void }) => <div>
  <span data-testid="merge-order">{items.map((item) => item.content).join(",")}</span>
  <button onClick={() => onDragEnd([...items].reverse())}>调换顺序</button>
</div> }));

afterEach(() => { cleanup(); fileAISession.reset(); vi.restoreAllMocks(); });

it("keeps the user's PDF merge order across unrelated file page updates", () => {
  mocks.files.push({ ...mocks.files[0], id: 13, key: "second", uuid: "second", display_name: "第二份.pdf" });
  mocks.noop.mockClear();
  try {
    const view = render(<FilesPage />);
    for (const name of ["作业.pdf", "第二份.pdf"]) {
      fireEvent.click(within(screen.getByText(name).closest("tr")!).getByRole("checkbox"));
    }
    fireEvent.click(screen.getByRole("button", { name: "合并 Word/PDF/PPTX" }));
    fireEvent.click(screen.getByRole("button", { name: "调换顺序" }));
    expect(screen.getByTestId("merge-order")).toHaveTextContent("第二份.pdf,作业.pdf");
    view.rerender(<FilesPage />);
    expect(screen.getByTestId("merge-order")).toHaveTextContent("第二份.pdf,作业.pdf");
    fireEvent.change(screen.getByRole("textbox", { name: "输出文件名" }), { target: { value: "课程笔记.pdf" } });
    fireEvent.click(screen.getByRole("button", { name: "开始合并" }));
    expect(mocks.enqueuePDFMerge).toHaveBeenCalledWith([mocks.files[1], mocks.files[0]], "课程笔记.pdf", undefined);
  } finally {
    mocks.files.pop();
  }
}, 15_000);

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
  handlers.get("file_ai_chat://chunk")!({ payload: { request_id: requestId, chunk: "后台片段\n\n$$\n\\frac{1}{" } });
  const returned = render(<FilesPage />);
  expect(screen.getByText("后台片段")).toBeInTheDocument();
  expect(screen.getByText("\\frac{1}{")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  act(() => handlers.get("file_ai_chat://chunk")!({ payload: { request_id: requestId, chunk: "2}\n$$" } }));
  expect(screen.getByRole("dialog").querySelector(".katex-display math annotation")?.textContent).toBe("\\frac{1}{2}");
  act(() => handlers.get("file_ai_chat://done")!({ payload: { request_id: requestId, content: "完整文件总结\n\n不变量为 `$P$`。\n\n$$\n\\frac{1}{2}\n$$" } }));
  expect(screen.getByText("完整文件总结")).toBeInTheDocument();
  expect(screen.getByRole("dialog").querySelector("math annotation")?.textContent).toBe("P");
  fireEvent.change(screen.getByPlaceholderText(/继续追问这份文件/), { target: { value: "未发送的追问" } });
  returned.unmount(); render(<FilesPage />);
  expect(screen.getByPlaceholderText(/继续追问这份文件/)).toHaveValue("未发送的追问");
  expect(mocks.invoke).toHaveBeenCalledOnce();
});

it("only queues course-wide synchronization after confirming the course and scope", async () => {
  const course = { id: 37, name: "课程同步测试", term: { id: 2, name: "Fall" } } as Course;
  mocks.courses = [course];
  mocks.selectedCourseId = course.id;
  mocks.invoke.mockResolvedValue([]);
  mocks.enqueueTask.mockClear();
  try {
    render(<FilesPage />);
    const sync = await screen.findByRole("button", { name: "一键同步" });
    await waitFor(() => expect(sync).toBeEnabled());
    fireEvent.click(sync);
    let dialog = screen.getByRole("dialog", { name: "同步课程文件" });
    expect(within(dialog).getByText(course.name)).toBeVisible();
    expect(within(dialog).getByText(/包括所有子目录/)).toBeVisible();
    expect(mocks.enqueueTask).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(mocks.enqueueTask).not.toHaveBeenCalled();
    fireEvent.click(sync);
    dialog = screen.getByRole("dialog", { name: "同步课程文件" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认同步" }));
    expect(mocks.enqueueTask).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      kind: "sync", source: "files", context: course.name,
    }));
  } finally {
    mocks.courses = [];
    mocks.selectedCourseId = -1;
  }
});

it("sorts folder files, separates preview from Canvas, and queues batches", async () => {
  const course = { id: 37, name: "测试课程", term: { id: 2, name: "Fall" } } as Course;
  const pdf = { id: 7, uuid: "pdf", folder_id: 2, display_name: "讲义.pdf", filename: "讲义.pdf", size: 300,
    modified_at: "2026-02-05T10:00:00Z", url: "https://example.com/pdf" };
  const doc = { id: 8, uuid: "doc", folder_id: 2, display_name: "提纲.docx", filename: "提纲.docx", size: 100,
    updated_at: "2026-10-01T10:00:00Z", url: "https://example.com/doc" };
  const savedFiles = mocks.files.splice(0);
  mocks.courses = [course];
  mocks.selectedCourseId = course.id;
  mocks.enqueueTask.mockClear();
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "list_course_folders") return [{ id: 2, name: "course files", full_name: "course files" }];
    if (command === "list_folder_files") return [pdf, doc];
    return [];
  });
  try {
    render(<FilesPage />);
    const preview = await screen.findByRole("button", { name: pdf.display_name });
    fireEvent.click(preview);
    expect(mocks.noop).toHaveBeenCalledWith(expect.objectContaining({ id: pdf.id }));
    expect(within(preview.closest("tr")!).getByRole("link", { name: "在 Canvas 打开" }))
      .toHaveAttribute("href", "https://example.com/courses/37/files?preview=7");

    const names = () => screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent);
    fireEvent.click(screen.getByRole("button", { name: "文件大小" }));
    expect(names()).toEqual([doc.display_name, pdf.display_name]);
    fireEvent.click(screen.getByRole("button", { name: "修改日期" }));
    expect(names()).toEqual([pdf.display_name, doc.display_name]);
    fireEvent.click(screen.getByRole("button", { name: "修改日期" }));
    expect(names()).toEqual([doc.display_name, pdf.display_name]);

    fireEvent.click(screen.getByRole("checkbox", { name: "选择所有可见文件" }));
    fireEvent.click(screen.getByRole("button", { name: "批量下载" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "下载原文件" }));
    expect(mocks.enqueueTask.mock.calls.map(([task]) => task.kind)).toEqual(["file", "file"]);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "批量上传云盘" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "上传原文件" }));
    expect(mocks.enqueueTask.mock.calls.map(([task]) => task.kind)).toEqual(["file", "file", "upload", "upload"]);
    expect(mocks.enqueueTask.mock.calls.slice(2).map(([task]) => task.outputPath))
      .toEqual(["交大云盘/测试课程/提纲.docx", "交大云盘/测试课程/讲义.pdf"]);
  } finally {
    mocks.files.push(...savedFiles);
    mocks.courses = [];
    mocks.selectedCourseId = -1;
  }
}, 30_000);
