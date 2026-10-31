import { expect, it, vi } from "vitest";
import { defaultDownloadPath, displayLocalPath, downloadType, downloadCourseContext } from "./downloads";
import type { Course } from "./model";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
it("presents normal drive and network paths without changing ordinary paths", () => {
  expect(displayLocalPath(String.raw`\\?\C:\目录\app-data`)).toBe(String.raw`C:\目录\app-data`);
  expect(displayLocalPath(String.raw`\\?\UNC\server\共享`)).toBe(String.raw`\\server\共享`);
  expect(displayLocalPath("/home/user/data")).toBe("/home/user/data");
});
it("uses stable service identities for course folders, including video-only courses", () => {
  const course = { id: 10, name: "数学", term: { name: "2026-2027 秋" } } as Course;
  expect(downloadCourseContext({ ...course, canvasId: 10, teachingClassId: 42 })).toEqual({ id: "10", name: "数学", term: "2026-2027 秋" });
  expect(downloadCourseContext({ ...course, id: -2, teachingClassId: 42 })).toEqual(downloadCourseContext({ ...course, id: -7, teachingClassId: 42 }));
  expect(downloadCourseContext({ ...course, id: -2, teachingClassId: 42 }).id).toBe("video-space-42");
});
it("uses the unified directory when suggesting an export path", async () => {
  mocks.invoke.mockResolvedValue(String.raw`D:\下载\导出`);
  expect(await defaultDownloadPath("课程/成绩.xlsx")).toBe(String.raw`D:\下载\导出/课程_成绩.xlsx`);
  expect(mocks.invoke).toHaveBeenCalledWith("download_directory", { kind: "export" });
  expect(downloadType("课件.PDF")).toBe("document");
  expect(downloadType("字幕.srt")).toBe("subtitle");
});
