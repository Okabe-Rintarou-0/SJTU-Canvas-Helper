import { Archive } from "libarchive.js";
import { createArchiveClient } from "./archive_client";
import { ARCHIVE_BOOTSTRAP_ERROR, ARCHIVE_BOOTSTRAP_READY } from "./archive_worker_bootstrap";

export interface ArchiveFile {
  name: string;
  size: number;
  extract(): Promise<File>;
}
export interface ArchiveTree { [name: string]: ArchiveTree | ArchiveFile }
export interface OpenArchive {
  getFilesObject(): Promise<ArchiveTree>;
  close(): void;
}

/** Own the worker before readiness/open callbacks, including never-ready workers. */
export function openArchive(file: File, signal?: AbortSignal): Promise<OpenArchive> {
  return createArchiveOperation({ file }, signal);
}

function createArchiveOperation(source: { file?: File }, signal?: AbortSignal): Promise<OpenArchive> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Archive closed")); return; }
    let worker: Worker | undefined = new Worker(new URL("./archive_worker.ts", import.meta.url), { type: "module" });
    let reader: Awaited<ReturnType<typeof Archive.open>> | undefined;
    let failure: Error | undefined;
    let started = false;
    const pending = new Set<(error: Error) => void>();
    const entries = new Set<{ current?: ArchiveFile }>();
    const closeReader = (value: NonNullable<typeof reader>, fallback?: Worker) => {
      try { void value.close().catch(() => fallback?.terminate()); }
      catch { fallback?.terminate(); }
    };
    const stop = (reason: unknown) => {
      if (failure) return;
      failure = reason instanceof Error ? reason : new Error(String(reason));
      signal?.removeEventListener("abort", abort);
      const ownedWorker = worker;
      worker = undefined;
      ownedWorker?.removeEventListener("error", workerError);
      ownedWorker?.removeEventListener("messageerror", messageError);
      ownedWorker?.removeEventListener("message", workerMessage);
      const opened = reader;
      reader = undefined;
      source.file = undefined;
      for (const entry of entries) entry.current = undefined;
      entries.clear();
      if (opened) closeReader(opened, ownedWorker);
      else ownedWorker?.terminate();
      reject(failure);
      for (const cancel of pending) cancel(failure);
      pending.clear();
    };
    const abort = () => stop(new Error("Archive closed"));
    const workerError = (event: ErrorEvent) => stop(new Error(event.message || "Archive worker failed"));
    const messageError = () => stop(new Error("Archive worker message failed"));
    worker.addEventListener("error", workerError);
    worker.addEventListener("messageerror", messageError);
    signal?.addEventListener("abort", abort, { once: true });

    const run = <T>(operation: () => Promise<T>): Promise<T> => new Promise((done, failed) => {
      if (failure) { failed(failure); return; }
      pending.add(failed);
      void Promise.resolve().then(() => {
        if (failure) throw failure;
        return operation();
      }).then((value) => {
        pending.delete(failed);
        if (failure) failed(failure);
        else done(value);
      }, (error: unknown) => {
        pending.delete(failed);
        stop(error);
        failed(failure);
      });
    });
    const protectEntry = (holder: { current?: ArchiveFile }, name: string, size: number): ArchiveFile => ({
      name, size, extract: () => run(() => {
        if (!holder.current) throw new Error("Archive closed");
        return holder.current.extract();
      }),
    });
    const protectEntries = (root: ArchiveTree): ArchiveTree => {
      const result: ArchiveTree = Object.create(null);
      const queue: [ArchiveTree, ArchiveTree][] = [[root, result]];
      for (let index = 0; index < queue.length; index += 1) {
        const [source, target] = queue[index];
        for (const [name, entry] of Object.entries(source)) {
          if (typeof entry.extract === "function") {
            const file = entry as ArchiveFile;
            const holder = { current: file as ArchiveFile | undefined };
            entries.add(holder);
            target[name] = protectEntry(holder, file.name, file.size);
          } else {
            const directory: ArchiveTree = Object.create(null);
            target[name] = directory;
            queue.push([entry as ArchiveTree, directory]);
          }
        }
      }
      return result;
    };

    const facade: OpenArchive = {
      getFilesObject: () => run(async () => {
        const opened = reader;
        if (!opened) throw new Error("Archive closed");
        const tree = await opened.getFilesObject() as ArchiveTree;
        if (failure) throw failure;
        return protectEntries(tree);
      }),
      close: abort,
    };
    const acceptOpened = (opened: NonNullable<typeof reader>) => {
      if (failure) { closeReader(opened); return; }
      reader = opened;
      resolve(facade);
    };
    const start = () => {
      const ownedWorker = worker;
      if (failure || started || !ownedWorker || !source.file) return;
      started = true;
      // 2.0.2 acquires both hooks synchronously before its first await. Remove
      // the global references immediately so closed archives are not retained.
      try {
        Archive.init({ getWorker: () => ownedWorker, createClient: (endpoint: Worker) => createArchiveClient(endpoint, stop) });
        void Archive.open(source.file).then(acceptOpened, stop);
      } catch (error: unknown) { stop(error); }
      finally { source.file = undefined; Archive.init(); }
    };
    function workerMessage(event: MessageEvent<unknown>) {
      const message = event.data;
      if (!message || typeof message !== "object" || !("type" in message)) return;
      if (message.type === ARCHIVE_BOOTSTRAP_READY) start();
      else if (message.type === ARCHIVE_BOOTSTRAP_ERROR) {
        stop(new Error("message" in message && typeof message.message === "string"
          ? message.message : "Archive worker failed"));
      }
    }
    worker.addEventListener("message", workerMessage);
  });
}
