import { invoke } from "@tauri-apps/api/core";
import { AISessionStore, aiMessage, aiPayload } from "./ai_session_store";
import type { CanvasAgentChatMessage } from "./model";

interface AgentState {
  messages: CanvasAgentChatMessage[];
  input: string;
  maxTurns: string;
  maxTokens: string;
  loading: boolean;
}

function normalize(value: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

export class CanvasAgentSession extends AISessionStore<AgentState> {
  constructor() {
    super(() => ({ messages: [], input: "", maxTurns: "6", maxTokens: "4096", loading: false }));
  }

  send = async (content: string) => {
    if (this.state.loading || !content.trim()) return;
    const generation = ++this.generation;
    const history = [...this.state.messages, aiMessage("user", content.trim())];
    const pending = aiMessage("assistant", "", { pending: true });
    const options = {
      max_turns: normalize(this.state.maxTurns, 6, 1, 12),
      max_tokens: normalize(this.state.maxTokens, 4096, 256, 8192),
    };
    this.update({ messages: [...history, pending], loading: true });
    try {
      const response = await invoke<string>("canvas_agent_chat", { messages: aiPayload(history), options });
      if (generation !== this.generation) return;
      this.update({ messages: [...history, { ...pending, content: response, pending: false }] });
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ messages: [...history, { ...pending, content: `Canvas Agent 调用失败：${error}`, pending: false, error: true }] });
    } finally {
      if (generation === this.generation) this.update({ loading: false });
    }
  };
}

export const canvasAgentSession = new CanvasAgentSession();
