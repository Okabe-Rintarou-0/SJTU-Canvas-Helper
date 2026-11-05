import { useCallback, useLayoutEffect, useRef } from "react";
import { isSessionCurrent } from "./session";

/** Capture once before starting work, then check before each continuation.
 * Leaving and reopening a retained panel does not restore old operations' ownership.
 * Already-issued native work is not cancelled or rolled back by this UI guard.
 */
export function useActiveSessionOperation(session: number, active: boolean) {
  const lifetime = useRef(0);
  useLayoutEffect(() => {
    lifetime.current += 1;
    return () => { lifetime.current += 1; };
  }, [session, active]);
  return useCallback(() => {
    const generation = lifetime.current;
    return () => active && lifetime.current === generation && isSessionCurrent(session);
  }, [session, active]);
}
