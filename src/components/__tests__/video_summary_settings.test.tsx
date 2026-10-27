import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import VideoSummarySettings from "../video_summary_settings";
import { DEFAULT_VIDEO_SUMMARY_PROMPT } from "../../lib/video_summary_config";
import type { AppConfig } from "../../lib/model";

afterEach(cleanup);
function Settings() {
  const [config, setConfig] = useState<Partial<AppConfig>>({});
  return <VideoSummarySettings config={config} onChange={setConfig} />;
}
it("edits requirements and token budgets, validates them, and restores all defaults", () => {
  render(<Settings />);
  const prompt = screen.getByLabelText("课堂总结要求");
  expect(prompt).toHaveValue(DEFAULT_VIDEO_SUMMARY_PROMPT);
  expect(screen.getByLabelText("上下文容量（tokens）")).toHaveValue(256000);
  expect(screen.getByLabelText("输出预留（tokens）")).toHaveValue(32768);
  fireEvent.change(prompt, { target: { value: "详细解释公式，并列出考试重点" } });
  expect(prompt).toHaveValue("详细解释公式，并列出考试重点");
  fireEvent.change(screen.getByLabelText("上下文容量（tokens）"), { target: { value: "4096" } });
  expect(screen.getByRole("alert")).toHaveTextContent("不超过上下文容量的一半");
  fireEvent.change(screen.getByLabelText("输出预留（tokens）"), { target: { value: "1024" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "恢复课堂总结默认设置" }));
  expect(prompt).toHaveValue(DEFAULT_VIDEO_SUMMARY_PROMPT);
  expect(screen.getByLabelText("上下文容量（tokens）")).toHaveValue(256000);
  expect(screen.getByLabelText("输出预留（tokens）")).toHaveValue(32768);
});
