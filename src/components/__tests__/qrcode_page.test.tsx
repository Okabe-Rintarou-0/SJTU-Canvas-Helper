import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import QRCodePage from "../../page/qrcode";
import type { QRCodeScanReport } from "../../lib/model";
import { invalidateSession } from "../../lib/session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), clipboard: vi.fn(), courses: [{ id: 1, name: "课程一" }, { id: 2, name: "课程二" }] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../layout", () => ({ default: ({ children }: PropsWithChildren) => <>{children}</> }));
vi.mock("../course_select", () => ({ default: ({ value, onChange }: { value?: number; onChange: (id: number) => void }) =>
  <select aria-label="课程" value={value ?? -1} onChange={(event) => onChange(Number(event.target.value))}>
    <option value={-1}>请选择</option>{mocks.courses.map((course) => <option value={course.id} key={course.id}>{course.name}</option>)}
  </select> }));
vi.mock("../../lib/hooks", async () => {
  const { useState } = await import("react");
  return { useCourses: () => ({ data: mocks.courses }), useSelectedCourse: () => {
    const [selectedCourseId, setSelectedCourseId] = useState(1);
    return { selectedCourseId, setSelectedCourseId };
  } };
});
const report = (name = "qr.png"): QRCodeScanReport => ({
  total_files: 5, image_files: 2, scanned_images: 2, failed_images: 0,
  results: [{ file: { id: 1, display_name: name, url: "/test-qr.png" }, contents: ["public-test-content"] }],
} as QRCodeScanReport);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockReset();
  mocks.clipboard.mockReset();
  mocks.invoke.mockResolvedValue(report());
  mocks.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: mocks.clipboard }, configurable: true });
});
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it("selects courses in the hero, scans automatically, previews and copies decoded contents", async () => {
  render(<QRCodePage />);
  expect(within(screen.getByRole("combobox", { name: "课程" }).closest(".MuiCard-root") as HTMLElement).getByRole("heading", { name: "二维码识别" })).toBeVisible();
  await screen.findByText("qr.png");
  expect(mocks.invoke).toHaveBeenCalledWith("scan_course_qrcodes", { courseId: 1 });
  expect(screen.getByRole("status")).toHaveTextContent("已扫描 2 / 2 张图片，1 张包含二维码");
  fireEvent.click(screen.getByRole("button", { name: "复制第 1 个二维码内容" }));
  await waitFor(() => expect(mocks.clipboard).toHaveBeenCalledWith("public-test-content"));
  fireEvent.click(screen.getByRole("button", { name: "查看原图：qr.png" }));
  expect(within(screen.getByRole("dialog", { name: "qr.png" })).getByText("public-test-content")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("shows scan failures and allows retry instead of reporting an empty success", async () => {
  mocks.invoke.mockRejectedValueOnce(new Error("offline"));
  render(<QRCodePage />);
  expect(await screen.findByText(/无法扫描该课程的图片/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByText("qr.png");
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText("搜索识别结果"), { target: { value: "no match" } });
  expect(screen.getByText("没有匹配的识别结果，请调整搜索条件。")).toBeVisible();
  fireEvent.change(screen.getByLabelText("搜索识别结果"), { target: { value: "public-test" } });
  expect(screen.getByText("qr.png")).toBeVisible();
});

it("keeps results from the latest course when requests finish out of order", async () => {
  let finishFirst!: (result: QRCodeScanReport) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
  mocks.invoke.mockResolvedValueOnce(report("course-two.png"));
  render(<QRCodePage />);
  fireEvent.change(screen.getByRole("combobox", { name: "课程" }), { target: { value: "2" } });
  await screen.findByText("course-two.png");
  finishFirst(report("stale-course-one.png"));
  await waitFor(() => expect(screen.queryByText("stale-course-one.png")).not.toBeInTheDocument());
  fireEvent.change(screen.getByRole("combobox", { name: "课程" }), { target: { value: "-1" } });
  expect(await screen.findByText("请先在上方选择课程。")).toBeVisible();
  expect(screen.queryByText("course-two.png")).not.toBeInTheDocument();
});

it("reports partial image failures while retaining successful QR results", async () => {
  mocks.invoke.mockResolvedValue({ ...report(), scanned_images: 1, failed_images: 1 });
  render(<QRCodePage />);
  await screen.findByText("qr.png");
  expect(screen.getByText(/有 1 张图片未能下载或解码/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重新扫描" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
});

it.each(["resolve", "reject"])("ignores a previous account session's late scan %s with the same course selected", async (completion) => {
  const old = deferred<QRCodeScanReport>();
  mocks.invoke.mockReturnValueOnce(old.promise).mockResolvedValueOnce(report("current-account.png"));
  render(<QRCodePage />);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  // Keep course id 1 across accounts, independently of Redux's selection reset.
  act(() => invalidateSession());
  expect(await screen.findByText("current-account.png")).toBeVisible();
  expect(mocks.invoke).toHaveBeenNthCalledWith(2, "scan_course_qrcodes", { courseId: 1 });
  await act(async () => {
    if (completion === "resolve") old.resolve(report("old-account.png"));
    else old.reject(new Error("old account scan failed"));
  });
  expect(screen.getByText("current-account.png")).toBeVisible();
  expect(screen.queryByText("old-account.png")).not.toBeInTheDocument();
  expect(screen.queryByText(/无法扫描该课程的图片/)).not.toBeInTheDocument();
});

it("clears results, search and open preview when the account session expires", async () => {
  const current = deferred<QRCodeScanReport>();
  mocks.invoke.mockResolvedValueOnce(report("old-account.png")).mockReturnValueOnce(current.promise);
  render(<QRCodePage />);
  await screen.findByText("old-account.png");
  fireEvent.change(screen.getByLabelText("搜索识别结果"), { target: { value: "old-account" } });
  fireEvent.click(screen.getByRole("button", { name: "查看原图：old-account.png" }));
  expect(screen.getByRole("dialog", { name: "old-account.png" })).toBeVisible();
  act(() => invalidateSession());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("old-account.png")).not.toBeInTheDocument();
  expect(screen.getByLabelText("搜索识别结果")).toHaveValue("");
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
  await act(async () => current.resolve(report("current-account.png")));
  expect(screen.getByText("current-account.png")).toBeVisible();
});

it.each([
  ["account session", "resolve"], ["account session", "reject"],
  ["course scan", "resolve"], ["course scan", "reject"],
])("ignores clipboard completion after a newer %s (%s)", async (change, completion) => {
  const copied = deferred<void>();
  mocks.clipboard.mockReturnValueOnce(copied.promise);
  mocks.invoke.mockResolvedValueOnce(report("old-result.png")).mockResolvedValueOnce(report("current-result.png"));
  render(<QRCodePage />);
  await screen.findByText("old-result.png");
  fireEvent.click(screen.getByRole("button", { name: "复制第 1 个二维码内容" }));
  expect(mocks.clipboard).toHaveBeenCalledWith("public-test-content");
  if (change === "account session") act(() => invalidateSession());
  else fireEvent.change(screen.getByRole("combobox", { name: "课程" }), { target: { value: "2" } });
  await screen.findByText("current-result.png");
  await act(async () => {
    if (completion === "resolve") copied.resolve();
    else copied.reject(new Error("old clipboard operation failed"));
  });
  expect(screen.queryByText("二维码内容已复制。")).not.toBeInTheDocument();
  expect(screen.queryByText("复制失败，请手动选择下方内容复制。")).not.toBeInTheDocument();
  expect(screen.getByText("current-result.png")).toBeVisible();
});
