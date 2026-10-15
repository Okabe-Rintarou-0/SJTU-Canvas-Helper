import { describe, expect, it } from "vitest";
import { livePlaybackURL, liveSessionStatus } from "./video_live";
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
  it("preserves signed queries through the dedicated proxy", () => {
    expect(livePlaybackURL("https://mss2.sjtu.edu.cn/live/camera.m3u8?auth_key=abc&account_token=a%2Bb%3D", 3030))
      .toBe("http://localhost:3030/canvas-stream/mss2.sjtu.edu.cn/live/camera.m3u8?auth_key=abc&account_token=a%2Bb%3D");
    expect(livePlaybackURL("https://live.sjtu.edu.cn/live/camera.m3u8", 3030)).toContain("/canvas-stream/live.sjtu.edu.cn/");
  });
  it.each(["http://mss2.sjtu.edu.cn/live/a.m3u8", "https://mss2.sjtu.edu.cn.evil.test/live/a.m3u8", "https://mss2.sjtu.edu.cn:8443/a.m3u8", "https://example.test/a.m3u8"])("rejects unsupported origin %s", (url) => {
    expect(() => livePlaybackURL(url, 3030)).toThrow("不支持");
  });
});
