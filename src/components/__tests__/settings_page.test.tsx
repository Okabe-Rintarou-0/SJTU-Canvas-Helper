import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import SettingsPage from "../../page/settings";
import type { AppConfig } from "../../lib/model";
import { ConfigReadFailure, StaleConfigSessionError } from "../../lib/config";
import { currentSession, invalidateSession } from "../../lib/session";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), getConfig: vi.fn(), saveConfig: vi.fn(), dispatch: vi.fn(), open: vi.fn(),
  validatePath: vi.fn(), changeAccount: vi.fn(), isOwnerCurrent: vi.fn(),
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), open: vi.fn(), destroy: vi.fn() },
  showQRCode: vi.fn(),
  writeClipboard: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../lib/config", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/config")>(),
  getConfig: mocks.getConfig, saveConfig: mocks.saveConfig, isConfigOwnerCurrent: mocks.isOwnerCurrent,
  updateConfig: (data: unknown) => data,
}));
vi.mock("../../lib/hooks", () => ({ useConfigDispatch: () => mocks.dispatch,
  useQRCode: () => ({ qrcode: null, showQRCode: mocks.showQRCode, refreshQRCode: vi.fn(), loading: false, error: "测试二维码" }) }));
vi.mock("../../lib/utils", () => ({ consoleLog: vi.fn(), savePathValidator: mocks.validatePath }));
vi.mock("../../lib/account_sessions", () => ({ changeSessionAccount: mocks.changeAccount }));
vi.mock("../../lib/message", () => ({ useAppMessage: () => [mocks.message, null] }));
vi.mock("../layout", () => ({ default: ({ children }: PropsWithChildren) => <>{children}</> }));
vi.mock("../log_modal", () => ({ default: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="日志与反馈"><button onClick={onClose}>关闭日志</button></div> }));
vi.mock("@lobehub/icons", () => ({ ProviderIcon: () => null }));
vi.mock("react-json-view-ts", () => ({ default: ({ src }: { src: unknown }) => <pre>{JSON.stringify(src)}</pre> }));

let config: AppConfig;
let ownerSession: number;
beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: mocks.writeClipboard }, configurable: true });
  mocks.writeClipboard.mockResolvedValue(undefined);
  config = {
    __config_owner: "owner:Default:0",
    token: "test-token", account_type: "Default", save_path: "D:\\Downloads", serve_as_plaintext: "md,txt",
    oauth_consumer_key: "", ja_auth_cookie: "", video_cookies: "", proxy_port: 3030,
    course_assignment_file_bindings: {}, show_alert_map: {}, llm_api_key: "", llm_base_url: "https://example.com/v1",
    llm_model: "test-model", llm_temperature: null, llm_api_keys: [], llm_active_api_key: "",
    theme: "light", color_primary: "#00b96b", compact_mode: false, mcp_enabled: false, mcp_port: 3100, debug_mode: false,
  };
  ownerSession = currentSession();
  mocks.isOwnerCurrent.mockImplementation((candidate: AppConfig) =>
    candidate?.__config_owner === config.__config_owner && ownerSession === currentSession());
  mocks.getConfig.mockImplementation(async () => {
    ownerSession = currentSession();
    return structuredClone(config);
  });
  mocks.saveConfig.mockImplementation(async (submitted: AppConfig) => {
    if (!mocks.isOwnerCurrent(submitted)) throw new StaleConfigSessionError();
    config = { ...structuredClone(submitted), __config_owner: `${submitted.__config_owner}:saved` };
    invalidateSession();
    ownerSession = currentSession();
    return structuredClone(config);
  });
  mocks.changeAccount.mockImplementation(async (action: () => Promise<unknown>, reconcile?: () => Promise<void>) => {
    try { return await action(); } finally { await reconcile?.(); }
  });
  mocks.validatePath.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue("D:\\Selected");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "list_accounts") return ["Default", "Study"];
    if (command === "read_account_info") return { current_account: "Default" };
    if (command === "check_extra_login_status") return true;
    if (command === "get_raw_config") return JSON.stringify({ theme: "light" });
    if (command === "test_token") return { name: "测试用户" };
  });
});
afterEach(cleanup);
async function openSettings() {
  render(<SettingsPage />);
  await screen.findByRole("tab", { name: "账号与连接" });
}
function section(name: string) { fireEvent.click(screen.getByRole("tab", { name })); }
function save() { fireEvent.click(screen.getAllByRole("button", { name: "保存全部设置" })[0]); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function switchAccount(account: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "选择账号" }));
  fireEvent.click(await screen.findByRole("option", { name: account }));
}

it("opens token instructions for the selected Canvas and returns to the draft", async () => {
  await openSettings();
  fireEvent.change(screen.getByLabelText("Canvas Token"), { target: { value: "draft-token" } });
  fireEvent.click(screen.getByRole("button", { name: "获取 Canvas Token" }));
  let guide = within(screen.getByRole("dialog", { name: "获取 Canvas Token" }));
  expect(guide.getByRole("link", { name: "打开 Canvas 个人设置" })).toHaveAttribute("href", "https://oc.sjtu.edu.cn/profile/settings");
  expect(guide.getByText("点击“创建新访问许可证”")).toBeVisible();
  expect(guide.getByText("填写用途并生成 Token")).toBeVisible();
  expect(guide.getByText("复制 Token，返回应用填写")).toBeVisible();
  fireEvent.click(guide.getByRole("button", { name: "返回填写 Token" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByLabelText("Canvas Token")).toHaveFocus());
  expect(screen.getByLabelText("Canvas Token")).toHaveValue("draft-token");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "账号类型" }));
  fireEvent.click(await screen.findByRole("option", { name: "密院" }));
  fireEvent.click(screen.getByRole("button", { name: "获取 Canvas Token" }));
  guide = within(screen.getByRole("dialog", { name: "获取 Canvas Token" }));
  expect(guide.getByRole("link", { name: "打开 Canvas 个人设置" })).toHaveAttribute("href", "https://jicanvas.com/profile/settings");
  expect(mocks.saveConfig).not.toHaveBeenCalled();
});

it("uses the same token instructions in first-run onboarding", async () => {
  config.token = "";
  render(<SettingsPage />);
  const tour = within(await screen.findByRole("dialog", { name: "填写您的 Canvas Token" }));
  expect(tour.getByText("点击“创建新访问许可证”")).toBeVisible();
  expect(tour.getByRole("link", { name: "打开 Canvas 个人设置" })).toHaveAttribute("href", "https://oc.sjtu.edu.cn/profile/settings");
  fireEvent.click(tour.getByRole("button", { name: "下一步" }));
  expect(screen.getByRole("dialog", { name: "填写您的下载保存目录" })).toBeVisible();
});

it("keeps edits across categories and saves all categories together", async () => {
  await openSettings();
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Canvas Token"), { target: { value: "updated-token" } });
  section("界面偏好");
  expect(screen.getByLabelText("Canvas Token")).not.toBeVisible();
  fireEvent.change(screen.getByLabelText("主色调"), { target: { value: "#336699" } });
  section("高级与实验");
  fireEvent.click(screen.getByRole("switch", { name: "使用任务中心替代页面任务列表" }));
  section("账号与连接");
  expect(screen.getByLabelText("Canvas Token")).toHaveValue("updated-token");
  save();
  await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ token: "updated-token", color_primary: "#336699", experimental_task_center_only: true })));
  await waitFor(() => expect(screen.getByText("所有设置已同步")).toBeVisible());
});

it("returns to the invalid category when saving from another category", async () => {
  await openSettings();
  fireEvent.change(screen.getByLabelText("Canvas Token"), { target: { value: "" } });
  section("工具与诊断"); save();
  expect(await screen.findByText("请输入有效的 Canvas Token。")).toBeVisible();
  expect(screen.getByRole("tab", { name: "账号与连接" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("Canvas Token")).toHaveFocus();
  expect(mocks.saveConfig).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Canvas Token"), { target: { value: "fixed-token" } });
  section("AI 与模型");
  fireEvent.change(screen.getByLabelText("输出预留（tokens）"), { target: { value: "200000" } });
  section("界面偏好"); save();
  await waitFor(() => expect(screen.getByRole("tab", { name: "AI 与模型" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("alert")).toBeVisible();
  expect(mocks.saveConfig).not.toHaveBeenCalled();
});

it("retains token visibility, token test, folder selection and account creation", async () => {
  await openSettings();
  expect(within(screen.getByRole("group", { name: "Canvas Token 与校验" })).getByRole("button", { name: "测试 Canvas Token" })).toBeVisible();
  expect(within(screen.getByRole("group", { name: "额外登录状态与检查" })).getByText("额外登录已连接")).toBeVisible();
  expect(screen.getByLabelText("Canvas Token")).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "显示 Token" }));
  expect(screen.getByLabelText("Canvas Token")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "测试 Canvas Token" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("test_token", { token: "test-token" }));
  expect(await screen.findByText("Token 校验通过，已连接到 测试用户 的 Canvas。")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "选择目录" }));
  await waitFor(() => expect(screen.getByLabelText("下载保存目录")).toHaveValue("D:\\Selected"));
  expect(screen.getByRole("button", { name: "删除当前账号" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "新建账号" }));
  fireEvent.change(screen.getByLabelText("新账号名称"), { target: { value: "Research" } });
  fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("create_account", { account: "Research" }));
  await screen.findByRole("combobox", { name: "选择账号" });
});

it("retains API Key creation, editing and removal", async () => {
  await openSettings(); section("AI 与模型");
  fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("名称"), { target: { value: "Test provider" } });
  fireEvent.change(dialog.getByLabelText("API Key"), { target: { value: "test-key" } });
  fireEvent.change(dialog.getByLabelText("Base URL"), { target: { value: "https://example.com/v1" } });
  fireEvent.change(dialog.getByLabelText("Model"), { target: { value: "test-model" } });
  fireEvent.click(dialog.getByRole("button", { name: "添加" }));
  await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ llm_active_api_key: "Test provider", llm_api_key: "test-key" })));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const name = screen.getByLabelText("名称");
  fireEvent.change(name, { target: { value: "Renamed" } }); fireEvent.blur(name);
  await waitFor(() => expect(mocks.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ llm_active_api_key: "Renamed" })));
  section("界面偏好"); section("AI 与模型");
  expect(screen.getByLabelText("名称")).toHaveValue("Renamed");
  fireEvent.click(screen.getByRole("button", { name: "删除此 Key" })); save();
  await waitFor(() => expect(mocks.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ llm_api_keys: [], llm_active_api_key: "", llm_api_key: "" })));
}, 15000);

it("shows every category after repeated switches and recovers a failed config preview", async () => {
  await openSettings();
  const token = screen.getByLabelText("Canvas Token");
  for (const [tab, heading] of [
    ["AI 与模型", "AI 与模型"], ["工具与诊断", "实用工具"], ["高级与实验", "高级选项"],
    ["工具与诊断", "实用工具"], ["界面偏好", "界面偏好"], ["账号与连接", "账号设置"], ["工具与诊断", "实用工具"],
  ]) {
    section(tab);
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveStyle({ display: "block" });
    expect(within(panels[0]).getByRole("heading", { name: heading })).toBeVisible();
  }
  expect(screen.getByLabelText("Canvas Token")).toBe(token);
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", behavior: "instant" });
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, ...args: unknown[]) => command === "get_raw_config" ? Promise.reject("无法读取文件") : invoke(command, ...args));
  fireEvent.click(screen.getByRole("button", { name: "加载原始配置" }));
  expect(screen.getByRole("button", { name: "加载中…" })).toBeDisabled();
  expect(await screen.findByText("无法加载配置：无法读取文件")).toBeVisible();
  expect(screen.getByRole("button", { name: "打开配置目录" })).toBeVisible();
  mocks.invoke.mockImplementation(invoke);
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
  expect(await screen.findByText('{"theme":"light"}')).toBeVisible();
}, 15000);

it("retains MCP settings, raw config preview and diagnostic tools", async () => {
  await openSettings(); section("高级与实验");
  expect(screen.getByLabelText("MCP 端口")).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "启用 MCP Server" }));
  fireEvent.change(screen.getByLabelText("MCP 端口"), { target: { value: "3200" } });
  const connectionText = (screen.getByLabelText("MCP 连接配置") as HTMLTextAreaElement).value;
  expect(connectionText).toContain('"type": "streamable-http"');
  expect(connectionText).toContain("http://localhost:3200");
  fireEvent.click(screen.getByRole("button", { name: "复制配置" }));
  expect(mocks.writeClipboard).toHaveBeenCalledWith(connectionText);
  fireEvent.click(screen.getByRole("switch", { name: "启用 Debug 模式" })); save();
  await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ mcp_enabled: true, mcp_port: 3200, debug_mode: true })));
  section("工具与诊断");
  fireEvent.click(screen.getByRole("button", { name: "打开配置目录" }));
  expect(mocks.invoke).toHaveBeenCalledWith("open_config_dir");
  fireEvent.click(screen.getByRole("button", { name: "日志与反馈" }));
  expect(screen.getByRole("dialog", { name: "日志与反馈" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭日志" }));
  fireEvent.click(screen.getByRole("button", { name: "加载原始配置" }));
  expect(await screen.findByText('{"theme":"light"}')).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "隐藏原始配置" }));
  expect(screen.queryByText('{"theme":"light"}')).not.toBeInTheDocument();
}, 15000);

it("can switch existing accounts and recover an unavailable extra login", async () => {
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, ...args: unknown[]) => command === "check_extra_login_status" ? Promise.resolve(false) : invoke(command, ...args));
  await openSettings();
  expect(await screen.findByText("扫码完成额外登录")).toBeVisible();
  expect(mocks.showQRCode).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新获取二维码" }));
  expect(mocks.showQRCode).toHaveBeenCalledTimes(2);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "选择账号" }));
  fireEvent.click(await screen.findByRole("option", { name: "Study" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("switch_account", { account: "Study" }));
  expect(mocks.changeAccount).toHaveBeenCalled();
}, 15000);

it("adopts successor ownership after each inline API Key edit", async () => {
  config.llm_api_keys = [{ name: "Original", key: "old-key", base_url: "https://example.com/v1", model: "test-model" }];
  config.llm_active_api_key = "Original";
  await openSettings(); section("AI 与模型");
  // Settings keeps every category mounted. Scope label queries to the active
  // panel instead of repeatedly traversing all hidden MUI controls in jsdom.
  const ai = within(screen.getByRole("tabpanel", { name: "AI 与模型" }));
  const saveAll = screen.getAllByText("保存全部设置", { selector: "button" })[0];
  expect(saveAll).toBeVisible();
  for (const [label, value, field] of [
    ["名称", "Renamed", "llm_active_api_key"],
    ["API Key", "new-key", "llm_api_key"],
    ["Base URL", "https://new.example.com/v1", "llm_base_url"],
  ]) {
    const previousOwner = config.__config_owner;
    const input = ai.getByLabelText(label);
    fireEvent.change(input, { target: { value } });
    // The save fixture resolves immediately; await its React update directly
    // rather than polling the entire document and then flushing a second time.
    await act(async () => { fireEvent.blur(input); });
    expect(mocks.saveConfig).toHaveBeenLastCalledWith(expect.objectContaining({ [field]: value, __config_owner: previousOwner }));
    expect(config).toMatchObject({ [field]: value, __config_owner: `${previousOwner}:saved` });
  }
  const previousOwner = config.__config_owner;
  fireEvent.change(ai.getByLabelText("Temperature"), { target: { value: "0.7" } });
  await act(async () => { fireEvent.click(saveAll); });
  expect(config).toMatchObject({ llm_temperature: 0.7, __config_owner: `${previousOwner}:saved` });
  expect(mocks.saveConfig).toHaveBeenCalledTimes(4);
  expect(mocks.message.error).not.toHaveBeenCalled();
});

it("does not apply edits or restore visual settings after the form owner expires", async () => {
  await openSettings(); section("界面偏好");
  fireEvent.change(screen.getByLabelText("主色调"), { target: { value: "#336699" } });
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ color_primary: "#336699" }));
  act(() => invalidateSession());
  mocks.dispatch.mockClear();
  fireEvent.change(screen.getByLabelText("主色调"), { target: { value: "#112233" } });
  expect(screen.getByLabelText("主色调")).toHaveValue("#336699");
  cleanup();
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it.each(["switch_account", "delete_account"])("reconciles authoritative settings after %s rejects", async (operation) => {
  let activeAccount = operation === "delete_account" ? "Study" : "Default";
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, ...args: unknown[]) => {
    if (command === "read_account_info") return { current_account: activeAccount };
    if (command === operation) {
      activeAccount = operation === "delete_account" ? "Default" : "Study";
      config = { ...config, token: "reconciled-token", __config_owner: "owner:reconciled" };
      throw new Error("mutation rejected after changing active account");
    }
    return invoke(command, ...args);
  });
  await openSettings();
  if (operation === "delete_account") fireEvent.click(screen.getByRole("button", { name: "删除当前账号" }));
  else await switchAccount("Study");
  await waitFor(() => expect(screen.getByLabelText("Canvas Token")).toHaveValue("reconciled-token"));
  expect(screen.getByText(`当前账号：${activeAccount}`)).toBeVisible();
  expect(mocks.changeAccount).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
  expect(mocks.message.error).toHaveBeenCalledWith(expect.stringContaining("mutation rejected"));
  fireEvent.change(screen.getByLabelText("Canvas Token"), { target: { value: "fresh-draft" } });
  save();
  await waitFor(() => expect(config.token).toBe("fresh-draft"));
});

it.each(["resolve", "reject"])("ignores an older initialization that completes with %s after a newer switch", async (completion) => {
  let activeAccount = "Default";
  let reads = 0;
  const late = deferred<{ current_account: string }>();
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args?: { account?: string }) => {
    if (command === "list_accounts") return ["Default", "Study", "Research"];
    if (command === "switch_account") {
      activeAccount = args!.account!;
      config = { ...config, token: `${activeAccount}-token`, __config_owner: `owner:${activeAccount}` };
      return;
    }
    if (command === "read_account_info") {
      reads += 1;
      return reads === 2 ? late.promise : { current_account: activeAccount };
    }
    return invoke(command, args);
  });
  await openSettings();
  await switchAccount("Study");
  await waitFor(() => expect(reads).toBe(2));
  await switchAccount("Research");
  await waitFor(() => expect(screen.getByLabelText("Canvas Token")).toHaveValue("Research-token"));
  await act(async () => {
    if (completion === "resolve") late.resolve({ current_account: "Study" });
    else late.reject(new Error("obsolete account info failed"));
  });
  expect(screen.getByLabelText("Canvas Token")).toHaveValue("Research-token");
  expect(screen.getByText("当前账号：Research")).toBeVisible();
  expect(mocks.message.error).not.toHaveBeenCalled();
});

it("does not reconcile a pending account mutation after settings is disposed", async () => {
  const pending = deferred<void>();
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, ...args: unknown[]) => command === "switch_account" ? pending.promise : invoke(command, ...args));
  await openSettings();
  await switchAccount("Study");
  const reads = mocks.getConfig.mock.calls.length;
  cleanup();
  await act(async () => pending.resolve());
  expect(mocks.getConfig).toHaveBeenCalledTimes(reads);
  expect(mocks.message.error).not.toHaveBeenCalled();
});

it("suppresses initialization failures delivered after disposal", async () => {
  const late = deferred<{ current_account: string }>();
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((command: string, ...args: unknown[]) => command === "read_account_info" ? late.promise : invoke(command, ...args));
  const view = render(<SettingsPage />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("read_account_info"));
  view.unmount();
  await act(async () => late.reject(new Error("disposed initialization failed")));
  expect(mocks.message.error).not.toHaveBeenCalled();
});

it("reports a current configuration read failure without leaking stale initialization errors", async () => {
  mocks.getConfig.mockImplementation(async () => { throw new ConfigReadFailure(currentSession()); });
  render(<SettingsPage />);
  await waitFor(() => expect(mocks.message.error).toHaveBeenCalledWith("读取配置失败，请重试。"));
  expect(mocks.message.error).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("tab", { name: "账号与连接" })).not.toBeInTheDocument();
});
