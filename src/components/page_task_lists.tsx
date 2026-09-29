import type { ReactNode } from "react";
import { useSelector } from "react-redux";
import type { ConfigState } from "../lib/store";

/** Only controls page-local views; task execution is independent of visibility. */
export default function PageTaskLists({ children }: { children: ReactNode }) {
  const centerOnly = useSelector(
    (state: ConfigState) => state.config.data?.experimental_task_center_only === true,
  );
  return centerOnly ? null : <>{children}</>;
}
