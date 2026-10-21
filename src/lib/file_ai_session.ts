import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AISessionStore, aiMessage, aiPayload } from "./ai_session_store";
import type { CanvasAgentChatMessage, File, FileChatStreamChunkPayload, FileChatStreamDonePayload, FileChatStreamErrorPayload } from "./model";

const OPENING = "请先总结这份文件。若它与作业相关，请额外列出得分点、提交要求、截止时间、文件格式限制和任何容易遗漏的注意事项。";
interface FileChatState {
  open: boolean;
  file: File | null;
  messages: CanvasAgentChatMessage[];
  loading: boolean;
  input: string;
}

export class FileAISession extends AISessionStore<FileChatState> {
  private unlisteners: UnlistenFn[] = [];

  constructor() {
    super(() => ({ open: false, file: null, messages: [], loading: false, input: "" }));
  }

  private cleanup() {
    this.unlisteners.forEach((unlisten) => unlisten());
    this.unlisteners = [];
  }

  override reset() {
    this.cleanup();
    super.reset();
  }

  explain = async (file: File) => {
    this.update({ open: true });
    // Reopening the current file restores its conversation; do not discard a running request.
    if (this.state.loading) return;
    if (this.state.file?.id === file.id) {
      if (!this.state.messages.some((message) => message.role === "assistant" && !message.error && !message.pending)) await this.send(OPENING);
      return;
    }
    this.update({ file, messages: [], input: "" });
    await this.send(OPENING);
  };

  send = async (content: string) => {
    if (this.state.loading || !this.state.file || !content.trim()) return;
    const file = this.state.file;
    const generation = ++this.generation;
    const requestId = crypto.randomUUID();
    const history = [...this.state.messages, aiMessage("user", content.trim())];
    const pending = aiMessage("assistant", "", { pending: true });
    this.update({ messages: [...history, pending], loading: true, input: "" });
    let finished = false;
    const active = () => generation === this.generation && !finished;
    const finish = (content: string, error = false) => {
      if (!active()) return;
      finished = true;
      this.cleanup();
      this.update({ loading: false, messages: this.state.messages.map((message) => message.id === pending.id
        ? { ...message, content: error && message.content ? `${message.content}\n\n${content}` : content || message.content, pending: false, error } : message) });
    };

    try {
      // Await all registrations before starting the stream, including slow/failing listeners.
      const registrations = await Promise.allSettled([
        listen<FileChatStreamChunkPayload>("file_ai_chat://chunk", ({ payload }) => {
          if (!active() || payload.request_id !== requestId) return;
          this.update({ messages: this.state.messages.map((message) => message.id === pending.id
            ? { ...message, content: message.content + payload.chunk } : message) });
        }),
        listen<FileChatStreamDonePayload>("file_ai_chat://done", ({ payload }) => {
          if (payload.request_id === requestId) finish(payload.content);
        }),
        listen<FileChatStreamErrorPayload>("file_ai_chat://error", ({ payload }) => {
          if (payload.request_id === requestId) finish(`AI 对话出错：${payload.error}`, true);
        }),
      ]);
      const unlisteners = registrations.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failure = registrations.find((result) => result.status === "rejected");
      if (!active() || failure) {
        unlisteners.forEach((unlisten) => unlisten());
        if (failure?.status === "rejected") throw failure.reason;
        return;
      }
      this.unlisteners = unlisteners;
      await invoke("start_file_chat_stream", { requestId, file, messages: aiPayload(history) });
      // The command only acknowledges startup. done/error events own completion.
    } catch (error) {
      finish(`AI 对话出错：${error}`, true);
    }
  };
}

export const fileAISession = new FileAISession();

if (import.meta.hot) import.meta.hot.dispose(() => fileAISession.reset());
