import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen: mocks.listen }) }));

describe("task event lifetime", () => {
  beforeEach(() => { vi.resetModules(); mocks.listen.mockReset(); });

  it("registers all event listeners before invoking commands and shares one registration", async () => {
    const releases: Array<() => void> = [];
    mocks.listen.mockImplementation(() => new Promise((resolve) => releases.push(() => resolve(vi.fn()))));
    const { enqueueTask } = await import("./task_runtime");
    const { taskManager } = await import("./task_manager");
    const run = vi.fn(async () => {});
    enqueueTask({ id: "one", name: "one", source: "files", kind: "file", run });
    enqueueTask({ id: "two", name: "two", source: "files", kind: "file", run });
    expect(mocks.listen).toHaveBeenCalledTimes(5);
    expect(mocks.listen).toHaveBeenCalledWith("file_upload://progress", expect.any(Function));
    expect(run).not.toHaveBeenCalled();
    releases.forEach((release) => release());
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(taskManager.getSnapshot().every((task) => task.status === "succeeded")).toBe(true);
  });

  it("cleans partial subscriptions after failure and can register again on retry", async () => {
    const cleanup = vi.fn();
    mocks.listen.mockResolvedValue(cleanup).mockRejectedValueOnce(new Error("listener unavailable"));
    const { ensureTaskEvents } = await import("./task_runtime");
    await expect(ensureTaskEvents()).rejects.toThrow("listener unavailable");
    expect(cleanup).toHaveBeenCalledTimes(4);
    await ensureTaskEvents();
    expect(mocks.listen).toHaveBeenCalledTimes(10);
  });
});
