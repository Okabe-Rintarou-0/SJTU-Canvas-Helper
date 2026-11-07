import { createContext, useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { isSessionCurrent } from "./session";

// The owner comes from the selection, before DocViewer starts fetching. It must
// survive delayed renderer mounts and DocViewer's internal renderer remounts.
export const PreviewSessionContext = createContext<number | undefined>(undefined);

export function usePreviewState<T>(session: number, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(() => ({ session, value: initial }));
  const value = state.session === session ? state.value : initial;
  useEffect(() => {
    setState((previous) => !isSessionCurrent(session) || previous.session === session
      ? previous : { session, value: initial });
  }, [initial, session]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    if (!isSessionCurrent(session)) return;
    setState((previous) => {
      if (!isSessionCurrent(session)) return previous;
      const current = previous.session === session ? previous.value : initial;
      return { session, value: typeof next === "function" ? (next as (value: T) => T)(current) : next };
    });
  }, [initial, session]);
  return [value, setValue];
}
