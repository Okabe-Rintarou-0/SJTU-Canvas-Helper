import { useSyncExternalStore } from "react";

let changing = false;
const listeners = new Set<() => void>();
export const isAccountTransitioning = () => changing;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useAccountTransitioning = () => useSyncExternalStore(subscribe, isAccountTransitioning);

export async function runAccountTransition(change: () => Promise<unknown>, busy: () => boolean, reset: () => void) {
  if (changing) throw new Error("账号正在切换，请稍后重试。");
  if (busy()) throw new Error("AI 请求仍在处理中，请等待完成后再切换或删除账号。");
  changing = true;
  listeners.forEach((listener) => listener());
  try {
    await change();
    reset();
  } finally {
    changing = false;
    listeners.forEach((listener) => listener());
  }
}
