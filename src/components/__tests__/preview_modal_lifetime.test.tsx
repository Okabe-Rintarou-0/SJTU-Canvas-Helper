import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import PreviewModal from "../preview_modal";
import type { File } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../renderers", () => ({ BasicRenderers: [] }));
vi.mock("../../lib/utils", () => ({ getFileType: async () => "pdf" }));
vi.mock("@cyntler/react-doc-viewer", () => ({
  default: ({ documents }: { documents: { uri: string }[] }) =>
    <div data-testid="documents">{documents.map((doc) => doc.uri).join(",")}</div>,
}));

const ppt = (name = "slides") => ({ display_name: `${name}.pptx`, url: `blob:input-${name}` } as File);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  let next = 0;
  mocks.create.mockImplementation(() => `blob:converted-${++next}`);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = mocks.create;
    static revokeObjectURL = mocks.revoke;
  });
  mocks.invoke.mockResolvedValue([37, 80, 68, 70]);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("preview conversion resource lifetime", () => {
  it("deduplicates within a session, releases on Close, and converts fresh when reopened", async () => {
    const file = ppt();
    const files = [file, file];
    const view = render(<PreviewModal open files={files} />);
    await screen.findByTestId("documents");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    view.rerender(<PreviewModal open={false} files={files} />);
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:converted-1");
    view.rerender(<PreviewModal open files={files} />);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(mocks.revoke.mock.calls).toEqual([["blob:converted-1"], ["blob:converted-2"]]);
  });

  it("does not allocate a PDF URL when conversion finishes after unmount", async () => {
    const task = deferred<number[]>();
    mocks.invoke.mockReturnValue(task.promise);
    const view = render(<PreviewModal open files={[ppt()]} />);
    view.unmount();
    await act(async () => task.resolve([1, 2, 3]));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("releases a completed sibling on failure and ignores another sibling finishing late", async () => {
    const failure = deferred<number[]>();
    const late = deferred<number[]>();
    mocks.invoke.mockResolvedValueOnce([1]).mockReturnValueOnce(failure.promise).mockReturnValueOnce(late.promise);
    render(<PreviewModal open files={[ppt("good"), ppt("bad"), ppt("late")]} />);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await act(async () => failure.reject(new Error("conversion failed")));
    expect(await screen.findByRole("alert")).toHaveTextContent("conversion failed");
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:converted-1");
    await act(async () => late.resolve([2]));
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("releases the replaced document and never publishes its late result", async () => {
    const old = deferred<number[]>();
    mocks.invoke.mockReturnValueOnce(old.promise).mockResolvedValueOnce([2]);
    const view = render(<PreviewModal open files={[ppt("old")]} />);
    view.rerender(<PreviewModal open files={[ppt("new")]} />);
    expect(await screen.findByTestId("documents")).toHaveTextContent("blob:converted-1");
    await act(async () => old.resolve([1]));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    view.rerender(<PreviewModal open files={[]} />);
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:converted-1");
    expect(screen.queryByTestId("documents")).not.toBeInTheDocument();
  });

  it("does not revoke input URLs owned by the caller", async () => {
    const view = render(<PreviewModal open files={[{ display_name: "existing.pdf", url: "blob:caller-owned" } as File]} />);
    expect(await screen.findByTestId("documents")).toHaveTextContent("blob:caller-owned");
    view.unmount();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("does not restart work when only the close callback changes and calls the latest callback", async () => {
    const online = deferred<void>();
    mocks.invoke.mockReturnValue(online.promise);
    const files = [{ id: 7, display_name: "online.pdf", url: "https://offline.test/file" } as File];
    const previous = vi.fn();
    const latest = vi.fn();
    const view = render(<PreviewModal open files={files} handleCancelPreview={previous} />);
    view.rerender(<PreviewModal open files={files} handleCancelPreview={latest} />);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => online.resolve());
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("does not start fallback conversion after a dismissed online preview fails", async () => {
    const online = deferred<void>();
    mocks.invoke.mockReturnValue(online.promise);
    const files = [{ id: 7, display_name: "remote.pptx", url: "https://offline.test/file" } as File];
    const view = render(<PreviewModal open files={files} />);
    view.rerender(<PreviewModal open={false} files={files} />);
    await act(async () => online.reject(new Error("offline")));
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("releases local conversions when a sibling opens an online preview", async () => {
    const online = deferred<void>();
    mocks.invoke.mockImplementation((command: string) => command === "open_file_preview_window"
      ? online.promise : Promise.resolve([1]));
    const close = vi.fn();
    render(<PreviewModal open files={[ppt(), {
      id: 9, display_name: "online.pdf", url: "https://offline.test/online",
    } as File]} handleCancelPreview={close} />);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await act(async () => online.resolve());
    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:converted-1");
  });

  it("does not invalidate another modal's conversion when one modal unmounts", async () => {
    const files = [ppt()];
    const first = render(<PreviewModal open files={files} />);
    const second = render(<PreviewModal open files={files} />);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    first.unmount();
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:converted-1");
    expect(screen.getByTestId("documents")).toHaveTextContent("blob:converted-2");
    second.unmount();
    expect(mocks.revoke.mock.calls).toEqual([["blob:converted-1"], ["blob:converted-2"]]);
  });

  it("releases conversion resources through StrictMode effect replay", async () => {
    const view = render(<StrictMode><PreviewModal open files={[ppt()]} /></StrictMode>);
    await screen.findByTestId("documents");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("blob:converted-1");
  });
});
