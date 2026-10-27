import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { File } from "./model";
import { taskManager } from "./task_manager";
import { enqueuePDFMerge } from "./pdf_tasks";

const mocks = vi.hoisted(() => ({ add: vi.fn(), saveAsBlob: vi.fn(), invoke: vi.fn(), save: vi.fn(), open: vi.fn() }));
vi.mock("pdf-merger-js/browser", () => ({ default: class { add = mocks.add; saveAsBlob = mocks.saveAsBlob; } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));

describe("PDF merge jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.add.mockResolvedValue(undefined);
    mocks.invoke.mockResolvedValue([1, 2]);
    mocks.save.mockResolvedValue("C:/output/merged.pdf");
    mocks.saveAsBlob.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([10, 20]).buffer });
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:merged"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => {
    taskManager.getSnapshot().forEach((task) => taskManager.remove(task.id));
    vi.unstubAllGlobals();
  });
  const files = [{ display_name: "slides.pptx", url: "https://example.test/slides" }, { display_name: "notes.pdf", url: "https://example.test/notes" }] as File[];

  it("retains merge output and saves it as a separate overwrite-safe job", async () => {
    const id = enqueuePDFMerge(files, "merged.pdf");
    await vi.waitFor(() => expect(taskManager.getSnapshot().find((task) => task.id === id)?.status).toBe("succeeded"));
    expect(mocks.invoke).toHaveBeenCalledWith("convert_pptx_to_pdf", { file: files[0] });
    expect(taskManager.getSnapshot().find((task) => task.id === id)?.result?.url).toBe("blob:merged");
    await taskManager.action(id, "save");
    await vi.waitFor(() => expect(taskManager.getSnapshot().find((task) => task.kind === "pdf-save")?.status).toBe("succeeded"));
    expect(mocks.invoke).toHaveBeenCalledWith("save_path_file", { path: "C:/output/merged.pdf", content: [10, 20] });
    expect(mocks.invoke).not.toHaveBeenCalledWith("save_file_content", expect.anything());
    taskManager.remove(id);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:merged");
  });

  it("captures final PDF generation failures and can retry with fresh merger state", async () => {
    mocks.saveAsBlob.mockRejectedValueOnce(new Error("invalid PDF"));
    const id = enqueuePDFMerge(files, "merged.pdf");
    await vi.waitFor(() => expect(taskManager.getSnapshot().find((task) => task.id === id)?.status).toBe("failed"));
    taskManager.retry(id);
    await vi.waitFor(() => expect(taskManager.getSnapshot().find((task) => task.id === id)?.status).toBe("succeeded"));
    expect(mocks.add).toHaveBeenCalledTimes(4);
  });
});
