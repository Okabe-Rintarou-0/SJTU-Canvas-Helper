import {
  listen,
  type Event as TauriEvent,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef } from "react";

import type {
  FileChatStreamChunkPayload,
  FileChatStreamDonePayload,
  FileChatStreamErrorPayload,
  ProgressPayload,
} from "./model";

/**
 * 应用级（全局）事件名 → 载荷类型。
 * Rust 端通过 app.emit 派发，任何窗口/Webview 都能收到。
 */
export interface TauriEventMap {
  "file_ai_chat://chunk": FileChatStreamChunkPayload;
  "file_ai_chat://done": FileChatStreamDonePayload;
  "file_ai_chat://error": FileChatStreamErrorPayload;
  "video_ai_chat://chunk": FileChatStreamChunkPayload;
  "video_ai_chat://done": FileChatStreamDonePayload;
  "video_ai_chat://error": FileChatStreamErrorPayload;
}

/**
 * 当前 Webview 级事件名 → 载荷类型。
 * Rust 端通过 webview.emit 派发，只对当前窗口生效。
 */
export interface WebviewEventMap {
  "download://progress": ProgressPayload;
  "ppt_download://progress": ProgressPayload;
  "video_download://progress": ProgressPayload;
  "ffmpeg://output": string;
}

type EventSubscribe<T> = (
  event: string,
  handler: EventCallback<T>
) => Promise<UnlistenFn>;

const appWindow = getCurrentWebviewWindow();

function subscribeGlobal<T>(
  event: string,
  handler: EventCallback<T>
): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}

function subscribeWebview<T>(
  event: string,
  handler: EventCallback<T>
): Promise<UnlistenFn> {
  return appWindow.listen<T>(event, handler);
}

/**
 * 注册一个 Tauri 事件订阅，返回取消订阅函数。
 * 处理好 `listen` 的异步注册与组件卸载之间的竞态：
 * 若在监听注册完成前取消，则注册完成后立即注销。
 */
function subscribe<T>(
  subscribeFn: EventSubscribe<T>,
  event: string,
  handler: (payload: T) => void
): UnlistenFn {
  let cancelled = false;
  let unlisten: UnlistenFn | undefined;
  void subscribeFn(event, (event: TauriEvent<T>) => handler(event.payload))
    .then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })
    .catch((error) => {
      console.error(`[events] 订阅事件 "${event}" 失败：`, error);
    });
  return () => {
    cancelled = true;
    void unlisten?.();
  };
}

function useTauriListener<T>(
  subscribeFn: EventSubscribe<T>,
  event: string,
  handler: (payload: T) => void,
  enabled: boolean
) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return subscribe(subscribeFn, event, (payload) =>
      handlerRef.current(payload)
    );
  }, [subscribeFn, event, enabled]);
}

/** 订阅应用级事件，组件卸载时自动取消。 */
export function useTauriEvent<K extends keyof TauriEventMap>(
  event: K,
  handler: (payload: TauriEventMap[K]) => void,
  enabled = true
) {
  useTauriListener<TauriEventMap[K]>(
    subscribeGlobal,
    event,
    handler,
    enabled
  );
}

/** 订阅当前 Webview 级事件，组件卸载时自动取消。 */
export function useWebviewEvent<K extends keyof WebviewEventMap>(
  event: K,
  handler: (payload: WebviewEventMap[K]) => void,
  enabled = true
) {
  useTauriListener<WebviewEventMap[K]>(
    subscribeWebview,
    event,
    handler,
    enabled
  );
}
