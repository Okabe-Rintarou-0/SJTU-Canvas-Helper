import { beforeEach, expect, it, vi } from "vitest";
import { createDataMock } from "../test/app_data_mock";
import { readVideoTopics, recordingTopic, validVideoTopic, videoTopicIndex, summaryBody, summaryTopics } from "./video_topics";
import type { CanvasVideo } from "./model";

const data = createDataMock();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (_command: string, args: Parameters<typeof data.invoke>[0]) => data.invoke(args) }));
beforeEach(() => data.reset());

it("hides streamed topic metadata and accepts only short topics for selected recordings", () => {
  const body = "## 课堂总结\n正文内容。\n";
  for (let end = 1; end <= "<video-topics>".length; end++) expect(summaryBody(body + "<video-topics>".slice(0, end))).toBe(body.trimEnd());
  const content = body + '<video-topics>[{"key":"canvas:a","topic":"词法分析"},{"key":"canvas:b","topic":"无关录像"},{"key":"canvas:a","topic":"过长主题'.concat("字".repeat(30), '"}]</video-topics>');
  expect(summaryBody(content)).toBe(body.trimEnd());
  expect(summaryTopics(content, new Set(["canvas:a"]))).toEqual({ "canvas:a": "词法分析" });
  expect(summaryTopics(body + "<video-topics>bad", new Set(["canvas:a"]))).toEqual({});
});

it("persists short Unicode topics independently of caption text and isolates accounts", async () => {
  const index = videoTopicIndex.forAccount("Default");
  await index.set("canvas:a", { topic: "语法分析与移入规约", sourceHash: "source", policy: "v7" });
  expect(await readVideoTopics("Default")).toEqual({ "canvas:a": "语法分析与移入规约" });
  data.switchAccount("Study");
  expect(await readVideoTopics("Study")).toEqual({});
  await expect(readVideoTopics("Default")).rejects.toThrow("账号已切换");
});

it("looks up the same section across its source alternatives", () => {
  const video = { source: "videoSpace", videoId: "b", alternatives: [{ source: "canvas", videoId: "a" }] } as CanvasVideo;
  expect(recordingTopic(video, { "canvas:a": "线程同步" })).toBe("线程同步");
  expect(recordingTopic(video, {})).toBeUndefined();
});

it("accepts at most 24 Unicode characters and rejects markup and empty titles", async () => {
  expect(validVideoTopic("语".repeat(24))).toBe(true);
  expect(validVideoTopic("𠮷".repeat(24))).toBe(true);
  for (const topic of ["语".repeat(25), "", "   ", " 主题", "主\n题", "**主题**", "$x$", "<主题>"]) {
    expect(validVideoTopic(topic)).toBe(false);
    await expect(videoTopicIndex.forAccount("Default").set("bad", { topic, sourceHash: "", policy: "" })).rejects.toThrow();
  }
});
