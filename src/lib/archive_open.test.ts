import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openArchive, type ArchiveFile, type ArchiveTree } from "./archive_open";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  open: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("libarchive.js", () => ({ Archive: { init: mocks.init, open: mocks.open } }));
vi.mock("./archive_client", () => ({ createArchiveClient: mocks.createClient }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
}

type Outcome<T> = { state: "pending" } | { state: "fulfilled"; value: T } | { state: "rejected"; error: unknown };

function observe<T>(promise: Promise<T>) {
  const result: { current: Outcome<T> } = { current: { state: "pending" } };
  void promise.then(
    (value) => { result.current = { state: "fulfilled", value }; },
    (error: unknown) => { result.current = { state: "rejected", error }; },
  );
  return result;
}

// A broken cancellation must fail immediately instead of waiting for a test timeout.
async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function expectRejected<T>(result: { current: Outcome<T> }, message: string) {
  await flushMicrotasks();
  expect(result.current.state).toBe("rejected");
  if (result.current.state === "rejected") {
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe(message);
  }
}

async function expectFulfilled<T>(result: { current: Outcome<T> }): Promise<T> {
  await flushMicrotasks();
  expect(result.current.state).toBe("fulfilled");
  if (result.current.state !== "fulfilled") throw new Error("Promise did not fulfill promptly");
  return result.current.value;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  readonly terminate = vi.fn();
  readonly addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });
  readonly removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    this.listeners.get(type)?.delete(listener);
  });

  constructor(readonly url: URL, readonly options: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  emit(type: "error" | "messageerror" | "message", data?: unknown) {
    const event = type === "message" ? new MessageEvent(type, { data })
      : type === "error" ? new ErrorEvent(type, { message: "Worker crashed" }) : new Event(type);
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  ready() {
    this.emit("message", { type: "canvas-archive-bootstrap-ready" });
  }

  fail(message = "Bootstrap failed") {
    this.emit("message", { type: "canvas-archive-bootstrap-error", message });
  }
}

function makeReader(worker: FakeWorker, tree: ArchiveTree = {}) {
  return {
    getFilesObject: vi.fn<() => Promise<ArchiveTree>>().mockResolvedValue(tree),
    close: vi.fn<() => Promise<void>>().mockImplementation(async () => { worker.terminate(); }),
  };
}

type Reader = ReturnType<typeof makeReader>;
interface Hooks {
  getWorker(): FakeWorker;
  createClient(worker: FakeWorker): object;
}
interface Opening {
  file: File;
  worker: FakeWorker;
  client: object;
  result: ReturnType<typeof deferred<Reader>>;
}

let hooks: Hooks | undefined;
let openings: Opening[];
let clients: { worker: FakeWorker; fail: (reason: unknown) => void; client: object }[];

function inputFile(name = "example.zip") {
  return new File(["archive bytes"], name);
}

function startArchive(file: File, signal?: AbortSignal) {
  const result = openArchive(file, signal);
  FakeWorker.instances[FakeWorker.instances.length - 1].ready();
  return result;
}

async function openReady(tree: ArchiveTree = {}, signal?: AbortSignal) {
  const result = observe(startArchive(inputFile(), signal));
  const opening = openings[openings.length - 1];
  const reader = makeReader(opening.worker, tree);
  opening.result.resolve(reader);
  const archive = await expectFulfilled(result);
  return { archive, reader, worker: opening.worker };
}

function expectWorkerListenersReleased(worker: FakeWorker) {
  for (const type of ["error", "messageerror", "message"]) {
    const registration = worker.addEventListener.mock.calls.find(([event]) => event === type);
    expect(registration).toBeDefined();
    expect(worker.removeEventListener).toHaveBeenCalledWith(type, registration![1]);
    expect(worker.listeners.get(type)?.size).toBe(0);
  }
}

function spyOnAbort(signal: AbortSignal) {
  return {
    add: vi.spyOn(signal, "addEventListener"),
    remove: vi.spyOn(signal, "removeEventListener"),
  };
}

function expectAbortListenerReleased(spies: ReturnType<typeof spyOnAbort>) {
  const registration = spies.add.mock.calls.find(([type]) => type === "abort");
  expect(registration).toBeDefined();
  expect(spies.remove).toHaveBeenCalledWith("abort", registration![1]);
}

beforeEach(() => {
  vi.resetAllMocks();
  FakeWorker.instances = [];
  hooks = undefined;
  openings = [];
  clients = [];
  vi.stubGlobal("Worker", FakeWorker);
  mocks.init.mockImplementation((configuration?: Hooks) => { hooks = configuration; });
  mocks.createClient.mockImplementation((worker: FakeWorker, fail: (reason: unknown) => void) => {
    const client = {};
    clients.push({ worker, fail, client });
    return client;
  });
  mocks.open.mockImplementation((file: File) => {
    // libarchive.js 2.0.2 acquires these hooks synchronously, before any await.
    // Delaying this capture in a mock would incorrectly share the latest worker.
    if (!hooks) throw new Error("Archive hooks were not installed synchronously");
    const acquiredHooks = hooks;
    const worker = acquiredHooks.getWorker();
    const client = acquiredHooks.createClient(worker);
    const result = deferred<Reader>();
    openings.push({ file, worker, client, result });
    return result.promise;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("openArchive lifetime", () => {
  it("does not create a worker or call libarchive when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = spyOnAbort(controller.signal);

    await expectRejected(observe(openArchive(inputFile(), controller.signal)), "Archive closed");

    expect(FakeWorker.instances).toHaveLength(0);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(abort.add).not.toHaveBeenCalled();
  });

  it("cancels a never-ready worker and removes every lifetime listener", async () => {
    const controller = new AbortController();
    const abort = spyOnAbort(controller.signal);
    const result = observe(startArchive(inputFile(), controller.signal));
    const worker = FakeWorker.instances[0];
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();

    controller.abort();

    await expectRejected(result, "Archive closed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    expectAbortListenerReleased(abort);
    worker.emit("error");
    worker.emit("messageerror");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["error", "Worker crashed"],
    ["messageerror", "Archive worker message failed"],
  ] as const)("rejects startup on worker %s", async (event, message) => {
    const controller = new AbortController();
    const abort = spyOnAbort(controller.signal);
    const result = observe(startArchive(inputFile(), controller.signal));
    const worker = FakeWorker.instances[0];

    worker.emit(event);

    await expectRejected(result, message);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    expectAbortListenerReleased(abort);
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates and releases listeners when Archive.open rejects", async () => {
    const controller = new AbortController();
    const abort = spyOnAbort(controller.signal);
    const result = observe(startArchive(inputFile(), controller.signal));
    openings[0].result.reject(new Error("Cannot open archive"));

    await expectRejected(result, "Cannot open archive");
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(FakeWorker.instances[0]);
    expectAbortListenerReleased(abort);
  });

  it("closes a reader that arrives after cancellation instead of exposing it", async () => {
    const controller = new AbortController();
    const result = observe(startArchive(inputFile(), controller.signal));
    const { worker } = openings[0];
    controller.abort();
    await expectRejected(result, "Archive closed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    const reader = makeReader(worker);
    openings[0].result.resolve(reader);
    await flushMicrotasks();

    await expectRejected(result, "Archive closed");
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(reader.getFilesObject).not.toHaveBeenCalled();
    expectWorkerListenersReleased(worker);
  });

  it("ignores a late open rejection after cancellation", async () => {
    const controller = new AbortController();
    const result = observe(startArchive(inputFile(), controller.signal));
    controller.abort();
    openings[0].result.reject(new Error("Late failure"));

    await expectRejected(result, "Archive closed");
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("makes repeated close, abort, and subsequent worker errors harmless", async () => {
    const controller = new AbortController();
    const abort = spyOnAbort(controller.signal);
    const { archive, reader, worker } = await openReady({}, controller.signal);

    archive.close();
    archive.close();
    controller.abort();
    worker.emit("error");
    worker.emit("messageerror");

    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    expectAbortListenerReleased(abort);
    await expectRejected(observe(archive.getFilesObject()), "Archive closed");
    expect(reader.getFilesObject).not.toHaveBeenCalled();
  });

  it.each([
    ["error", "Worker crashed"],
    ["messageerror", "Archive worker message failed"],
  ] as const)("rejects an in-flight listing and future calls after ready-worker %s", async (event, message) => {
    const listing = deferred<ArchiveTree>();
    const { archive, reader, worker } = await openReady();
    reader.getFilesObject.mockReturnValue(listing.promise);
    const result = observe(archive.getFilesObject());
    await flushMicrotasks();
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);

    worker.emit(event);

    await expectRejected(result, message);
    await expectRejected(observe(archive.getFilesObject()), message);
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    listing.resolve({});
    await expectRejected(result, message);
  });

  it("rejects concurrent extractions and prevents future extraction after a worker crash", async () => {
    const first = deferred<File>();
    const second = deferred<File>();
    const firstExtract = vi.fn(() => first.promise);
    const secondExtract = vi.fn(() => second.promise);
    const { archive, reader, worker } = await openReady({
      first: { name: "first", size: 1, extract: firstExtract },
      folder: { second: { name: "second", size: 2, extract: secondExtract } },
    });
    const tree = await expectFulfilled(observe(archive.getFilesObject()));
    const firstFile = tree.first as ArchiveFile;
    const secondFile = (tree.folder as ArchiveTree).second as ArchiveFile;
    const firstResult = observe(firstFile.extract());
    const secondResult = observe(secondFile.extract());
    await flushMicrotasks();
    expect(firstExtract).toHaveBeenCalledTimes(1);
    expect(secondExtract).toHaveBeenCalledTimes(1);

    worker.emit("error");

    await expectRejected(firstResult, "Worker crashed");
    await expectRejected(secondResult, "Worker crashed");
    await expectRejected(observe(firstFile.extract()), "Worker crashed");
    await expectRejected(observe(secondFile.extract()), "Worker crashed");
    await expectRejected(observe(archive.getFilesObject()), "Worker crashed");
    expect(firstExtract).toHaveBeenCalledTimes(1);
    expect(secondExtract).toHaveBeenCalledTimes(1);
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    first.resolve(inputFile("first"));
    second.resolve(inputFile("second"));
    await expectRejected(firstResult, "Worker crashed");
    await expectRejected(secondResult, "Worker crashed");
  });

  it.each(["close", "abort"] as const)("rejects a pending listing on %s and ignores its late result", async (action) => {
    const controller = new AbortController();
    const abort = spyOnAbort(controller.signal);
    const listing = deferred<ArchiveTree>();
    const { archive, reader, worker } = await openReady({}, controller.signal);
    reader.getFilesObject.mockReturnValue(listing.promise);
    const result = observe(archive.getFilesObject());
    await flushMicrotasks();
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);

    if (action === "close") archive.close();
    else controller.abort();

    await expectRejected(result, "Archive closed");
    listing.resolve({});
    await expectRejected(result, "Archive closed");
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    expectAbortListenerReleased(abort);
  });

  it("does not invoke a queued listing when closed before its microtask starts", async () => {
    const { archive, reader, worker } = await openReady();
    const result = observe(archive.getFilesObject());
    archive.close();

    await expectRejected(result, "Archive closed");
    expect(reader.getFilesObject).not.toHaveBeenCalled();
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not invoke a queued extraction when closed before its microtask starts", async () => {
    const extract = vi.fn<() => Promise<File>>().mockResolvedValue(inputFile("entry"));
    const { archive, reader, worker } = await openReady({ entry: { name: "entry", size: 1, extract } });
    const tree = await expectFulfilled(observe(archive.getFilesObject()));
    const result = observe((tree.entry as ArchiveFile).extract());
    archive.close();

    await expectRejected(result, "Archive closed");
    expect(extract).not.toHaveBeenCalled();
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("treats listing rejection as fatal and rejects another pending listing", async () => {
    const first = deferred<ArchiveTree>();
    const second = deferred<ArchiveTree>();
    const { archive, reader, worker } = await openReady();
    reader.getFilesObject.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstResult = observe(archive.getFilesObject());
    const secondResult = observe(archive.getFilesObject());
    await flushMicrotasks();
    expect(reader.getFilesObject).toHaveBeenCalledTimes(2);
    first.reject(new Error("Invalid archive paths"));

    await expectRejected(firstResult, "Invalid archive paths");
    await expectRejected(secondResult, "Invalid archive paths");
    await expectRejected(observe(archive.getFilesObject()), "Invalid archive paths");
    expect(reader.getFilesObject).toHaveBeenCalledTimes(2);
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("treats extraction rejection as fatal and cancels another pending extraction", async () => {
    const first = deferred<File>();
    const second = deferred<File>();
    const extract = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { archive, reader, worker } = await openReady({ entry: { name: "entry", size: 1, extract } });
    const tree = await expectFulfilled(observe(archive.getFilesObject()));
    const entry = tree.entry as ArchiveFile;
    const firstResult = observe(entry.extract());
    const secondResult = observe(entry.extract());
    await flushMicrotasks();
    expect(extract).toHaveBeenCalledTimes(2);
    first.reject(new Error("Extraction failed"));

    await expectRejected(firstResult, "Extraction failed");
    await expectRejected(secondResult, "Extraction failed");
    await expectRejected(observe(entry.extract()), "Extraction failed");
    expect(extract).toHaveBeenCalledTimes(2);
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("honors the client failure callback while opening", async () => {
    const result = observe(startArchive(inputFile()));
    expect(clients[0].worker).toBe(FakeWorker.instances[0]);
    clients[0].fail("Client initialization failed");

    await expectRejected(result, "Client initialization failed");
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(FakeWorker.instances[0]);
  });

  it("honors the client failure callback after opening", async () => {
    const listing = deferred<ArchiveTree>();
    const { archive, reader, worker } = await openReady();
    reader.getFilesObject.mockReturnValue(listing.promise);
    const result = observe(archive.getFilesObject());
    await flushMicrotasks();
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);
    clients[0].fail(new Error("Client RPC failed"));

    await expectRejected(result, "Client RPC failed");
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
  });

  it.each(["throw", "reject"] as const)("still terminates the worker when reader.close fails by %s", async (mode) => {
    const { archive, reader, worker } = await openReady();
    if (mode === "throw") reader.close.mockImplementation(() => { throw new Error("Close failed"); });
    else reader.close.mockRejectedValue(new Error("Close failed"));

    archive.close();
    await flushMicrotasks();

    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
  });

  it("lists a null-prototype tree and extracts nested files normally", async () => {
    const extracted = inputFile("notes.txt");
    const extract = vi.fn<() => Promise<File>>().mockResolvedValue(extracted);
    const originalEntry = { name: "notes.txt", size: 13, extract };
    const originalTree = { folder: { "notes.txt": originalEntry }, empty: {} };
    const { archive, reader, worker } = await openReady(originalTree);

    const tree = await expectFulfilled(observe(archive.getFilesObject()));
    const folder = tree.folder as ArchiveTree;
    const entry = folder["notes.txt"] as ArchiveFile;
    expect(Object.getPrototypeOf(tree)).toBeNull();
    expect(Object.getPrototypeOf(folder)).toBeNull();
    expect(Object.getPrototypeOf(tree.empty)).toBeNull();
    expect(tree).not.toBe(originalTree);
    expect(entry).not.toBe(originalEntry);
    expect(entry.name).toBe("notes.txt");
    expect(entry.size).toBe(13);
    expect(await expectFulfilled(observe(entry.extract()))).toBe(extracted);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.contexts[0]).toBe(originalEntry);
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);
    expect(reader.close).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.url).toBeInstanceOf(URL);
    expect(worker.url.pathname).toContain("archive_worker.ts");

    archive.close();
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("keeps synchronous worker/client acquisition isolated across concurrent opens", async () => {
    const firstFile = inputFile("first.zip");
    const secondFile = inputFile("second.zip");
    const firstResult = observe(startArchive(firstFile));
    const secondResult = observe(startArchive(secondFile));
    expect(FakeWorker.instances).toHaveLength(2);
    expect(openings).toHaveLength(2);
    expect(openings[0].file).toBe(firstFile);
    expect(openings[1].file).toBe(secondFile);
    expect(openings[0].worker).toBe(FakeWorker.instances[0]);
    expect(openings[1].worker).toBe(FakeWorker.instances[1]);
    expect(openings[0].worker).not.toBe(openings[1].worker);
    expect(openings[0].client).toBe(clients[0].client);
    expect(openings[1].client).toBe(clients[1].client);
    expect(clients[0].worker).toBe(openings[0].worker);
    expect(clients[1].worker).toBe(openings[1].worker);

    const firstReader = makeReader(openings[0].worker);
    const secondReader = makeReader(openings[1].worker);
    openings[1].result.resolve(secondReader);
    openings[0].result.resolve(firstReader);
    const firstArchive = await expectFulfilled(firstResult);
    const secondArchive = await expectFulfilled(secondResult);
    firstArchive.close();

    expect(firstReader.close).toHaveBeenCalledTimes(1);
    expect(openings[0].worker.terminate).toHaveBeenCalledTimes(1);
    expect(secondReader.close).not.toHaveBeenCalled();
    expect(openings[1].worker.terminate).not.toHaveBeenCalled();
    await expectFulfilled(observe(secondArchive.getFilesObject()));
    expect(secondReader.getFilesObject).toHaveBeenCalledTimes(1);
    secondArchive.close();
    expect(secondReader.close).toHaveBeenCalledTimes(1);
    expect(openings[1].worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("cancels one concurrent startup without terminating the other worker", async () => {
    const controller = new AbortController();
    const firstResult = observe(startArchive(inputFile("first.zip"), controller.signal));
    const secondResult = observe(startArchive(inputFile("second.zip")));
    controller.abort();
    await expectRejected(firstResult, "Archive closed");
    expect(openings[0].worker.terminate).toHaveBeenCalledTimes(1);
    expect(openings[1].worker.terminate).not.toHaveBeenCalled();

    const firstReader = makeReader(openings[0].worker);
    const secondReader = makeReader(openings[1].worker);
    openings[0].result.resolve(firstReader);
    openings[1].result.resolve(secondReader);
    const secondArchive = await expectFulfilled(secondResult);
    expect(firstReader.close).toHaveBeenCalledTimes(1);
    expect(secondReader.close).not.toHaveBeenCalled();
    expect(openings[1].worker.terminate).not.toHaveBeenCalled();
    await expectFulfilled(observe(secondArchive.getFilesObject()));
    expect(secondReader.getFilesObject).toHaveBeenCalledTimes(1);
    secondArchive.close();
    expect(openings[1].worker.terminate).toHaveBeenCalledTimes(1);
  });
});

describe("archive worker bootstrap and released references", () => {
  it("waits for the bootstrap envelope before invoking any archive hooks or RPC", async () => {
    const controller = new AbortController();
    const file = inputFile();
    const result = observe(openArchive(file, controller.signal));
    const worker = FakeWorker.instances[0];
    await flushMicrotasks();

    expect(result.current.state).toBe("pending");
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(openings).toHaveLength(0);
    expect(worker.terminate).not.toHaveBeenCalled();

    worker.ready();

    // Hooks are captured and cleared in the same event handler, not a microtask.
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(file);
    expect(mocks.createClient).toHaveBeenCalledExactlyOnceWith(worker, expect.any(Function));
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(mocks.init.mock.calls[0]).toEqual([{ getWorker: expect.any(Function), createClient: expect.any(Function) }]);
    expect(mocks.init.mock.calls[1]).toEqual([]);
    expect(mocks.open.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.init.mock.invocationCallOrder[0]);
    expect(mocks.open.mock.invocationCallOrder[0]).toBeLessThan(mocks.init.mock.invocationCallOrder[1]);
    expect(hooks).toBeUndefined();
    expect(result.current.state).toBe("pending");

    controller.abort();
    await expectRejected(result, "Archive closed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("aborts before bootstrap without opening the archive, including a late ready envelope", async () => {
    const controller = new AbortController();
    const abort = spyOnAbort(controller.signal);
    const result = observe(openArchive(inputFile(), controller.signal));
    const worker = FakeWorker.instances[0];
    controller.abort();
    worker.ready();
    worker.fail("Late bootstrap failure");

    await expectRejected(result, "Archive closed");
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    expectAbortListenerReleased(abort);
  });

  it("ignores duplicate ready envelopes both before and after the reader opens", async () => {
    const result = observe(openArchive(inputFile()));
    const worker = FakeWorker.instances[0];
    worker.ready();
    worker.ready();
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(hooks).toBeUndefined();
    const reader = makeReader(worker);
    openings[0].result.resolve(reader);
    const archive = await expectFulfilled(result);

    worker.ready();

    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(reader.close).not.toHaveBeenCalled();
    archive.close();
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(["init", "open", "createClient"] as const)("resets global hooks and terminates when %s throws synchronously", async (source) => {
    const error = new Error(`${source} threw`);
    if (source === "init") {
      mocks.init.mockImplementationOnce((configuration: Hooks) => {
        hooks = configuration;
        throw error;
      });
    } else mocks[source].mockImplementationOnce(() => { throw error; });
    const result = observe(openArchive(inputFile()));
    const worker = FakeWorker.instances[0];

    expect(() => worker.ready()).not.toThrow();

    await expectRejected(result, error.message);
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(mocks.init.mock.calls[1]).toEqual([]);
    expect(hooks).toBeUndefined();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    expect(mocks.open).toHaveBeenCalledTimes(source === "init" ? 0 : 1);
    expect(mocks.createClient).toHaveBeenCalledTimes(source === "createClient" ? 1 : 0);
    worker.ready();
    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(["before", "after"] as const)("rejects a bootstrap error envelope %s the ready handshake", async (when) => {
    const controller = new AbortController();
    const abort = spyOnAbort(controller.signal);
    const result = observe(openArchive(inputFile(), controller.signal));
    const worker = FakeWorker.instances[0];
    if (when === "after") worker.ready();

    worker.fail("Worker initialization rejected");

    await expectRejected(result, "Worker initialization rejected");
    expect(mocks.open).toHaveBeenCalledTimes(when === "after" ? 1 : 0);
    expect(mocks.createClient).toHaveBeenCalledTimes(when === "after" ? 1 : 0);
    expect(hooks).toBeUndefined();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    expectAbortListenerReleased(abort);
    worker.ready();
    expect(mocks.open).toHaveBeenCalledTimes(when === "after" ? 1 : 0);
  });

  it("closes an already-open reader on a bootstrap error envelope", async () => {
    const { archive, reader, worker } = await openReady();
    worker.fail("Ignored upstream rejection");

    await expectRejected(observe(archive.getFilesObject()), "Ignored upstream rejection");
    expect(reader.getFilesObject).not.toHaveBeenCalled();
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
  });

  it.each(["list", "extract"] as const)("rejects an in-flight %s on a bootstrap error envelope", async (operation) => {
    const listing = deferred<ArchiveTree>();
    const extraction = deferred<File>();
    const extract = vi.fn(() => extraction.promise);
    const { archive, reader, worker } = await openReady({ entry: { name: "entry", size: 1, extract } });
    let result: { current: Outcome<ArchiveTree | File> };
    let entry: ArchiveFile | undefined;
    if (operation === "list") {
      reader.getFilesObject.mockReturnValue(listing.promise);
      result = observe(archive.getFilesObject());
    } else {
      const tree = await expectFulfilled(observe(archive.getFilesObject()));
      entry = tree.entry as ArchiveFile;
      result = observe(entry.extract());
    }
    await flushMicrotasks();
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(operation === "extract" ? 1 : 0);

    worker.fail("Upstream async operation rejected");

    await expectRejected(result, "Upstream async operation rejected");
    await expectRejected(observe(archive.getFilesObject()), "Upstream async operation rejected");
    if (entry) await expectRejected(observe(entry.extract()), "Upstream async operation rejected");
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(operation === "extract" ? 1 : 0);
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expectWorkerListenersReleased(worker);
    listing.resolve({});
    extraction.resolve(inputFile("entry"));
    await expectRejected(result, "Upstream async operation rejected");
  });

  it("ignores unrelated and malformed messages while waiting for bootstrap", async () => {
    const controller = new AbortController();
    const result = observe(openArchive(inputFile(), controller.signal));
    const worker = FakeWorker.instances[0];
    for (const data of [undefined, null, "canvas-archive-bootstrap-ready", {}, { type: "OTHER" }, { id: "rpc-response", value: true }]) {
      worker.emit("message", data);
    }
    await flushMicrotasks();

    expect(result.current.state).toBe("pending");
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    controller.abort();
    await expectRejected(result, "Archive closed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not read the original entry when a retained facade is used after close", async () => {
    const extract = vi.fn<() => Promise<File>>().mockResolvedValue(inputFile("entry"));
    const original = { name: "entry", size: 3, extract };
    const { archive, reader, worker } = await openReady({ entry: original });
    const tree = await expectFulfilled(observe(archive.getFilesObject()));
    const entry = tree.entry as ArchiveFile;
    const readOriginal = vi.fn(() => { throw new Error("Read original after close"); });
    archive.close();
    for (const property of ["name", "size", "extract"]) {
      Object.defineProperty(original, property, { get: readOriginal, configurable: true });
    }

    expect(entry.name).toBe("entry");
    expect(entry.size).toBe(3);
    await expectRejected(observe(entry.extract()), "Archive closed");
    expect(readOriginal).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not inspect or wrap a listing result that arrives after close", async () => {
    const listing = deferred<ArchiveTree>();
    const { archive, reader, worker } = await openReady();
    reader.getFilesObject.mockReturnValue(listing.promise);
    const result = observe(archive.getFilesObject());
    await flushMicrotasks();
    expect(reader.getFilesObject).toHaveBeenCalledTimes(1);
    archive.close();
    const readLateEntry = vi.fn(() => { throw new Error("Inspected stale archive tree"); });
    const staleTree: ArchiveTree = {};
    Object.defineProperty(staleTree, "entry", { enumerable: true, get: readLateEntry });
    listing.resolve(staleTree);

    await expectRejected(result, "Archive closed");
    expect(readLateEntry).not.toHaveBeenCalled();
    expect(reader.close).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("keeps concurrent workers separate when their ready envelopes arrive in reverse order", async () => {
    const firstFile = inputFile("first.zip");
    const secondFile = inputFile("second.zip");
    const firstResult = observe(openArchive(firstFile));
    const secondResult = observe(openArchive(secondFile));
    const [firstWorker, secondWorker] = FakeWorker.instances;
    expect(mocks.open).not.toHaveBeenCalled();
    secondWorker.ready();
    expect(hooks).toBeUndefined();
    firstWorker.ready();
    expect(hooks).toBeUndefined();
    expect(openings[0].file).toBe(secondFile);
    expect(openings[0].worker).toBe(secondWorker);
    expect(clients[0].worker).toBe(secondWorker);
    expect(openings[1].file).toBe(firstFile);
    expect(openings[1].worker).toBe(firstWorker);
    expect(clients[1].worker).toBe(firstWorker);
    expect(mocks.init.mock.calls.map((args) => args.length)).toEqual([1, 0, 1, 0]);
    const firstReader = makeReader(firstWorker);
    const secondReader = makeReader(secondWorker);
    openings[0].result.resolve(secondReader);
    openings[1].result.resolve(firstReader);
    const firstArchive = await expectFulfilled(firstResult);
    const secondArchive = await expectFulfilled(secondResult);

    firstArchive.close();

    expect(firstReader.close).toHaveBeenCalledTimes(1);
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(secondReader.close).not.toHaveBeenCalled();
    expect(secondWorker.terminate).not.toHaveBeenCalled();
    await expectFulfilled(observe(secondArchive.getFilesObject()));
    expect(secondReader.getFilesObject).toHaveBeenCalledTimes(1);
    secondArchive.close();
    expect(secondReader.close).toHaveBeenCalledTimes(1);
    expect(secondWorker.terminate).toHaveBeenCalledTimes(1);
  });
});
