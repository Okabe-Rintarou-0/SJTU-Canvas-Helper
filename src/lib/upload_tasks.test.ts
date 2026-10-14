import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudUploadTask } from "./upload_tasks";
import { TaskManager, taskKindLabels } from "./task_manager";
import type { File } from "./model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
const file = { uuid: "file-id", display_name: "讲义.docx", filename: "lecture.docx" } as File;

describe("cloud upload tasks", () => {
  beforeEach(() => { mocks.invoke.mockReset().mockResolvedValue(undefined); });

  it("captures the destination and exposes uploads without pretending they are local downloads", async () => {
    const manager = new TaskManager();
    const spec = createCloudUploadTask(file, "original", "课程 A/讲义", "课程 A");
    manager.enqueue(spec);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("succeeded"));
    expect(spec).toMatchObject({ source: "files", kind: "upload", event: { channel: "file_upload://progress", id: file.uuid } });
    expect(mocks.invoke).toHaveBeenCalledWith("upload_file", { file, saveDir: "课程 A/讲义" });
    expect(manager.getSnapshot()[0]).toMatchObject({ canOpen: false, unreadCompletion: true });
  });

  it("re-authenticates once then retries the same upload", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("expired login"));
    const manager = new TaskManager();
    manager.enqueue(createCloudUploadTask(file, "original", "课程 A", "课程 A"));
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("succeeded"));
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["upload_file", "login_jbox", "upload_file"]);
  });

  it("retains failed uploads for explicit retry and does not flag them as completed", async () => {
    mocks.invoke.mockRejectedValue(new Error("network unavailable"));
    const manager = new TaskManager();
    const spec = createCloudUploadTask(file, "original", "课程 A", "课程 A");
    manager.enqueue(spec);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("failed"));
    expect(manager.getSnapshot()[0].unreadCompletion).not.toBe(true);
    mocks.invoke.mockResolvedValue(undefined);
    manager.retry(spec.id);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("succeeded"));
  });

  it("uses accurate PDF action labels and does not re-login for conversion errors", async () => {
    mocks.invoke.mockRejectedValue(new Error("Document conversion failed"));
    const manager = new TaskManager();
    const spec = createCloudUploadTask(file, "pdf", "课程 A", "课程 A");
    manager.enqueue(spec);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("failed"));
    expect(spec.kind).toBe("upload-pdf");
    expect(spec.name).toBe("讲义.pdf");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("upload_file_as_pdf", { file, saveDir: "课程 A" });
    expect(taskKindLabels.conversion).toBe("转换为 PDF 并下载");
  });
});
