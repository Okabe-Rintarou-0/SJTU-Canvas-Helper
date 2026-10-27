import { useEffect, useState, type ReactNode } from "react";
import { matchPath, useLocation } from "react-router-dom";
import { useVideoWorkspaceRevision } from "../lib/video_workspace";
import { WorkspaceActivity } from "../lib/workspace_activity";

function WorkspaceLifetime({ active, children }: { active: boolean; children: (active: boolean) => ReactNode }) {
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!active && !visited) return null;
  // Keep the actual media DOM/HLS instance, not just a saved playback timestamp.
  return <div hidden={!active} aria-hidden={!active} data-testid="retained-video-workspace">
    <WorkspaceActivity.Provider value={active}>{children(active)}</WorkspaceActivity.Provider>
  </div>;
}

export default function RetainedVideoWorkspace({ children }: { children: (active: boolean) => ReactNode }) {
  const { pathname } = useLocation();
  const revision = useVideoWorkspaceRevision();
  return <WorkspaceLifetime key={revision} active={!!matchPath("/video", pathname)}>{children}</WorkspaceLifetime>;
}
