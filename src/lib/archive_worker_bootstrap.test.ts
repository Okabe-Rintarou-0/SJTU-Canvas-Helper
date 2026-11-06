// @vitest-environment node
import { expect, it, vi } from "vitest";
import { ARCHIVE_BOOTSTRAP_ERROR, ARCHIVE_BOOTSTRAP_READY, bootstrapArchiveWorker } from "./archive_worker_bootstrap";

function setup(load: () => Promise<unknown>) {
  let rejection!: (event: PromiseRejectionEvent) => void;
  const scope = {
    addEventListener: vi.fn((_type: "unhandledrejection", listener: typeof rejection) => { rejection = listener; }),
    postMessage: vi.fn(),
  };
  bootstrapArchiveWorker(scope, load);
  return { scope, reject(reason: unknown) {
    const event = { reason, preventDefault: vi.fn() };
    rejection(event as unknown as PromiseRejectionEvent);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  } };
}
async function flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

it("installs the rejection handler before loading and only signals readiness after import", async () => {
  let done!: () => void;
  const load = vi.fn(() => new Promise<void>((resolve) => { done = resolve; }));
  const { scope } = setup(load);
  expect(scope.addEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  expect(load).not.toHaveBeenCalled();
  await flush();
  expect(load).toHaveBeenCalledOnce();
  expect(scope.postMessage).not.toHaveBeenCalled();
  done(); await flush();
  expect(scope.postMessage.mock.calls).toEqual([[{ type: ARCHIVE_BOOTSTRAP_READY }]]);
});

it.each(["throw", "reject"])("forwards an import %s as a fatal bootstrap error", async (mode) => {
  const error = new Error("Module failed");
  const { scope } = setup(() => { if (mode === "throw") throw error; return Promise.reject(error); });
  await flush();
  expect(scope.postMessage.mock.calls).toEqual([[{ type: ARCHIVE_BOOTSTRAP_ERROR, message: "Module failed" }]]);
});

it("forwards a vendor's otherwise unreturned rejection after readiness exactly once", async () => {
  const { scope, reject } = setup(async () => undefined);
  await flush();
  reject(new Error("Asynchronous open failed"));
  reject(new Error("Another failure"));
  expect(scope.postMessage.mock.calls).toEqual([
    [{ type: ARCHIVE_BOOTSTRAP_READY }],
    [{ type: ARCHIVE_BOOTSTRAP_ERROR, message: "Asynchronous open failed" }],
  ]);
});

it("does not announce readiness after a failure during import", async () => {
  let done!: () => void;
  const { scope, reject } = setup(() => new Promise<void>((resolve) => { done = resolve; }));
  await flush();
  reject("Unexpected failure");
  done(); await flush();
  expect(scope.postMessage.mock.calls).toEqual([[{ type: ARCHIVE_BOOTSTRAP_ERROR, message: "Archive worker failed" }]]);
});
