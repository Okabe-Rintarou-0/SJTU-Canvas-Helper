import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IMainState } from "@cyntler/react-doc-viewer/dist/cjs/store/mainStateReducer";
import type { IDocument } from "@cyntler/react-doc-viewer";
import ArchiveRenderer from "../archive_renderer";
import { currentSession, invalidateSession } from "../../lib/session";

import { PreviewSessionContext } from "../../lib/preview_session";

const mocks = vi.hoisted(() => ({
  captureConfig: vi.fn(), open: vi.fn(), invoke: vi.fn(), fileType: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn(),
  message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../lib/config", () => ({ captureOperationConfig: mocks.captureConfig }));
vi.mock("../../lib/archive_open", () => ({ openArchive: mocks.open }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.message, null] }));
vi.mock("../../lib/utils", () => ({ consoleLog: vi.fn(), dataURLtoFile: () => new File([], "archive.zip"),
  formatSize: () => "5 B", getFileType: mocks.fileType }));
vi.mock("../renderers", () => ({ ArchiveSupportedRenderers: [] }));
vi.mock("@cyntler/react-doc-viewer", () => ({ default: ({ documents }: { documents: IDocument[] }) => (
  <div data-testid="archive-preview">{documents[0].fileName}</div>
) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = (name: string) => new File(["notes"], name);
const entry = (name: string) => ({ name, size: 5, extract: vi.fn().mockResolvedValue(file(name)) });
const document = (name = "a.zip"): IMainState => ({ currentFileNo: 0, documents: [], language: "en",
  currentDocument: { uri: `blob:${name}`, fileName: name, fileData: "encoded" } });
function archive(files = { "a.txt": entry("a.txt"), "b.txt": entry("b.txt") }) {
  return { files, close: vi.fn(), getFilesObject: vi.fn().mockResolvedValue(files) };
}
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

beforeEach(() => {
  mocks.captureConfig.mockReturnValue({ __config_owner: "archive-owner" });
  mocks.fileType.mockResolvedValue("txt");
  mocks.createUrl.mockImplementation((value: File) => `blob:${value.name}`);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = mocks.createUrl;
    static revokeObjectURL = mocks.revokeUrl;
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("aborts an unfinished open on unmount and closes a late reader", async () => {
  const opening = deferred<ReturnType<typeof archive>>();
  mocks.open.mockReturnValueOnce(opening.promise);
  const view = render(<ArchiveRenderer mainState={document()} />);
  const signal = mocks.open.mock.calls[0][1] as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  const late = archive();
  await act(async () => opening.resolve(late));
  expect(late.close).toHaveBeenCalledOnce();
  expect(late.getFilesObject).not.toHaveBeenCalled();
});

it("closes the old reader and ignores a stale listing when the document changes", async () => {
  const first = archive(); const second = archive();
  const listing = deferred<object>();
  first.getFilesObject.mockReturnValueOnce(listing.promise);
  mocks.open.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const view = render(<ArchiveRenderer mainState={document()} />);
  await flush();
  view.rerender(<ArchiveRenderer mainState={document("b.zip")} />);
  await screen.findByRole("button", { name: /a.txt/ });
  expect(first.close).toHaveBeenCalledOnce();
  await act(async () => listing.resolve({ "stale.txt": entry("stale.txt") }));
  expect(screen.queryByRole("button", { name: /stale.txt/ })).not.toBeInTheDocument();
});

it("closes a reader whose listing fails and shows the failure", async () => {
  const value = archive(); value.getFilesObject.mockRejectedValueOnce(new Error("Unsafe archive path"));
  mocks.open.mockResolvedValueOnce(value);
  render(<ArchiveRenderer mainState={document()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unsafe archive path");
  expect(value.close).toHaveBeenCalledOnce();
  expect((mocks.open.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
});

it("releases the preview and worker immediately when the mounted session expires", async () => {
  const value = archive(); mocks.open.mockResolvedValueOnce(value);
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await screen.findByTestId("archive-preview");
  act(() => invalidateSession());
  expect(value.close).toHaveBeenCalledOnce();
  expect(mocks.revokeUrl).toHaveBeenCalledWith("blob:a.txt");
  expect(screen.queryByTestId("archive-preview")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("账号会话已变更");
  expect(mocks.open).toHaveBeenCalledOnce();
});

it("drops extraction that completes after unmount without creating a URL", async () => {
  const value = archive(); const extracting = deferred<File>();
  value.files["a.txt"].extract.mockReturnValueOnce(extracting.promise);
  mocks.open.mockResolvedValueOnce(value);
  const view = render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  view.unmount();
  await act(async () => extracting.resolve(file("a.txt")));
  expect(mocks.createUrl).not.toHaveBeenCalled();
  expect(mocks.message.error).not.toHaveBeenCalled();
});

it("drops a stale file-type result without leaking a URL", async () => {
  const value = archive(); const detecting = deferred<string>();
  mocks.open.mockResolvedValueOnce(value); mocks.fileType.mockReturnValueOnce(detecting.promise);
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await waitFor(() => expect(mocks.fileType).toHaveBeenCalled());
  act(() => invalidateSession());
  await act(async () => detecting.resolve("txt"));
  expect(mocks.createUrl).not.toHaveBeenCalled();
});

it("keeps the newer selection when an older extraction resolves late", async () => {
  const value = archive(); const extracting = deferred<File>();
  value.files["a.txt"].extract.mockReturnValueOnce(extracting.promise);
  mocks.open.mockResolvedValueOnce(value);
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  fireEvent.click(screen.getByRole("button", { name: /b.txt/ }));
  expect(await screen.findByTestId("archive-preview")).toHaveTextContent("b.txt");
  await act(async () => extracting.resolve(file("a.txt")));
  expect(screen.getByTestId("archive-preview")).toHaveTextContent("b.txt");
  expect(mocks.createUrl).toHaveBeenCalledTimes(1);
});

it("revokes each selected URL once on replacement and unmount", async () => {
  const value = archive(); mocks.open.mockResolvedValueOnce(value);
  const view = render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await screen.findByTestId("archive-preview");
  fireEvent.click(screen.getByRole("button", { name: /b.txt/ }));
  await waitFor(() => expect(screen.getByTestId("archive-preview")).toHaveTextContent("b.txt"));
  view.unmount();
  expect(mocks.revokeUrl.mock.calls).toEqual([["blob:a.txt"], ["blob:b.txt"]]);
});

it("passes the owner captured before download extraction to native save", async () => {
  const value = archive(); mocks.open.mockResolvedValueOnce(value);
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await screen.findByTestId("archive-preview");
  const extracting = deferred<File>();
  value.files["a.txt"].extract.mockReturnValueOnce(extracting.promise);
  fireEvent.click(screen.getByRole("button", { name: "下载" }));
  expect(mocks.captureConfig).toHaveBeenCalledOnce();
  mocks.captureConfig.mockReturnValue({ __config_owner: "later-owner" });
  const downloaded = file("a.txt");
  Object.defineProperty(downloaded, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
  await act(async () => extracting.resolve(downloaded));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("save_file_content", {
    content: [1, 2, 3], fileName: "a.txt", expectedOwner: "archive-owner",
  }));
  expect(mocks.captureConfig).toHaveBeenCalledOnce();
});

it("does not extract or save a download without a current configuration owner", async () => {
  const value = archive(); mocks.open.mockResolvedValueOnce(value);
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await screen.findByTestId("archive-preview");
  mocks.captureConfig.mockImplementationOnce(() => { throw new Error("Configuration unavailable"); });
  fireEvent.click(screen.getByRole("button", { name: "下载" }));
  await flush();
  expect(value.files["a.txt"].extract).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.message.error).toHaveBeenCalledWith(expect.stringContaining("Configuration unavailable"));
});

it("does not invoke native save if download extraction completes after session expiry", async () => {
  const value = archive(); mocks.open.mockResolvedValueOnce(value);
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await screen.findByTestId("archive-preview");
  const extracting = deferred<File>();
  value.files["a.txt"].extract.mockReturnValueOnce(extracting.promise);
  fireEvent.click(screen.getByRole("button", { name: "下载" }));
  act(() => invalidateSession());
  await act(async () => extracting.resolve(file("a.txt")));
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("aborts the active FileReader and cancels its timeout on unmount", async () => {
  const abort = vi.fn(); const reading = vi.fn();
  vi.stubGlobal("FileReader", class {
    static LOADING = 1; readyState = 1; result = null; error = null;
    onload = null; onerror = null; onabort = null;
    readAsDataURL = reading; abort = abort;
  });
  const value = archive(); mocks.open.mockResolvedValueOnce(value);
  const view = render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await waitFor(() => expect(reading).toHaveBeenCalledOnce());
  view.unmount();
  await flush();
  expect(abort).toHaveBeenCalledOnce();
  expect(mocks.createUrl).not.toHaveBeenCalled();
  expect(mocks.message.error).not.toHaveBeenCalled();
});

it("aborts a timed-out FileReader instead of only abandoning its promise", async () => {
  const abort = vi.fn(); const reading = vi.fn();
  vi.stubGlobal("FileReader", class {
    static LOADING = 1; readyState = 1; result = null; error = null;
    onload = null; onerror = null; onabort = null;
    readAsDataURL = reading; abort = abort;
  });
  mocks.open.mockResolvedValueOnce(archive());
  render(<ArchiveRenderer mainState={document()} />);
  const button = await screen.findByRole("button", { name: /a.txt/ });
  vi.useFakeTimers();
  fireEvent.click(button);
  await flush();
  expect(reading).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(abort).toHaveBeenCalledOnce();
  expect(mocks.message.error).toHaveBeenCalledWith(expect.stringContaining("读取压缩包子文件超时"));
  expect(mocks.createUrl).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not invoke native save if buffer reading completes after session expiry", async () => {
  const value = archive(); mocks.open.mockResolvedValueOnce(value);
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: /a.txt/ }));
  await screen.findByTestId("archive-preview");
  const buffer = deferred<ArrayBuffer>();
  const downloaded = file("a.txt");
  const read = vi.fn().mockReturnValue(buffer.promise);
  Object.defineProperty(downloaded, "arrayBuffer", { value: read });
  value.files["a.txt"].extract.mockResolvedValueOnce(downloaded);
  fireEvent.click(screen.getByRole("button", { name: "下载" }));
  await flush();
  expect(read).toHaveBeenCalledOnce();
  act(() => invalidateSession());
  await act(async () => buffer.resolve(new ArrayBuffer(0)));
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("recognizes directories containing a file named name", async () => {
  mocks.open.mockResolvedValueOnce({ close: vi.fn(), getFilesObject: async () => ({
    folder: { name: entry("name") },
  }) });
  render(<ArchiveRenderer mainState={document()} />);
  fireEvent.click(await screen.findByRole("button", { name: "folder" }));
  fireEvent.click(screen.getByRole("button", { name: /name/ }));
  expect(await screen.findByTestId("archive-preview")).toHaveTextContent("name");
});

it("rejects an inherited stale owner before first mount and after a renderer remount", () => {
  const owner = currentSession(); invalidateSession();
  const element = <PreviewSessionContext.Provider value={owner}><ArchiveRenderer mainState={document()} /></PreviewSessionContext.Provider>;
  const view = render(element);
  expect(mocks.open).not.toHaveBeenCalled();
  view.unmount();
  render(element);
  expect(mocks.open).not.toHaveBeenCalled();
});
it("does not recapture the current session when old document identity changes", async () => {
  mocks.open.mockResolvedValueOnce(archive());
  const view = render(<ArchiveRenderer mainState={document()} />);
  await flush();
  act(() => invalidateSession());
  view.rerender(<ArchiveRenderer mainState={document()} />);
  await flush();
  expect(mocks.open).toHaveBeenCalledOnce();
});
