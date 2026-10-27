import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FileAIChatModal from "../file_ai_chat_modal";
import { FileAISession } from "../../lib/file_ai_session";
import { useAISession } from "../../lib/ai_session_store";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("embedded AI conversation", () => {
  it("restores a controlled draft after unmounting and closing the conversation", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const session = new FileAISession();
    session.update({ open: true });
    function Conversation() {
      const state = useAISession(session);
      return <FileAIChatModal embedded open={state.open} title="文件" messages={[]} loading={false}
        input={state.input} onInputChange={(input) => session.update({ input })}
        onClose={() => session.update({ open: false })} onSend={() => {}} inputPlaceholder="草稿" />;
    }
    const view = render(<Conversation />);
    fireEvent.change(screen.getByPlaceholderText("草稿"), { target: { value: "未发送的问题" } });
    view.unmount();
    session.update({ open: false });
    const closed = render(<Conversation />);
    closed.unmount();
    session.update({ open: true }); render(<Conversation />);
    expect(screen.getByPlaceholderText("草稿")).toHaveValue("未发送的问题");
  });
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
