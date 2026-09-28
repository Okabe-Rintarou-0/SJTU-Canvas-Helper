import { describe, expect, it, vi } from "vitest";
import type { CanvasVideo, Course } from "./model";
import { loadVideoCourse, mergeVideoCourses } from "./video_courses";

function course(id: number, overrides: Partial<Course> = {}): Course {
  return {
    id, uuid: "", name: "测试课程甲", course_code: "TEST-001", enrollments: [],
    access_restricted_by_date: false, teachers: [],
    term: { id: 1, name: "2098-2099-1", start_at: null, end_at: null, created_at: null, workflow_state: "" },
    ...overrides,
  };
}

describe("video course merging", () => {
  it("merges matching courses across differently formatted semesters and preserves backend IDs", () => {
    const space = course(80);
    space.term.name = "2098-2099 第一学期";
    expect(mergeVideoCourses([course(10)], [space])).toMatchObject([
      { id: 10, canvasId: 10, teachingClassId: 80, sourceLabel: "" },
    ]);
  });
  it("keeps different terms and ID namespaces separate", () => {
    const space = course(10);
    space.term.name = "2097-2098 第一学期";
    const result = mergeVideoCourses([course(10)], [space]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ id: -1, teachingClassId: 10, sourceLabel: "视频空间" });
  });
  it("does not merge ambiguous classes", () => {
    expect(mergeVideoCourses([course(10), course(11)], [course(80)])).toHaveLength(3);
    expect(mergeVideoCourses([course(10)], [course(80), course(81)])).toHaveLength(3);
  });
  it("deduplicates repeated records within a source", () => {
    expect(mergeVideoCourses([course(10), course(10)], [course(80), course(80)])).toHaveLength(1);
  });
  it("matches localized course names by an exact course code", () => {
    const canvasTeachers = [{
      id: 1,
      anonymous_id: "",
      display_name: "测试教师甲",
      avatar_image_url: "",
      html_url: "",
    }];
    const spaceTeachers = [{ ...canvasTeachers[0], display_name: "测试教师乙" }];
    const result = mergeVideoCourses(
      [course(10, { name: "Example Course II", course_code: "DEMO-201", teachers: canvasTeachers })],
      [course(80, { name: "示例课程（二）", course_code: " demo-201 ", teachers: spaceTeachers })],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ canvasId: 10, teachingClassId: 80 });
  });
  it("matches names and teachers when course codes differ", () => {
    const teachers = [{ id: 1, anonymous_id: "", display_name: "测试教师甲", avatar_image_url: "", html_url: "" }];
    expect(mergeVideoCourses([course(10, { teachers })], [course(80, { teachers, course_code: "" })])).toHaveLength(1);
    expect(mergeVideoCourses([course(10, { teachers })], [course(80, {
      teachers: [{ ...teachers[0], display_name: "测试教师乙" }],
      course_code: "",
    })])).toHaveLength(2);
    expect(mergeVideoCourses([course(10)], [course(80, { course_code: "" })])).toHaveLength(2);
  });
});

describe("video course fallback", () => {
  const merged = mergeVideoCourses([course(10)], [course(80)])[0];
  const video = (
    source: CanvasVideo["source"],
    videoId: string,
    courseBeginTime = "",
  ): CanvasVideo => ({
    source,
    videoId,
    userName: "",
    videoName: "",
    classroomName: "",
    courseBeginTime,
    courseEndTime: "",
    weekNumber: 0,
    weekDay: 0,
    lessonNumber: 0,
    dailyLessonNumber: 0,
    playable: true,
    availability: "ready",
    availabilityLabel: "可播放",
  });
  it("combines all video sources for a Canvas course", async () => {
    const canvas = vi.fn().mockResolvedValue([video("canvas", "new")]);
    const space = vi.fn().mockResolvedValue([video("videoSpace", "space")]);
    const legacy = vi.fn().mockResolvedValue([video("legacy", "old")]);
    expect(await loadVideoCourse(merged, canvas, space, legacy)).toEqual([
      video("canvas", "new"),
      video("videoSpace", "space"),
      video("legacy", "old"),
    ]);
    expect(canvas).toHaveBeenCalledWith(10);
    expect(space).toHaveBeenCalledWith(80);
    expect(legacy).toHaveBeenCalledWith(10);
  });
  it.each(["empty", "failure"])("keeps other sources after Canvas %s", async (mode) => {
    const canvas = mode === "empty" ? vi.fn().mockResolvedValue([]) : vi.fn().mockRejectedValue(new Error("offline"));
    const videos = [video("videoSpace", "space")];
    const space = vi.fn().mockResolvedValue(videos);
    expect(await loadVideoCourse(merged, canvas, space)).toEqual(videos);
    expect(space).toHaveBeenCalledWith(80);
  });
  it("uses legacy recordings when the new Canvas service is not enabled", async () => {
    const legacyVideos = [video("legacy", "old")];
    await expect(loadVideoCourse(
      merged,
      vi.fn().mockRejectedValue(new Error("Canvas 未开启直录播")),
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue(legacyVideos),
    )).resolves.toEqual(legacyVideos);
  });
  it("treats a course without new-service recording as an empty source", async () => {
    await expect(loadVideoCourse(
      mergeVideoCourses([course(10)], [])[0],
      vi.fn().mockRejectedValue(new Error("Failed to download video 当前课程暂未安排直录播")),
      vi.fn(),
      vi.fn().mockResolvedValue([]),
    )).resolves.toEqual([]);
  });
  it("deduplicates the same scheduled recording and prefers Canvas", async () => {
    const canvasVideo = video("canvas", "new", "2098-09-01 08:00:00");
    const legacyVideo = video("legacy", "old", "2098/09/01 08:00");
    await expect(loadVideoCourse(
      merged,
      vi.fn().mockResolvedValue([canvasVideo]),
      vi.fn().mockResolvedValue([]),
      vi.fn().mockResolvedValue([legacyVideo]),
    )).resolves.toEqual([canvasVideo]);
  });
  it("loads space-only courses using their original teaching class ID", async () => {
    const canvas = vi.fn();
    const space = vi.fn().mockResolvedValue([video("videoSpace", "space")]);
    const legacy = vi.fn();
    await loadVideoCourse(mergeVideoCourses([], [course(80)])[0], canvas, space, legacy);
    expect(canvas).not.toHaveBeenCalled();
    expect(space).toHaveBeenCalledWith(80);
    expect(legacy).not.toHaveBeenCalled();
  });
  it("reports all failures", async () => {
    await expect(loadVideoCourse(
      merged,
      vi.fn().mockRejectedValue("first"),
      vi.fn().mockRejectedValue("second"),
      vi.fn().mockRejectedValue("third"),
    )).rejects.toThrow("Canvas：first；视频空间：second；旧版课堂视频：third");
  });
});
