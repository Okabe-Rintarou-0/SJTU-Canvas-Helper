import type { FileAIChatMessage } from "../components/file_ai_chat_modal";
import type { CanvasVideo } from "./model";
import { recordingKey, type VideoSession } from "./video_library";
import { videoSummaryOptions, videoSummaryOptionsError, type VideoSummaryOptions } from "./video_summary_config";
import { currentDataAccount, defineDataCollection } from "./app_data";
import { validSummarySources, type VideoSummarySource } from "./video_summary_sources";

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
  sources?: VideoSummarySource[];
  savedAt: string;
  summaryOptions?: VideoSummaryOptions;
  preparedContext?: VideoPreparedContext;
  transcribeMissing?: boolean;
  generateTopics?: boolean;
}
// Rebuild contexts with concise chronological OCR evidence, without processing metadata.
const STORAGE_KEY = "video-material-summaries-v7";
export const PPT_CLEANUP_POLICY = "ppt-cleanup-v9";

function isRecording(value: unknown, depth = 0): value is CanvasVideo {
  if (!value || typeof value !== "object") return false;
  const v = value as CanvasVideo;
  return ["canvas", "videoSpace", "legacy"].includes(v.source) && typeof v.videoId === "string"
    && [v.videoName, v.courseBeginTime, v.courseEndTime].every((field) => typeof field === "string") && typeof v.playable === "boolean"
    && (v.alternatives === undefined || (depth < 2 && Array.isArray(v.alternatives) && v.alternatives.every((item) => isRecording(item, depth + 1))));
}

export function summaryCacheKey(namespace: string, scopes: VideoSession[], organization: string, options = videoSummaryOptions(), transcribeMissing = true) {
  const groups = scopes.map((scope) => scope.videos.map((v) => `${recordingKey(v)}:${v.courseBeginTime}:${v.courseEndTime}`).sort());
  return JSON.stringify([transcribeMissing ? "canvas-optimized-transcript-v1" : "canvas-existing-material-v1", namespace, organization, options.prompt.trim(), options.contextTokens, options.outputTokens,
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

export function isSummaryCache(value: unknown): value is VideoSummaryCache {
    if (!value || typeof value !== "object") return false;
    const item = value as VideoSummaryCache;
    return typeof item.key === "string" && typeof item.namespace === "string" && typeof item.text === "string" && typeof item.title === "string" && typeof item.coverage === "string" && typeof item.savedAt === "string" && ["combined", "sessions"].includes(item.organization)
      && (item.summaryOptions === undefined || (typeof item.summaryOptions?.prompt === "string" && !videoSummaryOptionsError(item.summaryOptions)))
      && (item.preparedContext === undefined || (typeof item.preparedContext?.sourceHash === "string" && typeof item.preparedContext?.text === "string"))
      && (item.transcribeMissing === undefined || typeof item.transcribeMissing === "boolean")
      && (item.generateTopics === undefined || typeof item.generateTopics === "boolean")
      && (item.sources === undefined || validSummarySources(item.sources))
      && Array.isArray(item.messages) && item.messages.every((m: FileAIChatMessage) => m && typeof m.content === "string" && typeof m.id === "string" && typeof m.createdAt === "string" && ["user", "assistant"].includes(m.role))
      && Array.isArray(item.scopes) && item.scopes.length > 0 && item.scopes.every((s: VideoSession) => s && typeof s.id === "string" && typeof s.title === "string" && Array.isArray(s.videos) && s.videos.length > 0 && s.videos.every((v) => isRecording(v)));
}

export const videoSummaryHistory = defineDataCollection<VideoSummaryCache>({
  category: "history", name: "video-summaries", version: 1, validate: isSummaryCache,
});

export function summaryAccount(namespace: string): string | undefined {
  try {
    const match = /^(.*):ppt-(?:animation|cleanup)(?:-v\d+)?=[01]$/.exec(namespace);
    const parts: unknown = match && JSON.parse(match[1]);
    if (Array.isArray(parts) && typeof parts[0] === "string") return parts[0];
  } catch { /* Unrecognized legacy entries stay in localStorage for recovery. */ }
}

const migrations = new Map<string, Promise<void>>();
/** Import only this account, without replacing newer disk records. Remove each
 * legacy entry only after its complete context has been durably acknowledged.
 * Malformed/unknown entries and other accounts remain available for recovery.
 */
export function migrateSummaryHistory(account: string): Promise<void> {
  const existing = migrations.get(account);
  if (existing) return existing;
  const task = (async () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    let entries: unknown;
    try { entries = JSON.parse(raw); } catch { throw new Error("旧视频总结数据损坏，原数据已保留"); }
    if (!Array.isArray(entries)) throw new Error("旧视频总结格式无效，原数据已保留");
    const store = videoSummaryHistory.forAccount(account);
    for (const entry of entries) {
      if (!isSummaryCache(entry) || summaryAccount(entry.namespace) !== account) continue;
      await store.set(entry.key, entry, true);
      // Re-read so concurrent imports of a different account never resurrect data.
      const remaining: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (!Array.isArray(remaining)) throw new Error("旧视频总结格式发生变化，原数据已保留");
      const next = remaining.filter((item) => JSON.stringify(item) !== JSON.stringify(entry));
      if (next.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    }
  })().finally(() => { migrations.delete(account); });
  migrations.set(account, task);
  return task;
}

export async function readSummaryCache(account?: string): Promise<VideoSummaryCache[]> {
  account ??= await currentDataAccount();
  await migrateSummaryHistory(account);
  return (await videoSummaryHistory.forAccount(account).list()).map((record) => record.value)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
/** Histories are retained until explicitly deleted; no cache quota evicts them. */
export async function writeSummaryCache(entry: VideoSummaryCache, account?: string): Promise<boolean> {
  try {
    account ??= await currentDataAccount();
    const owner = summaryAccount(entry.namespace);
    if (owner && owner !== account) return false;
    await videoSummaryHistory.forAccount(account).set(entry.key, entry);
    return true;
  } catch { return false; }
}
export async function deleteSummaryCache(key: string, account?: string): Promise<boolean> {
  try {
    account ??= await currentDataAccount();
    // Prevent a deleted legacy entry from being reimported later.
    await migrateSummaryHistory(account);
    await videoSummaryHistory.forAccount(account).remove(key);
    return true;
  } catch { return false; }
}
