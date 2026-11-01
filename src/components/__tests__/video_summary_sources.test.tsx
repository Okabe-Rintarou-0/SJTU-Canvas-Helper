import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import VideoSummarySources from "../video_summary_sources";

afterEach(cleanup);
it("keeps incomplete historical coverage visible without showing its diagnostic wall of text", () => {
  render(<VideoSummarySources legacyCoverage="0/2 小节字幕可用；资料提示：server failure；未覆盖小节：第二小节" />);
  expect(screen.getByText("此历史总结有小节未纳入。可重新生成以重试。")).toBeVisible();
  expect(screen.getByRole("button", { name: "查看资料" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText(/server failure/)).not.toBeVisible();
});

it("identifies cross-date selections by date and time instead of inventing lesson numbers", async () => {
  render(<VideoSummarySources legacyCoverage="" sources={[
    { key: "a", title: "2026-10-29 · 星期四 · 2026-10-29 14:50:00", included: true, sources: ["字幕", "课堂音频"], warnings: [] },
    { key: "b", title: "2026-10-30 · 星期五 · 2026-10-30 14:50:20", included: false, sources: [], warnings: ["PPT 未提供可用 OCR"] },
  ]} />);
  fireEvent.click(screen.getByRole("button", { name: "查看资料" }));
  await waitFor(() => expect(screen.getByText("2026-10-29 14:50")).toBeVisible());
  expect(screen.getByText("2026-10-30 14:50")).toBeVisible();
  expect(screen.getByText("已纳入 · 字幕、音频转录")).toBeVisible();
  expect(screen.getByText("未获取到可用资料")).toBeVisible();
  expect(screen.queryByText("资料获取失败")).not.toBeInTheDocument();
  expect(screen.queryByText(/第 1 小节/)).not.toBeInTheDocument();
});
