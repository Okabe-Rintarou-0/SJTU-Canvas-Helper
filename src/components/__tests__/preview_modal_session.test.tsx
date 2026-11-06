import { act, cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PreviewModal from "../preview_modal";
import { currentSession, invalidateSession } from "../../lib/session";
import type { File } from "../../lib/model";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), type: vi.fn(), create: vi.fn(), revoke: vi.fn(), renders: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../lib/utils", () => ({ getFileType: mocks.type }));
vi.mock("../renderers", () => ({ BasicRenderers: [] }));
vi.mock("@cyntler/react-doc-viewer", async () => {
  const { useContext } = await import("react");
  const { PreviewSessionContext } = await import("../../lib/preview_session");
  return { default: function DocumentViewer({ documents }: { documents: { uri: string }[] }) { mocks.renders(documents); return (
    <div data-testid="viewer" data-owner={useContext(PreviewSessionContext)}>{documents.map((doc) => doc.uri).join(",")}</div>
  ); } };
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = (name: string, url = `blob:${name}`) => ({ id: 10, display_name: name, url } as File);
beforeEach(() => {
  mocks.type.mockResolvedValue("zip");
  mocks.create.mockReturnValue("blob:converted");
  vi.stubGlobal("URL", class extends URL { static createObjectURL = mocks.create; static revokeObjectURL = mocks.revoke; });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("does not start resolution for an owner invalidated before first mount", () => {
  const owner = currentSession(); invalidateSession();
  render(<PreviewModal ownerSession={owner} open files={[file("old.zip")]} />);
  expect(mocks.type).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
});
it("checks ownership again when invalidation occurs between render and passive effects", () => {
  const owner = currentSession();
  function Parent() {
    useLayoutEffect(() => invalidateSession(), []);
    return <PreviewModal ownerSession={owner} open files={[file("old.zip")]} />;
  }
  render(<Parent />);
  expect(mocks.type).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("drops a pending type result and cannot remount the old request after invalidation", async () => {
  const pending = deferred<string>(); mocks.type.mockReturnValueOnce(pending.promise);
  const owner = currentSession(); const files = [file("old.zip")];
  const view = render(<PreviewModal ownerSession={owner} open files={files} />);
  act(() => invalidateSession());
  await act(async () => pending.resolve("zip"));
  expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
  view.unmount();
  render(<PreviewModal ownerSession={owner} open files={files} />);
  expect(mocks.type).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
});
it("propagates the request owner and removes an existing viewer even without a close callback", async () => {
  const owner = currentSession();
  render(<PreviewModal ownerSession={owner} open files={[file("current.zip")]} />);
  expect(await screen.findByTestId("viewer")).toHaveAttribute("data-owner", String(owner));
  act(() => invalidateSession());
  expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
});
it("does not create a converted URL when conversion finishes after session cleanup", async () => {
  const pending = deferred<number[]>(); mocks.invoke.mockReturnValueOnce(pending.promise);
  render(<PreviewModal ownerSession={currentSession()} open files={[file("old.pptx")]} />);
  expect(mocks.invoke).toHaveBeenCalledWith("convert_pptx_to_pdf", { file: file("old.pptx") });
  act(() => invalidateSession());
  await act(async () => pending.resolve([1, 2]));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
});
it("reclaims only its own converted URL once and leaves input task URLs alone", async () => {
  mocks.invoke.mockResolvedValue([1, 2]);
  const view = render(<PreviewModal ownerSession={currentSession()} open files={[file("current.pptx"), file("external.zip")]} />);
  await screen.findByTestId("viewer");
  act(() => invalidateSession());
  view.unmount();
  expect(mocks.revoke.mock.calls).toEqual([["blob:converted"]]);
});
it("does not start local conversion after a stale online preview failure", async () => {
  const pending = deferred<void>(); mocks.invoke.mockReturnValueOnce(pending.promise);
  const close = vi.fn();
  render(<PreviewModal ownerSession={currentSession()} open files={[file("old.pptx", "https://example.test/old.pptx")]} handleCancelPreview={close} />);
  act(() => invalidateSession());
  await act(async () => pending.reject(new Error("offline")));
  expect(mocks.invoke).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("does not close a new preview when an old external window finishes opening", async () => {
  const pending = deferred<void>(); mocks.invoke.mockReturnValueOnce(pending.promise);
  const close = vi.fn();
  render(<PreviewModal ownerSession={currentSession()} open files={[file("old.pdf", "https://example.test/old.pdf")]} handleCancelPreview={close} />);
  act(() => invalidateSession());
  await act(async () => pending.resolve());
  expect(close).not.toHaveBeenCalled();
});
it("does not adopt resolved old documents when files and owner are replaced", async () => {
  const files = [file("old.zip")]; const owner = currentSession();
  const view = render(<PreviewModal ownerSession={owner} open files={files} />);
  await screen.findByText("blob:old.zip");
  act(() => invalidateSession());
  const pending = deferred<string>(); mocks.type.mockReturnValueOnce(pending.promise);
  view.rerender(<PreviewModal ownerSession={currentSession()} open files={[file("new.zip")]} />);
  expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
  await act(async () => pending.resolve("zip"));
  expect(await screen.findByTestId("viewer")).toHaveTextContent("blob:new.zip");
});
it("does not retain converted documents between preview requests", async () => {
  mocks.invoke.mockResolvedValue([1]);
  const files = [file("current.pptx")]; const owner = currentSession();
  const view = render(<PreviewModal ownerSession={owner} open files={files} />);
  await screen.findByTestId("viewer");
  view.unmount();
  render(<PreviewModal ownerSession={owner} open files={files} />);
  await screen.findByTestId("viewer");
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(mocks.revoke).toHaveBeenCalledOnce();
});

it("never renders old documents during a same-session request replacement", async () => {
  const owner = currentSession();
  const view = render(<PreviewModal ownerSession={owner} open files={[file("old.zip")]} />);
  await screen.findByText("blob:old.zip");
  mocks.renders.mockClear();
  const pending = deferred<string>(); mocks.type.mockReturnValueOnce(pending.promise);
  view.rerender(<PreviewModal ownerSession={owner} open files={[file("new.zip")]} />);
  expect(mocks.renders.mock.calls.flatMap(([documents]) => documents)).toEqual([]);
  await act(async () => pending.resolve("zip"));
  expect(mocks.renders.mock.calls.flatMap(([documents]) => documents).map((doc) => doc.uri))
    .toEqual(["blob:new.zip"]);
});
