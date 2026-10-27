import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import DebugPage from "../../page/debug";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), writeText: vi.fn(), messages: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../lib/config", () => ({ listNetworkLogs: mocks.list, clearNetworkLogs: vi.fn() }));
vi.mock("../../lib/hooks", () => ({ useConfigSelector: (selector: (state: unknown) => unknown) => selector({ config: { data: { debug_mode: false } } }) }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.messages, null] }));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("react-json-view-ts", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
  mocks.list.mockResolvedValue([{
    id: "request-7", timestamp: "2026-10-04T11:20:00Z", source: "canvas", method: "POST",
    url: "https://oc.sjtu.edu.cn/api/v1/courses/{id}/assignments", status: 403, ok: false,
    duration_ms: 123, request_headers: [], response_headers: [],
    request_body: "[omitted]", response_body: "[omitted]",
    request_body_truncated: false, response_body_truncated: false,
  }]);
});
afterEach(cleanup);

it("describes default safe metadata and copies a summary instead of a replayable curl command", async () => {
  render(<DebugPage />);
  expect(screen.getByText(/请求元数据默认记录/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "复制请求摘要" }));
  await waitFor(() => expect(mocks.writeText).toHaveBeenCalledOnce());
  const summary = mocks.writeText.mock.calls[0][0] as string;
  expect(summary).toContain("请求 ID：request-7");
  expect(summary).toContain("状态：403");
  expect(summary).toContain("不能直接重放请求");
  expect(summary).not.toContain("curl");
  expect(summary).not.toContain("[omitted]");
  fireEvent.click(screen.getByRole("button", { name: "展开请求详情" }));
  expect(screen.getByText("请求摘要")).toBeInTheDocument();
  expect(screen.queryByText("Curl 命令")).not.toBeInTheDocument();
});
