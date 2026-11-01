import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import PrimaryColorField, { DEFAULT_PRIMARY } from "../primary_color_field";

afterEach(cleanup);

it("keeps dragging local and commits the native change even after input already updated the value", () => {
  const onChange = vi.fn();
  const parentRender = vi.fn();
  function Parent() {
    parentRender();
    const [value, setValue] = useState(DEFAULT_PRIMARY);
    return <PrimaryColorField value={value} onChange={(next) => { onChange(next); setValue(next); }} />;
  }
  render(<Parent />);
  const picker = screen.getByLabelText("选择主色");
  const initialRenders = parentRender.mock.calls.length;
  for (let index = 0; index < 60; index++) {
    fireEvent.input(picker, { target: { value: `#3366${index.toString(16).padStart(2, "0")}` } });
  }
  expect(screen.getByLabelText("主色调")).toHaveValue("#33663b");
  expect(onChange).not.toHaveBeenCalled();
  expect(parentRender).toHaveBeenCalledTimes(initialRenders);

  fireEvent.change(picker, { target: { value: "#33663b" } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith("#33663b");
  fireEvent.blur(picker);
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("restores the default color and replaces a pending drag preview", () => {
  const onChange = vi.fn();
  render(<PrimaryColorField value="#336699" onChange={onChange} />);
  fireEvent.input(screen.getByLabelText("选择主色"), { target: { value: "#ff0000" } });
  fireEvent.click(screen.getByRole("button", { name: "恢复默认主色调" }));
  expect(screen.getByLabelText("主色调")).toHaveValue(DEFAULT_PRIMARY);
  expect(screen.getByLabelText("选择主色")).toHaveValue(DEFAULT_PRIMARY);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(DEFAULT_PRIMARY);
});

it("syncs externally changed colors and preserves direct Hex editing", () => {
  const onChange = vi.fn();
  const { rerender } = render(<PrimaryColorField value="#336699" onChange={onChange} />);
  fireEvent.input(screen.getByLabelText("选择主色"), { target: { value: "#ff0000" } });
  rerender(<PrimaryColorField value={DEFAULT_PRIMARY} onChange={onChange} />);
  expect(screen.getByLabelText("主色调")).toHaveValue(DEFAULT_PRIMARY);
  fireEvent.change(screen.getByLabelText("主色调"), { target: { value: "#123456" } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith("#123456");
});
