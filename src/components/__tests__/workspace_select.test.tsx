import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MenuItem } from "@mui/material";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceSelect from "../workspace_select";

afterEach(cleanup);

it("keeps menu scroll and focus when a parent updates its callbacks and items", () => {
  const first = vi.fn();
  const latest = vi.fn();
  const options = () => Array.from({ length: 40 }, (_, index) => <MenuItem key={index} value={index}>机位 {index + 1}</MenuItem>);
  const view = render(<WorkspaceSelect label="机位" value={0} onChange={first}>{options()}</WorkspaceSelect>);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "机位" }));
  const list = screen.getByRole("listbox");
  const focused = document.activeElement;
  list.scrollTop = 480;
  fireEvent.scroll(list);
  view.rerender(<WorkspaceSelect label="机位" value={0} onChange={latest}>{options()}</WorkspaceSelect>);
  expect(screen.getByRole("listbox")).toBe(list);
  expect(list.scrollTop).toBe(480);
  expect(document.activeElement).toBe(focused);
  fireEvent.click(within(list).getByRole("option", { name: "机位 40" }));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
}, 15_000);
