import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import FilesPage from "../../page/files";
import { invalidateSession, useSessionEpoch } from "../../lib/session";
import { usePreviewState } from "../../lib/preview_session";
import type { Entry, Course, File } from "../../lib/model";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), noop: vi.fn(), empty: [], courses: [] as Course[], selectedCourseId: -1, enqueue: vi.fn(),
  messages: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/task_runtime", () => ({ enqueueTask: mocks.enqueue }));
vi.mock("../../lib/upload_tasks", () => ({ createCloudUploadTask: vi.fn() }));
vi.mock("../../lib/task_hooks", () => ({ useLegacyTasks: () => mocks.empty }));
vi.mock("../../lib/file_conversion", () => ({ canConvertFileToPdf: () => false, getOutputFile: (file: File) => file }));
vi.mock("../../lib/hooks", () => ({
  useCourses: () => ({ data: mocks.courses }),
  useSelectedCourse: () => ({ selectedCourseId: mocks.selectedCourseId, setSelectedCourseId: mocks.noop }),
  useExternalFiles: () => ({ data: mocks.empty }), useBaseURL: () => ({ data: "https://example.com" }),
  useMerger: () => ({ merger: null, mergePDFs: mocks.noop }),
  // Exercise real session-bound selection state, without mounting document engines.
  // A fresh callback accepting an old row is the source-lifetime regression.
  usePreview: () => {
    const [entry, setEntry] = usePreviewState<Entry | undefined>(useSessionEpoch(), undefined);
    return {
      previewer: <output data-testid="preview-selection">{entry && "display_name" in entry ? entry.display_name : ""}</output>,
      onHoverEntry: mocks.noop, onLeaveEntry: mocks.noop, setPreviewEntry: setEntry, setEntries: mocks.noop,
    };
  },
}));
vi.mock("../../lib/config", () => ({ captureOperationConfig: () => ({ __config_owner: "test-owner", save_path: "/tmp/test" }), isConfigOwnerCurrent: () => true }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages] }));
vi.mock("../../lib/utils", () => ({ formatSize: () => "20 B", getFileIcon: () => null,
  isMergableFileType: () => false, consoleLog: vi.fn(), scrollToTop: vi.fn() }));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../page_task_lists", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: () => null }));
vi.mock("../file_download_table", () => ({ default: () => null }));
vi.mock("../file_ai_chat_modal", () => ({ default: () => null }));
vi.mock("../file_order_select_modal", () => ({ default: () => null }));

const oldFile = { id: 12, uuid: "old-file", display_name: "old-account.zip", url: "https://example.com/old", size: 20 };
const newFile = { ...oldFile, id: 22, uuid: "new-file", display_name: "new-account.zip", url: "https://example.com/new" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function backend(files: () => unknown) {
  mocks.invoke.mockImplementation((command: string) => {
    if (command === "list_my_folders") return Promise.resolve([{ id: 1, name: "my files", full_name: "my files", parent_folder_id: null }]);
    if (command === "list_course_folders") return Promise.resolve([{ id: 1, name: "course files", full_name: "course files", parent_folder_id: null }]);
    if (command === "sync_course_files") return Promise.resolve(files());
    if (command === "list_folder_folders") return Promise.resolve([]);
    if (command === "list_folder_files") return Promise.resolve(files());
    return Promise.resolve(undefined);
  });
}
function selectPersonalFiles() {
  fireEvent.click(screen.getByRole("tab", { name: "我的文件" }));
}
function previewRow(name: string) {
  fireEvent.click(within(screen.getByText(name).closest("tr")!).getByRole("button", { name: "预览" }));
}
beforeEach(() => { invalidateSession(); vi.clearAllMocks(); mocks.courses.splice(0); mocks.selectedCourseId = -1; });
afterEach(cleanup);

it("removes loaded old source rows before fresh preview callbacks can select them, then loads the new account", async () => {
  backend(() => [oldFile]);
  render(<FilesPage />);
  selectPersonalFiles();
  await screen.findByText(oldFile.display_name);
  previewRow(oldFile.display_name);
  expect(screen.getByTestId("preview-selection")).toHaveTextContent(oldFile.display_name);
  act(() => invalidateSession());
  // If the source survives, explicitly exercise its newly rendered callback.
  const staleRow = screen.queryByText(oldFile.display_name);
  if (staleRow) previewRow(oldFile.display_name);
  expect(screen.getByTestId("preview-selection")).toBeEmptyDOMElement();
  expect(screen.queryByText(oldFile.display_name)).not.toBeInTheDocument();
  backend(() => [newFile]);
  selectPersonalFiles();
  await screen.findByText(newFile.display_name);
  previewRow(newFile.display_name);
  expect(screen.getByTestId("preview-selection")).toHaveTextContent(newFile.display_name);
});

it("does not republish a deferred old folder result into the new mounted page", async () => {
  const pending = deferred<typeof oldFile[]>();
  backend(() => pending.promise);
  render(<FilesPage />);
  selectPersonalFiles();
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_folder_files", { folderId: 1 }));
  act(() => invalidateSession());
  await act(async () => { pending.resolve([oldFile]); });
  expect(screen.queryByText(oldFile.display_name)).not.toBeInTheDocument();
  backend(() => [newFile]);
  selectPersonalFiles();
  await screen.findByText(newFile.display_name);
});

it("preserves loaded personal files and selection across an unrelated same-session rerender", async () => {
  backend(() => [oldFile]);
  const view = render(<FilesPage />);
  selectPersonalFiles();
  await screen.findByText(oldFile.display_name);
  fireEvent.change(screen.getByPlaceholderText("输入文件关键词…"), { target: { value: "old-account" } });
  previewRow(oldFile.display_name);
  const requests = mocks.invoke.mock.calls.length;
  view.rerender(<FilesPage />);
  expect(screen.getByPlaceholderText("输入文件关键词…")).toHaveValue("old-account");
  expect(screen.getByRole("tab", { name: "我的文件" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("preview-selection")).toHaveTextContent(oldFile.display_name);
  expect(mocks.invoke.mock.calls).toHaveLength(requests);
});

function showCourseFiles() {
  mocks.courses.push({ id: 7, name: "Test course", term: { name: "2026" }, enrollments: [] } as unknown as Course);
  mocks.selectedCourseId = 7;
  render(<FilesPage />);
}
it("rejects a queued sync before it can request files for a previous account", async () => {
  backend(() => [oldFile]); showCourseFiles();
  fireEvent.click(screen.getByRole("button", { name: "一键同步" }));
  const task = mocks.enqueue.mock.calls[0][0];
  act(() => invalidateSession());
  const update = vi.fn();
  await expect(task.run({ update })).rejects.toThrow("账号已切换");
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "sync_course_files")).toEqual([]);
  expect(mocks.enqueue).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
});
it("does not turn a late old sync result into new-account download tasks", async () => {
  backend(() => [oldFile]); showCourseFiles();
  await screen.findByText(oldFile.display_name);
  fireEvent.click(screen.getByRole("button", { name: "一键同步" }));
  const task = mocks.enqueue.mock.calls[0][0];
  const pending = deferred<typeof oldFile[]>();
  mocks.invoke.mockReturnValueOnce(pending.promise);
  const update = vi.fn(); const running = task.run({ update });
  const rejection = expect(running).rejects.toThrow("账号已切换");
  act(() => invalidateSession());
  await act(async () => pending.resolve([oldFile]));
  await rejection;
  expect(mocks.enqueue).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
  expect(mocks.messages.success).not.toHaveBeenCalled();
});
it("still publishes child downloads and completion for a current-owner sync", async () => {
  backend(() => [oldFile]); showCourseFiles();
  await screen.findByText(oldFile.display_name);
  fireEvent.click(screen.getByRole("button", { name: "一键同步" }));
  const task = mocks.enqueue.mock.calls[0][0]; const update = vi.fn();
  await act(async () => task.run({ update }));
  expect(mocks.enqueue).toHaveBeenCalledTimes(2);
  expect(mocks.enqueue.mock.calls[1][0]).toMatchObject({ kind: "file", name: oldFile.display_name });
  expect(update).toHaveBeenCalledWith({ log: expect.stringContaining("1") });
  expect(mocks.messages.success).toHaveBeenCalledOnce();
});
