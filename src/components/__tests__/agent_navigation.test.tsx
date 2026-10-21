import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import CanvasAgentPage from "../../page/agent";
import { canvasAgentSession } from "../../lib/canvas_agent_session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), courses: [] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/hooks", () => ({ useCourses: () => ({ data: mocks.courses }) }));
vi.mock("../../lib/utils", () => ({ formatDate: (value: string) => value }));
vi.mock("../layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

beforeEach(() => { canvasAgentSession.reset(); vi.clearAllMocks(); });
afterEach(cleanup);

it("keeps a pending reply through Agent → settings → Agent and restores a draft", async () => {
  let finish!: (value: string) => void;
  mocks.invoke.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  render(<MemoryRouter initialEntries={["/agent"]}>
    <Link to="/settings">设置</Link><Link to="/agent">返回 Agent</Link>
    <Routes><Route path="/agent" element={<CanvasAgentPage />} /><Route path="/settings" element={<div>设置内容</div>} /></Routes>
  </MemoryRouter>);
  const input = () => screen.getByPlaceholderText(/直接描述你的需求/);
  fireEvent.change(input(), { target: { value: "本周作业" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  fireEvent.click(screen.getByRole("link", { name: "设置" }));
  expect(screen.getByText("设置内容")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "返回 Agent" }));
  expect(screen.getByText("本周作业")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  fireEvent.click(screen.getByRole("link", { name: "设置" }));
  await act(async () => finish("周五提交报告"));
  fireEvent.click(screen.getByRole("link", { name: "返回 Agent" }));
  expect(screen.getByText("周五提交报告")).toBeInTheDocument();
  fireEvent.change(input(), { target: { value: "草稿追问" } });
  fireEvent.click(screen.getByRole("link", { name: "设置" }));
  fireEvent.click(screen.getByRole("link", { name: "返回 Agent" }));
  expect(input()).toHaveValue("草稿追问");
  expect(mocks.invoke).toHaveBeenCalledOnce();
});
