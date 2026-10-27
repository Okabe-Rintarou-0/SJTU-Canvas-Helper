import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter } from "react-router-dom";
import { MenuItem } from "@mui/material";
import RetainedVideoWorkspace from "../retained_video_workspace";
import BasicLayout from "../layout";
import WorkspaceSelect from "../workspace_select";
import CourseSelect from "../course_select";
import { resetVideoWorkspace } from "../../lib/video_workspace";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "test" }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../../lib/hooks", () => ({ useConfigSelector: (selector: (state: unknown) => unknown) => selector({ config: { data: {} } }) }));
vi.mock("../../lib/task_hooks", () => ({ useTasks: () => [] }));
vi.mock("../../lib/task_manager", () => ({ isTaskActive: () => false, taskManager: { markCompletionsRead: vi.fn() } }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [{}, null] }));
vi.mock("../../lib/utils", () => ({ checkForUpdates: vi.fn() }));
vi.mock("../../lib/update_notice", () => ({ useUpdateNotice: () => ({ availableVersion: null, setAvailableVersion: vi.fn(), previewOnly: false }) }));
vi.mock("../change_log_modal", () => ({ ChangeLogModal: ({ open }: { open: boolean }) => open ? <div role="dialog">更新弹窗</div> : null }));
vi.mock("../task_popover", () => ({ default: () => null }));
vi.mock("../log_modal", () => ({ default: () => null }));

afterEach(cleanup);

it("mounts lazily, keeps layout/media identity, and releases on account reset", async () => {
  render(<MemoryRouter initialEntries={["/settings"]}>
    <Link to="/settings">离开</Link><Link to="/video">返回</Link>
    <RetainedVideoWorkspace>{(active) => <BasicLayout active={active} contentKey="video-workspace"><video data-testid="media" /></BasicLayout>}</RetainedVideoWorkspace>
  </MemoryRouter>);
  expect(screen.queryByTestId("media")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("返回"));
  const media = screen.getByTestId("media");
  fireEvent.click(screen.getByText("离开"));
  expect(media).toBeInTheDocument(); expect(media).not.toBeVisible();
  fireEvent.click(screen.getByText("返回")); expect(screen.getByTestId("media")).toBe(media);
  fireEvent.click(screen.getByText("离开"));
  act(() => resetVideoWorkspace()); expect(media).not.toBeInTheDocument();
});

it("closes a portaled camera menu on navigation and does not reopen it on return", async () => {
  render(<MemoryRouter initialEntries={["/video"]}>
    <Link to="/settings">离开</Link><Link to="/video">返回</Link>
    <RetainedVideoWorkspace>{() => <WorkspaceSelect label="机位" value="main"><MenuItem value="main">主机位</MenuItem></WorkspaceSelect>}</RetainedVideoWorkspace>
  </MemoryRouter>);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "机位" }));
  expect(screen.getByRole("listbox")).toBeInTheDocument();
  fireEvent.click(screen.getByText("离开"));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  fireEvent.click(screen.getByText("返回"));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("closes the course picker portal when its page becomes inactive", async () => {
  render(<MemoryRouter initialEntries={["/video"]}>
    <Link to="/settings">离开</Link><Link to="/video">返回</Link>
    <RetainedVideoWorkspace>{() => <CourseSelect courses={[{ id: 1, name: "课程", term: { id: 1, name: "Fall" }, teachers: [], enrollments: [] } as never]} />}</RetainedVideoWorkspace>
  </MemoryRouter>);
  fireEvent.mouseDown(screen.getByRole("combobox"));
  expect(await screen.findByRole("listbox")).toBeInTheDocument();
  fireEvent.click(screen.getByText("离开"));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  fireEvent.click(screen.getByText("返回")); expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
