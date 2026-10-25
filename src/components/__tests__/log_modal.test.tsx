import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LogModal from "../log_modal";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn(), open: vi.fn(), getVersion: vi.fn(), writeText: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));

const environment = "应用版本：3.0.13\n系统：Windows x64\n安装方式：便携版";
const log = "2026-10-04T11:20:00Z WARN request_id=7 连接超时";
const report = `${environment}\n近期运行日志\n${log}`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.invoke.mockImplementation(async (command: string) => command === "read_diagnostic_report" ? report : undefined);
  mocks.save.mockResolvedValue("D:\\反馈\\诊断信息.txt");
  mocks.getVersion.mockResolvedValue("3.0.13");
  mocks.open.mockResolvedValue(undefined);
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
});
afterEach(cleanup);

async function load() {
  render(<LogModal onClose={vi.fn()} />);
  await screen.findByRole("region", { name: "近期运行日志" });
}

describe("logs and feedback", () => {
  it("shows a loading state, an empty state, and refreshed logs", async () => {
    let finish!: (value: string) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    render(<LogModal onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在读取近期日志");
    expect(screen.getByRole("button", { name: "刷新" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "在 GitHub 反馈" })).toBeEnabled();
    await act(async () => finish(`${environment}\n近期运行日志\n`));
    expect(screen.getByText(/暂无运行日志/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByRole("region", { name: "近期运行日志" })).toHaveTextContent(log);
  });

  it("saves only after the user selects a path and explains manual attachment", async () => {
    await load();
    fireEvent.click(screen.getByRole("button", { name: "导出诊断信息" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("save_diagnostic_report", { path: "D:\\反馈\\诊断信息.txt" }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: expect.stringMatching(/\.txt$/), filters: [{ name: "文本文件", extensions: ["txt"] }],
    }));
    expect(await screen.findByText(/已保存到：D:\\反馈\\诊断信息.txt/)).toHaveTextContent("手动附加");
    expect(screen.getByText(/已保存到/)).toHaveTextContent("不会自动上传");
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("does not save or announce success when the save dialog is cancelled", async () => {
    mocks.save.mockResolvedValue(null);
    await load();
    fireEvent.click(screen.getByRole("button", { name: "导出诊断信息" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "导出诊断信息" })).toBeEnabled());
    expect(mocks.invoke.mock.calls.some(([command]) => command === "save_diagnostic_report")).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps feedback and environment copying available after an export failure", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "save_diagnostic_report") throw new Error("disk full");
      return report;
    });
    await load();
    fireEvent.click(screen.getByRole("button", { name: "导出诊断信息" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("导出失败");
    expect(screen.queryByText(/已保存到/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "复制环境信息" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(environment));
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 反馈" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
  });

  it("prefills only the short environment header, never recent logs", async () => {
    await load();
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 反馈" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
    const url = new URL(mocks.open.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/new");
    expect(url.searchParams.get("template")).toBe("01-bug.yml");
    expect(url.searchParams.get("environment")).toBe(environment);
    expect(decodeURIComponent(url.href)).not.toContain(log);
  });

  it("falls back to basic environment information when reading logs fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("cannot read"));
    render(<LogModal onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取日志");
    fireEvent.click(screen.getByRole("button", { name: "复制环境信息" }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(expect.stringContaining("应用版本：3.0.13")));
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 反馈" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
    expect(new URL(mocks.open.mock.calls[0][0]).searchParams.get("environment")).toContain("应用版本：3.0.13");
  });

  it("does not mistake an unrecognised report for an environment header", async () => {
    mocks.invoke.mockResolvedValue("unexpected log content without a header");
    await load();
    fireEvent.click(screen.getByRole("button", { name: "在 GitHub 反馈" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
    expect(new URL(mocks.open.mock.calls[0][0]).searchParams.get("environment")).not.toContain("unexpected log content");
  });

  it("opens the log directory and preserves the optional mail route", async () => {
    await load();
    fireEvent.click(screen.getByRole("button", { name: "打开日志目录" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("open_log_directory"));
    fireEvent.click(screen.getByRole("button", { name: "邮件反馈" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith("mailto:923048992@sjtu.edu.cn"));
  });

  it("recovers from read failure on refresh and lets the user close the dialog", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("temporary read failure"));
    const onClose = vi.fn();
    render(<LogModal onClose={onClose} />);
    await screen.findByText(/无法读取日志/);
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByRole("region", { name: "近期运行日志" })).toHaveTextContent(log);
    expect(screen.queryByText(/无法读取日志/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
