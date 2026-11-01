import { act, cleanup, render, screen } from "@testing-library/react";
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

it("uses the latest close callback when an external preview finishes opening", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  mocks.invoke.mockReturnValue(pending);
  const files = [{ id: 50, url: "https://example.test/file.pdf", display_name: "课程.pdf" } as File];
  const first = vi.fn();
  const latest = vi.fn();
  const view = render(<PreviewModal open files={files} handleCancelPreview={first} />);
  view.rerender(<PreviewModal open files={files} handleCancelPreview={latest} />);
  await act(async () => { finish(); await pending; });
  expect(mocks.invoke).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
});
