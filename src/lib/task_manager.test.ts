import { describe, expect, it, vi } from "vitest";
import { TaskManager, type TaskSpec } from "./task_manager";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const spec = (id: string, run: TaskSpec["run"], extra: Partial<TaskSpec> = {}): TaskSpec => ({ id, name: id, source: "files", kind: "file", run, ...extra });

describe("application task executor", () => {
  it("tracks only newly successful completions and acknowledges them without losing future completions", async () => {
    const manager = new TaskManager();
    const first = deferred();
    const second = deferred();
    manager.enqueue(spec("first", () => first.promise));
    manager.enqueue(spec("second", () => second.promise));
    manager.enqueue(spec("failure", async () => { throw new Error("offline"); }));
    await flush();
    expect(manager.getSnapshot().filter((task) => task.unreadCompletion)).toHaveLength(0);
    first.resolve();
    await flush();
    expect(manager.getSnapshot().filter((task) => task.unreadCompletion).map((task) => task.id)).toEqual(["first"]);
    manager.markCompletionsRead();
    expect(manager.getSnapshot().filter((task) => task.unreadCompletion)).toHaveLength(0);
    second.resolve();
    await flush();
    expect(manager.getSnapshot().filter((task) => task.unreadCompletion).map((task) => task.id)).toEqual(["second"]);
    manager.remove("second");
    expect(manager.getSnapshot().filter((task) => task.unreadCompletion)).toHaveLength(0);
  });

  it("keeps upload progress separate from a download of the same file", async () => {
    const manager = new TaskManager();
    const upload = deferred();
    const download = deferred();
    manager.enqueue(spec("upload", () => upload.promise, { kind: "upload-pdf", event: { channel: "file_upload://progress", id: "same" } }));
    manager.enqueue(spec("download", () => download.promise, { event: { channel: "download://progress", id: "same" } }));
    manager.progress("file_upload://progress", "same", 3, 4);
    expect(manager.getSnapshot()[0]).toMatchObject({ progress: 75, stage: "正在上传至云盘" });
    expect(manager.getSnapshot()[1].progress).toBeUndefined();
    manager.progress("file_upload://progress", "same", 4, 4);
    expect(manager.getSnapshot()[0].unreadCompletion).not.toBe(true);
    upload.resolve(); download.resolve();
    await flush();
  });

  it("continues without UI subscribers, deduplicates submissions and limits concurrency", async () => {
    const manager = new TaskManager(1);
    const first = deferred();
    const run = vi.fn(() => first.promise);
    const second = vi.fn(async () => {});
    const unsubscribe = manager.subscribe(vi.fn());
    manager.enqueue(spec("first", run));
    manager.enqueue(spec("first", run));
    manager.enqueue(spec("second", second));
    unsubscribe();
    expect(run).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    manager.remove("first");
    manager.remove("second");
    expect(manager.getSnapshot()).toHaveLength(2);
    first.resolve();
    await flush();
    expect(second).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().every((task) => task.status === "succeeded")).toBe(true);
  });

  it("serializes ambiguous event IDs while allowing unrelated tasks to run", async () => {
    const manager = new TaskManager(3);
    const first = deferred();
    const second = deferred();
    const event = { channel: "download://progress", id: "same-file" };
    manager.enqueue(spec("course-download", () => first.promise, { event }));
    manager.enqueue(spec("attachment-download", () => second.promise, { event, source: "submissions" }));
    manager.enqueue(spec("independent", async () => {}));
    manager.progress(event.channel, event.id, 5, 10);
    expect(manager.getSnapshot()[0].progress).toBe(50);
    expect(manager.getSnapshot()[1].status).toBe("queued");
    expect(manager.getSnapshot()[1].progress).toBeUndefined();
    first.resolve();
    await flush();
    expect(manager.getSnapshot()[1].status).toBe("running");
    second.resolve();
    await flush();
  });

  it("waits for command completion after 100% and ignores late terminal progress", async () => {
    const manager = new TaskManager();
    const command = deferred();
    const event = { channel: "ppt_download://progress", id: "ppt_lecture.pdf" };
    manager.enqueue(spec("ppt", () => command.promise, { event, kind: "ppt" }));
    manager.progress(event.channel, event.id, 10, 10);
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "running", stage: "正在合并 PDF", progress: undefined });
    command.reject(new Error("merge failed"));
    await flush();
    manager.progress(event.channel, event.id, 1, 10);
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "failed", error: "Error: merge failed" });
  });

  it("retries a failure exactly once using the original captured operation", async () => {
    const manager = new TaskManager();
    const run = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    manager.enqueue(spec("download", run));
    await flush();
    manager.retry("download");
    manager.retry("download");
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "succeeded", attempt: 2, error: undefined });
  });

  it("clears only terminal records, releases resources and never invokes output actions", async () => {
    const manager = new TaskManager();
    const dispose = vi.fn();
    const open = vi.fn();
    manager.enqueue(spec("merged", async () => {}, { dispose, open }));
    await flush();
    manager.remove("merged");
    expect(manager.getSnapshot()).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("handles unknown totals and clamps invalid transfer percentages", () => {
    const manager = new TaskManager();
    const event = { channel: "download://progress", id: "file" };
    manager.enqueue(spec("file", () => new Promise(() => {}), { event }));
    manager.progress(event.channel, event.id, 0, 0);
    expect(manager.getSnapshot()[0].progress).toBeUndefined();
    manager.progress(event.channel, event.id, 200, 100);
    expect(manager.getSnapshot()[0].progress).toBe(100);
  });

  it("bounds FFmpeg logs and prevents concurrent untagged log streams", async () => {
    const manager = new TaskManager();
    const command = deferred();
    manager.enqueue(spec("one", () => command.promise, { kind: "video-merge", locks: ["ffmpeg"] }));
    manager.enqueue(spec("two", async () => {}, { kind: "video-merge", locks: ["ffmpeg"] }));
    manager.appendVideoLog("x".repeat(70000));
    expect(manager.getSnapshot()[0].log).toHaveLength(64000);
    expect(manager.getSnapshot()[1].log).toBeUndefined();
    command.resolve();
    await flush();
  });

  it("reports output-action failures separately without corrupting successful tasks", async () => {
    const manager = new TaskManager();
    manager.enqueue(spec("file", async () => {}, { open: async () => { throw new Error("missing file"); } }));
    await flush();
    await manager.action("file", "open");
    expect(manager.getSnapshot()[0]).toMatchObject({ status: "succeeded", actionError: "Error: missing file" });
  });
});
