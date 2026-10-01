import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueVideoExports, resolveRecording, saveRecordingMaterial } from "./video_library_tasks";
import { taskManager } from "./task_manager";
import type { CanvasVideo } from "./model";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class { onmessage = () => {}; } }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen: vi.fn(async () => () => {}) }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
afterEach(() => { taskManager.getSnapshot().forEach((task) => taskManager.remove(task.id)); vi.clearAllMocks(); });
const video = { source: "canvas", videoId: "a", videoName: "第一小节", courseBeginTime: "2026-09-28 08:00" } as CanvasVideo;
describe("batch video tasks", () => {
  it("opens exported files through the local path command", async () => {
    mocks.invoke.mockImplementation(async (command: string) => command === "create_video_export_directory" ? "D:/课程/课堂" : { paths: ["D:/课程/课堂/ppt.pdf"], warnings: [] });
    await enqueueVideoExports([{ id: "session", title: "课堂", videos: [video] }], { video: false, ppt: true, subtitle: false, pptPerSession: true, tracks: "all" }, "D:/课程", "课程");
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    await taskManager.action(taskManager.getSnapshot()[0].id, "open");
    expect(mocks.invoke).toHaveBeenCalledWith("open_local_path", { path: "D:/课程/课堂/ppt.pdf" });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("saves individual subtitles using BeforeAssembly", async () => {
    mocks.save.mockResolvedValue("D:/课程/subtitle.srt");
    mocks.invoke.mockResolvedValue({ srt: "字幕内容" });
    expect(await saveRecordingMaterial(video, "subtitle")).toBe(true);
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    expect(mocks.invoke).toHaveBeenCalledWith("prepare_video_material", { request: expect.objectContaining({ key: "canvas:a" }), preferBefore: true });
    expect(mocks.invoke).toHaveBeenCalledWith("save_path_file", { path: "D:/课程/subtitle.srt", content: Array.from(new TextEncoder().encode("字幕内容")) });
    await taskManager.action(taskManager.getSnapshot()[0].id, "open");
    expect(mocks.invoke).toHaveBeenCalledWith("open_local_path", { path: "D:/课程/subtitle.srt" });
  });
  it("exports only selected recordings and retains partial failures while other tasks finish", async () => {
    mocks.invoke.mockImplementation(async (command: string, args: { kind?: string }) => {
      if (command === "create_video_export_directory") return "D:/课程/课堂";
      return { paths: ["D:/课程/课堂/result"], warnings: args.kind === "ppt" ? ["第二小节缺少 PPT"] : [] };
    });
    const scope = { id: "session", title: "课堂（部分小节）", videos: [video] };
    expect(await enqueueVideoExports([scope], { video: true, ppt: true, subtitle: true, pptPerSession: true, tracks: "all" }, "D:/课程", "测试课程")).toBe(4);
    await vi.waitFor(() => expect(taskManager.getSnapshot().every((task) => !["running", "queued"].includes(task.status))).toBe(true));
    const calls = mocks.invoke.mock.calls.filter(([command]) => command === "export_video_materials");
    expect(calls).toHaveLength(4);
    expect(calls.every(([, args]) => args.requests.length === 1 && args.requests[0].key === "canvas:a")).toBe(true);
    expect(taskManager.getSnapshot().filter((task) => task.status === "succeeded")).toHaveLength(3);
    expect(taskManager.getSnapshot().find((task) => task.kind === "ppt")).toMatchObject({ status: "failed", log: expect.stringContaining("已保存") });
  });
  it("reports transfer progress and retains the chosen output directory", async () => {
    let reported = false;
    mocks.invoke.mockImplementation(async (command: string, args: { onProgress: { onmessage: (p: unknown) => void } }) => {
      if (command === "create_video_export_directory") return "D:/课程/课堂";
      args.onProgress.onmessage({ processed: 50, total: 100, stage: "正在下载机位 1/2" });
      expect(taskManager.getSnapshot()[0]).toMatchObject({ progress: 50, stage: "正在下载机位 1/2", outputDirectory: "D:/课程/课堂" });
      reported = true;
      return { paths: ["D:/课程/课堂/video.mp4"], warnings: [] };
    });
    await enqueueVideoExports([{ id: "session", title: "课堂", videos: [video] }], { video: true, ppt: false, subtitle: false, pptPerSession: true, tracks: "all" }, "D:/课程", "课程");
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    expect(reported).toBe(true);
  });
  it("queues nothing when directory preparation fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("无权访问目录"));
    await expect(enqueueVideoExports([{ id: "a", title: "课堂", videos: [video] }], { video: true, ppt: false, subtitle: false, pptPerSession: true, tracks: "all" }, "D:/课程", "课程")).rejects.toThrow("无权访问");
    expect(taskManager.getSnapshot()).toHaveLength(0);
  });
  it("falls back to another source when the primary source has no tracks", async () => {
    mocks.invoke.mockImplementation(async (_command: string, args: { source: string }) => ({ videoPlayResponseVoList: args.source === "legacy" ? [{ id: 42 }] : [] }));
    const result = await resolveRecording({ ...video, alternatives: [{ ...video, source: "legacy", videoId: "b" }] });
    expect(result.source).toBe("legacy");
    expect(result.info.videoPlayResponseVoList).toEqual([{ id: 42 }]);
  });
});
