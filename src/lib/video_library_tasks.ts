import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { save } from "@tauri-apps/plugin-dialog";
import type { CanvasVideo, VideoInfo, VideoPlayInfo } from "./model";
import { enqueueTask } from "./task_runtime";
import { taskManager } from "./task_manager";
import { recordingKey, type VideoExportOptions, type VideoSession, type VideoMaterial } from "./video_library";

export function enqueueVideoTrack(video: CanvasVideo, track: VideoPlayInfo, index: number) {
  const name = `${Array.from(video.videoName, (c) => c.charCodeAt(0) < 32 ? "_" : c).join("").replace(/[<>:"/\\|?*]/g, "_")}_机位${index + 1}.mp4`;
  enqueueTask({
    id: `video:${track.id}:${name}`, name, source: "video", kind: "video",
    event: { channel: "video_download://progress", id: String(track.id) },
    locks: [`save:${name}`], stage: "正在下载",
    run: () => invoke("download_video", { video: { ...track, name, key: track.id, index }, saveName: name }),
    open: () => invoke("open_file", { name }),
  });
}

export async function saveRecordingMaterial(video: CanvasVideo, kind: "ppt" | "subtitle") {
  const extension = kind === "ppt" ? "pdf" : "srt";
  const outputPath = await save({ defaultPath: `${video.videoName}.${extension}`, filters: [{ name: kind === "ppt" ? "PDF" : "字幕", extensions: [extension] }] });
  if (!outputPath) return false;
  const name = outputPath.split(/[/\\]/).pop()!;
  enqueueTask({
    id: `${kind}:${outputPath}`, name, outputPath, kind, source: "video", locks: [`path:${outputPath.toLowerCase()}`],
    event: kind === "ppt" ? { channel: "ppt_download://progress", id: `ppt_${name}` } : undefined,
    run: async () => {
      if (kind === "subtitle") {
        const material = await invoke<VideoMaterial>("prepare_video_material", { request: recordingRequest(video) });
        if (!material.srt) throw new Error("该小节暂无可用字幕");
        await invoke("save_path_file", { path: outputPath, content: Array.from(new TextEncoder().encode(material.srt)) });
      } else {
        const candidates = [video, ...(video.alternatives ?? [])].filter((v) => v.source !== "legacy");
        if (!candidates.length) throw new Error("此来源不提供 PPT 切片");
        let lastError: unknown;
        for (const candidate of candidates) {
          try {
            const info = await invoke<VideoInfo>("get_video_play_info", { source: candidate.source, videoId: candidate.videoId });
            await invoke("download_ppt", { courseId: info.courId, savePath: outputPath });
            return;
          } catch (e) { lastError = e; }
        }
        throw lastError;
      }
    },
    open: () => open(outputPath),
  });
  return true;
}

export const recordingRequest = (video: CanvasVideo, title = video.videoName) => ({
  key: recordingKey(video), title,
  candidates: [video, ...(video.alternatives ?? [])].map(({ alternatives: _alternatives, ...candidate }) => candidate),
});

export async function resolveRecording(video: CanvasVideo): Promise<{ info: VideoInfo; source: CanvasVideo["source"] }> {
  const errors: string[] = [];
  for (const candidate of [video, ...(video.alternatives ?? [])]) {
    try {
      const info = await invoke<VideoInfo>("get_video_play_info", { source: candidate.source, videoId: candidate.videoId });
      if (info.videoPlayResponseVoList.length) return { info, source: candidate.source };
      errors.push("暂无可播放机位");
    } catch (error) { errors.push(String(error)); }
  }
  throw new Error(errors.join("；"));
}

export async function enqueueVideoExports(scopes: VideoSession[], options: VideoExportOptions, directory: string, course: string) {
  const root = await invoke<string>("create_video_export_directory", { directory, course });
  const batch = crypto.randomUUID();
  const folders = new Map<string, string>();
  for (const scope of scopes) {
    folders.set(scope.id, await invoke<string>("create_video_export_directory", { directory: root, course: scope.title }));
  }
  let count = 0;
  for (const scope of scopes) {
    const folder = folders.get(scope.id)!;
    const requests = scope.videos.map((video) => recordingRequest(video, `${video.courseBeginTime || video.videoName} ${video.videoId}`));
    const add = (kind: "video" | "ppt" | "subtitle" | "reading", items: typeof requests, name: string) => {
      const labels = { video: "视频", ppt: "PPT 切片 PDF", subtitle: "字幕 SRT", reading: "整堂课字幕文本" };
      count++;
      taskManager.enqueue({
        id: `${batch}:${scope.id}:${kind}:${count}`, name: `${name} · ${labels[kind]}`,
        source: "video", kind: kind === "video" ? "video" : kind === "ppt" ? "ppt" : "subtitle",
        context: course, outputDirectory: folder, stage: "准备资料", locks: [`video-export:${folder}:${kind}`],
        run: async ({ update, setOpen }) => {
          update({ stage: `正在导出${labels[kind]}` });
          const onProgress = new Channel<{ processed: number; total: number; stage: string }>();
          onProgress.onmessage = (progress) => update({ stage: progress.stage, progress: progress.total > 0 && progress.stage !== "正在合并 PDF" ? Math.min(100, Math.floor(progress.processed / progress.total * 100)) : undefined });
          const result = await invoke<{ paths: string[]; warnings: string[] }>("export_video_materials", {
            requests: items, kind, directory: folder, name, onProgress, allTracks: options.tracks === "all",
          });
          setOpen(() => open(result.paths.length === 1 ? result.paths[0] : folder));
          if (result.warnings.length) {
            update({ log: `已保存：\n${result.paths.join("\n")}\n未完成：\n${result.warnings.join("\n")}` });
            throw new Error(`部分资料未完成，已保存文件保留在 ${folder}。${result.warnings.join("；")}`);
          }
          update({ stage: "已完成", progress: 100, log: result.paths.join("\n") });
        },
      });
    };
    for (const request of requests) {
      if (options.video) add("video", [request], request.title);
      if (options.subtitle) add("subtitle", [request], request.title);
      if (options.ppt && !options.pptPerSession) add("ppt", [request], request.title);
    }
    if (options.ppt && options.pptPerSession) add("ppt", requests, scope.title);
    if (options.subtitle) add("reading", requests, scope.title);
  }
  return count;
}
