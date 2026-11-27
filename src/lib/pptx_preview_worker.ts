import { getSlides, loadPresentation } from "@office-kit/pptx";
import { renderSlideToSvg } from "@office-kit/pptx-preview";

export type SlideRequest = { uri: string } | { index: number };
export type SlideResponse = { index: number; svg: string; total: number } | { failed: true };

let presentation: Awaited<ReturnType<typeof loadPresentation>> | undefined;
const context = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");

async function render(request: SlideRequest): Promise<SlideResponse> {
  if ("uri" in request) {
    const response = await fetch(request.uri);
    if (!response.ok) return { failed: true };
    presentation = await loadPresentation(await response.arrayBuffer());
  }
  if (!presentation) return { failed: true };
  const index = "index" in request ? request.index : 0;
  const slides = getSlides(presentation);
  const slide = slides[index];
  if (!slide) return { failed: true };

  const svg = renderSlideToSvg(presentation, slide, {
    textLayout: "svg",
    resolveFamily: (family) => family || "Arial",
    measureText: context ? (text, font) => {
      context.font = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${font.sizePx}px ${JSON.stringify(font.family)}`;
      return { widthPx: context.measureText(text).width, approximate: false };
    } : undefined,
  });
  return { index, svg, total: slides.length };
}

self.addEventListener("message", (event: MessageEvent<SlideRequest>) => {
  void render(event.data)
    .then((response) => self.postMessage(response))
    .catch(() => self.postMessage({ failed: true } satisfies SlideResponse));
});
