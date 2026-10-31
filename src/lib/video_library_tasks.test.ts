import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueVideoExports, enqueueVideoTrack, resolveRecording, saveRecordingMaterial } from "./video_library_tasks";
import { taskManager } from "./task_manager";
import type { CanvasVideo, VideoPlayInfo } from "./model";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class { onmessage = () => {}; } }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen: vi.fn(async () => () => {}) }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
afterEach(() => { taskManager.getSnapshot().forEach((task) => taskManager.remove(task.id)); vi.clearAllMocks(); });
const video = { source: "canvas", videoId: "a", videoName: "第一小节", courseBeginTime: "2026-09-28 08:00" } as CanvasVideo;
const course = { id: "10", name: "课程", term: "2026-2027 秋" };
describe("batch video tasks", () => {
  it("retains the course when downloading and reopening a single track", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const track = { id: 42 } as VideoPlayInfo;
    enqueueVideoTrack(video, track, 0, course);
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    expect(mocks.invoke).toHaveBeenCalledWith("download_video", expect.objectContaining({ course, saveName: "第一小节_机位1.mp4" }));
    await taskManager.action(taskManager.getSnapshot()[0].id, "open");
    expect(mocks.invoke).toHaveBeenCalledWith("open_file", { name: "第一小节_机位1.mp4", kind: "video", course });
  });
  it("logs intentional PPT exclusions without treating them as failed exports", async () => {
    mocks.invoke.mockImplementation(async (command: string) => ["download_directory", "create_video_export_directory"].includes(command) ? "D:/课程/课堂" : { paths: ["D:/课程/课堂/ppt.pdf"], warnings: [], notes: ["实验性过滤：第 2 张切片识别为签到页面，未导出"] });
    await enqueueVideoExports([{ id: "session", title: "课堂", videos: [video] }], { video: false, ppt: true, subtitle: false, pptPerSession: true, tracks: "all" }, "D:/课程", course);
    expect(mocks.invoke).toHaveBeenCalledWith("download_directory", { kind: "ppt", course, root: "D:/课程" });
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    expect(taskManager.getSnapshot()[0].log).toContain("签到页面");
    await taskManager.action(taskManager.getSnapshot()[0].id, "open");
    expect(mocks.invoke).toHaveBeenCalledWith("open_local_path", { path: "D:/课程/课堂/ppt.pdf" });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("retains filtering notes for single PPT save-as", async () => {
    mocks.save.mockResolvedValue("D:/课程/ppt.pdf");
    mocks.invoke.mockImplementation(async (command: string) => command === "download_directory" ? "D:/下载/2026-2027 秋/课程 [10]/课件" : command === "get_video_play_info" ? { courId: 42 } : ["实验性过滤：Windows 桌面"]);
    await saveRecordingMaterial(video, "ppt", course);
    expect(mocks.invoke).toHaveBeenCalledWith("download_directory", { kind: "ppt", course });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "D:/下载/2026-2027 秋/课程 [10]/课件/第一小节.pdf" }));
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    expect(taskManager.getSnapshot()[0].log).toContain("Windows 桌面");
  });
  it("saves individual subtitles using BeforeAssembly", async () => {
    mocks.save.mockResolvedValue("D:/课程/subtitle.srt");
    mocks.invoke.mockImplementation(async (command: string) => command === "download_directory" ? "D:/下载/2026-2027 秋/课程 [10]/字幕" : { srt: "字幕内容" });
    expect(await saveRecordingMaterial(video, "subtitle", course)).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("download_directory", { kind: "subtitle", course });
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    expect(mocks.invoke).toHaveBeenCalledWith("prepare_video_material", { request: expect.objectContaining({ key: "canvas:a" }), preferBefore: true, includeOcr: false });
    expect(mocks.invoke).toHaveBeenCalledWith("save_path_file", { path: "D:/课程/subtitle.srt", content: Array.from(new TextEncoder().encode("字幕内容")) });
    await taskManager.action(taskManager.getSnapshot()[0].id, "open");
    expect(mocks.invoke).toHaveBeenCalledWith("open_local_path", { path: "D:/课程/subtitle.srt" });
  });
  it("exports only selected recordings and retains partial failures while other tasks finish", async () => {
    const warning = "隐私课堂标题：第二小节缺少 PPT";
    const note = "实验性过滤：第 2 张切片未导出";
    mocks.invoke.mockImplementation(async (command: string, args: { kind?: string; directory?: string }) => {
      if (command === "download_directory") return `D:/课程/${args.kind}`;
      if (command === "create_video_export_directory") return `${args.directory}/课堂`;
      return { paths: ["D:/课程/课堂/result"], warnings: args.kind === "ppt" ? [warning] : [], notes: [note] };
    });
    const scope = { id: "session", title: "课堂（部分小节）", videos: [video] };
    expect(await enqueueVideoExports([scope], { video: true, ppt: true, subtitle: true, pptPerSession: true, tracks: "all" }, "D:/课程", course)).toBe(4);
    for (const kind of ["video", "ppt", "subtitle"]) expect(mocks.invoke).toHaveBeenCalledWith("download_directory", { kind, course, root: "D:/课程" });
    await vi.waitFor(() => expect(taskManager.getSnapshot().every((task) => !["running", "queued"].includes(task.status))).toBe(true));
    const calls = mocks.invoke.mock.calls.filter(([command]) => command === "export_video_materials");
    expect(calls).toHaveLength(4);
    for (const [, args] of calls) expect(args.directory).toBe(`D:/课程/${args.kind === "reading" ? "subtitle" : args.kind}/课堂`);
    expect(calls.every(([, args]) => args.requests.length === 1 && args.requests[0].key === "canvas:a")).toBe(true);
    expect(taskManager.getSnapshot().filter((task) => task.status === "succeeded")).toHaveLength(3);
    const failed = taskManager.getSnapshot().find((task) => task.kind === "ppt");
    expect(failed).toMatchObject({
      status: "failed",
      error: "Error: 部分资料未完成：已保存 1 个文件，1 项失败。请查看任务详情。",
      log: `已保存：\nD:/课程/课堂/result\n${note}\n未完成：\n${warning}`,
    });
    expect(failed?.error).not.toContain("隐私课堂标题");
    expect(failed?.error).not.toContain("D:/课程/课堂");
  });
  it("reports transfer progress and retains the chosen output directory", async () => {
    let reported = false;
    mocks.invoke.mockImplementation(async (command: string, args: { onProgress: { onmessage: (p: unknown) => void } }) => {
      if (["download_directory", "create_video_export_directory"].includes(command)) return "D:/课程/课堂";
      args.onProgress.onmessage({ processed: 50, total: 100, stage: "正在下载机位 1/2" });
      expect(taskManager.getSnapshot()[0]).toMatchObject({ progress: 50, stage: "正在下载机位 1/2", outputDirectory: "D:/课程/课堂" });
      reported = true;
      return { paths: ["D:/课程/课堂/video.mp4"], warnings: [] };
    });
    await enqueueVideoExports([{ id: "session", title: "课堂", videos: [video] }], { video: true, ppt: false, subtitle: false, pptPerSession: true, tracks: "all" }, "D:/课程", course);
    await vi.waitFor(() => expect(taskManager.getSnapshot()[0].status).toBe("succeeded"));
    expect(reported).toBe(true);
  });
  it("queues nothing when directory preparation fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("无权访问目录"));
    await expect(enqueueVideoExports([{ id: "a", title: "课堂", videos: [video] }], { video: true, ppt: false, subtitle: false, pptPerSession: true, tracks: "all" }, "D:/课程", course)).rejects.toThrow("无权访问");
    expect(taskManager.getSnapshot()).toHaveLength(0);
  });
  it("falls back to another source when the primary source has no tracks", async () => {
    mocks.invoke.mockImplementation(async (_command: string, args: { source: string }) => ({ videoPlayResponseVoList: args.source === "legacy" ? [{ id: 42 }] : [] }));
    const result = await resolveRecording({ ...video, alternatives: [{ ...video, source: "legacy", videoId: "b" }] });
    expect(result.source).toBe("legacy");
    expect(result.info.videoPlayResponseVoList).toEqual([{ id: 42 }]);
  });
});
