import { useCallback, useRef } from "react";

/** Release media on actual removal/camera replacement, never on a route hide. */
export function useMediaElement() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const attach = useCallback((element: HTMLVideoElement | null) => {
    const previous = ref.current;
    if (previous && previous !== element) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }
    ref.current = element;
  }, []);
  return { ref, attach };
}
