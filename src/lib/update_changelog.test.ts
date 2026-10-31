import { describe, expect, it } from "vitest";
import { compareVersions, getCumulativeChanges } from "./update_changelog";

const log = (version: string, item = version) => ({ version, date: "2026/10/29", items: [item] });

describe("cumulative update changelog", () => {
  it("includes skipped intermediate versions, excludes installed and later versions, and sorts numerically", () => {
    const changes = getCumulativeChanges("3.0.8", "3.0.13", [
      log("v3.0.9"), log("v3.0.14"), log("v3.0.8"), log("v3.0.13"), log("v3.0.10"),
    ]);
    expect(changes.map((entry) => entry.version)).toEqual(["v3.0.13", "v3.0.10", "v3.0.9"]);
  });

  it("safely ignores malformed bundled entries and unknown versions", () => {
    expect(getCumulativeChanges("3.0.12", "3.0.13", [
      null, {}, log("invalid"), { ...log("3.0.13"), items: [null] }, log("3.0.13", "更新内容"),
    ])).toEqual([log("3.0.13", "更新内容")]);
    expect(getCumulativeChanges("3.0.12", "3.0.13", {})).toEqual([]);
    expect(getCumulativeChanges("unknown", "3.0.13", [log("3.0.13")])).toEqual([]);
  });

  it("compares prereleases and ignores build metadata", () => {
    expect(compareVersions("v3.0.13-beta.2", "3.0.13-beta.10")).toBeLessThan(0);
    expect(compareVersions("3.0.13-beta.10", "3.0.13")).toBeLessThan(0);
    expect(compareVersions("3.0.13-alpha", "3.0.13-alpha.1")).toBeLessThan(0);
    expect(compareVersions("3.0.13-1", "3.0.13-alpha")).toBeLessThan(0);
    expect(compareVersions("3.0.13+build.1", "v3.0.13")).toBe(0);
    expect(getCumulativeChanges("3.0.13", "3.0.12", [log("3.0.12")])).toEqual([]);
  });
});
