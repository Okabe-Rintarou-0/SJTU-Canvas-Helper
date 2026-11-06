import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { currentSession, invalidateSession } from "./session";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../components/preview_modal", () => ({ default: () => null }));
vi.mock("./pdf_tasks", () => ({ enqueuePDFMerge: vi.fn() }));
vi.mock("./message", () => ({ appMessage: () => ({ error: mocks.error }) }));
import { useData, useFolderFiles } from "./hooks";
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { invalidateSession(); mocks.invoke.mockReset(); mocks.error.mockReset(); });
afterEach(cleanup);
it("does not expose previous-session data even during the first new-session render", async () => {
  const first = deferred<string[]>(); const second = deferred<string[]>();
  mocks.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const seen: { owner: number; data: string[] | undefined }[] = [];
  renderHook(() => { const state = useData<string[]>("source", true); seen.push({ owner: currentSession(), data: state.data }); return state; });
  await act(async () => first.resolve(["old"]));
  act(() => invalidateSession());
  const owner = currentSession();
  expect(seen.filter((state) => state.owner === owner).every((state) => state.data === undefined)).toBe(true);
  await act(async () => second.resolve(["new"]));
});
it("does not let a retained old mutate callback invoke the old arguments in a new session", async () => {
  mocks.invoke.mockResolvedValue([]);
  const view = renderHook(() => useData("source", true));
  const oldMutate = view.result.current.mutate;
  await act(async () => invalidateSession());
  mocks.invoke.mockClear();
  await act(async () => oldMutate());
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("keeps newer same-session results when an earlier request resolves last", async () => {
  const first = deferred<string[]>(); const second = deferred<string[]>();
  mocks.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = renderHook(() => useData<string[]>("source", true));
  act(() => { void view.result.current.mutate(); });
  await act(async () => second.resolve(["new"]));
  await act(async () => first.resolve(["old"]));
  expect(view.result.current.data).toEqual(["new"]);
});
it("ignores late failures and loading changes from a superseded request", async () => {
  const first = deferred<string[]>(); const second = deferred<string[]>();
  mocks.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = renderHook(() => useData<string[]>("source", true));
  act(() => { void view.result.current.mutate(); });
  await act(async () => first.reject(new Error("old")));
  expect(mocks.error).not.toHaveBeenCalled();
  expect(view.result.current.isLoading).toBe(true);
  await act(async () => second.resolve(["new"]));
  expect(view.result.current.data).toEqual(["new"]);
});
it("restarts automatic loading when enabled without changing arguments", async () => {
  mocks.invoke.mockResolvedValue(["new"]);
  const view = renderHook(({ enabled }) => useData("source", enabled), { initialProps: { enabled: false } });
  expect(mocks.invoke).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  await waitFor(() => expect(view.result.current.data).toEqual(["new"]));
  expect(mocks.invoke).toHaveBeenCalledOnce();
});
it("masks old selection data on the first render and rejects its retained refresh callback", async () => {
  const first = deferred<string[]>(); const second = deferred<string[]>();
  mocks.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const seen: { id: number; data: unknown }[] = [];
  const view = renderHook(({ id }) => {
    const args = useMemo(() => ({ id }), [id]); const state = useData("source", true, args);
    seen.push({ id, data: state.data }); return state;
  }, { initialProps: { id: 1 } });
  await act(async () => first.resolve(["old"])); const oldMutate = view.result.current.mutate;
  view.rerender({ id: 2 });
  expect(seen.filter((state) => state.id === 2).every((state) => state.data === undefined)).toBe(true);
  mocks.invoke.mockClear(); await act(async () => oldMutate());
  expect(mocks.invoke).not.toHaveBeenCalled();
  await act(async () => second.resolve(["new"]));
});
it("does not request the previous folder during a simultaneous session and folder change", async () => {
  mocks.invoke.mockResolvedValue([]);
  const view = renderHook(({ id }) => useFolderFiles(id), { initialProps: { id: 1 } });
  await act(async () => {}); mocks.invoke.mockClear();
  act(() => { invalidateSession(); view.rerender({ id: 2 }); });
  await act(async () => {});
  expect(mocks.invoke.mock.calls).toEqual([["list_folder_files", { folderId: 2 }]]);
});
it("does not publish or notify after unmount and rejects its old refresh callback", async () => {
  const pending = deferred<unknown>(); mocks.invoke.mockReturnValueOnce(pending.promise);
  const view = renderHook(() => useData("source", true)); const mutate = view.result.current.mutate;
  view.unmount();
  await act(async () => pending.reject(new Error("late")));
  expect(mocks.error).not.toHaveBeenCalled();
  mocks.invoke.mockClear(); await act(async () => mutate());
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("keeps an unchanged old folder unauthorized until it is selected again", async () => {
  mocks.invoke.mockResolvedValue([]);
  const view = renderHook(({ id }: { id?: number }) => useFolderFiles(id), { initialProps: { id: 1 } as { id?: number } });
  await act(async () => {}); mocks.invoke.mockClear();
  act(() => invalidateSession());
  await act(async () => view.result.current.mutate());
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(view.result.current.data).toBeUndefined();
  view.rerender({ id: undefined }); view.rerender({ id: 1 });
  await act(async () => {});
  expect(mocks.invoke.mock.calls).toEqual([["list_folder_files", { folderId: 1 }]]);
});
it("ignores an enabled request after loading is disabled", async () => {
  const pending = deferred<string[]>(); mocks.invoke.mockReturnValueOnce(pending.promise);
  const view = renderHook(({ enabled }) => useData<string[]>("source", enabled), { initialProps: { enabled: true } });
  view.rerender({ enabled: false });
  await act(async () => pending.resolve(["old"]));
  expect(view.result.current.data).toBeUndefined();
  expect(view.result.current.isLoading).toBe(false);
});
