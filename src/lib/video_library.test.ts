import { describe, expect, it } from "vitest";
import { formatVideoTimestamp, groupVideoSessions, groupSessionsByDate, parseVideoCitation, recordingKey, recordingTime, selectedSessionScopes, toggleRecordings } from "./video_library";
import type { CanvasVideo } from "./model";

export function recording(id: string, start = "2026-09-28 08:00", end = "2026-09-28 08:45", overrides: Partial<CanvasVideo> = {}): CanvasVideo {
  return { source: "canvas", videoId: id, videoName: `课程 ${id}`, userName: "老师", classroomName: "教室", courseBeginTime: start,
    courseEndTime: end, weekNumber: 4, weekDay: 1, lessonNumber: 1, dailyLessonNumber: 1, playable: true, availability: "ready", availabilityLabel: "可播放", ...overrides };
}
describe("classroom grouping", () => {
  it("combines adjacent lessons but separates morning and afternoon", () => {
    const a = recording("a");
    const b = recording("b", "2026-09-28 08:55", "2026-09-28 09:40");
    const c = recording("c", "2026-09-28 14:00", "2026-09-28 14:45");
    const sessions = groupVideoSessions([b, c, a]);
    expect(sessions.map((s) => s.videos.map((v) => v.videoId))).toEqual([["c"], ["a", "b"]]);
  });
  it("groups separate classes on the same date and places unknown dates last", () => {
    const sessions = groupVideoSessions([recording("a"), recording("b", "2026/09/28 14:00", "2026/09/28 14:45"), recording("c", "2026-09-29 08:00", "2026-09-29 08:45"), recording("unknown", "", "")]);
    const dates = groupSessionsByDate(sessions.map((session) => ({ session })));
    expect(dates.map((d) => d.id)).toEqual(["2026-09-29", "2026-09-28", "unknown"]);
    expect(dates[1].items).toHaveLength(2);
    expect(dates[1].items.flatMap((i) => i.session.videos.map((v) => v.videoId))).toEqual(["b", "a"]);
  });
  it("does not infer a class from missing or invalid times or conflicting rooms", () => {
    const a = recording("a");
    const b = recording("b", "2026-09-28 08:55", "2026-09-28 09:40", { classroomName: "另一教室" });
    const c = recording("c", "", "");
    const d = recording("d", "", "");
    expect(groupVideoSessions([d, b, a, c])).toHaveLength(4);
    expect(recordingTime("2026-02-30 08:00")).toBeUndefined();
    expect(recordingTime("2026-09-28 28:00")).toBeUndefined();
  });
  it("keeps different days separate and orders lessons chronologically", () => {
    const sessions = groupVideoSessions([recording("a"), recording("b", "2026/09/29 08:00", "2026/09/29 08:45")]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].videos[0].videoId).toBe("b");
  });
});
describe("selection and scope", () => {
  it("toggles a class without affecting hidden selections and marks partial scopes", () => {
    const a = recording("a"); const b = recording("b", "2026-09-28 08:55", "2026-09-28 09:40");
    const selected = new Set(["legacy:hidden", recordingKey(a)]);
    const next = toggleRecordings(selected, [a, b]);
    expect([...next]).toEqual(["legacy:hidden", "canvas:a", "canvas:b"]);
    expect([...toggleRecordings(next, [a, b])]).toEqual(["legacy:hidden"]);
    const scopes = selectedSessionScopes(groupVideoSessions([a, b]), selected);
    expect(scopes[0].videos).toEqual([a]);
    expect(scopes[0].title).toContain("部分小节");
    expect(selected.size).toBe(2);
  });
  it("formats citation labels consistently without milliseconds", () => {
    expect(formatVideoTimestamp(356)).toBe("00:05:56");
    expect(formatVideoTimestamp(3723)).toBe("01:02:03");
  });
  it("resolves a timestamp only with its recording identity", () => {
    expect(parseVideoCitation("#video=canvas%3A123&t=120")).toEqual({ key: "canvas:123", seconds: 120 });
    expect(parseVideoCitation("#video=%zz&t=4")).toBeUndefined();
    expect(parseVideoCitation("https://example.com/?t=120")).toBeUndefined();
    expect(parseVideoCitation("#video=canvas%3A123&t=-5")).toBeUndefined();
  });
});
