import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IMainState } from "@cyntler/react-doc-viewer/dist/cjs/store/mainStateReducer";
import ArchiveRenderer from "../archive_renderer";

const mocks = vi.hoisted(() => ({ loads: vi.fn(), message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.message, null] }));
vi.mock("../../lib/utils", () => ({ consoleLog: vi.fn(), dataURLtoFile: vi.fn(), formatSize: () => "5 B", getFileType: async () => "txt" }));
vi.mock("../renderers", () => ({ ArchiveSupportedRenderers: [] }));
vi.mock("libarchive.js", () => ({ Archive: { init: vi.fn(), open: async () => ({ getFilesObject: async () => ({
  "课件.txt": { name: "课件.txt", size: 5, extract: async () => new File(["notes"], "课件.txt") },
  "其他资料": {},
}) }) } }));
vi.mock("@cyntler/react-doc-viewer", async () => {
  const { useEffect } = await import("react");
  return { default: function DocumentViewer({ documents, config }: { documents: unknown[]; config: unknown }) {
    useEffect(() => { mocks.loads(documents, config); }, [documents, config]);
    return <div data-testid="archive-document" />;
  } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("does not reload the selected document when expanding another archive folder", async () => {
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { return "blob:archive-child"; }
    static revokeObjectURL() {}
  });
  const mainState: IMainState = { currentFileNo: 0, documents: [], language: "en",
    currentDocument: { uri: "blob:archive", fileName: "materials.zip", fileData: "encoded" } };
  render(<ArchiveRenderer mainState={mainState} />);
  fireEvent.click(await screen.findByRole("button", { name: /课件.txt/ }));
  const viewer = await screen.findByTestId("archive-document");
  mocks.loads.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /其他资料/ }));
  expect(screen.getByTestId("archive-document")).toBe(viewer);
  expect(mocks.loads).not.toHaveBeenCalled();
});
