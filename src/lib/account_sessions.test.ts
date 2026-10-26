import { afterEach, expect, it, vi } from "vitest";
import { changeSessionAccount } from "./account_sessions";
import { isAccountTransitioning } from "./account_transition";
import { resetAISessions } from "./ai_sessions";
import { canvasAgentSession } from "./canvas_agent_session";
import { fileAISession } from "./file_ai_session";
import { videoSummarySession } from "./video_summary_session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), releaseWorkspace: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./video_library_tasks", () => ({ recordingRequest: vi.fn() }));
vi.mock("./video_workspace", () => ({ resetVideoWorkspace: mocks.releaseWorkspace }));
afterEach(() => { resetAISessions(); vi.clearAllMocks(); });

it("does not switch/delete accounts while any AI request is still active", async () => {
  const change = vi.fn();
  for (const session of [canvasAgentSession, fileAISession, videoSummarySession]) {
    session.update({ loading: true });
    await expect(changeSessionAccount(change)).rejects.toThrow("AI 请求仍在处理中");
    session.reset();
  }
  expect(change).not.toHaveBeenCalled(); expect(mocks.releaseWorkspace).not.toHaveBeenCalled();
});

it("blocks new requests and duplicate switches, then resets sessions on success", async () => {
  let finish!: () => void;
  canvasAgentSession.update({ input: "草稿" });
  const changing = changeSessionAccount(() => new Promise<void>((resolve) => { finish = resolve; }));
  expect(isAccountTransitioning()).toBe(true);
  await canvasAgentSession.send("不应发送");
  await fileAISession.explain({ id: 1 } as never);
  expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.listen).not.toHaveBeenCalled();
  await expect(changeSessionAccount(vi.fn())).rejects.toThrow("账号正在切换");
  finish(); await changing;
  expect(isAccountTransitioning()).toBe(false);
  expect(canvasAgentSession.getSnapshot().input).toBe("");
  expect(mocks.releaseWorkspace).toHaveBeenCalledOnce();
});

it("keeps old sessions and playback when switching fails, and unlocks retry", async () => {
  canvasAgentSession.update({ input: "保留草稿" });
  await expect(changeSessionAccount(() => Promise.reject(new Error("切换失败")))).rejects.toThrow("切换失败");
  expect(isAccountTransitioning()).toBe(false);
  expect(canvasAgentSession.getSnapshot().input).toBe("保留草稿");
  expect(mocks.releaseWorkspace).not.toHaveBeenCalled();
  await changeSessionAccount(() => Promise.resolve());
  expect(mocks.releaseWorkspace).toHaveBeenCalledOnce();
});


it("reconciles after a rejected attempted transition before releasing its lock", async () => {
  const failure = new Error("switch rejected");
  const reconcile = vi.fn(async () => { expect(isAccountTransitioning()).toBe(true); });
  await expect(changeSessionAccount(async () => {throw failure;}, reconcile)).rejects.toBe(failure);
  expect(reconcile).toHaveBeenCalledOnce();
  expect(isAccountTransitioning()).toBe(false);
});

it("does not reconcile when a busy session prevents the transition from starting", async () => {
  canvasAgentSession.update({loading: true}); const reconcile = vi.fn(async () => {});
  await expect(changeSessionAccount(vi.fn(), reconcile)).rejects.toThrow("AI 请求仍在处理中");
  expect(reconcile).not.toHaveBeenCalled();
});
