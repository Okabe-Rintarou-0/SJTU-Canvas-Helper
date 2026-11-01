import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAISession } from "./ai_session_store";
import { CanvasAgentSession } from "./canvas_agent_session";
import { FileAISession } from "./file_ai_session";
import { VideoSummarySession } from "./video_summary_session";
import { readSummaryCache, writeSummaryCache, summaryCacheKey, PPT_CLEANUP_POLICY } from "./video_summary_cache";
import type { CanvasVideo, File } from "./model";
import type { VideoSession } from "./video_library";
import { videoSummaryOptions } from "./video_summary_config";
import { createDataMock } from "../test/app_data_mock";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args: Parameters<typeof dataMock.invoke>[0]) => command === "app_data" ? dataMock.invoke(args) : command === "read_account_info" ? Promise.resolve({ current_account: "Default" }) : mocks.invoke(command, args), Channel: class { onmessage = () => {}; } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./video_library_tasks", () => ({ recordingRequest: (video: CanvasVideo, title: string) => ({ key: video.videoId, title }) }));

const dataMock = createDataMock();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Payload = { request_id: string; chunk?: string; content?: string; error?: string };
const handlers = new Map<string, (event: { payload: Payload }) => void>();
const unlisteners: ReturnType<typeof vi.fn>[] = [];
const file = { id: 12, display_name: "作业.pdf" } as File;
const scopes = [{ id: "class", title: "第一堂课", videos: [{ source: "canvas", videoId: "a", videoName: "录像",
  playable: true, courseBeginTime: "2026-10-08 08:00", courseEndTime: "2026-10-08 08:45" }] }] as VideoSession[];
const material = { key: "a", title: "第一堂课", text: "课堂资料", srt: "字幕", subtitleAvailable: true, warnings: [] };
const request = { scopes, organization: "combined", namespace: "account:course:ppt-cleanup-v3=0", title: "课堂总结", cleanUpPpt: false, generateTopics: true };

beforeEach(() => {
  vi.resetAllMocks(); dataMock.reset(); localStorage.clear(); handlers.clear(); unlisteners.length = 0;
  mocks.listen.mockImplementation(async (event: string, handler: (event: { payload: Payload }) => void) => {
    handlers.set(event, handler);
    const unlisten = vi.fn(() => { if (handlers.get(event) === handler) handlers.delete(event); });
    unlisteners.push(unlisten);
    return unlisten;
  });
});
afterEach(cleanup);

describe("Canvas Agent lifetime", () => {
  it("retains pending, completed messages and draft across unmount, and sends history only once", async () => {
    const session = new CanvasAgentSession();
    const reply = deferred<string>(); mocks.invoke.mockReturnValue(reply.promise);
    const view = renderHook(() => useAISession(session));
    let sending!: Promise<void>;
    act(() => { session.update({ maxTurns: "8", input: "快捷提问前的草稿" }); sending = session.send("第一问"); });
    view.unmount();
    await session.send("重复发送");
    const returned = renderHook(() => useAISession(session));
    expect(returned.result.current.loading).toBe(true);
    expect(returned.result.current.messages[0].content).toBe("第一问");
    expect(returned.result.current.input).toBe("快捷提问前的草稿");
    expect(mocks.invoke).toHaveBeenCalledOnce();
    await act(async () => { reply.resolve("第一答"); await sending; });
    act(() => session.update({ input: "未发送草稿" }));
    returned.unmount();
    const again = renderHook(() => useAISession(session));
    expect(again.result.current).toMatchObject({ loading: false, input: "未发送草稿", maxTurns: "8" });
    mocks.invoke.mockResolvedValue("第二答");
    await act(() => session.send("第二问"));
    expect(mocks.invoke.mock.calls[1][1].messages).toEqual([
      { role: "user", content: "第一问" }, { role: "assistant", content: "第一答" }, { role: "user", content: "第二问" },
    ]);
  });

  it("keeps errors after leaving and ignores old-account results", async () => {
    const session = new CanvasAgentSession();
    const failed = deferred<string>(); mocks.invoke.mockReturnValue(failed.promise);
    const first = session.send("问题");
    failed.reject(new Error("服务不可用")); await first;
    expect(session.getSnapshot().messages[1]).toMatchObject({ error: true, pending: false });
    const late = deferred<string>(); mocks.invoke.mockReturnValue(late.promise);
    const second = session.send("旧账号问题");
    session.reset(); late.resolve("旧账号回答"); await second;
    expect(session.getSnapshot()).toMatchObject({ loading: false, messages: [] });
  });
});

describe("file stream lifetime", () => {
  it("receives chunks without a page, waits for done instead of startup ACK, and cleans up listeners", async () => {
    const session = new FileAISession(); mocks.invoke.mockResolvedValue(undefined);
    const view = renderHook(() => useAISession(session));
    await act(() => session.explain(file));
    expect(view.result.current.loading).toBe(true);
    view.unmount();
    const requestId = mocks.invoke.mock.calls[0][1].requestId;
    handlers.get("file_ai_chat://chunk")!({ payload: { request_id: "unrelated", chunk: "错误上下文" } });
    handlers.get("file_ai_chat://chunk")!({ payload: { request_id: requestId, chunk: "部分回复" } });
    await session.send("重复发送");
    expect(mocks.invoke).toHaveBeenCalledOnce();
    const returned = renderHook(() => useAISession(session));
    expect(returned.result.current.messages[1].content).toBe("部分回复");
    returned.unmount();
    handlers.get("file_ai_chat://done")!({ payload: { request_id: requestId, content: "完整回复" } });
    expect(unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
    const completed = renderHook(() => useAISession(session));
    expect(completed.result.current).toMatchObject({ open: true, loading: false });
    expect(completed.result.current.messages[1]).toMatchObject({ content: "完整回复", pending: false });
    await act(() => session.explain(file));
    expect(mocks.invoke).toHaveBeenCalledOnce();
    await act(() => session.send("追问"));
    expect(mocks.invoke.mock.calls[1][1].messages[1]).toEqual({ role: "assistant", content: "完整回复" });
    act(() => session.reset());
  });

  it("waits for listener readiness and cleans successful registrations when one fails", async () => {
    const session = new FileAISession(); const registration = deferred<() => void>();
    const unlisten = vi.fn();
    mocks.listen.mockImplementation((event: string) => event.endsWith("error") ? registration.promise : Promise.resolve(unlisten));
    const running = session.explain(file);
    await Promise.resolve();
    expect(mocks.invoke).not.toHaveBeenCalled();
    registration.reject(new Error("监听失败")); await running;
    expect(unlisten).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().messages[1]).toMatchObject({ error: true, pending: false });
    expect(session.getSnapshot().loading).toBe(false);
  });

  it("records stream/start errors and ignores late events after account reset", async () => {
    const session = new FileAISession(); mocks.invoke.mockResolvedValue(undefined);
    await session.explain(file);
    const requestId = mocks.invoke.mock.calls[0][1].requestId;
    const late = handlers.get("file_ai_chat://done")!;
    handlers.get("file_ai_chat://chunk")!({ payload: { request_id: requestId, chunk: "已生成的部分回复" } });
    handlers.get("file_ai_chat://error")!({ payload: { request_id: requestId, error: "流中断" } });
    expect(session.getSnapshot().messages[1]).toMatchObject({ error: true, pending: false });
    expect(session.getSnapshot().messages[1].content).toContain("已生成的部分回复");
    mocks.invoke.mockRejectedValue(new Error("启动失败"));
    await session.explain(file);
    expect(session.getSnapshot().loading).toBe(false);
    expect(session.getSnapshot().messages[3].content).toContain("启动失败");
    session.reset(); late({ payload: { request_id: requestId, content: "旧回复" } });
    expect(session.getSnapshot().messages).toEqual([]);
  });

  it("releases delayed listener registrations if reset occurs before startup", async () => {
    const session = new FileAISession(); const registration = deferred<() => void>(); const unlisten = vi.fn();
    mocks.listen.mockReturnValue(registration.promise);
    const running = session.explain(file);
    session.reset(); registration.resolve(unlisten); await running;
    expect(unlisten).toHaveBeenCalledTimes(3);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("video summary lifetime", () => {
  it("defaults topic generation off without losing summary scope or changing saved topics", async () => {
    const { videoTopicIndex, readVideoTopics } = await import("./video_topics");
    await videoTopicIndex.forAccount("Default").set("canvas:a", { topic: "已有主题", sourceHash: "old", policy: "v7" });
    mocks.invoke.mockImplementation(async (command) => command === "prepare_video_material" ? material
      : '总结正文。<video-topics>[{"key":"canvas:a","topic":"不应保存"}]</video-topics>');
    const session = new VideoSummarySession();
    await session.start({ ...request, generateTopics: undefined });
    const chat = mocks.invoke.mock.calls.find(([command]) => command === "chat_video_materials")![1];
    expect(chat.messages[0].content).toContain("canvas:a");
    expect(chat.messages[0].content).not.toContain("video-topics");
    expect(await readVideoTopics("Default")).toEqual({ "canvas:a": "已有主题" });
    const messages = session.getSnapshot().messages;
    expect(messages[messages.length - 1]?.content).toBe("总结正文。");
    expect(session.getSnapshot().cacheEntry?.generateTopics).toBe(false);
  });

  it.each([
    { known: ["a"], firstTopic: "替换第一节主题", secondTopic: "第二节主题" },
    { known: ["a", "b"], firstTopic: "替换第一节主题", secondTopic: "第二节主题" },
    { known: [], firstTopic: "替换第一节主题", secondTopic: "第二节主题" },
  ])("summarizes both available sections regardless of existing topics ($known)", async ({ known, firstTopic, secondTopic }) => {
    const { readVideoTopics, videoTopicIndex } = await import("./video_topics");
    for (const key of known) await videoTopicIndex.forAccount("Default").set(`canvas:${key}`, { topic: key === "a" ? "第一节已有主题" : "第二节已有主题", sourceHash: "old", policy: "v7" });
    const first = { ...scopes[0].videos[0], courseBeginTime: "2026-10-30 13:55:00" };
    const second = { ...first, videoId: "b", courseBeginTime: "2026-10-30 14:50:20" };
    mocks.invoke.mockImplementation(async (command, args) => command === "prepare_video_material"
      ? { ...material, text: args.request.key === "a" ? "第一节课堂内容" : "第二节课堂内容" }
      : '两节总结。<video-topics>[{"key":"canvas:a","topic":"替换第一节主题"},{"key":"canvas:b","topic":"第二节主题"}]</video-topics>');
    const session = new VideoSummarySession();
    await session.start({ ...request, scopes: [{ ...scopes[0], videos: [first, second] }] });
    const chat = mocks.invoke.mock.calls.find(([command]) => command === "chat_video_materials")![1];
    for (const expected of ["canvas:a", "canvas:b", "2026-10-30 13:55:00", "2026-10-30 14:50:20"]) {
      expect(chat.messages[0].content).toContain(expected);
    }
    expect(chat.text).toContain("第一节课堂内容");
    expect(chat.text).toContain("第二节课堂内容");
    expect(await readVideoTopics("Default")).toEqual({ "canvas:a": firstTopic, "canvas:b": secondTopic });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "chat_video_materials")).toHaveLength(1);
  });

  it("keeps per-section failures out of classroom evidence and only assigns topics to available material", async () => {
    const second = { ...scopes[0].videos[0], videoId: "b", courseBeginTime: "2026-10-08 08:55" };
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "prepare_video_material") return args.request.key === "a" ? material
        : { ...material, key: "canvas:b", text: "", srt: "", subtitleAvailable: false, warnings: ["private technical failure"] };
      if (command === "transcribe_video_material") throw new Error("audio request failed");
      return '总结正文。<video-topics>[{"key":"canvas:a","topic":"CNN：池化"},{"key":"canvas:b","topic":"不应猜测的主题"}]</video-topics>';
    });
    const session = new VideoSummarySession();
    await session.start({ ...request, scopes: [{ ...scopes[0], videos: [scopes[0].videos[0], second] }] });
    const state = session.getSnapshot();
    expect(state.coverage).toBe("已覆盖 1 / 2 小节");
    expect(state.sources?.map((item) => item.included)).toEqual([true, false]);
    expect(state.text).not.toContain("private technical failure");
    expect(state.text).not.toContain("audio request failed");
    expect(state.messages[0].content).toBe("总结所选 2 小节");
    const { readVideoTopics } = await import("./video_topics");
    expect(await readVideoTopics("Default")).toEqual({ "canvas:a": "CNN：池化" });
    expect(state.cacheEntry?.sources).toEqual(state.sources);
  });

  it("overwrites an existing topic when generation is enabled", async () => {
    const { readVideoTopics, videoTopicIndex } = await import("./video_topics");
    await videoTopicIndex.forAccount("Default").set("canvas:a", { topic: "CNN：输出尺寸、池化", sourceHash: "original", policy: "v7" });
    mocks.invoke.mockImplementation(async (command) => command === "prepare_video_material" ? material
      : '总结正文。<video-topics>[{"key":"canvas:a","topic":"替换主题"}]</video-topics>');
    await new VideoSummarySession().start(request);
    expect(await readVideoTopics("Default")).toEqual({ "canvas:a": "替换主题" });
    const chat = mocks.invoke.mock.calls.find(([command]) => command === "chat_video_materials")![1];
    expect(chat.messages[0].content).toContain("video-topics");
  });

  it("updates a topic created while the summary request was in flight when generation is enabled", async () => {
    const { readVideoTopics, videoTopicIndex } = await import("./video_topics");
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "prepare_video_material") return material;
      await videoTopicIndex.forAccount("Default").set("canvas:a", { topic: "LR：分析、项目集", sourceHash: "proofread", policy: "v7" });
      return '总结正文。<video-topics>[{"key":"canvas:a","topic":"替换主题"}]</video-topics>';
    });
    await new VideoSummarySession().start(request);
    expect(await readVideoTopics("Default")).toEqual({ "canvas:a": "替换主题" });
  });
  it("generates section topics in the summary request, persists them and hides metadata from chat", async () => {
    const { readVideoTopics } = await import("./video_topics");
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "prepare_video_material") return material;
      args.onChunk.onmessage("总结正文。\n<video-to");
      args.onChunk.onmessage('pics>[{"key":"canvas:a","topic":"语法分析"}]</video-topics>');
      return '总结正文。\n<video-topics>[{"key":"canvas:a","topic":"语法分析"}]</video-topics>';
    });
    const session = new VideoSummarySession();
    await session.start(request);
    expect(session.getSnapshot().messages[session.getSnapshot().messages.length - 1]?.content).toBe("总结正文。");
    expect(await readVideoTopics("Default")).toEqual({ "canvas:a": "语法分析" });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "chat_video_materials")).toHaveLength(1);
    expect(session.getSnapshot().cacheEntry?.messages[session.getSnapshot().cacheEntry!.messages.length - 1]?.content).not.toContain("video-topics");
  });
  it("only starts transcription when enabled and retains that preference in history", async () => {
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "prepare_video_material") return { ...material, srt: "", subtitleAvailable: false, text: "PPT 内容", ocrAvailable: true };
      if (command === "transcribe_video_material") return { ...material, srt: "", subtitleAvailable: false, transcriptAvailable: true, text: "补齐的转录" };
      return "总结";
    });
    const session = new VideoSummarySession();
    await session.start({ ...request, transcribeMissing: false });
    expect(mocks.invoke.mock.calls.some(([command]) => command === "transcribe_video_material")).toBe(false);
    expect(session.getSnapshot().cacheEntry?.transcribeMissing).toBe(false);
    const restored = new VideoSummarySession(); restored.restore(session.getSnapshot().cacheEntry!);
    expect(restored.getSnapshot().transcribeMissing).toBe(false);
    await session.start({ ...request, transcribeMissing: true });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "transcribe_video_material")).toHaveLength(1);
    expect(session.getSnapshot().text).toContain("补齐的转录");
    expect((await readSummaryCache())).toHaveLength(2);
  });

  it("uses previously saved untimed text even when new transcription is disabled", async () => {
    mocks.invoke.mockImplementation(async (command) => command === "prepare_video_material"
      ? { ...material, srt: "", subtitleAvailable: false, transcriptAvailable: true, text: "本地保存的转录" } : "总结");
    const session = new VideoSummarySession();
    await session.start({ ...request, transcribeMissing: false });
    expect(session.getSnapshot().text).toContain("本地保存的转录");
    expect(mocks.invoke.mock.calls.some(([command]) => command === "transcribe_video_material")).toBe(false);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "chat_video_materials")).toBe(true);
  });
  it("summarizes available subtitles directly without a separate proofreading call", async () => {
    mocks.invoke.mockImplementation(async (command) => command === "prepare_video_material"
      ? { ...material, subtitleSource: "canvas", text: "有识别错误的原始字幕与 PPT OCR" } : "结合上下文的总结");
    const session = new VideoSummarySession();
    await session.start(request);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "proofread_video_subtitles")).toBe(false);
    expect(session.getSnapshot().text).toContain("有识别错误的原始字幕与 PPT OCR");
    expect(mocks.invoke.mock.calls.some(([command]) => command === "chat_video_materials")).toBe(true);
  });
  it("does not summarize a caption track whose entire text was excluded, but can still use PPT evidence", async () => {
    mocks.invoke.mockResolvedValue({ ...material, text: "## 课堂", summarySubtitleAvailable: false });
    const session = new VideoSummarySession();
    await session.start(request);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "chat_video_materials")).toBe(false);
    const messages = session.getSnapshot().messages;
    expect(messages[messages.length - 1]?.content).toContain("均无可用字幕");
    mocks.invoke.mockImplementation(async (command) => command === "prepare_video_material"
      ? { ...material, text: "PPT 教学资料", summarySubtitleAvailable: false, ocrAvailable: true }
      : "根据 PPT 总结");
    await session.start({ ...request, force: true });
    const args = mocks.invoke.mock.calls.find(([command]) => command === "chat_video_materials")![1];
    expect(args.text).toContain("PPT 教学资料");
  });

  it("refreshes materials from an older PPT cleanup policy and reuses only the current policy", async () => {
    const options = videoSummaryOptions();
    await writeSummaryCache({ key: summaryCacheKey(request.namespace, scopes, request.organization, options),
      namespace: request.namespace, scopes, organization: request.organization, title: "旧总结",
      text: "旧版清理后的资料", messages: [], coverage: "1/1", savedAt: "2026-01-01T00:00:00Z" });
    mocks.invoke.mockImplementation(async (command) => command === "prepare_video_material" ? material : "新总结");
    const session = new VideoSummarySession();
    await session.start(request);
    expect(session.getSnapshot().namespace).toBe(`account:course:${PPT_CLEANUP_POLICY}=0`);
    expect(session.getSnapshot().text).toContain(material.text);
    expect(session.getSnapshot().text).not.toContain("旧版清理后的资料");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material")).toHaveLength(1);
    const count = mocks.invoke.mock.calls.length;
    await session.start(request);
    expect(mocks.invoke.mock.calls).toHaveLength(count);
    await session.start({ ...request, cleanUpPpt: true });
    expect(mocks.invoke).toHaveBeenCalledWith("prepare_video_material", expect.objectContaining({ cleanUpPpt: true }));
    expect(session.getSnapshot().namespace).toBe(`account:course:${PPT_CLEANUP_POLICY}=1`);
  });

  it("snapshots preferences, restores prepared notes for follow-ups, and bypasses caches when preferences change", async () => {
    const options = { ...videoSummaryOptions(), prompt: "详细推导公式" };
    const prepared = { sourceHash: "source", text: "压缩课堂笔记" };
    mocks.invoke.mockImplementation(async (command) => command === "prepare_video_material" ? material : { content: "总结正文", preparedContext: prepared });
    const session = new VideoSummarySession();
    await session.start({ ...request, summaryOptions: options });
    const firstArgs = mocks.invoke.mock.calls.find(([command]) => command === "chat_video_materials")![1];
    expect(firstArgs.options).toEqual(options);
    expect(firstArgs.messages[0].content).toContain("详细推导公式");
    expect(firstArgs.text).toContain(material.text);
    const cache = (await readSummaryCache())[0];
    expect(cache.preparedContext).toEqual(prepared);
    const restored = new VideoSummarySession(); restored.restore(cache);
    await restored.send("继续解释这个条件");
    const followup = mocks.invoke.mock.calls[mocks.invoke.mock.calls.length - 1][1];
    expect(followup.options).toEqual(options);
    expect(followup.preparedContext).toEqual(prepared);
    expect(followup.text).toBe(cache.text);
    expect(followup.messages.at(-1)).toEqual({ role: "user", content: "继续解释这个条件" });
    const calls = mocks.invoke.mock.calls.length;
    await session.start({ ...request, summaryOptions: { ...options, prompt: "只列考试重点" } });
    expect(mocks.invoke.mock.calls.length).toBeGreaterThan(calls);
    expect(await readSummaryCache()).toHaveLength(2);
    expect(session.getSnapshot().preparedContext).toEqual(prepared);
  });
  it("continues preparation and streaming while unmounted, caches the result and reuses context", async () => {
    const session = new VideoSummarySession(); const preparation = deferred<typeof material>(); const answer = deferred<string>();
    mocks.invoke.mockImplementation((command) => command === "prepare_video_material" ? preparation.promise : answer.promise);
    const view = renderHook(() => useAISession(session));
    let running!: Promise<void>;
    act(() => { running = session.start(request); }); view.unmount();
    preparation.resolve(material);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("chat_video_materials", expect.anything()));
    const args = mocks.invoke.mock.calls[1][1];
    args.onStatus.onmessage("正在思考"); args.onChunk.onmessage("一部分");
    const returned = renderHook(() => useAISession(session));
    expect(returned.result.current.messages[1].content).toContain("一部分");
    expect(returned.result.current.loading).toBe(true); returned.unmount();
    answer.resolve("完整总结"); await running;
    expect(session.getSnapshot().loading).toBe(false);
    expect((await readSummaryCache())[0].messages[1].content).toContain("完整总结");
    mocks.invoke.mockResolvedValue("追问回复"); await session.send("继续解释");
    expect(mocks.invoke.mock.calls[2][1].text).toBe(args.text);
    expect((await readSummaryCache())[0].messages[3].content).toBe("追问回复");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "prepare_video_material")).toHaveLength(1);
  });

  it("does not continue preparation or write a stale cache after reset", async () => {
    const session = new VideoSummarySession(); const preparation = deferred<typeof material>();
    mocks.invoke.mockReturnValue(preparation.promise);
    const running = session.start(request); session.reset(); preparation.resolve(material); await running;
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(session.getSnapshot().messages).toEqual([]);
    expect(await readSummaryCache()).toEqual([]);
  });

  it("retains a failed reply without caching it and allows another request", async () => {
    const session = new VideoSummarySession();
    mocks.invoke.mockImplementation((command) => command === "prepare_video_material" ? Promise.resolve(material) : Promise.reject(new Error("模型不可用")));
    await session.start(request);
    expect(session.getSnapshot().loading).toBe(false);
    expect(session.getSnapshot().messages[1]).toMatchObject({ error: true });
    expect(await readSummaryCache()).toEqual([]);
    mocks.invoke.mockResolvedValue("重试成功"); await session.send("请重试");
    expect(session.getSnapshot().messages[3].content).toBe("重试成功");
  });
});
