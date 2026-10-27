import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import QRCodePage from "../../page/qrcode";
import type { QRCodeScanReport } from "../../lib/model";

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
  mocks.invoke.mockResolvedValue(report());
  mocks.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: mocks.clipboard }, configurable: true });
});
afterEach(cleanup);

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
