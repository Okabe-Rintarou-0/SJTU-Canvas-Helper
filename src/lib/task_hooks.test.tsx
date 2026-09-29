import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLegacyTasks, useTasks } from "./task_hooks";
import { taskManager } from "./task_manager";
import type { FileDownloadTask } from "./model";

describe("shared task views", () => {
  it("keeps page and center progress consistent across unmounts without starting another job", async () => {
    let resolve!: () => void;
    let starts = 0;
    const id = "hook-test-file";
    const source = renderHook(() => useLegacyTasks<FileDownloadTask>("files", ["file"]));
    const center = renderHook(() => useTasks());
    act(() => {
      taskManager.enqueue({
        id, name: "lecture.pdf", kind: "file", source: "files", data: { file: { uuid: id } },
        event: { channel: "download://progress", id },
        run: () => { starts++; return new Promise<void>((done) => { resolve = done; }); },
      });
      taskManager.progress("download://progress", id, 2, 4);
    });
    expect(source.result.current[0].progress).toBe(50);
    expect(center.result.current.find((task) => task.id === id)?.progress).toBe(50);
    source.unmount();
    act(() => taskManager.progress("download://progress", id, 3, 4));
    const remounted = renderHook(() => useLegacyTasks<FileDownloadTask>("files", ["file"]));
    expect(remounted.result.current[0].progress).toBe(75);
    expect(starts).toBe(1);
    await act(async () => resolve());
    expect(remounted.result.current[0].state).toBe("succeed");
    act(() => taskManager.remove(id));
    expect(remounted.result.current).toHaveLength(0);
    center.unmount();
    remounted.unmount();
  });
});
