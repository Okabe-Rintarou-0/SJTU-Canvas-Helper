import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CourseSelect from "../course_select";
import type { Course } from "../../lib/model";

afterEach(cleanup);

const courses: Course[] = Array.from({ length: 40 }, (_, index) => ({
  id: index + 1,
  uuid: `course-${index + 1}`,
  name: `课程 ${index + 1}`,
  course_code: `COURSE-${index + 1}`,
  enrollments: [],
  access_restricted_by_date: false,
  teachers: [],
  term: {
    id: 1,
    name: "2026 Fall",
    start_at: null,
    end_at: null,
    created_at: null,
    workflow_state: "active",
  },
}));

it.each([undefined, 1])("keeps scrolling during unrelated parent updates with stable props (value: %s)", (value) => {
  const onChange = vi.fn();
  const view = render(<CourseSelect courses={courses} value={value} onChange={onChange} />);
  fireEvent.mouseDown(screen.getByRole("combobox"));
  const list = screen.getByRole("listbox");
  list.scrollTop = 480;
  fireEvent.scroll(list);
  for (let update = 0; update < 3; update++) {
    view.rerender(<CourseSelect courses={courses} value={value} onChange={onChange} />);
    expect(screen.getByRole("listbox")).toBe(list);
    expect(list.scrollTop).toBe(480);
  }
  fireEvent.click(within(list).getByRole("option", { name: /课程 40/ }));
  expect(onChange).toHaveBeenCalledWith(40);
}, 15_000);

it("preserves the open course list and scroll position across parent updates with a selected course", () => {
  const value = 1;
  const onChange = vi.fn();
  const view = render(<CourseSelect courses={courses} value={value} onChange={(id) => onChange(id)} />);
  fireEvent.mouseDown(screen.getByRole("combobox"));
  const list = screen.getByRole("listbox");
  list.scrollTop = 480;
  fireEvent.scroll(list);

  // Other parent state updates can still supply fresh callbacks with unchanged courses.
  for (let update = 0; update < 3; update++) {
    view.rerender(<CourseSelect courses={courses} value={value} onChange={(id) => onChange(id)} />);
    expect(screen.getByRole("listbox")).toBe(list);
    expect(list.scrollTop).toBe(480);
  }

  fireEvent.click(within(list).getByRole("option", { name: /课程 40/ }));
  expect(onChange).toHaveBeenCalledWith(40);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
}, 15_000);
