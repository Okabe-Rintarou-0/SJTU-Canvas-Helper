import { createContext, useContext, useEffect, useState } from "react";

export const WorkspaceActivity = createContext(true);

/** Popups rendered into document.body must close when their workspace is hidden. */
export function useWorkspacePopup() {
  const active = useContext(WorkspaceActivity);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  return { open: active && open, onOpen: () => setOpen(true), onClose: () => setOpen(false) };
}
