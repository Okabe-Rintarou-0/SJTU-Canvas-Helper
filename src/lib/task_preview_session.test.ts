import { expect, it, vi } from "vitest";
import { TaskManager, type TaskSpec } from "./task_manager";
import { currentSession, invalidateSession } from "./session";
vi.mock("./diagnostics", () => ({ logDiagnostic: vi.fn() }));
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const spec = (run: TaskSpec["run"]): TaskSpec => ({ id: "result", name: "result.pdf", source: "files", kind: "pdf-merge", run });
it("keeps the original result owner when a task completes after invalidation", async () => {
  const manager = new TaskManager(); const owner = currentSession();
  let finish!: () => void;
  manager.enqueue(spec(async ({ update }) => { await new Promise<void>((resolve) => { finish = resolve; }); update({ result: { name: "result.pdf", url: "blob:result" } }); }));
  invalidateSession(); finish(); await flush();
  expect(manager.getSnapshot()[0]).toMatchObject({ ownerSession: owner, status: "succeeded", result: { url: "blob:result" } });
  expect(manager.getSnapshot()[0].ownerSession).not.toBe(currentSession());
});
it("preserves result ownership on retry but assigns explicit resubmission its new owner", async () => {
  const manager = new TaskManager(); const owner = currentSession();
  manager.enqueue(spec(async () => { throw new Error("offline"); })); await flush();
  invalidateSession(); manager.retry("result"); await flush();
  expect(manager.getSnapshot()[0].ownerSession).toBe(owner);
  manager.enqueue(spec(async ({ update }) => { update({ result: { name: "new.pdf", url: "blob:new" } }); })); await flush();
  expect(manager.getSnapshot()[0]).toMatchObject({ ownerSession: currentSession(), status: "succeeded", result: { url: "blob:new" } });
});
