import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskPopover from "../task_popover";
import { taskManager } from "../../lib/task_manager";

vi.mock("../preview_modal", () => ({ default: () => null }));
afterEach(() => {
  cleanup();
  taskManager.getSnapshot().forEach((task) => taskManager.remove(task.id));
});

describe("minimal task popover", () => {
  it("shows necessary information and actions without a task page or filters", async () => {
    let finish!: () => void;
    await act(async () => {
      taskManager.enqueue({ id: "ui-done", name: "已下载.pdf", kind: "file", source: "files", run: async () => {}, open: async () => {} });
      taskManager.enqueue({ id: "ui-failed", name: "失败附件.zip", kind: "attachment", source: "submissions", run: async () => { throw new Error("网络中断"); } });
      taskManager.enqueue({ id: "ui-running", name: "课程视频.mp4", kind: "video", source: "video", run: async ({ update }) => { update({ progress: 42, stage: "正在下载" }); await new Promise<void>((resolve) => { finish = resolve; }); } });
      taskManager.enqueue({ id: "ui-merge", name: "未保存.pdf", kind: "pdf-merge", source: "files", run: async ({ update, setSave }) => { update({ result: { url: "blob:test", name: "未保存.pdf" } }); setSave(async () => {}); } });
    });
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ x: 16, y: 700, width: 240, height: 44, top: 700, left: 16, right: 256, bottom: 744, toJSON: () => ({}) });
    document.body.appendChild(anchor);
    const close = vi.fn();
    render(<TaskPopover anchorEl={anchor} onClose={close} />);
    const dialog = within(screen.getByRole("dialog", { name: "任务中心" }));
    expect(dialog.getByText(/42%/)).toBeInTheDocument();
    expect(dialog.getByText("视频管理 · 视频下载")).toBeInTheDocument();
    expect(dialog.getByText("提交批改 · 附件下载")).toBeInTheDocument();
    expect(taskManager.getSnapshot().some((task) => task.unreadCompletion)).toBe(false);
    expect(dialog.queryByRole("textbox")).not.toBeInTheDocument();
    expect(dialog.queryByRole("combobox")).not.toBeInTheDocument();
    expect(dialog.queryByRole("tablist")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "重试 失败附件.zip" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "清除记录 课程视频.mp4" })).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "清除已完成记录" }));
    expect(dialog.queryByText("已下载.pdf")).not.toBeInTheDocument();
    expect(dialog.getByText("未保存.pdf")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "关闭任务中心" }));
    expect(close).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(taskManager.getSnapshot().some((task) => task.unreadCompletion)).toBe(false);
    anchor.remove();
  });
});
