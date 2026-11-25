import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PreviewModal from "../preview_modal";
import type { File } from "../../lib/model";

const mocks = vi.hoisted(() => ({ loads: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/utils", () => ({ getFileType: async () => "pdf" }));
vi.mock("../renderers", () => ({ BasicRenderers: [] }));
vi.mock("@cyntler/react-doc-viewer", async () => {
  const { useEffect } = await import("react");
  return { default: function DocumentViewer({ documents }: { documents: { uri: string }[] }) {
    useEffect(() => { mocks.loads(documents); }, [documents]);
    return <div data-testid="document-viewer">{documents.map((doc) => doc.uri).join(",")}</div>;
  } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("keeps a document loaded when a parent supplies a fresh close callback", async () => {
  const files = [{ url: "blob:stable-preview", display_name: "合并结果.pdf" } as File];
  const view = render(<PreviewModal open files={files} handleCancelPreview={() => {}} />);
  await screen.findByText("blob:stable-preview");
  const viewer = screen.getByTestId("document-viewer");
  mocks.loads.mockClear();
  for (let update = 0; update < 3; update++) {
    await act(async () => view.rerender(<PreviewModal open files={files} handleCancelPreview={() => {}} />));
    expect(screen.getByTestId("document-viewer")).toBe(viewer);
    expect(mocks.loads).not.toHaveBeenCalled();
  }
});

it("keeps a Canvas preview in the dialog and closes its child webview on unmount", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  mocks.invoke.mockImplementation((command) => command === "open_embedded_file_preview" ? pending : Promise.resolve());
  const files = [{ id: 50, url: "https://example.test/file.pdf", display_name: "课程.pdf" } as File];
  const close = vi.fn();
  const view = render(<PreviewModal open files={files} handleCancelPreview={close} />);
  await act(async () => { finish(); await pending; });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith("open_embedded_file_preview", expect.objectContaining({ fileId: 50 }));
  const previewId = mocks.invoke.mock.calls[0][1].previewId;
  view.unmount();
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("close_embedded_file_preview", { previewId }));
});

it("cleans up a Canvas preview when its webview opens after the dialog unmounts", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  mocks.invoke.mockImplementation((command) => command === "open_embedded_file_preview" ? pending : Promise.resolve());
  const files = [{ id: 51, url: "https://example.test/late.pdf", display_name: "课程.pdf" } as File];
  const view = render(<PreviewModal open files={files} />);
  const previewId = mocks.invoke.mock.calls[0][1].previewId;
  view.unmount();
  await act(async () => { finish(); await pending; });
  expect(mocks.invoke).toHaveBeenLastCalledWith("close_embedded_file_preview", { previewId });
});

it("falls back to the local PDF viewer when Canvas preview fails", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("Canvas unavailable"));
  const files = [{ id: 52, url: "https://example.test/fallback.pdf", display_name: "课程.pdf" } as File];
  render(<PreviewModal open files={files} />);
  expect(await screen.findByText(files[0].url)).toBeInTheDocument();
});
