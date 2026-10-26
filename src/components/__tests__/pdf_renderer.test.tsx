import { StrictMode, useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { DocumentProps, PageProps } from "react-pdf";
import type { IMainState } from "@cyntler/react-doc-viewer/dist/cjs/store/mainStateReducer";
import { act, cleanup, fireEvent, render, screen, waitFor } from "../../test/test-utils";
import PdfRenderer from "../pdf_renderer";

const pdfMock = vi.hoisted(() => ({
  current: undefined as PDFDocumentProxy | undefined,
  documents: [] as DocumentProps[],
  pages: [] as PageProps[],
}));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: (props: DocumentProps) => {
    pdfMock.documents.push(props);
    const pdf = pdfMock.current;
    useEffect(() => {
      if (props.file && pdf) props.onLoadSuccess?.(pdf);
      // Match react-pdf: callbacks are not load dependencies.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.file, pdf]);
    return <div data-testid="pdf-document">{props.children as ReactNode}</div>;
  },
  Page: (props: PageProps) => {
    pdfMock.pages.push(props);
    return <canvas data-testid="pdf-page" data-page={props.pageNumber} data-width={props.width} />;
  },
}));

function createPdf(count = 200, ratios: number[] = []): PDFDocumentProxy {
  return {
    numPages: count,
    getPage: vi.fn(async (pageNumber: number) => ({
      getViewport: () => ({ width: 100, height: 100 * (ratios[pageNumber - 1] ?? 1) }),
    })),
  } as unknown as PDFDocumentProxy;
}
function mainState(fileData = "data:application/pdf;base64,JVBERg=="): IMainState {
  return {
    currentFileNo: 0, documents: [], language: "en",
    currentDocument: { uri: "test.pdf", fileName: "test.pdf", fileType: "pdf", fileData },
  };
}
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[];
let width: number;
let height: number;

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
function scrollRoot() {
  return screen.getByTestId("pdf-document").parentElement as HTMLDivElement;
}
// Model the browser's automatic clamp against the current committed spacer height.
// A geometry shrink therefore changes the getter even without assigning scrollTop.
function clampScrollToGeometry(root: HTMLDivElement) {
  let top = root.scrollTop;
  const clamp = (value: number) => {
    const geometry = root.querySelector<HTMLElement>("[data-pdf-pages]");
    return Math.max(0, Math.min(value, 56 + Number.parseFloat(geometry?.style.height ?? "0") - height));
  };
  Object.defineProperty(root, "scrollTop", {
    configurable: true,
    get: () => { top = clamp(top); return top; },
    set: (value: number) => { top = clamp(value); },
  });
}
function renderedPages() {
  return screen.queryAllByTestId("pdf-page").map((page) => Number(page.dataset.page));
}

beforeEach(() => {
  pdfMock.current = createPdf();
  pdfMock.documents = [];
  pdfMock.pages = [];
  frames = new Map(); nextFrame = 0; observers = []; width = 800; height = 600;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal("ResizeObserver", class {
    callback: ResizeObserverCallback;
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(callback: ResizeObserverCallback) { this.callback = callback; observers.push(this); }
  });
  let nextUrl = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:pdf-${++nextUrl}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const scroll = this.closest("[data-pdf-scroll]");
    const top = this.hasAttribute("data-pdf-pages") ? 56 - (scroll?.scrollTop ?? 0) : 0;
    return { x: 0, y: top, top, left: 0, bottom: top + height, right: width, width, height, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PdfRenderer bounded page lifecycle", () => {
  it("renders only nearby pages in a long document without reducing page quality", async () => {
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(renderedPages().length).toBeGreaterThan(0));
    expect(renderedPages()).toEqual([1, 2]);
    expect(pdfMock.pages[pdfMock.pages.length - 1]).toMatchObject({ width: 768, renderTextLayer: true, renderAnnotationLayer: true });
    expect(pdfMock.pages[pdfMock.pages.length - 1]?.devicePixelRatio).toBeUndefined();
    expect(pdfMock.current?.getPage).toHaveBeenCalledTimes(200);
    const geometry = document.querySelector<HTMLElement>("[data-pdf-pages]")!;
    expect(geometry.style.height).toBe(`${200 * 768 + 199 * 20}px`);
  });

  it("replaces distant pages, coalesces scroll work, and supports internal page links", async () => {
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    const root = scrollRoot();
    root.scrollTop = 56 + 100 * 788;
    fireEvent.scroll(root); fireEvent.scroll(root); fireEvent.scroll(root);
    expect(frames.size).toBe(1);
    flushFrames();
    expect(renderedPages()).toEqual([100, 101, 102]);
    // React-PDF 7.5 retains its initial onItemClick callback; exercise that closure.
    act(() => pdfMock.documents[0].onItemClick?.({ pageIndex: 198, pageNumber: 199 }));
    flushFrames();
    expect(root.scrollTop).toBe(56 + 198 * 788);
    expect(renderedPages()).toEqual([198, 199, 200]);
  });

  it("recalculates mixed page sizes on zoom and resize without loading page metadata again", async () => {
    pdfMock.current = createPdf(4, [2, 0.5, 1, 1.5]);
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    const geometry = document.querySelector<HTMLElement>("[data-pdf-pages]")!;
    expect(geometry.style.height).toBe("3900px");
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(geometry.style.height).toBe("4280px"); // floor(768 * 1.1) = 844
    width = 1000;
    act(() => observers[observers.length - 1].callback([], {} as ResizeObserver));
    flushFrames();
    expect(screen.getAllByTestId("pdf-page")[0].dataset.width).toBe("1064");
    expect(geometry.style.height).toBe("5380px");
    expect(pdfMock.current.getPage).toHaveBeenCalledTimes(4);
  });

  it("does not accumulate observers/listeners/frames across StrictMode, document switches and unmount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const view = render(<StrictMode><PdfRenderer mainState={mainState()} /></StrictMode>);
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    const oldRoot = scrollRoot();
    const pendingObserver = observers[observers.length - 1];
    fireEvent.scroll(oldRoot);
    expect(frames.size).toBe(1);
    view.rerender(<StrictMode><PdfRenderer mainState={mainState("data:application/pdf;base64,UERG")}/></StrictMode>);
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    view.unmount();
    expect(frames.size).toBe(0);
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
    expect(remove.mock.calls.filter(([event]) => event === "resize").length)
      .toBe(add.mock.calls.filter(([event]) => event === "resize").length);
    act(() => pendingObserver.callback([], {} as ResizeObserver));
    fireEvent.scroll(oldRoot); fireEvent(window, new Event("resize"));
    expect(frames.size).toBe(0);
    const created = vi.mocked(URL.createObjectURL).mock.results.map((result) => result.value).sort();
    const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url).sort();
    expect(revoked).toEqual(created);
  });

  it("stops serial metadata reads and ignores late results when a document is replaced", async () => {
    let resolvePage!: (page: PDFPageProxy) => void;
    const oldPdf = createPdf();
    vi.mocked(oldPdf.getPage).mockImplementation(() => new Promise((resolve) => { resolvePage = resolve; }));
    pdfMock.current = oldPdf;
    const view = render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(oldPdf.getPage).toHaveBeenCalledTimes(1));
    expect(renderedPages()).toEqual([]);
    pdfMock.current = createPdf(1, [2]);
    view.rerender(<PdfRenderer mainState={mainState("data:application/pdf;base64,UERG")} />);
    await waitFor(() => expect(renderedPages()).toEqual([1]));
    await act(async () => { resolvePage({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    expect(oldPdf.getPage).toHaveBeenCalledTimes(1);
    expect(renderedPages()).toEqual([1]);
    expect(document.querySelector<HTMLElement>("[data-pdf-pages]")!.style.height).toBe("1536px");
  });

  it("shows the first page without waiting for the last page's metadata", async () => {
    let resolveLast!: (page: PDFPageProxy) => void;
    pdfMock.current = createPdf(3);
    vi.mocked(pdfMock.current.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 3) return new Promise((resolve) => { resolveLast = resolve; });
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(renderedPages()).toEqual([1]));
    expect(screen.getByRole("status")).toHaveTextContent("正在准备其余 PDF 页面");
    expect(document.querySelector<HTMLElement>("[data-pdf-pages]")!.style.height).toBe("768px");
    await act(async () => { resolveLast({ getViewport: () => ({ width: 100, height: 200 }) } as unknown as PDFPageProxy); });
    expect(renderedPages()).toEqual([1, 2]);
    expect(document.querySelector<HTMLElement>("[data-pdf-pages]")!.style.height).toBe("3112px");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("completes the latest valid pending link when target metadata becomes ready", async () => {
    let resolveLast!: (page: PDFPageProxy) => void;
    pdfMock.current = createPdf(5);
    vi.mocked(pdfMock.current.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 5) return new Promise((resolve) => { resolveLast = resolve; });
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(renderedPages()).toEqual([1]));
    // Use the initial callback, as react-pdf 7.5 does, not the latest render's callback.
    act(() => {
      pdfMock.documents[0].onItemClick?.({ pageIndex: 3, pageNumber: 4 });
      pdfMock.documents[0].onItemClick?.({ pageIndex: 4, pageNumber: 5 });
      pdfMock.documents[0].onItemClick?.({ pageIndex: 100, pageNumber: 101 });
    });
    expect(scrollRoot().scrollTop).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    width = 1000;
    act(() => observers[observers.length - 1].callback([], {} as ResizeObserver));
    flushFrames();
    await act(async () => { resolveLast({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    expect(scrollRoot().scrollTop).toBe(56 + 4 * 1084);
    expect(renderedPages()).toEqual([4, 5]);
  });

  it("publishes scrollable exact prefixes and pending links before the final metadata resolves", async () => {
    let resolveMiddle!: (page: PDFPageProxy) => void;
    let resolveLast!: (page: PDFPageProxy) => void;
    pdfMock.current = createPdf(33);
    vi.mocked(pdfMock.current.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 17) return new Promise((resolve) => { resolveMiddle = resolve; });
      if (pageNumber === 33) return new Promise((resolve) => { resolveLast = resolve; });
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(17));
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    expect(document.querySelector<HTMLElement>("[data-pdf-pages]")!.style.height).toBe("12588px");
    act(() => {
      pdfMock.documents[0].onItemClick?.({ pageIndex: 5, pageNumber: 6 });
      pdfMock.documents[0].onItemClick?.({ pageIndex: 20, pageNumber: 21 });
    });
    // The older programmatic jump's queued scroll event must not cancel the newer link.
    fireEvent.scroll(scrollRoot()); flushFrames();
    expect(scrollRoot().scrollTop).toBe(56 + 5 * 788);
    await act(async () => { resolveMiddle({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(33));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(scrollRoot().scrollTop).toBe(56 + 20 * 788);
    expect(renderedPages()).toEqual([20, 21, 22]);
    expect(document.querySelector<HTMLElement>("[data-pdf-pages]")!.style.height).toBe("25196px");
    scrollRoot().scrollTop = 56 + 25 * 788;
    fireEvent.scroll(scrollRoot()); flushFrames();
    expect(renderedPages()).toEqual([25, 26, 27]);
    await act(async () => { resolveLast({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    expect(scrollRoot().scrollTop).toBe(56 + 25 * 788);
    expect(renderedPages()).toEqual([25, 26, 27]);
    expect(document.querySelector<HTMLElement>("[data-pdf-pages]")!.style.height).toBe("25984px");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    { manualCancel: false, resize: false }, { manualCancel: true, resize: false },
    { manualCancel: false, resize: true }, { manualCancel: true, resize: true },
  ])("preserves pending navigation through geometry clamping, unless manually cancelled (%o)", async ({ manualCancel, resize }) => {
    let resolveMiddle!: (page: PDFPageProxy) => void;
    pdfMock.current = createPdf(100);
    vi.mocked(pdfMock.current.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 17) return new Promise((resolve) => { resolveMiddle = resolve; });
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(17));
    const root = scrollRoot();
    clampScrollToGeometry(root);
    root.scrollTop = Number.MAX_SAFE_INTEGER;
    fireEvent.scroll(root); flushFrames();
    const oldTop = root.scrollTop;
    act(() => pdfMock.documents[0].onItemClick?.({ pageIndex: 99, pageNumber: 100 }));
    if (resize) {
      width = 720;
      act(() => observers[observers.length - 1].callback([], {} as ResizeObserver));
      flushFrames();
    } else {
      fireEvent.click(screen.getByRole("button", { name: "缩小" }));
    }
    expect(root.scrollTop).toBeLessThan(oldTop);
    // This is the scroll event queued by the geometry shrink/clamp, not user input.
    fireEvent.scroll(root); flushFrames();
    if (manualCancel) {
      root.scrollTop -= 100;
      fireEvent.scroll(root); flushFrames();
    }
    const beforeMetadata = root.scrollTop;
    await act(async () => { resolveMiddle({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    expect(root.scrollTop).toBeCloseTo(manualCancel ? beforeMetadata : 56 + 99 * (resize ? 708 : 711));
    if (!manualCancel) expect(renderedPages()).toContain(100);
  });

  it("preserves the current logical page and within-page position on zoom and resize", async () => {
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(200));
    const root = scrollRoot();
    clampScrollToGeometry(root);
    root.scrollTop = 56 + 30 * 788 + 768 / 4;
    fireEvent.scroll(root);
    // Zoom before the coalesced scroll RAF: the newest scroll position still wins.
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(root.scrollTop).toBeCloseTo(56 + 30 * 864 + 844 / 4);
    flushFrames();
    width = 1000;
    act(() => observers[observers.length - 1].callback([], {} as ResizeObserver));
    flushFrames();
    expect(root.scrollTop).toBeCloseTo(56 + 30 * 1084 + 1064 / 4);
    expect(renderedPages()).toContain(31);
    expect(getComputedStyle(root).overflowAnchor).toBe("none");
    expect(screen.getByText(/⌘F.*Ctrl\+F.*已加载页面/)).toBeInTheDocument();
  });

  it("does not let an old pending link navigate a replacement document", async () => {
    let resolveOld!: (page: PDFPageProxy) => void;
    const oldPdf = createPdf(200);
    vi.mocked(oldPdf.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 2) return new Promise((resolve) => { resolveOld = resolve; });
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    pdfMock.current = oldPdf;
    const view = render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(renderedPages()).toEqual([1]));
    act(() => pdfMock.documents[0].onItemClick?.({ pageIndex: 198, pageNumber: 199 }));
    pdfMock.current = createPdf(200);
    view.rerender(<PdfRenderer mainState={mainState("data:application/pdf;base64,UERG")} />);
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    await act(async () => { resolveOld({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    expect(oldPdf.getPage).toHaveBeenCalledTimes(2);
    expect(scrollRoot().scrollTop).toBe(0);
    expect(renderedPages()).toEqual([1, 2]);
  });

  it("cancels an old pending link when the user scrolls before metadata is ready", async () => {
    let resolveLast!: (page: PDFPageProxy) => void;
    pdfMock.current = createPdf(5);
    vi.mocked(pdfMock.current.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 5) return new Promise((resolve) => { resolveLast = resolve; });
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(renderedPages()).toEqual([1]));
    act(() => pdfMock.documents[0].onItemClick?.({ pageIndex: 4, pageNumber: 5 }));
    scrollRoot().scrollTop = 80;
    fireEvent.scroll(scrollRoot()); flushFrames();
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(5));
    await act(async () => { resolveLast({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    expect(scrollRoot().scrollTop).toBe(80);
    expect(renderedPages()).toEqual([1, 2]);
  });

  it("keeps healthy pages readable when a later page's metadata fails", async () => {
    pdfMock.current = createPdf(3);
    vi.mocked(pdfMock.current.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 2) throw new Error("damaged page");
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    expect(document.querySelector<HTMLElement>("[data-pdf-pages]")!.style.height).toBe("2344px");
    scrollRoot().scrollTop = 56 + 2 * 788;
    fireEvent.scroll(scrollRoot()); flushFrames();
    expect(renderedPages()).toEqual([2, 3]);
    expect(screen.queryByText(/PDF 页面载入失败/)).not.toBeInTheDocument();
  });

  it("exposes a readable successor when the first page fails, even while later metadata is pending", async () => {
    let resolveLast!: (page: PDFPageProxy) => void;
    pdfMock.current = createPdf(3);
    vi.mocked(pdfMock.current.getPage).mockImplementation(async (pageNumber) => {
      if (pageNumber === 1) throw new Error("damaged first page");
      if (pageNumber === 3) return new Promise((resolve) => { resolveLast = resolve; });
      return { getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy;
    });
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    act(() => pdfMock.documents[0].onItemClick?.({ pageIndex: 1, pageNumber: 2 }));
    expect(scrollRoot().scrollTop).toBe(56 + Math.floor(768 * Math.SQRT2) + 20);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => { resolveLast({ getViewport: () => ({ width: 100, height: 100 }) } as unknown as PDFPageProxy); });
    expect(renderedPages()).toEqual([1, 2, 3]);
  });

  it("uses bounded per-page error placeholders instead of a full-render fallback", async () => {
    vi.mocked(pdfMock.current!.getPage).mockRejectedValue(new Error("page load failed"));
    render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(200));
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores a late metadata rejection after unmount", async () => {
    let rejectPage!: (reason: Error) => void;
    vi.mocked(pdfMock.current!.getPage).mockImplementation(() => new Promise((_resolve, reject) => { rejectPage = reject; }));
    const view = render(<PdfRenderer mainState={mainState()} />);
    await waitFor(() => expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { rejectPage(new Error("document destroyed")); });
    expect(pdfMock.current!.getPage).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("initializes sizing when a document arrives after an empty state", async () => {
    const state = mainState();
    const view = render(<PdfRenderer mainState={{ ...state, currentDocument: undefined }} />);
    expect(screen.queryByTestId("pdf-document")).not.toBeInTheDocument();
    view.rerender(<PdfRenderer mainState={state} />);
    await waitFor(() => expect(renderedPages()).toEqual([1, 2]));
    expect(screen.getAllByTestId("pdf-page")[0].dataset.width).toBe("768");
    expect(observers.length).toBe(1);
  });
});
