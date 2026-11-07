import { describe, expect, it } from "vitest";
import { isRelativeFolderPath, relativeFolderPath } from "./file_folder_path";

describe("Canvas folder paths", () => {
  it.each(["", "第一章/练习", "a\\b", "./a", "a/./b"])("accepts valid relative path %j", (path) => {
    expect(isRelativeFolderPath(path)).toBe(true);
  });
  it.each([null, undefined, 1, "/outside", "\\outside", "C:\\outside", "a:stream", "../outside", "a/../b", "a\\..\\b", ".", "./", "a\0b"])("rejects unsafe or unresolved path %j", (path) => {
    expect(isRelativeFolderPath(path)).toBe(false);
  });
  it("strips only the exact root and preserves nonempty nested paths", () => {
    expect(relativeFolderPath("course files", "course files")).toBe("");
    expect(relativeFolderPath("course files/第一章/练习", "course files")).toBe("第一章/练习");
    for (const fullName of ["other/Branch", "course files2/Branch", "course files/", "course files/.", "course files/../outside"])
      expect(relativeFolderPath(fullName, "course files")).toBeUndefined();
  });
});
