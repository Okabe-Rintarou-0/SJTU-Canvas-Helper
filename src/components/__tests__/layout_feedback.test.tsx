import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import BasicLayout from "../layout";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "3.0.13" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => "版本：3.0.13\n近期运行日志\n" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@mui/material", async (importOriginal) => ({ ...await importOriginal<typeof import("@mui/material")>(), useMediaQuery: () => true }));
vi.mock("../../lib/hooks", () => ({ useConfigSelector: (selector: (state: unknown) => unknown) => selector({ config: { data: {} } }) }));
vi.mock("../../lib/task_hooks", () => ({ useTasks: () => [] }));
vi.mock("../../lib/task_manager", () => ({ isTaskActive: () => false, taskManager: { markCompletionsRead: vi.fn() } }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [{}, null] }));
vi.mock("../../lib/utils", () => ({ checkForUpdates: vi.fn() }));
vi.mock("../../lib/update_notice", () => ({ useUpdateNotice: () => ({ availableVersion: null, setAvailableVersion: vi.fn(), previewOnly: false }) }));
vi.mock("../change_log_modal", () => ({ ChangeLogModal: () => null }));
vi.mock("../task_popover", () => ({ default: () => null }));
afterEach(cleanup);

it("opens logs and feedback from the regular sidebar with no debug or experimental flags", async () => {
  render(<MemoryRouter><BasicLayout>页面内容</BasicLayout></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "反馈" }));
  expect(await screen.findByRole("dialog", { name: "日志与反馈" })).toBeInTheDocument();
  expect(await screen.findByText(/暂无运行日志/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导出诊断信息" })).toBeEnabled();
});
