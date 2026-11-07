import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useContext, type ReactNode } from "react";
import FilesPage from "../../page/files";
import { invalidateSession } from "../../lib/session";
import { DownloadCourseContext } from "../../lib/download_context";
import type { Course, File } from "../../lib/model";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), noop: vi.fn(), enqueue: vi.fn(), empty: [], courses: [] as Course[], selectedCourseId: 7,
  messages: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/task_runtime", () => ({ enqueueTask: mocks.enqueue }));
vi.mock("../../lib/pdf_tasks", () => ({ enqueuePDFMerge: mocks.noop }));
vi.mock("../../lib/task_hooks", () => ({ useLegacyTasks: () => mocks.empty }));
vi.mock("../../lib/file_conversion", () => ({ canConvertFileToPdf: () => false, getOutputFile: (file: File) => file }));
vi.mock("../../lib/hooks", async (original) => {
  const actual = await original<typeof import("../../lib/hooks")>();
  return {
    ...actual,
    useCourses: () => ({ data: mocks.courses }),
    useSelectedCourse: () => ({ selectedCourseId: mocks.selectedCourseId, setSelectedCourseId: mocks.noop }),
    useBaseURL: () => ({ data: "https://example.com" }),
    useMerger: () => ({ merger: null, mergePDFs: mocks.noop }),
    // Keep the real useExternalFiles/useData and usePreview state/key handling.
  };
});
vi.mock("../../lib/config", async (original) => ({
  ...await original<typeof import("../../lib/config")>(),
  captureOperationConfig: () => ({ __config_owner: "test-owner", save_path: "/tmp/test" }),
  isConfigOwnerCurrent: () => true,
}));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages], appMessage: () => mocks.messages }));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../page_task_lists", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: () => null }));
vi.mock("../file_download_table", () => ({ default: () => null }));
vi.mock("../file_ai_chat_modal", () => ({ default: () => null }));
vi.mock("../file_order_select_modal", () => ({ default: () => null }));
vi.mock("../preview_modal", () => ({ default: function PreviewFixture({ files }: { files: File[] }) {
  const course = useContext(DownloadCourseContext);
  return <output data-testid="preview-selection">{files[0].display_name}:{course?.name ?? "personal"}</output>;
} }));
const courseA = { id: 7, name: "Course A", term: { name: "2026" } } as Course;
const courseB = { ...courseA, id: 8, name: "Course B" };
const localFile = { id: 12, uuid: "local", folder_id: 1, display_name: "local.zip", filename: "local.zip", mime_class: "zip", url: "https://example.com/local.zip", size: 20 };
const externalItem = { id: 90, title: "External", external_url: "https://example.com/external.zip" };
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function backend(external: () => unknown = () => [externalItem]) {
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "list_course_folders") return Promise.resolve([{ id: 1, name: "course files", full_name: "course files", parent_folder_id: null }]);
    if (command === "list_my_folders") return Promise.resolve([{ id: 1, name: "my files", full_name: "my files", parent_folder_id: null }]);
    if (command === "list_folder_folders") return Promise.resolve([]);
    if (command === "list_folder_files") return Promise.resolve([localFile]);
    if (command === "list_external_module_items") return Promise.resolve(external());
    return Promise.resolve(undefined);
  });
}
async function enableExternal() {
  await screen.findByText(localFile.display_name);
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "显示外部文件" })).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox", { name: "显示外部文件" }));
}
function externalRow() { return screen.queryByText(/external\.zip/); }
beforeEach(() => { invalidateSession(); vi.clearAllMocks(); mocks.courses.splice(0, mocks.courses.length, courseA, courseB); mocks.selectedCourseId = 7; });
afterEach(cleanup);

it("removes cached course external rows from personal files and restores them on returning to the course", async () => {
  backend(); render(<FilesPage />); await enableExternal();
  await screen.findByText(/external\.zip/);
  fireEvent.click(screen.getByRole("tab", { name: "我的文件" }));
  await screen.findByText("当前目录：my files");
  expect(externalRow()).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "课程文件" }));
  await screen.findByText(/external\.zip/);
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "list_external_module_items")).toHaveLength(2);
});

it("drops a late course external response after switching to personal files", async () => {
  const external = pending<typeof externalItem[]>(); backend(() => external.promise);
  render(<FilesPage />); await enableExternal();
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_external_module_items", { courseId: 7 }));
  fireEvent.click(screen.getByRole("tab", { name: "我的文件" }));
  await screen.findByText("当前目录：my files");
  await act(async () => external.resolve([externalItem]));
  expect(externalRow()).not.toBeInTheDocument();
  expect(mocks.messages.error).not.toHaveBeenCalled();
});

it("removes external rows when the selected course becomes unavailable", async () => {
  backend(); const view = render(<FilesPage />); await enableExternal();
  await screen.findByText(/external\.zip/);
  mocks.courses.splice(0, 1, { ...courseB, id: 9 }); view.rerender(<FilesPage />);
  expect(externalRow()).not.toBeInTheDocument();
  expect(screen.getByText("当前目录：未选择目录")).toBeInTheDocument();
});

it("clears an active preview when the shared selected course changes", async () => {
  backend(); const view = render(<FilesPage />);
  await screen.findByText(localFile.display_name);
  fireEvent.click(within(screen.getByText(localFile.display_name).closest("tr")!).getByRole("button", { name: "预览" }));
  expect(screen.getByTestId("preview-selection")).toHaveTextContent("local.zip:Course A");
  mocks.selectedCourseId = 8; view.rerender(<FilesPage />);
  expect(screen.queryByTestId("preview-selection")).not.toBeInTheDocument();
});

it("does not reopen an old hovered file with Space after a source change", async () => {
  backend(); const view = render(<FilesPage />);
  await screen.findByText(localFile.display_name);
  fireEvent.mouseEnter(screen.getByText(localFile.display_name));
  // Open through the button without mouseleave, so both selections need resetting.
  fireEvent.click(within(screen.getByText(localFile.display_name).closest("tr")!).getByRole("button", { name: "预览" }));
  mocks.selectedCourseId = 8; view.rerender(<FilesPage />);
  expect(screen.queryByTestId("preview-selection")).not.toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: " " });
  expect(screen.queryByTestId("preview-selection")).not.toBeInTheDocument();
});


it("preserves an active preview across unrelated same-source rerenders", async () => {
  backend(); const view = render(<FilesPage />);
  await screen.findByText(localFile.display_name);
  fireEvent.click(within(screen.getByText(localFile.display_name).closest("tr")!).getByRole("button", { name: "预览" }));
  view.rerender(<FilesPage />);
  expect(screen.getByTestId("preview-selection")).toHaveTextContent("local.zip:Course A");
});


it("downloads a valid external file into its course root, including its queued native arguments", async () => {
  backend(); render(<FilesPage />); await enableExternal();
  await screen.findByText(/external\.zip/);
  fireEvent.click(within(externalRow()!.closest("tr")!).getByRole("button", { name: "下载" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "下载原文件" }));
  expect(mocks.enqueue).toHaveBeenCalledOnce();
  const task = mocks.enqueue.mock.calls[0][0];
  expect(task.context).toBe("Course A");
  await task.run();
  expect(mocks.invoke).toHaveBeenCalledWith("download_course_file", expect.objectContaining({
    course: expect.objectContaining({ id: 7 }), folderPath: "", file: expect.objectContaining({ external_type: "File" }),
  }));
});
