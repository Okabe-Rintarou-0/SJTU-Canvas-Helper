import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { version as appVersion } from "../../package.json";
import { UpdateNoticeProvider } from "./update_notice";

const mocks = vi.hoisted(() => ({ check: vi.fn(), close: vi.fn(), install: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("./utils", () => ({ checkForUpdates: mocks.install }));

const VERSION_KEY = "sjtu-canvas-helper:update-notice:last-run-version";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.check.mockResolvedValue(null);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([null, appVersion, "99.0.0", "invalid"])(
  "records the running version without claiming an upgrade from %s",
  async (previousVersion) => {
    if (previousVersion !== null) localStorage.setItem(VERSION_KEY, previousVersion);
    render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
    await waitFor(() => expect(mocks.check).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(VERSION_KEY)).toBe(appVersion);
  },
);

it("shows the installed upgrade's bundled cumulative notes once, even offline or under StrictMode", async () => {
  localStorage.setItem(VERSION_KEY, "3.0.11");
  mocks.check.mockRejectedValue(new Error("offline"));
  const view = render(<StrictMode><UpdateNoticeProvider>应用</UpdateNoticeProvider></StrictMode>);
  const dialog = await screen.findByRole("dialog", { name: "更新成功" });
  expect(dialog).toHaveTextContent(`已从 v3.0.11 更新至 v${appVersion}`);
  const notes = within(dialog).getByRole("region", { name: "本次更新内容" });
  expect(notes).toHaveTextContent(/v3.0.13.*v3.0.12/);
  expect(notes).not.toHaveTextContent("v3.0.11");
  expect(mocks.install).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "开始使用" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  view.unmount();
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(localStorage.getItem(VERSION_KEY)).toBe(appVersion);
});

it("keeps future update reminders and installation available without displaying their release notes", async () => {
  mocks.check.mockResolvedValue({
    currentVersion: appVersion, version: "99.0.0", close: mocks.close,
    body: "尚未安装的版本说明", rawJson: { changelog: [{ version: "99.0.0", items: ["未来内容"] }] },
  });
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  const dialog = await screen.findByRole("dialog", { name: "发现新版本" });
  expect(dialog).toHaveTextContent("v99.0.0");
  expect(dialog).not.toHaveTextContent("尚未安装的版本说明");
  expect(dialog).not.toHaveTextContent("未来内容");
  expect(within(dialog).queryByRole("region")).not.toBeInTheDocument();
  expect(mocks.close).toHaveBeenCalledOnce();
  fireEvent.click(within(dialog).getByRole("button", { name: "立即更新" }));
  expect(mocks.install).toHaveBeenCalledOnce();
});

it("shows upgrade success before a newer release reminder and preserves skip and never-remind preferences", async () => {
  localStorage.setItem(VERSION_KEY, "3.0.11");
  mocks.check.mockResolvedValue({ version: "99.0.0", close: mocks.close });
  const view = render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  await screen.findByRole("dialog", { name: "更新成功" });
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog", { name: "发现新版本" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
  const reminder = await screen.findByRole("dialog", { name: "发现新版本" });
  fireEvent.click(within(reminder).getByRole("button", { name: "提醒选项" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /跳过此版本/ }));
  expect(localStorage.getItem("sjtu-canvas-helper:update-notice:skipped-version")).toBe("99.0.0");
  view.unmount();
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  cleanup();
  localStorage.setItem("sjtu-canvas-helper:update-notice:never-remind", "true");
  localStorage.setItem(VERSION_KEY, "3.0.11");
  mocks.check.mockResolvedValue({ version: "100.0.0", close: mocks.close });
  render(<UpdateNoticeProvider>应用</UpdateNoticeProvider>);
  expect(await screen.findByRole("dialog", { name: "更新成功" })).toBeInTheDocument();
  await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("dialog", { name: "发现新版本" })).not.toBeInTheDocument();
});
