import { useSyncExternalStore } from "react";
import { courseSlice, configStore } from "./store";

/**
 * Account session ownership.
 *
 * Every account-scoped async request captures the session epoch when it starts
 * and must check it again before touching state. Switching accounts (or any
 * other change of identity) bumps the epoch, so every request that started under
 * the previous account is stale: its result belongs to an account that is no
 * longer active and must be dropped instead of being written into the state that
 * now belongs to the new account.
 */

let epoch = 0;
const listeners = new Set<() => void>();

/** Identity of the account session that is currently active. */
export function currentSession(): number {
  return epoch;
}

/** Whether a request that captured `session` still owns the active account. */
export function isSessionCurrent(session: number): boolean {
  return session === epoch;
}

/**
 * End the current account session.
 *
 * Requests already in flight become stale, and account-scoped global state is
 * reset so that nothing owned by the previous account survives into the next
 * one (e.g. the selected course id, which every page auto-loads on mount).
 */
export function invalidateSession(): void {
  epoch += 1;
  configStore.dispatch(courseSlice.actions.setSelectedCourseId(-1));
  listeners.forEach((listener) => listener());
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the caller whenever the account session changes. */
export function useSessionEpoch(): number {
  return useSyncExternalStore(subscribeSession, currentSession, currentSession);
}
