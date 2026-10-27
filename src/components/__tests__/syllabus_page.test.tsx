import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import SyllabusPage from "../../page/syllabus";
import type { Course } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), log: vi.fn(), initialCourse: 1 }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/diagnostics", () => ({ consoleLog: mocks.log }));
vi.mock("../layout", () => ({ default: ({ children }: PropsWithChildren) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: ({ value, onChange }: { value?: number; onChange: (id: number) => void }) =>
  <select aria-label="课程" value={value ?? -1} onChange={(event) => onChange(Number(event.target.value))}>
    <option value={-1}>请选择</option><option value={1}>课程一</option><option value={2}>课程二</option>
  </select> }));
vi.mock("../../lib/hooks", async () => {
  const { useState } = await import("react");
  const { useCourseSyllabus } = await import("../../lib/course_syllabus");
  return { useCourseSyllabus, useCourses: () => ({ data: [] }), useSelectedCourse: () => {
    const [selectedCourseId, setSelectedCourseId] = useState(mocks.initialCourse);
    return { selectedCourseId, setSelectedCourseId };
  } };
});

const course = (syllabus_body = ""): Course => ({ id: 1, syllabus_body } as Course);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.initialCourse = 1;
  mocks.invoke.mockResolvedValue(course());
});
afterEach(cleanup);

it("shows a helpful failure with retry, keeps diagnostics out of the page and clears errors after success", async () => {
  const technical = "Json deserialization error, object type: sjtu_canvas_helper::model::Course, reason: invalid_type";
  mocks.invoke.mockRejectedValueOnce(technical).mockResolvedValueOnce(course("<p>课程考核方式</p>"));
  render(<SyllabusPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法加载教学大纲");
  expect(screen.queryByText(technical)).not.toBeInTheDocument();
  expect(screen.queryByText("该课程暂无教学大纲")).not.toBeInTheDocument();
  expect(mocks.log).toHaveBeenCalledWith(3, technical);
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(await screen.findByText("课程考核方式")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it.each(["", "   \n "])("treats an empty syllabus as unpublished without showing an error", async (body) => {
  mocks.invoke.mockResolvedValue(course(body));
  render(<SyllabusPage />);
  expect(await screen.findByText("该课程暂无教学大纲")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("waits for a course selection before requesting a syllabus", async () => {
  mocks.initialCourse = -1;
  render(<SyllabusPage />);
  expect(screen.getByText("请先选择课程")).toBeVisible();
  expect(mocks.invoke).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "课程" }), { target: { value: "1" } });
  await screen.findByText("该课程暂无教学大纲");
  expect(mocks.invoke).toHaveBeenCalledWith("get_course_syllabus", { courseId: 1 });
});

it("ignores a previous course's late error and clears content when selection is removed", async () => {
  let rejectFirst!: (reason: unknown) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
  mocks.invoke.mockResolvedValueOnce(course("<p>课程二的大纲</p>"));
  render(<SyllabusPage />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("combobox", { name: "课程" }), { target: { value: "2" } });
  await screen.findByText("课程二的大纲");
  await act(async () => rejectFirst("late failure"));
  expect(screen.getByText("课程二的大纲")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mocks.log).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "课程" }), { target: { value: "-1" } });
  expect(screen.getByText("请先选择课程")).toBeVisible();
  expect(screen.queryByText("课程二的大纲")).not.toBeInTheDocument();
});
