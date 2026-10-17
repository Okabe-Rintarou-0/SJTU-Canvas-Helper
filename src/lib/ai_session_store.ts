import { useSyncExternalStore } from "react";
import type { CanvasAgentChatMessage, LLMChatMessage } from "./model";

/** App-lifetime state. Route components only subscribe; requests own their lifetime. */
export class AISessionStore<T> {
  private listeners = new Set<() => void>();
  protected generation = 0;
  protected state: T;

  constructor(private readonly initialState: () => T) {
    this.state = initialState();
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  update = (patch: Partial<T>) => {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  };
  reset() {
    this.generation++;
    this.state = this.initialState();
    this.listeners.forEach((listener) => listener());
  }
}

export function useAISession<T>(store: AISessionStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function aiMessage(
  role: "user" | "assistant", content: string, extras?: Partial<CanvasAgentChatMessage>,
): CanvasAgentChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString(), ...extras };
}

export function aiPayload(messages: CanvasAgentChatMessage[]): LLMChatMessage[] {
  return messages.filter((message) => !message.pending && !message.error)
    .map(({ role, content }) => ({ role, content }));
}
