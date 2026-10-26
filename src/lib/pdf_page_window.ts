/** Page geometry only: no canvases, text layers, or document-sized DOM tree. */
export const PDF_PAGE_GAP = 20;

export function getPdfPageLayout(ratios: readonly number[], width: number) {
  let height = 0;
  const offsets = ratios.map((ratio, index) => {
    const top = height;
    height += Math.max(1, Math.floor(width * ratio));
    if (index < ratios.length - 1) height += PDF_PAGE_GAP;
    return top;
  });
  return { offsets, height };
}

function pageAt(offsets: readonly number[], position: number) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= position) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

/** Keep the same logical page and relative position inside it after geometry changes. */
export function getPdfAnchoredTop(
  previous: ReturnType<typeof getPdfPageLayout>,
  next: ReturnType<typeof getPdfPageLayout>,
  top: number,
) {
  if (top < 0 || !previous.offsets.length || !next.offsets.length) return top;
  const index = Math.min(pageAt(previous.offsets, top), next.offsets.length - 1);
  const pageHeight = (layout: ReturnType<typeof getPdfPageLayout>) =>
    (layout.offsets[index + 1] ?? layout.height) - layout.offsets[index]
      - (index + 1 < layout.offsets.length ? PDF_PAGE_GAP : 0);
  const previousHeight = pageHeight(previous);
  const nextHeight = pageHeight(next);
  const within = top - previous.offsets[index];
  // Gaps remain 20 CSS px; scale only the position inside the page itself.
  return next.offsets[index] + (within <= previousHeight
    ? within / Math.max(1, previousHeight) * nextHeight
    : nextHeight + Math.min(PDF_PAGE_GAP, within - previousHeight));
}

/** Include the viewport and one neighbouring page in each direction. */
export function getPdfPageWindow(offsets: readonly number[], top: number, height: number) {
  if (!offsets.length || height <= 0) return { start: 0, end: 0 };
  return {
    start: Math.max(0, pageAt(offsets, top) - 1),
    end: Math.min(offsets.length, pageAt(offsets, top + height - 1) + 2),
  };
}
