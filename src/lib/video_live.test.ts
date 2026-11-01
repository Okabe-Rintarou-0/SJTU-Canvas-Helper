import { describe, expect, it } from "vitest";
import { livePlaybackURL, liveSessionStatus, nextLiveSession } from "./video_live";
import type { CanvasLiveSession } from "./model";

const session = { startTime: 100, finishTime: 200, enabled: true } as CanvasLiveSession;
describe("classroom live playback", () => {
  it("uses explicit start and end boundaries and viewing permission", () => {
    expect(liveSessionStatus(session, 99)).toBe("upcoming");
    expect(liveSessionStatus(session, 100)).toBe("live");
    expect(liveSessionStatus(session, 199)).toBe("live");
    expect(liveSessionStatus(session, 200)).toBe("ended");
    expect(liveSessionStatus({ ...session, enabled: false }, 150)).toBe("unavailable");
  });
  it("follows the next available lesson of the same class and teaching day", () => {
    const start = Date.parse("2026-10-26T09:00:00+08:00");
    const current = { ...session, id: "1", teachingClassId: 7, startTime: start, finishTime: start + 40 * 60_000 };
    const next = { ...current, id: "2", startTime: start + 50 * 60_000, finishTime: start + 90 * 60_000 };
    const later = { ...next, id: "3", startTime: start + 100 * 60_000, finishTime: start + 140 * 60_000 };
    const tomorrow = { ...next, id: "tomorrow", startTime: next.startTime + 86400_000, finishTime: next.finishTime + 86400_000 };
    expect(nextLiveSession(current, [later, tomorrow, next, current], current.finishTime)).toBe(next);
    expect(nextLiveSession(current, [next, later], next.finishTime)).toBe(later);
    expect(nextLiveSession(current, [{ ...next, enabled: false }, { ...later, teachingClassId: 8 }, tomorrow], current.finishTime)).toBeUndefined();
    expect(nextLiveSession(current, [current], current.finishTime)).toBeUndefined();
  });
  it("preserves signed queries through the dedicated proxy", () => {
    expect(livePlaybackURL("https://mss2.sjtu.edu.cn/live/camera.m3u8?auth_key=abc&account_token=a%2Bb%3D", 3030))
      .toBe("http://localhost:3030/canvas-stream/mss2.sjtu.edu.cn/live/camera.m3u8?auth_key=abc&account_token=a%2Bb%3D");
    expect(livePlaybackURL("https://live.sjtu.edu.cn/live/camera.m3u8", 3030)).toContain("/canvas-stream/live.sjtu.edu.cn/");
  });
  it.each(["http://mss2.sjtu.edu.cn/live/a.m3u8", "https://mss2.sjtu.edu.cn.evil.test/live/a.m3u8", "https://mss2.sjtu.edu.cn:8443/a.m3u8", "https://example.test/a.m3u8"])("rejects unsupported origin %s", (url) => {
    expect(() => livePlaybackURL(url, 3030)).toThrow("不支持");
  });
});
