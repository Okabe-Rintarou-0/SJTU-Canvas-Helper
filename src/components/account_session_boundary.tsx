import { Fragment, type ReactNode } from "react";
import { useSessionEpoch } from "../lib/session";

/** Page-local source lists and dialogs must never outlive their account. */
export default function AccountSessionBoundary({ children }: { children: ReactNode }) {
  const session = useSessionEpoch();
  return <Fragment key={session}>{children}</Fragment>;
}
