import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppZoom } from "./app_zoom";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  setZoom: vi.fn<(scale: number) => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: mocks.setZoom }),
}));

function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...options });
  window.dispatchEvent(event);
  return event;
}

describe("app keyboard zoom", () => {
  beforeEach(() => {
    mocks.isTauri.mockReturnValue(true);
    mocks.setZoom.mockReset().mockResolvedValue(undefined);
  });

  it("zooms the whole webview with Ctrl/Cmd plus and minus", async () => {
    const hook = renderHook(useAppZoom);
    await act(async () => {
      expect(press("=", { ctrlKey: true }).defaultPrevented).toBe(true);
      press("+", { ctrlKey: true, shiftKey: true });
      press("-", { metaKey: true });
    });
    expect(mocks.setZoom.mock.calls).toEqual([[1.2], [1.4], [1.2]]);
    hook.unmount();
  });

  it("leaves ordinary typing, unrelated shortcuts, and scrolling alone", async () => {
    const hook = renderHook(useAppZoom);
    await act(async () => {
      expect(press("+").defaultPrevented).toBe(false);
      expect(press("-", { altKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press("0", { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press("=", { ctrlKey: true, isComposing: true }).defaultPrevented).toBe(false);
      for (const type of ["wheel", "mousewheel"]) {
        for (const ctrlKey of [false, true]) {
          const event = new WheelEvent(type, { deltaY: -100, ctrlKey, cancelable: true });
          window.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
        }
      }
    });
    expect(mocks.setZoom).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("waits for native zoom before applying the next key press", async () => {
    let finish!: () => void;
    mocks.setZoom.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const hook = renderHook(useAppZoom);
    await act(async () => {
      press("+", { ctrlKey: true });
      press("+", { ctrlKey: true });
    });
    expect(mocks.setZoom.mock.calls).toEqual([[1.2]]);
    await act(async () => finish());
    expect(mocks.setZoom.mock.calls).toEqual([[1.2], [1.4]]);
    hook.unmount();
  });

  it("bounds the zoom level and removes the listener on unmount", async () => {
    const hook = renderHook(useAppZoom);
    await act(async () => {
      for (let i = 0; i < 10; i++) press("-", { ctrlKey: true });
    });
    expect(mocks.setZoom).toHaveBeenLastCalledWith(0.2);
    await act(async () => {
      for (let i = 0; i < 60; i++) press("+", { ctrlKey: true });
    });
    expect(mocks.setZoom).toHaveBeenLastCalledWith(10);
    mocks.setZoom.mockClear();
    hook.unmount();
    expect(press("+", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(mocks.setZoom).not.toHaveBeenCalled();
  });

  it("preserves browser shortcuts outside Tauri", () => {
    mocks.isTauri.mockReturnValue(false);
    const hook = renderHook(useAppZoom);
    expect(press("+", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(mocks.setZoom).not.toHaveBeenCalled();
    hook.unmount();
  });
});
