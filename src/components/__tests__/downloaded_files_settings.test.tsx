import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DownloadedFilesSettings from "../downloaded_files_settings";
import type { DownloadedFile } from "../../lib/downloads";
import { invalidateSession } from "../../lib/session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), tasks: [] as { id: string; status: string }[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/task_hooks", () => ({ useTasks: () => mocks.tasks }));
const files: DownloadedFile[] = [
  { path: "D:/下载/课程文件/数学/课件.pdf", name: "课件.pdf", relativePath: "课程文件/数学/课件.pdf", size: 2048, modifiedAt: 1000, stamp: "2048:1", external: false },
  { path: "E:/字幕.srt", name: "字幕.srt", relativePath: "E:/字幕.srt", size: 20, modifiedAt: 2000, stamp: "20:2", external: true },
];
let remaining: DownloadedFile[];
beforeEach(() => {
  vi.clearAllMocks(); mocks.tasks = []; remaining = [...files];
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "read_account_info") return { current_account: "Default" };
    if (command === "downloaded_files") {
      if (args.request.op === "list") return { directory: "D:/下载", files: remaining, totalBytes: 2068, warnings: [], busy: false };
      if (args.request.op === "delete") { remaining = remaining.filter((f) => !args.request.files.some((s: DownloadedFile) => s.path === f.path)); return { deleted: args.request.files.map((f: DownloadedFile) => f.path), errors: [] }; }
    }
  });
});
afterEach(cleanup);
const load = () => render(<DownloadedFilesSettings active />);

it("searches legacy paths and opens registered external outputs", async () => {
  load();
  await screen.findByText("课件.pdf");
  fireEvent.change(screen.getByRole("textbox", { name: "搜索文件名或路径" }), { target: { value: "数学" } });
  expect(screen.queryByText("字幕.srt")).not.toBeInTheDocument();
  expect(screen.getByText("课件.pdf")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索文件名或路径" }), { target: { value: "字幕" } });
  fireEvent.click(screen.getByRole("button", { name: "所在目录" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("downloaded_files", { account: "Default", request: { op: "open", path: "E:/字幕.srt", folder: true } }));
});

it("deletes only the selected snapshot after confirmation and refreshes the list", async () => {
  load();
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择 课件.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "删除所选（1）" }));
  expect(mocks.invoke.mock.calls.some(([, args]) => args?.request?.op === "delete")).toBe(false);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(files[0].path)).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
  await screen.findByText("已删除 1 个文件。");
  expect(mocks.invoke).toHaveBeenCalledWith("downloaded_files", { account: "Default", request: { op: "delete", files: [files[0]] } });
  expect(screen.queryByText("课件.pdf")).not.toBeInTheDocument();
  expect(screen.getByText("字幕.srt")).toBeVisible();
});

it("blocks cleanup throughout queued and running download tasks", async () => {
  mocks.tasks = [{ id: "pending", status: "queued" }]; load();
  expect(await screen.findByRole("checkbox", { name: "选择 课件.pdf" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除所选" })).toBeDisabled();
  expect(screen.getByText(/下载或导出任务进行中/)).toBeVisible();
});

it("keeps errors visible when changed files are refused by the backend", async () => {
  load(); await screen.findByText("课件.pdf");
  fireEvent.click(within(screen.getByText("课件.pdf").closest("tr")!).getByRole("button", { name: "删除" }));
  mocks.invoke.mockImplementation(async (command, args) => { if (command === "downloaded_files" && args.request.op === "delete") throw new Error("文件已发生变化，请刷新列表后重新选择"); });
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText(/文件已发生变化/)).toBeVisible();
  expect(screen.getByText("课件.pdf")).toBeVisible();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("clears old files, search, selection and confirmation on a new account session", async () => {
  load();
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择 课件.pdf" }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索文件名或路径" }), { target: { value: "数学" } });
  fireEvent.click(screen.getByRole("button", { name: "删除所选（1）" }));
  const current = deferred<unknown>();
  mocks.invoke.mockImplementation(async (command, args) => command === "read_account_info" ? { current_account: "Next" }
    : args.request.op === "list" ? current.promise : undefined);
  act(() => invalidateSession());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("课件.pdf")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "搜索文件名或路径" })).toHaveValue("");
  await act(async () => current.resolve({ directory: "D:/Next", files: [], totalBytes: 0, warnings: [], busy: false }));
  expect(await screen.findByText("当前使用：D:/Next")).toBeVisible();
});

it("does not list files after its pending account lookup is unmounted", async () => {
  const account = deferred<{ current_account: string }>();
  mocks.invoke.mockReturnValueOnce(account.promise);
  const view = load();
  view.unmount();
  await act(async () => account.resolve({ current_account: "Default" }));
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "downloaded_files")).toHaveLength(0);
});

it.each(["resolve", "reject"])("ignores an old delete %s after leaving and reopening the panel", async (completion) => {
  const deletion = deferred<{ deleted: string[]; errors: string[] }>();
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command, args) => command === "downloaded_files" && args.request.op === "delete" ? deletion.promise : original(command, args));
  const view = load();
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择 课件.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "删除所选（1）" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(mocks.invoke.mock.calls.some(([, args]) => args?.request?.op === "delete")).toBe(true));
  view.rerender(<DownloadedFilesSettings active={false} />);
  view.rerender(<DownloadedFilesSettings active />);
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
  const calls = mocks.invoke.mock.calls.length;
  await act(async () => {
    if (completion === "resolve") deletion.resolve({ deleted: [files[0].path], errors: [] });
    else deletion.reject(new Error("old deletion failed"));
  });
  expect(mocks.invoke).toHaveBeenCalledTimes(calls);
  expect(screen.queryByText("已删除 1 个文件。")).not.toBeInTheDocument();
  expect(screen.queryByText(/old deletion failed/)).not.toBeInTheDocument();
});
