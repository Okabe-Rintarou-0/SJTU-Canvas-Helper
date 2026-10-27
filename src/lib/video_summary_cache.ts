import type { FileAIChatMessage } from "../components/file_ai_chat_modal";
import type { CanvasVideo } from "./model";
import { recordingKey, type VideoSession } from "./video_library";
import { videoSummaryOptions, videoSummaryOptionsError, type VideoSummaryOptions } from "./video_summary_config";

export interface VideoPreparedContext { sourceHash: string; text: string }
export interface VideoChatResponse { content: string; preparedContext?: VideoPreparedContext | null }

export interface VideoSummaryCache {
  key: string;
  namespace: string;
  title: string;
  scopes: VideoSession[];
  organization: string;
  messages: FileAIChatMessage[];
  text: string;
  coverage: string;
  savedAt: string;
  summaryOptions?: VideoSummaryOptions;
  preparedContext?: VideoPreparedContext;
}
// Rebuild contexts with concise chronological OCR evidence, without processing metadata.
const STORAGE_KEY = "video-material-summaries-v7";
export const PPT_CLEANUP_POLICY = "ppt-cleanup-v9";
const MAX_BYTES = 3_000_000;

function isRecording(value: unknown, depth = 0): value is CanvasVideo {
  if (!value || typeof value !== "object") return false;
  const v = value as CanvasVideo;
  return ["canvas", "videoSpace", "legacy"].includes(v.source) && typeof v.videoId === "string"
    && [v.videoName, v.courseBeginTime, v.courseEndTime].every((field) => typeof field === "string") && typeof v.playable === "boolean"
    && (v.alternatives === undefined || (depth < 2 && Array.isArray(v.alternatives) && v.alternatives.every((item) => isRecording(item, depth + 1))));
}

export function summaryCacheKey(namespace: string, scopes: VideoSession[], organization: string, options = videoSummaryOptions()) {
  const groups = scopes.map((scope) => scope.videos.map((v) => `${recordingKey(v)}:${v.courseBeginTime}:${v.courseEndTime}`).sort());
  return JSON.stringify(["prompt-v1", namespace, organization, options.prompt.trim(), options.contextTokens, options.outputTokens,
    organization === "combined" ? groups.flat().sort() : groups.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
}

/** Regeneration retains the original course/account scope while adopting the current model. */
export function withSummaryModelIdentity(namespace: string, modelIdentity: string): string {
  const match = /^(.*)(:ppt-cleanup-v\d+=[01])$/.exec(namespace);
  if (!match) return namespace;
  try {
    const parts: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parts) || parts.length !== 6) return namespace;
    parts[5] = modelIdentity;
    return `${JSON.stringify(parts)}${match[2]}`;
  } catch { return namespace; }
}

export function readSummaryCache(): VideoSummaryCache[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is VideoSummaryCache => !!item && typeof item.key === "string" && typeof item.namespace === "string" && typeof item.text === "string" && typeof item.title === "string" && typeof item.coverage === "string" && typeof item.savedAt === "string" && ["combined", "sessions"].includes(item.organization)
      && (item.summaryOptions === undefined || (typeof item.summaryOptions?.prompt === "string" && !videoSummaryOptionsError(item.summaryOptions)))
      && (item.preparedContext === undefined || (typeof item.preparedContext?.sourceHash === "string" && typeof item.preparedContext?.text === "string"))
      && Array.isArray(item.messages) && item.messages.every((m: FileAIChatMessage) => m && typeof m.content === "string" && typeof m.id === "string" && typeof m.createdAt === "string" && ["user", "assistant"].includes(m.role))
      && Array.isArray(item.scopes) && item.scopes.length > 0 && item.scopes.every((s: VideoSession) => s && typeof s.id === "string" && typeof s.title === "string" && Array.isArray(s.videos) && s.videos.length > 0 && s.videos.every((v) => isRecording(v))));
  } catch { return []; }
}
/** Keep complete contexts for follow-up questions. Never cache failed or partial replies. */
export function writeSummaryCache(entry: VideoSummaryCache): boolean {
  try {
    const entries = [entry, ...readSummaryCache().filter((e) => e.key !== entry.key)].slice(0, 12);
    while (new Blob([JSON.stringify(entries)]).size > MAX_BYTES && entries.length > 1) entries.pop();
    if (new Blob([JSON.stringify(entries)]).size > MAX_BYTES) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch { return false; }
}
export function deleteSummaryCache(key: string): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readSummaryCache().filter((e) => e.key !== key))); return true; }
  catch { return false; }
}
