import type { CanvasLiveSession } from "./model";

export function liveSessionStatus(session: CanvasLiveSession, now: number): "live" | "upcoming" | "ended" | "unavailable" {
  if (!session.enabled) return "unavailable";
  if (now < session.startTime) return "upcoming";
  if (now >= session.finishTime) return "ended";
  return "live";
}

export const liveStatusLabels = { live: "直播中", upcoming: "未开始", ended: "已结束", unavailable: "未开放" };

// The service schedule uses Shanghai time even when the computer is abroad.
const teachingDay = (time: number) => Math.floor((time + 8 * 60 * 60_000) / (24 * 60 * 60_000));

export function visibleLiveSessions(sessions: CanvasLiveSession[], now: number): CanvasLiveSession[] {
  const today = teachingDay(now);
  return sessions.filter((session) => session.enabled && session.finishTime > now
    && (session.startTime <= now || teachingDay(session.startTime) === today))
    .sort((a, b) => a.startTime - b.startTime);
}

// Only follow the same teaching class on the same teaching day, not next week's lesson.
export function nextLiveSession(current: CanvasLiveSession, sessions: CanvasLiveSession[], now: number): CanvasLiveSession | undefined {
  return sessions.filter((session) => session.id !== current.id && session.enabled
    && session.teachingClassId === current.teachingClassId
    && session.startTime > current.startTime && session.finishTime > now
    && teachingDay(session.startTime) === teachingDay(current.startTime))
    .sort((a, b) => a.startTime - b.startTime)[0];
}

export function livePlaybackURL(source: string, port: number): string {
  const url = new URL(source);
  if (url.protocol !== "https:" || (url.port && url.port !== "443")
    || !(url.hostname === "live.sjtu.edu.cn" || /^mss\d+\.sjtu\.edu\.cn$/.test(url.hostname))) {
    throw new Error("当前直播机位使用了不支持的媒体地址");
  }
  return `http://localhost:${port}/canvas-stream/${url.hostname}${url.pathname}${url.search}`;
}

// Bound requests so switching courses and retrying always leave a usable UI.
export function liveRequest<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("直播请求超时，请重试")), 30_000);
    request.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
