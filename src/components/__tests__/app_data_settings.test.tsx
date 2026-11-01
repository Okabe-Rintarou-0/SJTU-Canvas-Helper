import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AppDataSettings from "../app_data_settings";
import { createDataMock } from "../../test/app_data_mock";
import { defineDataCollection } from "../../lib/app_data";
import { writeSummaryCache, readSummaryCache, type VideoSummaryCache } from "../../lib/video_summary_cache";
import type { CanvasVideo } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), update: vi.fn(), clear: vi.fn(), summary: { loading: false, cacheEntry: undefined as VideoSummaryCache | undefined } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../lib/video_summary_session", () => ({ videoSummarySession: { update: mocks.update, clearMaterials: mocks.clear } }));
vi.mock("../../lib/ai_session_store", () => ({ useAISession: () => mocks.summary }));
const data = createDataMock();
const entry: VideoSummaryCache = {
  key: "summary", namespace: "legacy-test", title: "测试总结", text: "原始上下文", coverage: "1/1", organization: "combined", savedAt: "2026-10-29T00:00:00Z",
  scopes: [{ id: "day", title: "课堂（部分小节）", videos: [{ source: "canvas", videoId: "b", videoName: "第二小节录像", playable: true, courseBeginTime: "2026-09-28 08:55", courseEndTime: "2026-09-28 09:40" } as CanvasVideo] }],
  messages: [{ id: "m", role: "assistant", content: "完整总结正文", createdAt: "2026-10-29T00:00:00Z" }],
};
const state = defineDataCollection({ category: "state", name: "positions", version: 1, validate: (v: unknown): v is number => typeof v === "number" }).forAccount("Default");

beforeEach(async () => {
  vi.clearAllMocks(); data.reset(); localStorage.clear(); mocks.summary.loading = false; mocks.summary.cacheEntry = undefined;
  mocks.invoke.mockImplementation(async (command, args) => command === "read_account_info" ? { current_account: "Default" } : data.invoke(args));
  await writeSummaryCache(entry); await state.set("video", 100);
});
afterEach(cleanup);

it("previews and deletes a saved summary only after explicit confirmation", async () => {
  mocks.summary.cacheEntry = entry;
  render(<AppDataSettings active />);
  await screen.findByText("测试总结");
  fireEvent.click(screen.getByRole("button", { name: "管理已保存的 AI 内容" }));
  expect(screen.getByText("第二小节录像")).toBeVisible();
  expect(screen.getByText("2026-09-28 08:55 — 2026-09-28 09:40")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看" }));
  expect(await screen.findByText("完整总结正文")).toBeVisible();
  expect(within(screen.getByRole("dialog")).getByText("第二小节录像")).toBeVisible();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
  expect(await readSummaryCache()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "确认操作" }));
  await screen.findByText("操作已完成。");
  expect(await readSummaryCache()).toEqual([]);
  expect(await state.get("video")).toBe(100);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ cacheEntry: undefined }));
});

it("keeps saved history and playback-shaped state when clearing caches", async () => {
  render(<AppDataSettings active />);
  fireEvent.click(await screen.findByRole("button", { name: "清理缓存" }));
  fireEvent.click(screen.getByRole("button", { name: "确认操作" }));
  await screen.findByText("操作已完成。");
  expect(await readSummaryCache()).toHaveLength(1);
  expect(await state.get("video")).toBe(100);
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(data.calls.some(({ request }) => request.op === "clear" && request.category === "cache")).toBe(true);
});

it("confirms relocation, reports the retained source, and handles folder cancellation", async () => {
  render(<AppDataSettings active />);
  const choose = await screen.findByRole("button", { name: "选择应用数据目录" });
  const apply = screen.getByRole("button", { name: "应用并迁移" });
  mocks.open.mockResolvedValueOnce(null);
  fireEvent.click(choose);
  await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  expect(data.calls.some(({ request }) => request.op === "relocate")).toBe(false);
  fireEvent.change(screen.getByLabelText("应用数据保存目录"), { target: { value: "D:\\手动目录" } });
  fireEvent.click(apply);
  await screen.findByRole("dialog");
  expect(data.calls.some(({ request }) => request.op === "relocate")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  mocks.open.mockResolvedValueOnce("D:\\新目录");
  fireEvent.click(choose);
  await waitFor(() => expect(screen.getByLabelText("应用数据保存目录")).toHaveValue("D:\\新目录"));
  expect(data.calls.some(({ request }) => request.op === "relocate")).toBe(false);
  fireEvent.click(apply);
  await screen.findByRole("dialog");
  expect(data.calls.some(({ request }) => request.op === "relocate")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "确认操作" }));
  expect(await screen.findByText(/原目录保留为副本，可确认后自行删除/)).toBeVisible();
  expect(data.calls).toContainEqual({ account: "Default", request: { op: "relocate", directory: "D:\\新目录" } });
});

it("keeps the data folder accessible when legacy history is corrupt", async () => {
  localStorage.setItem("video-material-summaries-v7", "{bad json");
  render(<AppDataSettings active />);
  expect(await screen.findByText(/旧视频总结数据损坏/)).toBeVisible();
  expect(screen.getByRole("button", { name: "打开应用数据目录" })).toBeEnabled();
});

it("blocks destructive management while a summary is generating", async () => {
  mocks.summary.loading = true;
  render(<AppDataSettings active />);
  expect(await screen.findByRole("button", { name: "应用并迁移" })).toBeDisabled();
  expect(screen.getByLabelText("应用数据保存目录")).toBeDisabled();
  expect(screen.getByRole("button", { name: "清理缓存" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "管理已保存的 AI 内容" }));
  expect(screen.getByRole("button", { name: "删除全部 AI 内容" })).toBeDisabled();
  expect(screen.queryByText("使用状态")).not.toBeInTheDocument();
});
