import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { ProgressPayload } from "./model";
import { taskManager, type TaskSpec } from "./task_manager";

let ready: Promise<void> | undefined;
let unlisteners: UnlistenFn[] = [];
export function ensureTaskEvents() {
  if (!ready) ready = (async () => {
    const window = getCurrentWebviewWindow();
    const registrations = await Promise.allSettled([
      ...["download://progress", "file_upload://progress", "video_download://progress", "ppt_download://progress"].map((channel) =>
        // The existing PPT backend reports a zero-based slide index and a basename ID.
        window.listen<ProgressPayload>(channel, ({ payload }) => taskManager.progress(channel, payload.uuid, channel === "ppt_download://progress" ? payload.processed + 1 : payload.processed, payload.total))),
      window.listen<string>("ffmpeg://output", ({ payload }) => taskManager.appendVideoLog(payload)),
    ]);
    unlisteners = registrations.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failed = registrations.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      unlisteners.forEach((unlisten) => unlisten());
      unlisteners = [];
      throw failed.reason;
    }
  })().catch((error) => { ready = undefined; throw error; });
  return ready;
}

export function enqueueTask(spec: TaskSpec) {
  return taskManager.enqueue({ ...spec, run: async (context) => {
    await ensureTaskEvents();
    return spec.run(context);
  } });
}

if (import.meta.hot) import.meta.hot.dispose(() => unlisteners.forEach((unlisten) => unlisten()));
