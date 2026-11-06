import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import AccountSessionBoundary from "../account_session_boundary";
import { invalidateSession } from "../../lib/session";
afterEach(cleanup);
it("drops nested source state and old completions while preserving the surrounding shell", async () => {
  const clean = vi.fn(); const setters: ((value: string) => void)[] = [];
  function SourcePage() {
    const [source, setSource] = useState("");
    useEffect(() => { setters.push(setSource); return clean; }, []);
    return <output data-testid="source">{source}</output>;
  }
  function Shell() {
    const [shell, setShell] = useState(0);
    return <><button onClick={() => setShell(shell + 1)}>{shell}</button><AccountSessionBoundary><SourcePage /></AccountSessionBoundary></>;
  }
  const view = render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "0" }));
  act(() => setters[0]("old files"));
  view.rerender(<Shell />);
  expect(screen.getByTestId("source")).toHaveTextContent("old files");
  expect(clean).not.toHaveBeenCalled();
  act(() => invalidateSession());
  expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
  expect(screen.getByTestId("source")).toBeEmptyDOMElement();
  expect(clean).toHaveBeenCalledOnce();
  await act(async () => { await Promise.resolve(); setters[0]("late old files"); });
  expect(screen.getByTestId("source")).toBeEmptyDOMElement();
  act(() => setters[1]("new files"));
  expect(screen.getByTestId("source")).toHaveTextContent("new files");
});
