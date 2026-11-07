// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateArchiveEntries } from "./archive_client";

const file = (path: string) => ({ path, type: "FILE" });
const directory = (path: string) => ({ path, type: "DIRECTORY" });

describe("archive paths before object construction", () => {
  it.each([
    "__proto__", "__proto__/polluted", "folder/__proto__/polluted",
    "constructor/prototype/polluted", "toString/polluted", "hasOwnProperty/polluted",
    "valueOf/polluted", "__defineGetter__/polluted", "folder/constructor/polluted",
    "", "/", "/absolute", "folder//file", "folder/../file", "../file", "folder//",
  ])("rejects unsafe file path %s without changing prototypes", (path) => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    expect(() => validateArchiveEntries([file(path)])).toThrow();
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
  });

  it.each(["DIRECTORY", "SYMLINK", "OTHER"])("checks non-file %s paths too", (type) => {
    expect(() => validateArchiveEntries([{ path: "__proto__/polluted", type }])).toThrow();
    expect(() => validateArchiveEntries([{ path: "constructor", type }])).toThrow();
  });

  it.each([
    [file("a"), file("a")],
    [file("a"), file("a/b")],
    [file("a/b"), file("a")],
    [directory("a/"), file("a")],
    [file("a"), directory("a/")],
    [file("a"), file("a/_archiveRef/file")],
  ])("rejects duplicate files and both collision orders: %j", (...entries) => {
    expect(() => validateArchiveEntries(entries)).toThrow(/Conflicting/);
  });

  it.each([null, {}, [null], [{ path: 1, type: "FILE" }], [{ path: "a" }]])(
    "rejects malformed metadata %j", (entries) => expect(() => validateArchiveEntries(entries)).toThrow(),
  );

  it("allows normal Unicode, explicit/repeated directories, dot prefixes and built-in file leaves", () => {
    expect(() => validateArchiveEntries([
      directory("资料/"), file("资料/笔记.txt"), directory("资料/"), file("./readme.txt"),
      file("constructor"), file("toString"), file("hasOwnProperty"), file("prototype"),
      directory("empty/"),
    ])).not.toThrow();
  });

  it("allows an ordinary prototype directory and an empty archive", () => {
    expect(() => validateArchiveEntries([file("prototype/readme.txt")])).not.toThrow();
    expect(() => validateArchiveEntries([])).not.toThrow();
  });
});
