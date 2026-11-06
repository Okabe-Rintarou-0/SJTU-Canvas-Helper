// @vitest-environment node
import { expose } from "comlink";
import { Archive } from "libarchive.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openArchive, type ArchiveFile, type ArchiveTree } from "./archive_open";
import { ARCHIVE_BOOTSTRAP_READY } from "./archive_worker_bootstrap";

// Exercise the actual main-thread library and Comlink protocol only. The remote
// endpoint below returns harmless metadata and text; no archive or WASM is read.
const NativeMessageChannel = globalThis.MessageChannel;
const ports = new Set<MessagePort>();

class TrackedMessageChannel extends NativeMessageChannel {
  constructor() {
    super();
    ports.add(this.port1);
    ports.add(this.port2);
  }
}

interface Fixture { name: string; text: string }
type Callback = () => Promise<void>;

class LocalWorker {
  static fixtures: Fixture[] = [];
  static instances: LocalWorker[] = [];
  readonly main: MessagePort;
  readonly remote: MessagePort;
  readonly fixture: Fixture;
  ready?: Callback;
  opened?: Callback;
  received?: Blob;
  readonly list = vi.fn();
  readonly extract = vi.fn();
  readonly terminate = vi.fn(() => {
    this.main.close();
    this.remote.close();
  });

  constructor() {
    const fixture = LocalWorker.fixtures.shift();
    if (!fixture) throw new Error("Missing harmless remote fixture");
    this.fixture = fixture;
    const channel = new MessageChannel();
    this.main = channel.port1;
    this.remote = channel.port2;
    const receiveReady = (ready: Callback) => { this.ready = ready; };
    const receiveOpen = (file: Blob, opened: Callback) => {
      this.received = file;
      this.opened = opened;
    };
    const list = this.list;
    const extract = this.extract;
    const metadata = {
      path: `notes/${fixture.name}`, fileName: fixture.name, type: "FILE",
      size: new TextEncoder().encode(fixture.text).length, lastModified: 0,
    };
    expose(class {
      constructor(ready: Callback) { receiveReady(ready); }
      open(file: Blob, opened: Callback) { receiveOpen(file, opened); }
      listFiles() {
        list();
        return [metadata];
      }
      extractSingleFile(path: string) {
        extract(path);
        if (path !== metadata.path) throw new Error("Unexpected harmless fixture path");
        return { ...metadata, fileData: new TextEncoder().encode(fixture.text) };
      }
    }, this.remote);
    LocalWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
    this.main.addEventListener(type, listener, options);
  }
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.main.removeEventListener(type, listener);
  }
  postMessage(message: unknown, transfer: Transferable[] = []) { this.main.postMessage(message, transfer); }
  start() { this.main.start(); }
  bootstrap() {
    this.main.start();
    this.remote.postMessage({ type: ARCHIVE_BOOTSTRAP_READY });
  }
}

async function constructed(worker: LocalWorker) {
  await vi.waitFor(() => expect(worker.ready).toBeTypeOf("function"));
}

async function finishOpening(worker: LocalWorker) {
  await worker.ready!();
  await vi.waitFor(() => expect(worker.opened).toBeTypeOf("function"));
  await worker.opened!();
}

beforeEach(() => {
  LocalWorker.fixtures = [];
  LocalWorker.instances = [];
  vi.stubGlobal("MessageChannel", TrackedMessageChannel);
  vi.stubGlobal("Worker", LocalWorker);
});

afterEach(() => {
  Archive.init();
  for (const worker of LocalWorker.instances) worker.terminate();
  // Includes the additional channels created by real Comlink for remote objects
  // and both callbacks, not just the initial fake worker channel.
  for (const port of ports) port.close();
  ports.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("re-proxies both bundled-library callbacks and lists, extracts, and closes through real Comlink", async () => {
  LocalWorker.fixtures.push({ name: "readme.txt", text: "ordinary notes" });
  const init = vi.spyOn(Archive, "init");
  const opening = openArchive(new File(["plain transport input"], "input.txt"));
  const worker = LocalWorker.instances[0];
  expect(init).not.toHaveBeenCalled();
  worker.bootstrap();
  await constructed(worker);

  // The actual 2.0.2 open has acquired both hooks despite not being ready yet.
  expect(init.mock.calls).toHaveLength(2);
  expect(init.mock.calls[0][0]?.getWorker?.()).toBe(worker);
  expect(init.mock.calls[1]).toEqual([]);
  expect(init.mock.results[1].value).toEqual({});
  await finishOpening(worker);
  const archive = await opening;
  expect(await worker.received!.text()).toBe("plain transport input");
  const tree = await archive.getFilesObject();
  const entry = (tree.notes as ArchiveTree)["readme.txt"] as ArchiveFile;
  expect(Object.getPrototypeOf(tree)).toBeNull();
  expect(entry.name).toBe("readme.txt");
  expect(entry.size).toBe(14);
  const extracted = await entry.extract();
  expect(extracted.name).toBe("readme.txt");
  expect(await extracted.text()).toBe("ordinary notes");
  expect(worker.list).toHaveBeenCalledOnce();
  expect(worker.extract).toHaveBeenCalledExactlyOnceWith("notes/readme.txt");

  archive.close();
  expect(worker.terminate).toHaveBeenCalledOnce();
  await expect(entry.extract()).rejects.toThrow("Archive closed");
  await expect(archive.getFilesObject()).rejects.toThrow("Archive closed");
  expect(worker.extract).toHaveBeenCalledOnce();
});

it("captures separate endpoints before resetting hooks and tolerates reverse readiness across concurrent opens", async () => {
  LocalWorker.fixtures.push(
    { name: "first.txt", text: "first harmless text" },
    { name: "second.txt", text: "second harmless text" },
  );
  const init = vi.spyOn(Archive, "init");
  const firstOpening = openArchive(new File(["first input"], "first.txt"));
  const secondOpening = openArchive(new File(["second input"], "second.txt"));
  let firstResolved = false;
  void firstOpening.then(() => { firstResolved = true; });
  const [firstWorker, secondWorker] = LocalWorker.instances;
  firstWorker.bootstrap();
  await constructed(firstWorker);
  secondWorker.bootstrap();
  await constructed(secondWorker);
  expect(init.mock.calls).toHaveLength(4);
  expect(init.mock.calls[0][0]?.getWorker?.()).toBe(firstWorker);
  expect(init.mock.calls[1]).toEqual([]);
  expect(init.mock.calls[2][0]?.getWorker?.()).toBe(secondWorker);
  expect(init.mock.calls[3]).toEqual([]);

  await finishOpening(secondWorker);
  const second = await secondOpening;
  expect(firstResolved).toBe(false);
  await finishOpening(firstWorker);
  const first = await firstOpening;
  expect(await firstWorker.received!.text()).toBe("first input");
  expect(await secondWorker.received!.text()).toBe("second input");
  const firstTree = await first.getFilesObject();
  const secondTree = await second.getFilesObject();
  expect(Object.keys(firstTree.notes)).toEqual(["first.txt"]);
  expect(Object.keys(secondTree.notes)).toEqual(["second.txt"]);

  first.close();
  expect(firstWorker.terminate).toHaveBeenCalledOnce();
  expect(secondWorker.terminate).not.toHaveBeenCalled();
  const secondEntry = (secondTree.notes as ArchiveTree)["second.txt"] as ArchiveFile;
  expect(await (await secondEntry.extract()).text()).toBe("second harmless text");
  expect(firstWorker.extract).not.toHaveBeenCalled();
  expect(secondWorker.extract).toHaveBeenCalledExactlyOnceWith("notes/second.txt");
  second.close();
  expect(secondWorker.terminate).toHaveBeenCalledOnce();
});
