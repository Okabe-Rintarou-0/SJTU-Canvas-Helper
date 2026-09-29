import type { CanvasVideo } from "./model";

export const recordingKey = (video: CanvasVideo) => `${video.source}:${video.videoId}`;
export interface VideoSession { id: string; title: string; videos: CanvasVideo[] }

export function groupSessionsByDate<T extends { session: VideoSession }>(items: T[]) {
  const dates = new Map<string, { id: string; title: string; items: T[] }>();
  for (const item of items) {
    const time = recordingTime(item.session.videos[0].courseBeginTime);
    const date = time === undefined ? undefined : new Date(time);
    const id = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "unknown";
    const group = dates.get(id) ?? { id, title: date ? `${id} · ${date.toLocaleDateString("zh-CN", { weekday: "long" })}` : "日期待确认", items: [] };
    group.items.push(item);
    dates.set(id, group);
  }
  return [...dates.values()].sort((a, b) => a.id === "unknown" ? 1 : b.id === "unknown" ? -1 : b.id.localeCompare(a.id));
}

// Parse service-local time explicitly; WebView's parsing of slash/space dates varies.
export function recordingTime(value: string): number | undefined {
  const m = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s = "0"] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return date.getFullYear() === +y && date.getMonth() === +mo - 1 && date.getDate() === +d
    && +h < 24 && +mi < 60 && +s < 60 ? date.getTime() : undefined;
}

export function groupVideoSessions(videos: CanvasVideo[]): VideoSession[] {
  const ordered = [...videos].sort((a, b) => (recordingTime(a.courseBeginTime) ?? Infinity)
    - (recordingTime(b.courseBeginTime) ?? Infinity) || recordingKey(a).localeCompare(recordingKey(b)));
  const groups: VideoSession[] = [];
  for (const video of ordered) {
    const group = groups[groups.length - 1];
    const previous = group?.videos[group.videos.length - 1];
    const start = recordingTime(video.courseBeginTime);
    const end = previous && recordingTime(previous.courseEndTime);
    const priorStart = previous && recordingTime(previous.courseBeginTime);
    const sameDay = start !== undefined && priorStart !== undefined
      && new Date(start).toDateString() === new Date(priorStart).toDateString();
    const compatible = previous && (!previous.userName || !video.userName || previous.userName === video.userName)
      && (!previous.classroomName || !video.classroomName || previous.classroomName === video.classroomName);
    // dailyLessonNumber is a daily ordinal, not proof of contiguous scheduled lessons.
    const adjacent = start !== undefined && end !== undefined && priorStart !== undefined
      && end > priorStart && start >= end && start - end <= 25 * 60_000;
    if (group && sameDay && compatible && adjacent) group.videos.push(video);
    else groups.push({ id: recordingKey(video), title: "", videos: [video] });
  }
  for (const group of groups) {
    const first = group.videos[0];
    const last = group.videos[group.videos.length - 1];
    const start = recordingTime(first.courseBeginTime);
    const end = recordingTime(last.courseEndTime);
    const hm = (time: number) => new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    group.title = start === undefined ? first.videoName || "时间待确认"
      : `${new Date(start).toLocaleDateString("zh-CN")} ${hm(start)}${end === undefined ? "" : `–${hm(end)}`}`;
  }
  return groups.sort((a, b) => (recordingTime(b.videos[0].courseBeginTime) ?? -Infinity)
    - (recordingTime(a.videos[0].courseBeginTime) ?? -Infinity));
}

export function toggleRecordings(selected: Set<string>, videos: CanvasVideo[]): Set<string> {
  const next = new Set(selected);
  const remove = videos.every((v) => selected.has(recordingKey(v)));
  videos.forEach((v) => remove ? next.delete(recordingKey(v)) : next.add(recordingKey(v)));
  return next;
}

export function selectedSessionScopes(sessions: VideoSession[], selected: Set<string>): VideoSession[] {
  return sessions.flatMap((session) => {
    const videos = session.videos.filter((video) => selected.has(recordingKey(video)));
    return videos.length ? [{ ...session, videos,
      title: session.title + (videos.length < session.videos.length ? "（部分小节）" : "") }] : [];
  }).reverse();
}

export interface VideoMaterial {
  key: string;
  title: string;
  text: string;
  warnings: string[];
  srt: string;
  subtitleAvailable: boolean;
}

export interface VideoExportOptions {
  video: boolean;
  ppt: boolean;
  subtitle: boolean;
  pptPerSession: boolean;
  tracks: "all" | "first";
}

export function parseVideoCitation(href: string | undefined): { key: string; seconds: number } | undefined {
  const match = href?.match(/^#video=([^&]+)&t=(\d+)$/);
  if (!match) return undefined;
  try {
    const key = decodeURIComponent(match[1]);
    const seconds = Number(match[2]);
    return Number.isSafeInteger(seconds) ? { key, seconds } : undefined;
  } catch { return undefined; }
}

export function formatVideoTimestamp(seconds: number): string {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
