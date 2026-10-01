import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";

export function useAppZoom() {
  useEffect(() => {
    if (!isTauri()) return;

    const webview = getCurrentWebview();
    let scale = 1;
    let pending = Promise.resolve();
    let active = true;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented || event.isComposing || event.altKey ||
        !(event.ctrlKey || event.metaKey)
      ) return;

      const direction = event.key === "-" ? -1 :
        event.key === "+" || event.key === "=" ? 1 : 0;
      if (!direction) return;

      event.preventDefault();
      const nextScale = Math.min(10, Math.max(0.2, Math.round((scale + direction * 0.2) * 10) / 10));
      if (nextScale === scale) return;
      scale = nextScale;

      // Serialize native calls so rapid key presses cannot apply zoom out of order.
      pending = pending.then(async () => {
        if (active) await webview.setZoom(nextScale);
      }).catch((error: unknown) => {
        console.error("Failed to set app zoom", error);
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      active = false;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
