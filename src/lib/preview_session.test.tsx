import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Entry, File } from "./model";
import { currentSession, invalidateSession, isSessionCurrent, useSessionEpoch } from "./session";
import { usePreviewState } from "./preview_session";

vi.mock("../components/preview_modal", () => ({ default: ({ title, ownerSession }: { title: string; ownerSession: number }) => (
  <div data-testid="preview" data-owner={ownerSession}>{title}</div>
) }));
vi.mock("./pdf_tasks", () => ({ enqueuePDFMerge: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./message", () => ({ appMessage: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));
import { usePreview } from "./hooks";

beforeEach(() => invalidateSession());
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const file = (id: number): File => ({ id, display_name: `${id}.zip`, url: `https://example.test/${id}.zip` } as File);
const emptyEntries: Entry[] = [];

it("preserves same-session values and setter identity across unrelated renders", () => {
  const view = renderHook(() => usePreviewState(useSessionEpoch(), 0));
  const setter = view.result.current[1];
  act(() => setter((previous) => previous + 2));
  view.rerender();
  expect(view.result.current[0]).toBe(2);
  expect(view.result.current[1]).toBe(setter);
});

it("clears state at invalidation and rejects retained values and updater functions", () => {
  const view = renderHook(() => usePreviewState(useSessionEpoch(), 0));
  const staleSetter = view.result.current[1];
  act(() => staleSetter(3));
  const staleUpdater = vi.fn(() => 9);
  act(() => {
    invalidateSession();
    // Exercise the interval before the hook's new render commits.
    staleSetter(8);
    staleSetter(staleUpdater);
  });
  expect(view.result.current[0]).toBe(0);
  expect(staleUpdater).not.toHaveBeenCalled();
  act(() => {
    view.result.current[1]((previous) => previous + 5);
    staleSetter(8);
    staleSetter(staleUpdater);
  });
  expect(view.result.current[0]).toBe(5);
  expect(staleUpdater).not.toHaveBeenCalled();
  expect(view.result.current[1]).not.toBe(staleSetter);
});

it("does not carry an updater's old state into a new session", () => {
  const view = renderHook(() => usePreviewState(useSessionEpoch(), "initial"));
  act(() => view.result.current[1]("old"));
  act(() => invalidateSession());
  const updater = vi.fn((previous: string) => `${previous}:new`);
  act(() => view.result.current[1](updater));
  expect(updater).toHaveBeenCalledWith("initial");
  expect(view.result.current[0]).toBe("initial:new");
});

function previewHarness() {
  let latest!: ReturnType<typeof usePreview>;
  function Harness() {
    latest = usePreview();
    return latest.previewer;
  }
  const view = render(<Harness />);
  return { view, get current() { return latest; } };
}

it("closes selected previews on invalidation, rejects retained callbacks, and permits new selections", () => {
  const harness = previewHarness();
  const old = harness.current;
  act(() => old.setPreviewEntry(file(1)));
  expect(screen.getByTestId("preview")).toHaveTextContent("1.zip");
  act(() => invalidateSession());
  expect(harness.current.previewEntry).toBeUndefined();
  expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  act(() => {
    old.setPreviewEntry(file(2));
    old.onHoverEntry(file(3));
  });
  fireEvent.keyDown(document.body, { key: " " });
  expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  act(() => harness.current.setPreviewEntry(file(4)));
  expect(screen.getByTestId("preview")).toHaveTextContent("4.zip");
});

it("clears an old hover before Space and prevents old arrow navigation from reopening it", () => {
  const harness = previewHarness();
  act(() => {
    harness.current.setEntries([file(1), file(2)]);
    harness.current.onHoverEntry(file(1));
  });
  act(() => invalidateSession());
  fireEvent.keyDown(document.body, { key: " " });
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  // Reusing an ID in the new session must not navigate into the old list.
  act(() => harness.current.setPreviewEntry(file(1)));
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(screen.getByTestId("preview")).toHaveTextContent("1.zip");
  act(() => harness.current.setEntries([file(1), file(3)]));
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(screen.getByTestId("preview")).toHaveTextContent("3.zip");
});

it("keeps same-session hover, Space, and arrow navigation working", () => {
  const harness = previewHarness();
  act(() => {
    harness.current.setEntries([file(1), file(2)]);
    harness.current.onHoverEntry(file(1));
  });
  fireEvent.keyDown(document.body, { key: " " });
  expect(screen.getByTestId("preview")).toHaveTextContent("1.zip");
  fireEvent.keyDown(document.body, { key: "ArrowLeft" });
  expect(screen.getByTestId("preview")).toHaveTextContent("2.zip");
  fireEvent.keyDown(document.body, { key: " " });
  expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
});

it("source-owner checking prevents a dependency-driven old array from being relabeled", () => {
  const source = { owner: currentSession(), entries: [file(1)] };
  const view = renderHook(() => {
    const [entries, setEntries] = usePreviewState(useSessionEpoch(), emptyEntries);
    useEffect(() => {
      // Models submissions' [attachments, setEntries] effect with the minimal
      // source-owner guard. Request ownership cannot infer array provenance.
      if (isSessionCurrent(source.owner)) setEntries(source.entries);
    }, [setEntries]);
    return entries;
  });
  expect(view.result.current).toEqual(source.entries);
  act(() => invalidateSession());
  expect(view.result.current).toEqual([]);
});
