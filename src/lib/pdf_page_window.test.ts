import { describe, expect, it } from "vitest";
import { getPdfAnchoredTop, getPdfPageLayout, getPdfPageWindow } from "./pdf_page_window";

describe("PDF page window", () => {
  it("anchors mixed-size pages, fixed-size gaps and the pre-document header", () => {
    const previous = getPdfPageLayout([2, 0.5, 1], 300);
    const next = getPdfPageLayout([2, 0.5, 1], 600);
    expect(getPdfAnchoredTop(previous, next, 695)).toBe(1370); // halfway through page 2
    expect(getPdfAnchoredTop(previous, next, 780)).toBe(1530); // 10px into the gap
    expect(getPdfAnchoredTop(previous, next, -56)).toBe(-56);
    expect(getPdfAnchoredTop(previous, getPdfPageLayout([2, 0.5, 1, 2], 300), 940)).toBe(940);
    expect(getPdfAnchoredTop(getPdfPageLayout([], 300), next, 0)).toBe(0);
  });

  it("keeps exact mixed-size placeholders, including gaps but no trailing gap", () => {
    expect(getPdfPageLayout([2, 0.5, 1.414], 300)).toEqual({
      offsets: [0, 620, 790], height: 1214,
    });
    expect(getPdfPageLayout([], 300)).toEqual({ offsets: [], height: 0 });
  });

  it("bounds a 10,000-page document to visible pages and one neighbour each side", () => {
    const { offsets } = getPdfPageLayout(Array(10_000).fill(1), 500);
    expect(getPdfPageWindow(offsets, 0, 600)).toEqual({ start: 0, end: 3 });
    expect(getPdfPageWindow(offsets, 520 * 5000, 600)).toEqual({ start: 4999, end: 5003 });
    expect(getPdfPageWindow(offsets, 520 * 9999, 600)).toEqual({ start: 9998, end: 10000 });
  });

  it("uses actual page offsets after zoom/resize and covers short pages without a fixed cap", () => {
    const ratios = [2, 0.5, 1, 0.5, 1];
    expect(getPdfPageWindow(getPdfPageLayout(ratios, 300).offsets, 620, 500))
      .toEqual({ start: 0, end: 5 });
    expect(getPdfPageWindow(getPdfPageLayout(ratios, 600).offsets, 620, 500))
      .toEqual({ start: 0, end: 2 });
    expect(getPdfPageWindow([0, 10, 20, 30, 40, 50], 0, 45)).toEqual({ start: 0, end: 6 });
  });

  it("handles empty/hidden views, offsets before the document, and exact page boundaries", () => {
    expect(getPdfPageWindow([], 0, 500)).toEqual({ start: 0, end: 0 });
    expect(getPdfPageWindow([0, 100], 0, 0)).toEqual({ start: 0, end: 0 });
    expect(getPdfPageWindow([0, 100, 200], -40, 100)).toEqual({ start: 0, end: 2 });
    expect(getPdfPageWindow([0, 100, 200, 300], 0, 100)).toEqual({ start: 0, end: 2 });
  });
});
