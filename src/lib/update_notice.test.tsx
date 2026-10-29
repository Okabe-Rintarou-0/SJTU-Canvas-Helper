import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdateNoticeProvider } from "./update_notice";

const mocks = vi.hoisted(() => ({ check: vi.fn(), close: vi.fn(), install: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("./utils", () => ({ checkForUpdates: mocks.install }));

const log = (version: string, item: string) => ({ version, date: "2026/10/29", items: [item] });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.check.mockResolvedValue({
    currentVersion: "3.0.13", version: "3.0.16", close: mocks.close,
    rawJson: { changelog: [
      log("v3.0.14", "修复下载"), log("v3.0.16", "改善体验"),
      log("v3.0.15", "新增功能"), log("v3.0.13", "已安装内容"), log("v3.0.17", "未来内容"),
    ] },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("expands cumulative release notes without downloading, and keeps update actions accessible", async () => {
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  const dialog = await screen.findByRole("dialog", { name: "发现新版本" });
  const toggle = within(dialog).getByRole("button", { name: "查看更新内容（累计 3 个版本）" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  fireEvent.click(toggle);
  const notes = screen.getByRole("region", { name: "累积更新内容" });
  expect(notes).toHaveTextContent(/v3.0.16.*改善体验.*v3.0.15.*新增功能.*v3.0.14.*修复下载/);
  expect(notes).not.toHaveTextContent("已安装内容");
  expect(notes).not.toHaveTextContent("未来内容");
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.install).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
  fireEvent.click(within(dialog).getByRole("button", { name: "立即更新" }));
  expect(mocks.install).toHaveBeenCalledOnce();
});

it("shows legacy release notes and a release link when the manifest has no cumulative data", async () => {
  mocks.check.mockResolvedValue({ currentVersion: "3.0.13", version: "3.0.14", body: "发布说明\n修复启动", close: mocks.close, rawJson: {} });
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "查看更新内容" }));
  expect(screen.getByText(/修复启动/)).toBeInTheDocument();
  expect(screen.getByText(/尚未提供完整的累积更新日志/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "查看发布说明" })).toHaveAttribute("href", "https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases/tag/app-v3.0.14");
});

it("uses bundled logs for an older manifest and retains skip and never-remind preferences", async () => {
  mocks.check.mockResolvedValue({ currentVersion: "3.0.11", version: "3.0.13", close: mocks.close, rawJson: {} });
  const view = render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  expect(await screen.findByRole("button", { name: "查看更新内容（累计 2 个版本）" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "提醒选项" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /跳过此版本/ }));
  expect(localStorage.getItem("sjtu-canvas-helper:update-notice:skipped-version")).toBe("3.0.13");
  view.unmount();
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  cleanup();
  localStorage.setItem("sjtu-canvas-helper:update-notice:never-remind", "true");
  mocks.check.mockResolvedValue({ currentVersion: "3.0.13", version: "3.0.16", close: mocks.close });
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not show a prompt if there is no update or the check fails", async () => {
  mocks.check.mockResolvedValue(null);
  const view = render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  await waitFor(() => expect(mocks.check).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  view.unmount();
  mocks.check.mockRejectedValue(new Error("offline"));
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
