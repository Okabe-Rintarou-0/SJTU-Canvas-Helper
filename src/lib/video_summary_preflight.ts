import { invoke } from "@tauri-apps/api/core";
import { recordingRequest } from "./video_library_tasks";
import type { CanvasVideo } from "./model";
import type { VideoRecordingStatus, VideoSession } from "./video_library";

export interface SummaryPreflight {
  missing: number;
  needsTranscription: number;
  savedTranscripts: number;
  unknown: number;
}
export async function inspectSummaryScope(scopes: VideoSession[]): Promise<SummaryPreflight> {
  const videos = scopes.flatMap((scope) => scope.videos);
  const result: SummaryPreflight = { missing: 0, needsTranscription: 0, savedTranscripts: 0, unknown: 0 };
  let cursor = 0;
  const inspect = async (video: CanvasVideo) => {
    const candidates = [video, ...(video.alternatives ?? [])];
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const status = await Promise.race([
        invoke<VideoRecordingStatus>("inspect_video_recording", { request: recordingRequest(video) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("字幕检查超时")), 30_000); }),
      ]).finally(() => clearTimeout(timer));
      if (!status.subtitleAvailable) {
        result.missing++;
        if (status.transcriptAvailable) result.savedTranscripts++;
        else if (candidates.some((item) => item.playable)) result.needsTranscription++;
      }
    } catch { result.unknown++; }
  };
  await Promise.all(Array.from({ length: Math.min(3, videos.length) }, async () => {
    while (cursor < videos.length) await inspect(videos[cursor++]);
  }));
  return result;
}
