import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import VideoLibraryTasks from "../video_library_tasks";
import type { Task } from "../../lib/task_manager";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each([
  [{ outputDirectory: "D:/课程/第一堂" }, "D:/课程/第一堂"],
  [{ outputPath: "D:/字幕.srt" }, "D:/"],
])("opens local export directories without URL validation", (output, expected) => {
  const task: Task = { id: "export", name: "字幕", kind: "subtitle", source: "video", status: "succeeded", stage: "已完成", createdAt: 0, attempt: 0, canOpen: false, canSave: false, ...output };
  render(<VideoLibraryTasks tasks={[task]} />);
  fireEvent.click(screen.getByRole("button", { name: "目录" }));
  expect(invoke).toHaveBeenCalledWith("open_local_path", { path: expected });
});
