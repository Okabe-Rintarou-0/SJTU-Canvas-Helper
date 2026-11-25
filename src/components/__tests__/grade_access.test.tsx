import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import GradePage from "../../page/grades";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  errorToast: vi.fn(),
  selectedCourseId: 37,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("react-redux", () => ({
  useSelector: (select: (state: unknown) => unknown) =>
    select({ course: { selectedCourseId: mocks.selectedCourseId } }),
  useDispatch: () => vi.fn(),
}));
vi.mock("../../lib/downloads", () => ({
  downloadCourseContext: vi.fn(),
  downloadDirectory: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../lib/message", () => ({
  appMessage: () => ({ error: mocks.errorToast }),
  useAppMessage: () => [{ error: mocks.errorToast }, null],
}));
vi.mock("../../lib/utils", () => ({
  assignmentIsEnded: () => false,
  consoleLog: vi.fn(),
}));
vi.mock("../layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../grade_statistic", () => ({ default: () => null }));
vi.mock("../course_select", () => ({ default: () => null }));
vi.mock("../preview_modal", () => ({ default: () => null }));
vi.mock("../login_alert_modal", () => ({ LoginAlertModal: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("does not request grades for an inherited student course", async () => {
  mocks.invoke.mockResolvedValue([
    { id: 37, enrollments: [{ role: "StudentEnrollment" }] },
    { id: 42, enrollments: [{ role: "TaEnrollment" }] },
  ]);

  render(<GradePage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("当前课程没有成绩管理权限");
  expect(mocks.invoke.mock.calls).toEqual([["list_courses", undefined]]);
  expect(mocks.errorToast).not.toHaveBeenCalled();
});

it("shows one inline permissions notice when Canvas rejects grade requests", async () => {
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "list_courses") {
      return [{ id: 37, name: "测试课程", enrollments: [{ role: "TeacherEnrollment" }] }];
    }
    throw "Network error: HTTP status client error (401 Unauthorized)";
  });

  render(<GradePage />);

  await screen.findByText(/Canvas 拒绝了此课程的成绩访问请求/);
  expect(screen.getByRole("alert")).toHaveTextContent("Canvas 拒绝了此课程的成绩访问请求");
  expect(mocks.invoke).toHaveBeenCalledWith("list_course_students", { courseId: 37 });
  expect(mocks.invoke).toHaveBeenCalledWith("list_course_assignments", { courseId: 37 });
  expect(mocks.errorToast).not.toHaveBeenCalled();
});
