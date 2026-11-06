// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createArchiveClient } from "./archive_client";

const mocks = vi.hoisted(() => ({
  wrap: vi.fn(), proxy: vi.fn(), ready: vi.fn(),
  remote: { open: vi.fn(), listFiles: vi.fn(), extractSingleFile: vi.fn() },
}));
vi.mock("comlink", () => ({ wrap: mocks.wrap, proxy: mocks.proxy }));

interface Client {
  open(file: File, callback: () => void): Promise<unknown>;
  listFiles(): Promise<unknown>;
  extractSingleFile(path: string): Promise<unknown>;
}

const endpoint = {} as Worker;
async function connect(fail = vi.fn()) {
  const Constructor = createArchiveClient(endpoint, fail) as unknown as new (ready: () => void) => Promise<Client>;
  return new Constructor(mocks.ready);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.proxy.mockImplementation((callback: () => void) => () => callback());
  mocks.wrap.mockReturnValue(function Remote(ready: () => void) {
    ready();
    return Promise.resolve(mocks.remote);
  });
  mocks.remote.open.mockResolvedValue(undefined);
});

it("re-proxies readiness and open callbacks using its own Comlink instance", async () => {
  const client = await connect();
  expect(mocks.wrap).toHaveBeenCalledWith(endpoint);
  expect(mocks.proxy).toHaveBeenCalledWith(mocks.ready);
  expect(mocks.ready).toHaveBeenCalledOnce();
  const opened = vi.fn(); const file = new File([], "a.zip");
  await client.open(file, opened);
  expect(mocks.proxy).toHaveBeenCalledWith(opened);
  const sent = mocks.remote.open.mock.calls[0][1] as () => void;
  expect(sent).not.toBe(opened);
  sent();
  expect(opened).toHaveBeenCalledOnce();
});

it("reports a remote constructor rejection", async () => {
  const error = new Error("Construction failed"); const fail = vi.fn();
  mocks.wrap.mockReturnValue(function Remote() { return Promise.reject(error); });
  await expect(connect(fail)).rejects.toBe(error);
  expect(fail).toHaveBeenCalledWith(error);
});

it("handles open RPC rejection even when ArchiveReader ignores its return value", async () => {
  const error = new Error("Open failed"); const fail = vi.fn();
  mocks.remote.open.mockRejectedValueOnce(error);
  const client = await connect(fail);
  await expect(client.open(new File([], "a.zip"), vi.fn())).resolves.toBeUndefined();
  expect(fail).toHaveBeenCalledWith(error);
});

it("rejects the complete raw list before returning any entries for object construction", async () => {
  mocks.remote.listFiles.mockResolvedValueOnce([
    { path: "ordinary.txt", type: "FILE" }, { path: "__proto__/invalid.txt", type: "FILE" },
  ]);
  const client = await connect();
  await expect(client.listFiles()).rejects.toThrow("Unsafe archive path");
  expect(mocks.remote.extractSingleFile).not.toHaveBeenCalled();
});

it("preserves metadata and passes individual extraction to the remote client", async () => {
  const entries = [{ path: "资料.txt", type: "FILE", size: 5 }];
  const contents = { fileName: "资料.txt", fileData: new Uint8Array([1, 2]).buffer };
  mocks.remote.listFiles.mockResolvedValueOnce(entries);
  mocks.remote.extractSingleFile.mockResolvedValueOnce(contents);
  const client = await connect();
  await expect(client.listFiles()).resolves.toBe(entries);
  await expect(client.extractSingleFile("资料.txt")).resolves.toBe(contents);
  expect(mocks.remote.extractSingleFile).toHaveBeenCalledWith("资料.txt");
});
