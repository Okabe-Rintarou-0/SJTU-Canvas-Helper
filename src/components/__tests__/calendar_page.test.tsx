import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import CalendarPage from "../../page/calendar";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../layout", () => ({ default: ({ children }: PropsWithChildren) => <>{children}</> }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("shows a course name and deadline in the selected day's assignment list", async () => {
  vi.setSystemTime(new Date(2026, 10, 24, 9));
  const due = new Date(2026, 10, 25, 18).toISOString();
  const assignment = {
    id: "assignment_12",
    title: "进程实验",
    context_code: "course_37",
    context_name: "abbreviated",
    end_at: new Date(2026, 10, 26, 12).toISOString(),
    assignment: { id: 12, due_at: due, lock_at: new Date(2026, 10, 27, 18).toISOString() },
  };
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_colors") return { custom_colors: { course_37: "#00b96b" } };
    if (command === "list_courses") return [{ id: 37, name: "操作系统" }, { id: 41, name: "计算机网络" }];
    return command === "list_calendar_events" ? [assignment, assignment] : [];
  });
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);

  const day = await screen.findByRole("button", { name: "11 月 25 日，1 项作业" });
  fireEvent.click(day.parentElement!.querySelector("a")!);
  expect(day).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "11 月 26 日，0 项作业" })).toBeVisible();
  expect(screen.getByRole("button", { name: "11 月 27 日，0 项作业" })).toBeVisible();
  fireEvent.click(day.parentElement!);
  const selectedAgenda = screen.getByRole("heading", { name: "11 月 25 日事项" }).parentElement!;
  expect(within(selectedAgenda).getByRole("link", { name: /进程实验 操作系统/ })).toHaveAttribute("href", "/assignments?id=37");
  expect(within(selectedAgenda).getByText("11/25 18:00")).toBeVisible();
  expect(screen.getByText("剩 1 天 9 小时")).toBeVisible();
  expect(mocks.invoke).toHaveBeenCalledWith("list_calendar_events", expect.objectContaining({ contextCodes: ["course_37"] }));
});

it("opens adjacent dates and returns to today with the month controls", async () => {
  vi.setSystemTime(new Date(2026, 10, 24, 9));
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_colors") return { custom_colors: {} };
    return [];
  });
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "10 月 31 日，0 项作业" }).parentElement!);
  expect(screen.getByRole("heading", { name: "10 月 31 日事项" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "上个月" }));
  expect(screen.getByRole("heading", { name: "9 月 1 日事项" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "下个月" }));
  expect(screen.getByRole("heading", { name: "10 月 1 日事项" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "回到今天" }));
  expect(await screen.findByText("当天没有作业截止或关闭。")).toBeVisible();
  expect(screen.getByRole("heading", { name: "11 月 24 日事项" })).toBeVisible();
});

it("shows past lock-only assignments in their month and future lock dates in the upcoming agenda", async () => {
  vi.setSystemTime(new Date(2026, 10, 24, 9));
  const event = (id: number, title: string, date: Date) => ({
    title,
    context_code: "course_37",
    assignment: { id, due_at: null, lock_at: date.toISOString() },
    start_at: null,
    end_at: null,
  });
  const closedAssignment = event(1, "旧作业", new Date(2026, 9, 15, 18));
  const closingAssignment = event(2, "即将关闭的作业", new Date(2026, 10, 28, 18));
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_colors") return { custom_colors: { course_37: "#00b96b" } };
    if (command === "list_courses") return [{ id: 37, name: "操作系统" }];
    return command === "list_calendar_assignments_with_only_lock_dates"
      ? [closedAssignment, closingAssignment]
      : [];
  });
  render(<MemoryRouter><CalendarPage /></MemoryRouter>);

  const upcoming = screen.getByRole("heading", { name: "未来七天" }).parentElement!;
  expect(await within(upcoming).findByText("即将关闭的作业")).toBeVisible();
  expect(within(upcoming).getByText("关闭 11/28 18:00")).toBeVisible();
  expect(within(upcoming).queryByText("旧作业")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "上个月" }));
  fireEvent.click(await screen.findByRole("button", { name: "10 月 15 日，1 项作业" }));
  const day = screen.getByRole("heading", { name: "10 月 15 日事项" }).parentElement!;
  expect(within(day).getByText("旧作业")).toBeVisible();
  expect(within(day).getByText("关闭 10/15 18:00")).toBeVisible();
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "list_calendar_assignments_with_only_lock_dates"))
    .toEqual([["list_calendar_assignments_with_only_lock_dates", { contextCodes: ["course_37"] }]]);
});
