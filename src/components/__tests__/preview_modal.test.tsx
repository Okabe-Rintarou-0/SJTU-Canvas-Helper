import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PreviewModal from "../preview_modal";
import type { File } from "../../lib/model";

const mocks = vi.hoisted(() => ({ loads: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/utils", () => ({ getFileType: async (name: string) => name.toLowerCase().split(".").pop() }));
vi.mock("../renderers", () => ({ BasicRenderers: [{ fileTypes: ["pdf", "pptx"] }] }));
vi.mock("@cyntler/react-doc-viewer", async () => {
  const { useContext, useEffect } = await import("react");
  const { PreviewErrorContext } = await import("../preview_error");
  return { default: function DocumentViewer({ documents }: { documents: { uri: string }[] }) {
    const onFailure = useContext(PreviewErrorContext);
    useEffect(() => { mocks.loads(documents); }, [documents]);
    return <div data-testid="document-viewer">
      {documents.map((doc) => doc.uri).join(",")}
      <button onClick={onFailure}>模拟渲染失败</button>
    </div>;
  } };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  const files = [{ id: 50, url: "https://example.test/file.doc", display_name: "课程.doc" } as File];
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
  const files = [{ id: 51, url: "https://example.test/late.doc", display_name: "课程.doc" } as File];
  const view = render(<PreviewModal open files={files} />);
  const previewId = mocks.invoke.mock.calls[0][1].previewId;
  view.unmount();
  await act(async () => { finish(); await pending; });
  expect(mocks.invoke).toHaveBeenLastCalledWith("close_embedded_file_preview", { previewId });
});

it("opens PDFs directly and offers the original file if both preview modes fail", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("Canvas unavailable"));
  const files = [{ id: 52, url: "https://example.test/fallback.pdf", display_name: "课程.pdf" } as File];
  render(<PreviewModal open files={files} />);
  expect(await screen.findByText(files[0].url)).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "模拟渲染失败" }));
  expect(await screen.findByText("文件预览失败")).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith("open_embedded_file_preview", expect.objectContaining({ fileId: 52 }));
  expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", files[0].url);
});

it("tries local Office conversion when Canvas reports a failure", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("Canvas unavailable")).mockRejectedValueOnce(new Error("Converter unavailable"));
  const file = { id: 53, url: "https://example.test/fallback.doc", display_name: "课程.doc" } as File;
  render(<PreviewModal open files={[file]} />);
  expect(await screen.findByText("文件预览失败")).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith("convert_pptx_to_pdf", { file });
  expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", file.url);
});

it("starts PPTX in the local viewer without invoking Office conversion or Canvas", async () => {
  const file = { id: 54, url: "https://example.test/slides.pptx", display_name: "课件.pptx" } as File;
  render(<PreviewModal open files={[file]} />);
  expect(await screen.findByText(file.url)).toBeInTheDocument();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "使用 Canvas 预览" })).toBeEnabled();
});

it("starts converting legacy PPT locally before trying Canvas", async () => {
  const file = { id: 55, url: "https://example.test/slides.ppt", display_name: "课件.ppt" } as File;
  mocks.invoke.mockRejectedValueOnce(new Error("Converter unavailable")).mockRejectedValueOnce(new Error("Canvas unavailable"));
  render(<PreviewModal open files={[file]} />);
  expect(mocks.invoke).toHaveBeenNthCalledWith(1, "convert_pptx_to_pdf", { file });
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "open_embedded_file_preview", expect.objectContaining({ fileId: 55 })),
  );
});

it.each([["README.md", "md"], ["Dockerfile", "dockerfile"]])(
  "uses the Canvas download client for text previews of %s", async (name, fileType) => {
    const file = { id: 56, url: "https://example.test/files/56/download", display_name: name } as File;
    const content = new Uint8Array([97, 98, 99]).buffer;
    const createObjectURL = vi.fn(() => "blob:canvas-text");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    mocks.invoke.mockResolvedValueOnce(content);
    const view = render(<PreviewModal open files={[file]} />);
    expect(await screen.findByText("blob:canvas-text")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("read_canvas_preview_file", { fileId: 56 });
    expect(mocks.loads).toHaveBeenCalledWith([{ uri: "blob:canvas-text", fileName: name, fileType }]);
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:canvas-text");
  },
);

it.each([
  { name: ".env", type: "application/octet-stream", prefix: [78, 65, 77, 69, 61, 65], expected: "txt", sample: true },
  { name: "NOTICE", type: "application/octet-stream", prefix: [0xff, 0xfe, 65, 0], expected: "txt", sample: true },
  { name: "settings.custom", type: "text/plain; charset=utf-8", prefix: [65], expected: "txt", sample: false },
  { name: "assets.bin", type: "application/octet-stream", prefix: [65, 0, 5, 6], expected: "bin", sample: true },
])("uses MIME or the file prefix to determine whether to render $name", async ({ name, type, prefix, expected, sample }) => {
  const file = { id: 57, url: "https://example.test/files/57/download", display_name: name, "content-type": type } as File;
  const content = new Uint8Array(prefix).buffer;
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { return "blob:canvas-text"; }
    static revokeObjectURL() {}
  });
  mocks.invoke.mockResolvedValue(content);
  render(<PreviewModal open files={[file]} />);

  const uri = expected === "txt" ? "blob:canvas-text" : file.url;
  expect(await screen.findByText(uri)).toBeInTheDocument();
  expect(mocks.loads).toHaveBeenCalledWith([{ uri, fileName: name, fileType: expected }]);
  if (sample) {
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "read_canvas_preview_file", { fileId: 57, sampleOnly: true });
  }
  expect(mocks.invoke).toHaveBeenCalledTimes(Number(sample) + Number(expected === "txt"));
});
