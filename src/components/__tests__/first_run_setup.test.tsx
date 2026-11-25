import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import FirstRunSetupGate, { FirstRunSetup } from "../first_run_setup";
import type { AppConfig } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getConfig: vi.fn(), saveConfig: vi.fn(), open: vi.fn(), validatePath: vi.fn(), showQRCode: vi.fn(), qr: { qrcode: "", loading: false, error: "" }, onScanSuccess: undefined as undefined | (() => void), onSavingChange: undefined as undefined | ((saving: boolean) => void) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../lib/config", () => ({ getConfig: mocks.getConfig, saveConfig: mocks.saveConfig }));
vi.mock("../../lib/utils", () => ({ savePathValidator: mocks.validatePath }));
vi.mock("../../lib/hooks", () => ({ useQRCode: (options: { onScanSuccess: () => void; onSavingChange: (saving: boolean) => void }) => {
  mocks.onScanSuccess = options.onScanSuccess; mocks.onSavingChange = options.onSavingChange;
  return { ...mocks.qr, showQRCode: mocks.showQRCode, refreshQRCode: vi.fn() };
} }));

let config: AppConfig;
beforeEach(() => {
  vi.resetAllMocks();
  config = { token: "", account_type: "Default", save_path: "", ja_auth_cookie: "" } as AppConfig;
  mocks.getConfig.mockImplementation(async () => structuredClone(config));
  mocks.saveConfig.mockImplementation(async (next: AppConfig) => { config = structuredClone(next); });
  mocks.invoke.mockImplementation(async (command: string) => command === "test_token" ? { name: "测试同学" } : false);
  mocks.validatePath.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue("D:\\Courses");
  mocks.qr = { qrcode: "", loading: false, error: "" };
});
afterEach(cleanup);

function RouteContent() { return <div>当前页面：{useLocation().pathname}</div>; }
function renderGate() { return render(<MemoryRouter initialEntries={["/video"]}><FirstRunSetupGate><RouteContent /></FirstRunSetupGate></MemoryRouter>); }
async function connect() {
  fireEvent.change(await screen.findByLabelText("Canvas Token"), { target: { value: "  valid-token  " } });
  fireEvent.click(screen.getByRole("button", { name: "验证并继续" }));
  await screen.findByRole("heading", { name: "给课程资料一个固定位置" });
}
async function saveBasics() {
  await connect();
  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() => expect(screen.getByLabelText("下载保存目录")).toHaveValue("D:\\Courses"));
  fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
  await screen.findByRole("heading", { name: "按需连接额外登录态" });
}

it("gates unconfigured pages, saves basics, allows skipping login and completes into files", async () => {
  renderGate();
  await screen.findByRole("main", { name: "首次配置向导" });
  expect(screen.queryByText("当前页面：/video")).not.toBeInTheDocument();
  await saveBasics();
  expect(mocks.invoke).toHaveBeenCalledWith("test_token", { token: "valid-token", accountType: "Default" });
  expect(config).toMatchObject({ token: "valid-token", save_path: "D:\\Courses", onboarding_completed: false });
  expect(mocks.showQRCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "跳过，稍后配置" }));
  expect(screen.getByRole("heading", { name: "准备好了，开始探索吧" })).toHaveFocus();
  expect(screen.getByText("AI 学习助手")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
  await screen.findByText("当前页面：/files");
  expect(config.onboarding_completed).toBe(true);
  cleanup();
  renderGate();
  await screen.findByText("当前页面：/video");
});

it("does not force existing accounts through setup and retries configuration read errors", async () => {
  config.token = "existing-token";
  mocks.getConfig.mockRejectedValueOnce(new Error("read failed"));
  renderGate();
  fireEvent.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByText("当前页面：/video");
  expect(screen.queryByRole("main")).not.toBeInTheDocument();
});

it("reopens from setup with the latest saved config and exits without saving", async () => {
  config.token = "existing-token";
  render(<MemoryRouter initialEntries={["/settings"]}>
    <Link to="/setup">调试向导</Link>
    <FirstRunSetupGate><RouteContent /></FirstRunSetupGate>
  </MemoryRouter>);
  await screen.findByText("当前页面：/settings");
  config.token = "latest-token";
  fireEvent.click(screen.getByRole("link", { name: "调试向导" }));
  await waitFor(() => expect(screen.getByLabelText("Canvas Token")).toHaveValue("latest-token"));
  fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
  await screen.findByText("当前页面：/settings");
  expect(mocks.saveConfig).not.toHaveBeenCalled();
  expect(config.onboarding_completed).toBeUndefined();
});

it("does not mark a replayed account as incomplete when saving basics", async () => {
  config.token = "existing-token";
  render(<MemoryRouter initialEntries={["/setup"]}><FirstRunSetupGate><RouteContent /></FirstRunSetupGate></MemoryRouter>);
  await saveBasics();
  expect(config.onboarding_completed).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "返回设置" }));
  await screen.findByText("当前页面：/settings");
});

it("tests the selected Canvas, blocks invalid credentials and retains the draft", async () => {
  renderGate();
  await screen.findByLabelText("Canvas Token");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "账号类型" }));
  fireEvent.click(await screen.findByRole("option", { name: "密院 Canvas" }));
  expect(screen.getByRole("link", { name: "打开 Canvas 个人设置" })).toHaveAttribute("href", "https://jicanvas.com/profile/settings");
  mocks.invoke.mockRejectedValueOnce(new Error("bad token"));
  fireEvent.change(screen.getByLabelText("Canvas Token"), { target: { value: "ji-token" } });
  fireEvent.click(screen.getByRole("button", { name: "验证并继续" }));
  await screen.findByText("连接失败，请检查 Token、所选账号类型及网络后重试。");
  expect(screen.getByLabelText("Canvas Token")).toHaveValue("ji-token");
  expect(mocks.saveConfig).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "验证并继续" }));
  await screen.findByLabelText("下载保存目录");
  expect(mocks.invoke).toHaveBeenLastCalledWith("test_token", { token: "ji-token", accountType: "JI" });
});

it("blocks empty tokens and invalid paths, and retries failed saves without losing input", async () => {
  renderGate();
  fireEvent.click(await screen.findByRole("button", { name: "验证并继续" }));
  expect(screen.getByText("请填写 Canvas Token。")).toBeVisible();
  expect(mocks.invoke).not.toHaveBeenCalled();
  await connect();
  fireEvent.change(screen.getByLabelText("下载保存目录"), { target: { value: "D:\\Missing" } });
  mocks.validatePath.mockRejectedValueOnce(new Error("missing folder"));
  fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
  await screen.findByText("请选择一个已存在的下载目录。");
  expect(mocks.saveConfig).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("下载保存目录"), { target: { value: "D:\\Retry" } });
  mocks.saveConfig.mockRejectedValueOnce(new Error("disk full"));
  fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
  await screen.findByText("设置未能保存，请重试。你的填写内容仍保留在此页。");
  expect(screen.getByLabelText("下载保存目录")).toHaveValue("D:\\Retry");
  fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));
  await screen.findByRole("heading", { name: "按需连接额外登录态" });
});

it("resumes pending setup, handles QR failure and preserves the saved cookie on completion", async () => {
  config = { ...config, token: "saved-token", save_path: "D:\\Courses", onboarding_completed: false };
  mocks.qr.error = "二维码获取失败";
  const onComplete = vi.fn();
  render(<FirstRunSetup initialConfig={config} onComplete={onComplete} />);
  fireEvent.click(await screen.findByRole("button", { name: "扫码连接额外登录态" }));
  await waitFor(() => expect(mocks.showQRCode).toHaveBeenCalledTimes(1));
  expect(screen.getByText("二维码获取失败")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重新获取二维码" }));
  expect(mocks.showQRCode).toHaveBeenCalledTimes(2);
  // Simulate the shared QR hook saving the cookie before notifying the wizard.
  config.ja_auth_cookie = "saved-cookie";
  act(() => mocks.onSavingChange?.(true));
  expect(screen.getByRole("button", { name: "正在保存登录态…" })).toBeDisabled();
  act(() => { mocks.onScanSuccess?.(); mocks.onSavingChange?.(false); });
  await screen.findByText("额外登录态已连接，可以继续。");
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  mocks.saveConfig.mockRejectedValueOnce(new Error("write failed"));
  fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
  await screen.findByText("设置未能保存，请重试。你的填写内容仍保留在此页。");
  expect(onComplete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "开始使用" }));
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ ja_auth_cookie: "saved-cookie", onboarding_completed: true })));
});
