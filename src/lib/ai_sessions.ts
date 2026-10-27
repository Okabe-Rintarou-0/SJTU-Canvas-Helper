import { canvasAgentSession } from "./canvas_agent_session";
import { fileAISession } from "./file_ai_session";
import { videoSummarySession } from "./video_summary_session";

/** Account changes must discard old context and ignore late responses. */
export function resetAISessions() {
  canvasAgentSession.reset();
  fileAISession.reset();
  videoSummarySession.reset();
}
