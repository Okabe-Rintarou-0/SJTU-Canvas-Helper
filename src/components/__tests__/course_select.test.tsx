import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CourseSelect from "../course_select";
import type { Course } from "../../lib/model";

const courses: Course[] = Array.from({ length: 40 }, (_, index) => ({
  id: index + 1, uuid: `course-${index + 1}`, name: `Course ${index + 1}`,
  course_code: `TEST${index + 1}`, enrollments: [], teachers: [],
  access_restricted_by_date: false,
  term: { id: 1, name: "2026 Fall", start_at: null, end_at: null, created_at: null, workflow_state: "active" },
}));

beforeEach(() => {
  // JSDOM has no layout; supply a non-empty anchor for MUI Popper.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 56, width: 640, height: 56,
    toJSON: () => ({}),
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([undefined, 1])("keeps the course list mounted across parent renders (selected: %s)", async (value) => {
  const view = render(<CourseSelect courses={courses} value={value} onChange={() => {}} />);
  fireEvent.mouseDown(screen.getByRole("combobox"));
  const list = await screen.findByRole("listbox");

  // Allow MUI's initial filtered-options/highlight synchronization. Even that
  // first parent update must preserve the list DOM instead of remounting it.
  view.rerender(<CourseSelect courses={courses} value={value} onChange={() => {}} />);
  expect(screen.getByRole("listbox")).toBe(list);

  for (let update = 0; update < 3; update++) {
    list.scrollTop = 640;
    view.rerender(<CourseSelect courses={courses} value={value} onChange={() => {}} />);
    expect(screen.getByRole("listbox")).toBe(list);
    expect(list.scrollTop).toBe(640);
  }
});
