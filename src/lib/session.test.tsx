import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "./model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
// Session hooks do not execute PDF workers; keep this asset out of the shared
// dependency cache's Vite URL loader while exercising the real hooks/config.
vi.mock("pdfjs-dist/build/pdf.worker.min.js?url", () => ({ default: "synthetic-pdf-worker-url" }));
vi.mock("./message", () => ({
  appMessage: () => ({
    error: mocks.error,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
  useAppMessage: () => [{ error: vi.fn(), success: vi.fn() }, null],
  AppMessageProvider: ({ children }: { children: unknown }) => children,
}));

import { getConfig, saveConfig } from "./config";
import { useAutoLoadCourse, useData, useBaseURL } from "./hooks";
import { currentSession, invalidateSession } from "./session";
import { configStore, courseSlice } from "./store";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Each command gets a FIFO of responses so a test can decide when (and whether)
// a given request settles, independently of the other requests in flight.
const queues = new Map<string, Deferred<unknown>[]>();

function respondTo(command: string): Deferred<unknown> {
  const queue = queues.get(command) ?? [];
  const next = deferred<unknown>();
  queue.push(next);
  queues.set(command, queue);
  return next;
}

function countCalls(command: string): number {
  return mocks.invoke.mock.calls.filter(([called]) => called === command).length;
}

const configFixture = (token: string): AppConfig => ({
  __config_owner: `synthetic-owner:${token}`,
  token,
  account_type: "Default",
  save_path: "/tmp/canvas",
  serve_as_plaintext: "",
  oauth_consumer_key: "",
  ja_auth_cookie: "",
  video_cookies: "",
  proxy_port: 7890,
  course_assignment_file_bindings: {},
  show_alert_map: {},
  llm_api_key: "",
  llm_base_url: "",
  llm_model: "",
  llm_temperature: null,
  llm_api_keys: [],
  llm_active_api_key: "",
  theme: "light",
  compact_mode: false,
  color_primary: null,
  mcp_enabled: false,
  mcp_port: 3100,
  debug_mode: false,
});

beforeEach(() => {
  queues.clear();
  mocks.invoke.mockImplementation((command: string) => {
    const queue = queues.get(command);
    const next = queue?.shift();
    return next ? next.promise : Promise.resolve(undefined);
  });
  // Start every test from a fresh account session.
  invalidateSession();
  vi.clearAllMocks();
});

afterEach(() => {
  queues.clear();
});

describe("account session ownership", () => {
  it("ignores a late success from the previous account", async () => {
    const first = respondTo("list_courses");
    const second = respondTo("list_courses");

    const { result } = renderHook(() => useData<string[]>("list_courses", true));
    await waitFor(() => expect(countCalls("list_courses")).toBe(1));
    expect(result.current.isLoading).toBe(true);

    act(() => {
      invalidateSession();
    });
    await waitFor(() => expect(countCalls("list_courses")).toBe(2));

    await act(async () => {
      second.resolve(["B course"]);
    });
    await waitFor(() => expect(result.current.data).toEqual(["B course"]));

    await act(async () => {
      first.resolve(["A course"]);
    });

    expect(result.current.data).toEqual(["B course"]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("ignores a late failure from the previous account", async () => {
    const first = respondTo("list_courses");
    const second = respondTo("list_courses");

    const { result } = renderHook(() => useData<string[]>("list_courses", true));
    await waitFor(() => expect(countCalls("list_courses")).toBe(1));

    act(() => {
      invalidateSession();
    });
    await waitFor(() => expect(countCalls("list_courses")).toBe(2));

    await act(async () => {
      second.resolve(["B course"]);
    });
    await waitFor(() => expect(result.current.data).toEqual(["B course"]));

    await act(async () => {
      first.reject(new Error("A failed"));
    });

    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toEqual(["B course"]);
    // A stale failure must not surface a message for the new account.
    expect(mocks.error).not.toHaveBeenCalled();
    expect(countCalls("console_log")).toBe(0);
  });

  it("ignores a retry of the previous account that settles late", async () => {
    const original = respondTo("list_courses");
    const retry = respondTo("list_courses");

    const { result } = renderHook(() => useData<string[]>("list_courses", true));
    await waitFor(() => expect(countCalls("list_courses")).toBe(1));

    // Retry while account A is still the owner: both requests belong to A.
    await act(async () => {
      void result.current.mutate();
    });
    await waitFor(() => expect(countCalls("list_courses")).toBe(2));

    const next = respondTo("list_courses");
    act(() => {
      invalidateSession();
    });
    await waitFor(() => expect(countCalls("list_courses")).toBe(3));

    await act(async () => {
      next.resolve(["B course"]);
    });
    await waitFor(() => expect(result.current.data).toEqual(["B course"]));

    await act(async () => {
      retry.resolve(["A retry"]);
      original.resolve(["A original"]);
    });

    expect(result.current.data).toEqual(["B course"]);
  });

  it("clears the previous account's data as soon as the session changes", async () => {
    const first = respondTo("list_courses");

    const { result } = renderHook(() => useData<string[]>("list_courses", true));
    await act(async () => {
      first.resolve(["A course"]);
    });
    await waitFor(() => expect(result.current.data).toEqual(["A course"]));

    const second = respondTo("list_courses");
    act(() => {
      invalidateSession();
    });

    // B's request is still in flight, so B must not see A's data meanwhile.
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(countCalls("list_courses")).toBe(2));

    await act(async () => {
      second.resolve(["B course"]);
    });
    await waitFor(() => expect(result.current.data).toEqual(["B course"]));
  });

  it("keeps loading state owned by the current account", async () => {
    const first = respondTo("list_courses");

    const { result } = renderHook(() => useData<string[]>("list_courses", true));
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    const second = respondTo("list_courses");
    act(() => {
      invalidateSession();
    });
    await waitFor(() => expect(countCalls("list_courses")).toBe(2));
    expect(result.current.isLoading).toBe(true);

    // A settles first, but it no longer owns the loading state.
    await act(async () => {
      first.resolve(["A course"]);
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await act(async () => {
      second.resolve(["B course"]);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(["B course"]);
  });

  it("drops requests from both earlier accounts when returning to the first", async () => {
    const first = respondTo("list_courses");

    const { result } = renderHook(() => useData<string[]>("list_courses", true));
    await waitFor(() => expect(countCalls("list_courses")).toBe(1));

    const second = respondTo("list_courses");
    act(() => {
      invalidateSession();
    });
    await waitFor(() => expect(countCalls("list_courses")).toBe(2));

    const third = respondTo("list_courses");
    act(() => {
      invalidateSession();
    });
    await waitFor(() => expect(countCalls("list_courses")).toBe(3));

    await act(async () => {
      third.resolve(["A again"]);
    });
    await waitFor(() => expect(result.current.data).toEqual(["A again"]));

    await act(async () => {
      first.resolve(["A first"]);
      second.resolve(["B course"]);
    });

    expect(result.current.data).toEqual(["A again"]);
  });

  it("invalidates in-flight requests when the session ends and starts a clean session", async () => {
    const pending = respondTo("list_courses");

    const { result } = renderHook(() => useData<string[]>("list_courses", true));
    await waitFor(() => expect(countCalls("list_courses")).toBe(1));
    const session = currentSession();

    const fresh = respondTo("list_courses");
    await act(async () => {
      invalidateSession();
    });

    expect(currentSession()).not.toBe(session);
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(countCalls("list_courses")).toBe(2));

    await act(async () => {
      fresh.resolve(["new session"]);
    });
    await waitFor(() => expect(result.current.data).toEqual(["new session"]));

    // The request that belonged to the ended session is discarded whenever it lands.
    await act(async () => {
      pending.resolve(["stale course"]);
    });
    expect(result.current.data).toEqual(["new session"]);
    expect(result.current.isLoading).toBe(false);
  });

  it("resets the selected course when the session is invalidated", () => {
    configStore.dispatch(courseSlice.actions.setSelectedCourseId(42));
    expect(configStore.getState().course.selectedCourseId).toBe(42);

    invalidateSession();

    expect(configStore.getState().course.selectedCourseId).toBe(-1);
  });

  it("re-loads the selected course for the new account after a session change", async () => {
    const load = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={configStore}>{children}</Provider>
    );
    renderHook(() => useAutoLoadCourse(load), { wrapper });

    act(() => {
      configStore.dispatch(courseSlice.actions.setSelectedCourseId(42));
    });
    await waitFor(() => expect(load).toHaveBeenCalledWith(42));

    act(() => {
      invalidateSession();
    });
    expect(configStore.getState().course.selectedCourseId).toBe(-1);

    // The new account may select the same numeric course id; it must still be
    // loaded for that account rather than reused from the previous session.
    act(() => {
      configStore.dispatch(courseSlice.actions.setSelectedCourseId(42));
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith(42);
  });

  it("does not reuse a config that was cached for a previous account", async () => {
    let token = "A token";
    mocks.invoke.mockImplementation((command: string) =>
      command === "get_config"
        ? Promise.resolve(configFixture(token))
        : Promise.resolve(undefined)
    );

    expect((await getConfig(true))?.token).toBe("A token");
    expect((await getConfig())?.token).toBe("A token");
    expect(countCalls("get_config")).toBe(1);

    token = "B token";
    invalidateSession();

    // The cached config belongs to the previous session and must be re-read.
    expect((await getConfig())?.token).toBe("B token");
    expect(countCalls("get_config")).toBe(2);
    expect(configStore.getState().config.data?.token).toBe("B token");
  });

  it("does not publish a config that was saved for a previous account", async () => {
    const read = respondTo("get_config");
    const loading = getConfig(true);
    await waitFor(() => expect(countCalls("get_config")).toBe(1));
    read.resolve(configFixture("A token"));
    const config = await loading;
    const write = respondTo("save_config");
    const saving = saveConfig(config);
    const rejected = expect(saving).rejects.toMatchObject({ name: "StaleConfigSessionError" });
    await waitFor(() => expect(countCalls("save_config")).toBe(1));
    expect(mocks.invoke).toHaveBeenCalledWith("save_config", {
      config: expect.not.objectContaining({ __config_owner: expect.anything() }),
      expectedOwner: config.__config_owner,
    });

    invalidateSession();
    const nextRead = respondTo("get_config");
    const nextLoading = getConfig(true);
    await act(async () => {
      write.resolve("synthetic-committed-A-successor");
      await rejected;
    });
    await waitFor(() => expect(countCalls("get_config")).toBe(2));
    nextRead.resolve(configFixture("B token"));
    await nextLoading;

    expect(configStore.getState().config.data?.token).toBe("B token");
  });
});


describe("configuration read failure retry boundary", () => {
  it.each(["rejected", "ownerless"])("%s stops useBaseURL from an unbounded session retry loop", async kind => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.invoke.mockImplementation((command: string) => {
      if (command !== "get_config") return Promise.resolve(undefined);
      return kind === "rejected" ? Promise.reject(new Error("synthetic unavailable")) : Promise.resolve({account_type: "Default"});
    });
    const {result, unmount} = renderHook(() => useBaseURL());
    try {
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(countCalls("get_config")).toBeLessThanOrEqual(2);
      const calls = countCalls("get_config");
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
      expect(countCalls("get_config")).toBe(calls);
    } finally { unmount(); error.mockRestore(); }
  });
});


it("a successful read and an explicit session change each reopen the failure invalidation boundary", async () => {
  mocks.invoke.mockRejectedValue(new Error("synthetic unavailable"));
  const initial = currentSession();
  await expect(getConfig(true)).rejects.toMatchObject({name: "ConfigReadFailure"});
  const failed = currentSession(); expect(failed).toBe(initial + 1);
  await expect(getConfig(true)).rejects.toMatchObject({name: "ConfigReadFailure"});
  expect(currentSession()).toBe(failed);
  mocks.invoke.mockResolvedValue(configFixture("recovered"));
  await getConfig(true); const restored = currentSession();
  mocks.invoke.mockRejectedValue(new Error("synthetic unavailable again"));
  await expect(getConfig(true)).rejects.toMatchObject({name: "ConfigReadFailure"});
  expect(currentSession()).toBe(restored + 1);
  invalidateSession(); const changed = currentSession();
  await expect(getConfig(true)).rejects.toMatchObject({name: "ConfigReadFailure"});
  expect(currentSession()).toBe(changed + 1);
});
