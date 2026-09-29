export type TaskStatus = "queued" | "running" | "succeeded" | "failed";
export type TaskKind = "file" | "sync" | "conversion" | "upload" | "upload-pdf" | "attachment" | "video" | "ppt" | "subtitle" | "pdf-merge" | "pdf-save" | "video-merge";
export type TaskSource = "files" | "submissions" | "video";
export const taskKindLabels: Record<TaskKind, string> = {
  subtitle: "字幕导出",
  file: "文件下载", sync: "文件同步检查", conversion: "转换为 PDF 并下载", upload: "上传云盘", "upload-pdf": "转换为 PDF 并上传云盘", attachment: "附件下载", video: "视频下载",
  ppt: "PPT 下载与合并", "pdf-merge": "PDF 合并", "pdf-save": "合并结果保存", "video-merge": "视频合成",
};
export const taskSourceLabels: Record<TaskSource, string> = { files: "文件管理", submissions: "提交批改", video: "视频管理" };
export interface Task {
  id: string;
  name: string;
  kind: TaskKind;
  source: TaskSource;
  context?: string;
  outputPath?: string;
  outputDirectory?: string;
  status: TaskStatus;
  stage: string;
  progress?: number;
  error?: string;
  actionError?: string;
  log?: string;
  createdAt: number;
  finishedAt?: number;
  unreadCompletion?: boolean;
  attempt: number;
  data?: unknown;
  result?: { url: string; name: string };
  canOpen: boolean;
  canSave: boolean;
}
export interface TaskContext {
  update: (patch: Partial<Pick<Task, "stage" | "progress" | "log" | "result">>) => void;
  setOpen: (action: () => Promise<unknown>) => void;
  setSave: (action: () => Promise<unknown>) => void;
}
export interface TaskSpec {
  id: string;
  name: string;
  kind: TaskKind;
  source: TaskSource;
  context?: string;
  outputPath?: string;
  outputDirectory?: string;
  data?: unknown;
  /** Tasks sharing an event ID or destination must not execute together. */
  locks?: string[];
  event?: { channel: string; id: string };
  stage?: string;
  run: (context: TaskContext) => Promise<unknown>;
  open?: () => Promise<unknown>;
  save?: () => Promise<unknown>;
  dispose?: () => void;
}

export const isTaskActive = (task: Task) => task.status === "queued" || task.status === "running";

/** Session-scoped executor. UI mounts never start, restart or own a job. */
export class TaskManager {
  private tasks: Task[] = [];
  private specs = new Map<string, TaskSpec>();
  private listeners = new Set<() => void>();
  private executing = new Set<string>();
  private actionBusy = new Set<string>();
  private draining = false;
  constructor(private readonly concurrency = 3) {}
  getSnapshot = () => this.tasks;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private emit() { this.listeners.forEach((listener) => listener()); }
  private patch(id: string, patch: Partial<Task>) {
    const current = this.tasks.find((task) => task.id === id);
    if (!current || Object.entries(patch).every(([key, value]) => current[key as keyof Task] === value)) return;
    this.tasks = this.tasks.map((task) => task.id === id ? { ...task, ...patch } : task);
    this.emit();
  }
  enqueue(spec: TaskSpec): string {
    const existing = this.tasks.find((task) => task.id === spec.id);
    if (existing) {
      if (existing.status === "failed") this.retry(existing.id);
      return existing.id;
    }
    this.specs.set(spec.id, spec);
    this.tasks = [...this.tasks, {
      id: spec.id, name: spec.name, kind: spec.kind, source: spec.source,
      context: spec.context, outputPath: spec.outputPath, outputDirectory: spec.outputDirectory, data: spec.data,
      status: "queued", stage: "等待执行", createdAt: Date.now(), attempt: 0,
      canOpen: !!spec.open, canSave: !!spec.save,
    }];
    this.emit();
    this.drain();
    return spec.id;
  }
  retry(id: string) {
    const task = this.tasks.find((item) => item.id === id);
    if (task?.status !== "failed" || this.executing.has(id)) return;
    this.patch(id, { status: "queued", stage: "等待重试", progress: undefined, error: undefined, actionError: undefined, finishedAt: undefined, log: undefined });
    this.drain();
  }
  remove(id: string) {
    const task = this.tasks.find((item) => item.id === id);
    if (!task || isTaskActive(task) || this.executing.has(id) || this.actionBusy.has(id)) return;
    this.specs.get(id)?.dispose?.();
    this.specs.delete(id);
    this.tasks = this.tasks.filter((item) => item.id !== id);
    this.emit();
  }
  markCompletionsRead() {
    if (!this.tasks.some((task) => task.unreadCompletion)) return;
    this.tasks = this.tasks.map((task) => task.unreadCompletion ? { ...task, unreadCompletion: false } : task);
    this.emit();
  }
  async action(id: string, action: "open" | "save") {
    const task = this.tasks.find((item) => item.id === id);
    if (task?.status !== "succeeded" || this.actionBusy.has(id)) return;
    const handler = this.specs.get(id)?.[action];
    if (!handler) return;
    this.actionBusy.add(id);
    this.patch(id, { actionError: undefined });
    try { await handler(); }
    catch (error) { this.patch(id, { actionError: String(error) }); }
    finally { this.actionBusy.delete(id); }
  }
  progress(channel: string, id: string, processed: number, total: number) {
    for (const task of this.tasks) {
      const event = this.specs.get(task.id)?.event;
      if (task.status !== "running" || event?.channel !== channel || event.id !== id) continue;
      const percent = total > 0 && Number.isFinite(processed / total) ? Math.max(0, Math.min(100, Math.floor(processed / total * 100))) : undefined;
      // A transfer reaching 100% is not command completion (PPT still merges).
      this.patch(task.id, {
        progress: task.kind === "ppt" && percent === 100 ? undefined : percent,
        stage: task.kind === "ppt" && percent === 100 ? "正在合并 PDF" : channel === "file_upload://progress" ? "正在上传至云盘" : "正在下载",
      });
    }
  }
  appendVideoLog(text: string) {
    const task = this.tasks.find((item) => item.kind === "video-merge" && item.status === "running");
    if (task) this.patch(task.id, { log: ((task.log ?? "") + text).slice(-64000) });
  }
  private locks(spec: TaskSpec) {
    return [...(spec.locks ?? []), ...(spec.event ? [`event:${spec.event.channel}:${spec.event.id}`] : [])];
  }
  private drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.executing.size < this.concurrency) {
        const occupied = new Set([...this.executing].flatMap((id) => this.locks(this.specs.get(id)!)));
        const task = this.tasks.find((item) => item.status === "queued" && !this.executing.has(item.id) &&
          !this.locks(this.specs.get(item.id)!).some((lock) => occupied.has(lock)));
        if (!task) break;
        this.executing.add(task.id);
        void this.execute(task, this.specs.get(task.id)!);
      }
    } finally { this.draining = false; }
  }
  private async execute(task: Task, spec: TaskSpec) {
    this.patch(task.id, { status: "running", stage: spec.stage ?? "正在处理", attempt: task.attempt + 1 });
    try {
      await spec.run({
        update: (patch) => this.patch(task.id, patch),
        setOpen: (action) => { spec.open = action; this.patch(task.id, { canOpen: true }); },
        setSave: (action) => { spec.save = action; this.patch(task.id, { canSave: true }); },
      });
      this.patch(task.id, { status: "succeeded", stage: "已完成", progress: 100, finishedAt: Date.now(), unreadCompletion: true });
    } catch (error) {
      this.patch(task.id, { status: "failed", stage: "执行失败", error: String(error), finishedAt: Date.now() });
    } finally {
      this.executing.delete(task.id);
      this.drain();
    }
  }
}

export const taskManager = new TaskManager();
