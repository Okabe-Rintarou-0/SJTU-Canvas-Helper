import { defineDataCollection } from "./app_data";
import { recordingKey } from "./video_library";
import type { CanvasVideo } from "./model";

export const VIDEO_TOPIC_MAX_CHARS = 24;
interface VideoTopic { topic: string; sourceHash: string; policy: string }
export function validVideoTopic(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0
    && Array.from(value).length <= VIDEO_TOPIC_MAX_CHARS && !/[\p{Cc}`#*\\$<>]/u.test(value);
}
export const videoTopicIndex = defineDataCollection<VideoTopic>({
  category: "history", name: "video-recording-topics", version: 1,
  validate: (value: unknown): value is VideoTopic => {
    if (!value || typeof value !== "object") return false;
    const item = value as VideoTopic;
    return validVideoTopic(item.topic) && typeof item.sourceHash === "string" && typeof item.policy === "string";
  },
});
export async function readVideoTopics(account: string): Promise<Record<string, string>> {
  return Object.fromEntries((await videoTopicIndex.forAccount(account).list()).map(({ key, value }) => [key, value.topic]));
}
export const recordingTopic = (video: CanvasVideo, topics: Record<string, string>) => [video, ...(video.alternatives ?? [])]
  .map((item) => topics[recordingKey(item)]).find(Boolean);

const TOPIC_OPEN = "<video-topics>";
const TOPIC_CLOSE = "</video-topics>";
export function summaryBody(content: string): string {
  const start = content.indexOf(TOPIC_OPEN);
  if (start >= 0) return content.slice(0, start).trimEnd();
  // Hide a marker arriving across multiple streaming chunks.
  for (let length = TOPIC_OPEN.length - 1; length > 0; length--) {
    if (content.endsWith(TOPIC_OPEN.slice(0, length))) return content.slice(0, -length).trimEnd();
  }
  return content;
}
export function summaryTopics(content: string, allowed: Set<string>): Record<string, string> {
  const start = content.indexOf(TOPIC_OPEN);
  const end = content.indexOf(TOPIC_CLOSE, start);
  if (start < 0 || end < 0) return {};
  try {
    const values: unknown = JSON.parse(content.slice(start + TOPIC_OPEN.length, end));
    if (!Array.isArray(values)) return {};
    return Object.fromEntries(values.filter((item) => item && typeof item.key === "string" && allowed.has(item.key) && validVideoTopic(item.topic)).map((item) => [item.key, item.topic]));
  } catch { return {}; }
}
