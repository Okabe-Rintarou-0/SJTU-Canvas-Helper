import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import FilesPage from "../../page/files";
import { invalidateSession, useSessionEpoch } from "../../lib/session";
import { usePreviewState } from "../../lib/preview_session";
import type { Entry, Course, File } from "../../lib/model";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), noop: vi.fn(), empty: [], courses: [] as Course[], selectedCourseId: -1, enqueue: vi.fn(), uploadTask: vi.fn(),
  messages: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/task_runtime", () => ({ enqueueTask: mocks.enqueue }));
vi.mock("../../lib/upload_tasks", () => ({ createCloudUploadTask: mocks.uploadTask }));
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

const rootFolder = { id: 1, name: "my files", full_name: "my files", parent_folder_id: null };
const branchFolder = { id: 2, name: "Branch", full_name: "my files/Branch", parent_folder_id: 1 };
const nestedFolder = { id: 3, name: "Nested", full_name: "my files/Branch/Nested", parent_folder_id: 2 };
const rootFile = { ...oldFile, uuid: "root-file", display_name: "root.zip" };
const branchFile = { ...oldFile, uuid: "branch-file", display_name: "branch.zip" };
const nestedFile = { ...oldFile, uuid: "nested-file", display_name: "nested.zip" };
function pending<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function navigationBackend(overrides: (command: string, id: number | undefined) => unknown = () => undefined) {
  mocks.invoke.mockImplementation((command: string, args?: { folderId?: number; courseId?: number }) => {
    const overridden = overrides(command, args?.folderId ?? args?.courseId);
    if (overridden !== undefined) return overridden;
    if (command === "list_my_folders") return Promise.resolve([rootFolder, branchFolder, nestedFolder]);
    if (command === "list_course_folders") return Promise.resolve([{ ...rootFolder, name: "course files", full_name: "course files" }, branchFolder, nestedFolder]);
    if (command === "list_folder_files") return Promise.resolve(args?.folderId === 1 ? [rootFile] : args?.folderId === 2 ? [branchFile] : [nestedFile]);
    if (command === "list_folder_folders") return Promise.resolve(args?.folderId === 1 ? [branchFolder] : args?.folderId === 2 ? [nestedFolder] : []);
    if (command === "get_folder_by_id") return Promise.resolve(args?.folderId === 2 ? branchFolder : args?.folderId === 3 ? nestedFolder : rootFolder);
    return Promise.resolve(undefined);
  });
}
async function openBranch() {
  render(<FilesPage />); selectPersonalFiles();
  fireEvent.click(await screen.findByRole("button", { name: "Branch" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_folder_files", { folderId: 2 }));
}

it("ignores older folder rows after returning to root in the same session", async () => {
  const files = pending<typeof branchFile[]>(); const folders = pending<typeof nestedFolder[]>();
  navigationBackend((command, id) => id === 2 && command === "list_folder_files" ? files.promise : id === 2 && command === "list_folder_folders" ? folders.promise : undefined);
  await openBranch();
  await waitFor(() => expect(screen.getByRole("button", { name: "根目录" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "根目录" }));
  await screen.findByText(rootFile.display_name);
  await act(async () => { files.resolve([branchFile]); folders.resolve([nestedFolder]); });
  expect(screen.getByText(rootFile.display_name)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Branch" })).toBeInTheDocument();
  expect(screen.queryByText(branchFile.display_name)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Nested" })).not.toBeInTheDocument();
});

it("does not let older failed file and folder requests clear the latest root", async () => {
  const files = pending<typeof branchFile[]>(); const folders = pending<typeof nestedFolder[]>();
  navigationBackend((command, id) => id === 2 && command === "list_folder_files" ? files.promise : id === 2 && command === "list_folder_folders" ? folders.promise : undefined);
  await openBranch();
  await waitFor(() => expect(screen.getByRole("button", { name: "根目录" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "根目录" }));
  await screen.findByText(rootFile.display_name);
  await act(async () => { files.reject(new Error("old files")); folders.reject(new Error("old folders")); });
  expect(screen.getByText(rootFile.display_name)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Branch" })).toBeInTheDocument();
});

it("keeps newer path and parent navigation when an older metadata request settles last", async () => {
  const metadata = pending<typeof branchFolder>();
  navigationBackend((command, id) => command === "get_folder_by_id" && id === 2 ? metadata.promise : undefined);
  await openBranch();
  fireEvent.click(await screen.findByRole("button", { name: "Nested" }));
  await screen.findByText(nestedFile.display_name);
  await screen.findByText("当前目录：my files/Branch/Nested");
  await act(async () => metadata.resolve(branchFolder));
  expect(screen.getByText("当前目录：my files/Branch/Nested")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "上级目录" }));
  await screen.findByText(branchFile.display_name);
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "get_folder_by_id").slice(-1)[0]).toEqual(["get_folder_by_id", { folderId: 2 }]);
});

it("does not clear the latest loading state when an older folder finishes", async () => {
  const oldFiles = pending<typeof branchFile[]>(); const newFiles = pending<typeof nestedFile[]>();
  navigationBackend((command, id) => command === "list_folder_files" && id === 2 ? oldFiles.promise : command === "list_folder_files" && id === 3 ? newFiles.promise : undefined);
  await openBranch();
  fireEvent.click(await screen.findByRole("button", { name: "Nested" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_folder_files", { folderId: 3 }));
  await act(async () => oldFiles.resolve([branchFile]));
  expect(screen.getByRole("tab", { name: "课程文件" })).toBeDisabled();
  expect(screen.queryByText(branchFile.display_name)).not.toBeInTheDocument();
  await act(async () => newFiles.resolve([nestedFile]));
  expect(screen.getByRole("tab", { name: "课程文件" })).toBeEnabled();
  expect(screen.getByText(nestedFile.display_name)).toBeInTheDocument();
});

it("rejects a late root-list success after the selected course changes", async () => {
  const oldRoot = pending<typeof rootFolder[]>();
  navigationBackend((command, id) => command === "list_course_folders" && id === 7 ? oldRoot.promise : undefined);
  mocks.courses.push({ id: 7, name: "Old course", term: { name: "2026" } } as Course, { id: 8, name: "New course", term: { name: "2026" } } as Course);
  mocks.selectedCourseId = 7;
  const view = render(<FilesPage />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("list_course_folders", { courseId: 7 }));
  mocks.selectedCourseId = 8; view.rerender(<FilesPage />);
  await screen.findByText(rootFile.display_name);
  await act(async () => oldRoot.resolve([{ ...rootFolder, id: 77, name: "course files", full_name: "course files" }]));
  expect(mocks.invoke).not.toHaveBeenCalledWith("list_folder_files", { folderId: 77 });
  expect(screen.getByText(rootFile.display_name)).toBeInTheDocument();
});

it("rejects a late root-list failure after the selected course changes", async () => {
  const oldRoot = pending<typeof rootFolder[]>();
  navigationBackend((command, id) => command === "list_course_folders" && id === 7 ? oldRoot.promise : undefined);
  mocks.courses.push({ id: 7, name: "Old course", term: { name: "2026" } } as Course, { id: 8, name: "New course", term: { name: "2026" } } as Course);
  mocks.selectedCourseId = 7;
  const view = render(<FilesPage />);
  mocks.selectedCourseId = 8; view.rerender(<FilesPage />);
  await screen.findByText(rootFile.display_name);
  await act(async () => oldRoot.reject(new Error("old root")));
  expect(screen.getByText(rootFile.display_name)).toBeInTheDocument();
});

it("distinguishes the first A request from a later A after A-to-B-to-A navigation", async () => {
  const firstA = pending<typeof branchFile[]>(); let visits = 0;
  navigationBackend((command, id) => command === "list_folder_files" && id === 2 && ++visits === 1 ? firstA.promise : undefined);
  await openBranch();
  fireEvent.click(await screen.findByRole("button", { name: "Nested" }));
  await screen.findByText(nestedFile.display_name);
  fireEvent.click(screen.getByRole("button", { name: "上级目录" }));
  await screen.findByText(branchFile.display_name);
  await act(async () => firstA.resolve([{ ...branchFile, uuid: "superseded", display_name: "superseded.zip" }]));
  expect(screen.getByText(branchFile.display_name)).toBeInTheDocument();
  expect(screen.queryByText("superseded.zip")).not.toBeInTheDocument();
  expect(visits).toBe(2);
});

it("clears the old selection on parent and root navigation", async () => {
  navigationBackend(); await openBranch();
  await screen.findByText(branchFile.display_name);
  fireEvent.click(within(screen.getByText(branchFile.display_name).closest("tr")!).getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "上级目录" }));
  await screen.findByText(rootFile.display_name);
  fireEvent.click(screen.getByRole("button", { name: "Branch" }));
  await screen.findByText(branchFile.display_name);
  expect(within(screen.getByText(branchFile.display_name).closest("tr")!).getByRole("checkbox")).not.toBeChecked();
  fireEvent.click(within(screen.getByText(branchFile.display_name).closest("tr")!).getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "根目录" }));
  await screen.findByText(rootFile.display_name);
  fireEvent.click(screen.getByRole("button", { name: "Branch" }));
  await screen.findByText(branchFile.display_name);
  expect(within(screen.getByText(branchFile.display_name).closest("tr")!).getByRole("checkbox")).not.toBeChecked();
});

it("handles current file failure without erasing successfully loaded subfolders or hanging loading", async () => {
  navigationBackend((command, id) => command === "list_folder_files" && id === 2 ? Promise.reject(new Error("current files")) : undefined);
  await openBranch();
  await screen.findByRole("button", { name: "Nested" });
  expect(screen.queryByText(branchFile.display_name)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("tab", { name: "课程文件" })).toBeEnabled());
  expect(screen.getByText("当前目录：my files/Branch")).toBeInTheDocument();
});

it("keeps personal navigation when unrelated courses or their selection change", async () => {
  navigationBackend();
  const view = render(<FilesPage />); selectPersonalFiles();
  fireEvent.click(await screen.findByRole("button", { name: "Branch" }));
  await screen.findByText(branchFile.display_name);
  const requests = mocks.invoke.mock.calls.length;
  mocks.courses.push({ id: 7, name: "New course", term: { name: "2026" } } as Course);
  mocks.selectedCourseId = 7; view.rerender(<FilesPage />);
  expect(screen.getByText(branchFile.display_name)).toBeInTheDocument();
  expect(screen.getByText("当前目录：my files/Branch")).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledTimes(requests);
});

it("clears an unavailable selected course even if the course list length is unchanged", async () => {
  navigationBackend();
  mocks.courses.push({ id: 7, name: "Old course", term: { name: "2026" } } as Course);
  mocks.selectedCourseId = 7;
  const view = render(<FilesPage />);
  await screen.findByText(rootFile.display_name);
  mocks.courses.splice(0, 1, { id: 8, name: "Replacement", term: { name: "2026" } } as Course);
  view.rerender(<FilesPage />);
  expect(screen.queryByText(rootFile.display_name)).not.toBeInTheDocument();
  expect(screen.getByText("当前目录：未选择目录")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "我的文件" })).toBeEnabled();
});

it("handles a missing root and does not continue root discovery after unmount", async () => {
  navigationBackend((command) => command === "list_my_folders" ? Promise.resolve([]) : undefined);
  const view = render(<FilesPage />); selectPersonalFiles();
  await waitFor(() => expect(screen.getByRole("tab", { name: "课程文件" })).toBeEnabled());
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "list_folder_files")).toHaveLength(0);
  view.unmount();
  const root = pending<typeof rootFolder[]>();
  navigationBackend((command) => command === "list_my_folders" ? root.promise : undefined);
  const next = render(<FilesPage />); selectPersonalFiles(); next.unmount();
  await act(async () => root.resolve([rootFolder]));
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "list_folder_files")).toHaveLength(0);
});


it("does not upload a child file into root while its directory metadata is pending", async () => {
  const metadata = pending<typeof branchFolder>();
  navigationBackend((command, id) => command === "get_folder_by_id" && id === 2 ? metadata.promise : undefined);
  await openBranch(); await screen.findByText(branchFile.display_name);
  const upload = within(screen.getByText(branchFile.display_name).closest("tr")!).getByRole("button", { name: "上传云盘" });
  expect(upload).toBeDisabled(); fireEvent.click(upload);
  expect(mocks.uploadTask).not.toHaveBeenCalled();
  await act(async () => metadata.resolve(branchFolder));
  expect(upload).toBeEnabled(); fireEvent.click(upload);
  fireEvent.click(screen.getByRole("menuitem", { name: "上传原文件" }));
  expect(mocks.uploadTask).toHaveBeenCalledWith(expect.objectContaining({ uuid: branchFile.uuid }), "original", "我的Canvas文件/Branch", "我的 Canvas 文件");
});

it("does not fall back to a root upload after directory metadata fails", async () => {
  navigationBackend((command, id) => command === "get_folder_by_id" && id === 2 ? Promise.reject(new Error("path unavailable")) : undefined);
  await openBranch(); await screen.findByText(branchFile.display_name);
  const upload = within(screen.getByText(branchFile.display_name).closest("tr")!).getByRole("button", { name: "上传云盘" });
  expect(upload).toBeDisabled(); fireEvent.click(upload);
  expect(mocks.uploadTask).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: "课程文件" })).toBeEnabled();
});
