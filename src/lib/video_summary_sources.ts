import { hasVideoMaterial, type VideoMaterial } from "./video_library";

export interface VideoSummarySource {
  key: string;
  title: string;
  included: boolean;
  sources: string[];
  warnings: string[];
}
export const summarySource = (material: VideoMaterial): VideoSummarySource => ({
  key: material.key, title: material.title, included: hasVideoMaterial(material),
  sources: [material.summarySubtitleAvailable !== false && material.subtitleAvailable ? "字幕" : "",
    material.transcriptAvailable ? "音频转录" : "", material.ocrAvailable ? "课件文字" : ""].filter(Boolean),
  warnings: material.warnings,
});
export function sourceCoverage(sources: VideoSummarySource[]) {
  return `已覆盖 ${sources.filter((item) => item.included).length} / ${sources.length} 小节`;
}
export function validSummarySources(value: unknown): value is VideoSummarySource[] {
  return Array.isArray(value) && value.every((item) => item && typeof item.key === "string"
    && typeof item.title === "string" && typeof item.included === "boolean"
    && Array.isArray(item.sources) && item.sources.every((source: unknown) => typeof source === "string")
    && Array.isArray(item.warnings) && item.warnings.every((warning: unknown) => typeof warning === "string"));
}
