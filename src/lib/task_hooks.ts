import { useMemo, useSyncExternalStore } from "react";
import { taskManager, type TaskKind, type TaskSource } from "./task_manager";
import type { DownloadTask, FileDownloadTask, VideoDownloadTask } from "./model";

export function useTasks() {
  return useSyncExternalStore(taskManager.subscribe, taskManager.getSnapshot);
}

export function useLegacyTasks<T extends FileDownloadTask | VideoDownloadTask | DownloadTask>(source: TaskSource, kinds: TaskKind[]) {
  const tasks = useTasks();
  const kindKey = kinds.join(",");
  return useMemo(() => tasks.filter((task) => task.source === source && kindKey.split(",").includes(task.kind) && task.data).map((task) => ({
    ...(task.data as T), key: task.id, progress: task.progress ?? 0,
    state: task.status === "queued" ? "queued" : task.status === "failed" ? "fail" : task.status === "succeeded" ? (task.kind === "ppt" ? "completed" : "succeed") : task.kind === "upload" || task.kind === "upload-pdf" ? "uploading" : task.kind === "conversion" ? "converting" : task.kind === "ppt" && task.stage === "正在合并 PDF" ? "merging" : "downloading",
  } as T)), [tasks, source, kindKey]);
}
