import { useCallback, useEffect, useRef, useState } from "react";
import { ReadyState } from "react-use-websocket";

type Snapshot = {
  url: string; generation: number; connect: boolean;
  readyState: ReadyState; lastMessage: MessageEvent | null; connectionFailed: boolean;
};
export function useOwnedQRCodeSocket(url: string, generation: number, connect: boolean) {
  const socketRef = useRef<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const getWebSocket = useCallback(() => socketRef.current, []);
  const sendMessage = useCallback((message: string, _keep = false) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(message);
  }, []);
  useEffect(() => {
    const base: Snapshot = { url, generation, connect, readyState: ReadyState.CONNECTING, lastMessage: null, connectionFailed: false };
    if (!connect || !url) {
      socketRef.current = null;
      setSnapshot({ ...base, readyState: ReadyState.CLOSED });
      return;
    }
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch {
      socketRef.current = null;
      setSnapshot({ ...base, readyState: ReadyState.CLOSED, connectionFailed: true });
      return;
    }
    let active = true;
    socketRef.current = socket;
    setSnapshot(base);
    const owns = () => active && socketRef.current === socket;
    const onOpen = () => {
      if (owns()) setSnapshot(previous => ({ ...base, lastMessage: previous?.lastMessage ?? null, readyState: ReadyState.OPEN }));
    };
    const onClose = () => {
      if (!owns()) return;
      setSnapshot(previous => ({
        ...base,
        readyState: ReadyState.CLOSED,
        lastMessage: previous?.url === url
          && previous.generation === generation
          && previous.connect === connect
          ? previous.lastMessage : null,
      }));
    };
    const onError = () => {
      if (!owns()) return;
      active = false;
      socketRef.current = null;
      setSnapshot({ ...base, readyState: ReadyState.CLOSED, connectionFailed: true });
      try { socket.close(); } catch {
        // Ownership is already revoked. A failed close must not reactivate this socket or prevent cleanup of a newer connection.
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (owns()) setSnapshot({ ...base, readyState: ReadyState.OPEN, lastMessage: event });
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    socket.addEventListener("message", onMessage);
    return () => {
      active = false;
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("message", onMessage);
      if (socketRef.current === socket) socketRef.current = null;
      try { socket.close(); } catch {
        // Ownership is already revoked. A failed close must not reactivate this socket or prevent cleanup of a newer connection.
      }
    };
  }, [url, generation, connect]);
  const current = snapshot?.url === url && snapshot.generation === generation && snapshot.connect === connect;
  return {
    sendMessage, getWebSocket,
    readyState: current ? snapshot.readyState : (connect && url ? ReadyState.CONNECTING : ReadyState.CLOSED),
    lastMessage: current ? snapshot.lastMessage : null,
    connectionFailed: current ? snapshot.connectionFailed : false,
  };
}
