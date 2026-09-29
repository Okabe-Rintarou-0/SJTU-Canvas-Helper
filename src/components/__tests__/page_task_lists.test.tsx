import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { expect, it } from "vitest";
import { configSlice } from "../../lib/store";
import type { AppConfig } from "../../lib/model";
import { useTasks } from "../../lib/task_hooks";
import { taskManager } from "../../lib/task_manager";
import PageTaskLists from "../page_task_lists";

it("restores local lists and keeps an upload running when the experiment changes", async () => {
  const store = configureStore({ reducer: { config: configSlice.reducer } });
  let finish!: () => void;
  let starts = 0;
  const id = "experiment-upload";
  function Tasks({ label }: { label: string }) {
    const tasks = useTasks();
    return <div data-testid={label}>{tasks.find((task) => task.id === id)?.status}</div>;
  }
  const view = render(
    <Provider store={store}>
      <Tasks label="center" />
      <PageTaskLists><Tasks label="local" /></PageTaskLists>
    </Provider>,
  );
  expect(screen.getByTestId("local")).toBeTruthy();
  act(() => {
    taskManager.enqueue({
      id, name: "upload.pdf", kind: "upload", source: "files",
      run: () => { starts++; return new Promise<void>((resolve) => { finish = resolve; }); },
    });
  });
  const setExperiment = (enabled?: boolean) => act(() => {
    store.dispatch(configSlice.actions.updateConfig({ experimental_task_center_only: enabled } as AppConfig));
  });
  setExperiment(undefined); // Older config files keep both views.
  expect(screen.getByTestId("local").textContent).toBe("running");
  setExperiment(true);
  expect(screen.queryByTestId("local")).toBeNull();
  expect(screen.getByTestId("center").textContent).toBe("running");
  await act(async () => finish());
  expect(screen.getByTestId("center").textContent).toBe("succeeded");
  setExperiment(false);
  expect(screen.getByTestId("local").textContent).toBe("succeeded");
  expect(starts).toBe(1);
  view.unmount();
  taskManager.remove(id);
});
