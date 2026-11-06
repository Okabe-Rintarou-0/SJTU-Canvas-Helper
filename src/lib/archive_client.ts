import { proxy, wrap } from "comlink";

interface ArchiveEntry {
  path: string;
  type: string;
}

interface PathNode {
  file: boolean;
  children: Map<string, PathNode>;
}

/** Validate the entire list before libarchive.js 2.0.2 writes any path to an object. */
export function validateArchiveEntries(entries: unknown): asserts entries is ArchiveEntry[] {
  if (!Array.isArray(entries)) throw new Error("Invalid archive entry list");
  const root: PathNode = { file: false, children: new Map() };
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string" || typeof entry.type !== "string") {
      throw new Error("Invalid archive entry");
    }
    const parts = entry.path.split("/");
    if (parts[parts.length - 1] === "") parts.pop();
    if (!parts.length || parts.some((part: string) => !part || part === "..")) {
      throw new Error("Unsafe archive path");
    }
    let node = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name: string = parts[index];
      const file = index === parts.length - 1 && entry.type === "FILE";
      // Even a file leaf named __proto__ invokes the ordinary object's setter.
      // Inherited names at directory positions traverse shared objects/functions.
      if (name === "__proto__" || (!file && Object.prototype.hasOwnProperty.call(Object.prototype, name))) {
        throw new Error("Unsafe archive path");
      }
      const previous = node.children.get(name);
      if (previous && (previous.file || file)) {
        throw new Error("Conflicting archive paths");
      }
      if (previous) node = previous;
      else {
        const child: PathNode = { file, children: new Map() };
        node.children.set(name, child);
        node = child;
      }
    }
  }
}

interface WorkerClient {
  open(file: File, ready: () => void): Promise<void>;
  listFiles(): Promise<unknown>;
  extractSingleFile(path: string): Promise<unknown>;
}

/** Public createClient hook; no private fields or bundled-code patching. */
export function createArchiveClient(worker: Worker, fail: (reason: unknown) => void) {
  const RemoteClient = wrap<new (ready: () => void) => WorkerClient>(worker);
  return function Client(ready: () => void) {
    // libarchive.js bundles its own Comlink symbols. Re-mark callbacks with the
    // Comlink instance that owns this endpoint, rather than forwarding its mark.
    return (async () => {
      const client = await new RemoteClient(proxy(ready));
      return {
        open(file: File, opened: () => void) {
          // ArchiveReader.open ignores this promise, so handle RPC rejection here.
          return client.open(file, proxy(opened)).catch(fail);
        },
        async listFiles() {
          const entries = await client.listFiles();
          validateArchiveEntries(entries);
          return entries;
        },
        extractSingleFile: (path: string) => client.extractSingleFile(path),
      };
    })().catch((error: unknown) => {
      fail(error);
      throw error;
    });
  };
}
