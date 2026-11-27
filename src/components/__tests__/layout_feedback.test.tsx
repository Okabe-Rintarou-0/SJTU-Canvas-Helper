import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import BasicLayout, { AppShell } from "../layout";
import type { Task } from "../../lib/task_manager";

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  centerEnabled: false,
  availableVersion: null as string | null,
  openExternal: vi.fn().mockResolvedValue(undefined),
  checkForUpdates: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "3.0.13" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => "版本：3.0.13\n近期运行日志\n" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.openExternal }));
vi.mock("@mui/material", async (importOriginal) => ({ ...await importOriginal<typeof import("@mui/material")>(), useMediaQuery: () => true }));
vi.mock("../../lib/hooks", () => ({ useConfigSelector: (selector: (state: unknown) => unknown) => selector({ config: { data: { experimental_task_center_only: mocks.centerEnabled } } }) }));
vi.mock("../../lib/task_hooks", () => ({ useTasks: () => mocks.tasks }));
vi.mock("../../lib/task_manager", () => ({ isTaskActive: (task: Task) => task.status === "running" || task.status === "queued", taskManager: { markCompletionsRead: vi.fn() } }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [{}, null] }));
vi.mock("../../lib/utils", () => ({ checkForUpdates: mocks.checkForUpdates }));
vi.mock("../../lib/update_notice", () => ({ useUpdateNotice: () => ({ availableVersion: mocks.availableVersion, setAvailableVersion: vi.fn(), previewOnly: false }) }));
vi.mock("../change_log_modal", () => ({ ChangeLogModal: () => null }));
vi.mock("../task_popover", () => ({ default: () => null }));
afterEach(() => {
  cleanup();
  mocks.centerEnabled = false;
  mocks.tasks = [];
  mocks.availableVersion = null;
  vi.clearAllMocks();
});

it("opens logs and feedback from the regular sidebar with no debug or experimental flags", async () => {
  render(<MemoryRouter><AppShell><BasicLayout>页面内容</BasicLayout></AppShell></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "帮助" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "反馈" }));
  expect(await screen.findByRole("dialog", { name: "日志与反馈" })).toBeInTheDocument();
  expect(await screen.findByText(/暂无运行日志/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导出诊断信息" })).toBeEnabled();
});

it("checks updates from the sidebar and opens the community thread from support", async () => {
  mocks.availableVersion = "3.0.14";
  render(<MemoryRouter><AppShell><BasicLayout>页面内容</BasicLayout></AppShell></MemoryRouter>);
  expect(await screen.findByText("SJTU Canvas Helper v3.0.13")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "检查更新，有新版本 v3.0.14" }));
  expect(mocks.checkForUpdates).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "帮助" }));
  expect(screen.queryByRole("menuitem", { name: /检查更新/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "水源社区讨论帖" }));
  expect(mocks.openExternal).toHaveBeenCalledWith("https://shuiyuan.sjtu.edu.cn/t/topic/245275");
});

it("groups secondary course tools and follows the existing routes", async () => {
  render(<MemoryRouter><AppShell><BasicLayout>页面内容</BasicLayout></AppShell></MemoryRouter>);
  expect(screen.queryByRole("link", { name: "成员导出" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "其他工具" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["讨论管理", "成员导出", "教学大纲", "二维码管理"]);
  fireEvent.click(screen.getByRole("menuitem", { name: "成员导出" }));
  fireEvent.click(screen.getByRole("button", { name: "其他工具" }));
  expect(await screen.findByRole("menuitem", { name: "成员导出" })).toHaveAttribute("aria-current", "page");
});

it("includes completed tasks from the active batch in overall progress", () => {
  mocks.centerEnabled = true;
  const task = { source: "files", kind: "file", stage: "正在下载", createdAt: 0, attempt: 1, canOpen: false, canSave: false } as const;
  mocks.tasks = [
    { ...task, id: "old", name: "历史任务", batch: 1, status: "succeeded", progress: 100 },
    { ...task, id: "done", name: "已下载", batch: 2, status: "succeeded", progress: 100 },
    { ...task, id: "active", name: "正在下载", batch: 2, status: "running", progress: 20 },
    { ...task, id: "queued", name: "排队中", batch: 2, status: "queued" },
  ];
  render(<MemoryRouter><AppShell><BasicLayout>页面内容</BasicLayout></AppShell></MemoryRouter>);
  expect(screen.getByRole("progressbar", { name: "任务总进度" })).toHaveAttribute("aria-valuenow", "40");
});

it("keeps the sidebar and its collapsed state when the routed page changes", () => {
  render(<MemoryRouter initialEntries={["/files"]}>
    <AppShell>
      <Routes>
        <Route path="/files" element={<BasicLayout>文件页</BasicLayout>} />
        <Route path="/assignments" element={<BasicLayout>作业页</BasicLayout>} />
        <Route path="/settings" element={<BasicLayout>设置页</BasicLayout>} />
      </Routes>
    </AppShell>
  </MemoryRouter>);
  const navigation = screen.getByRole("navigation", { name: "功能导航" });
  expect(within(navigation).getByRole("link", { name: "视频中心" })).toHaveAttribute("href", "/video");
  expect(within(navigation).queryByRole("link", { name: "系统设置" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
  const assignments = within(navigation).getByRole("link", { name: "作业列表" });
  fireEvent.click(assignments);
  expect(screen.getByText("作业页")).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "功能导航" })).toBe(navigation);
  expect(within(navigation).getByRole("link", { name: "作业列表" })).toBe(assignments);
  expect(assignments).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "系统设置" }));
  expect(screen.getByText("设置页")).toBeInTheDocument();
});
