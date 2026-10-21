import { runAccountTransition } from "./account_transition";
import { resetAISessions } from "./ai_sessions";
import { canvasAgentSession } from "./canvas_agent_session";
import { fileAISession } from "./file_ai_session";
import { videoSummarySession } from "./video_summary_session";
import { resetVideoWorkspace } from "./video_workspace";

export function changeSessionAccount(change: () => Promise<unknown>) {
  return runAccountTransition(change,
    () => canvasAgentSession.getSnapshot().loading || fileAISession.getSnapshot().loading || videoSummarySession.getSnapshot().loading,
    () => { resetAISessions(); resetVideoWorkspace(); });
}
