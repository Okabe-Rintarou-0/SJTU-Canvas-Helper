export const ARCHIVE_BOOTSTRAP_READY = "canvas-archive-bootstrap-ready";
export const ARCHIVE_BOOTSTRAP_ERROR = "canvas-archive-bootstrap-error";

interface WorkerScope {
  addEventListener(type: "unhandledrejection", listener: (event: PromiseRejectionEvent) => void): void;
  postMessage(message: unknown): void;
}

/** Forward failures ignored inside the upstream worker's async methods. */
export function bootstrapArchiveWorker(scope: WorkerScope, load: () => Promise<unknown>) {
  let failed = false;
  const fail = (reason: unknown) => {
    if (failed) return;
    failed = true;
    scope.postMessage({ type: ARCHIVE_BOOTSTRAP_ERROR,
      message: reason instanceof Error ? reason.message : "Archive worker failed" });
  };
  scope.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    fail(event.reason);
  });
  void Promise.resolve().then(load).then(() => {
    // Comlink's expose listener is now installed. Do not send CONSTRUCT earlier.
    if (!failed) scope.postMessage({ type: ARCHIVE_BOOTSTRAP_READY });
  }, fail);
}
