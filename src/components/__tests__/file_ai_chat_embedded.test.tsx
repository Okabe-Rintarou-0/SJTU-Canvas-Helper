import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FileAIChatModal from "../file_ai_chat_modal";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("embedded AI conversation", () => {
  it("renders beside other controls without a modal and still sends follow-up questions", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const send = vi.fn();
    render(<><button>浏览录像</button><FileAIChatModal embedded open title="课堂" messages={[]} loading={false} onClose={() => {}} onSend={send} inputPlaceholder="追问字幕" /></>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "浏览录像" })).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText("追问字幕"), { target: { value: "重点是什么" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(send).toHaveBeenCalledWith("重点是什么");
  });
});
