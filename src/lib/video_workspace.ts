import { useSyncExternalStore } from "react";

let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Account changes release the media elements and the old account's course state. */
export function resetVideoWorkspace() {
  revision++;
  listeners.forEach((listener) => listener());
}

export function useVideoWorkspaceRevision() {
  return useSyncExternalStore(subscribe, () => revision);
}
