import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ErrorBoundary from "../error_boundary";
import { logDiagnostic } from "../../lib/diagnostics";
import { LOG_LEVEL_ERROR } from "../../lib/model";

vi.mock("../../lib/diagnostics", () => ({ logDiagnostic: vi.fn() }));
vi.mock("../log_modal", () => ({ default: ({ onClose }: { onClose: () => void }) => (
  <div role="dialog" aria-label="日志与反馈"><button onClick={onClose}>关闭日志</button></div>
) }));
afterEach(() => vi.restoreAllMocks());

it("logs a rendering failure and keeps feedback available without application providers", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("broken page");
  function BrokenPage(): never { throw error; }
  const suppressExpectedError = (event: ErrorEvent) => {
    if (event.error === error) event.preventDefault();
  };
  window.addEventListener("error", suppressExpectedError);
  try {
    render(<ErrorBoundary><BrokenPage /></ErrorBoundary>);
  } finally {
    window.removeEventListener("error", suppressExpectedError);
  }
  expect(screen.getByRole("heading", { name: "页面出现错误" })).toBeInTheDocument();
  expect(logDiagnostic).toHaveBeenCalledWith(LOG_LEVEL_ERROR, "frontend.react.render", error, {
    componentStack: expect.stringContaining("BrokenPage"),
  });
  fireEvent.click(screen.getByRole("button", { name: "查看日志与反馈" }));
  expect(screen.getByRole("dialog", { name: "日志与反馈" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭日志" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
