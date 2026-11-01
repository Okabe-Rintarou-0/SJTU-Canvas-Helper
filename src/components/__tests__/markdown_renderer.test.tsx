import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { IMainState } from "@cyntler/react-doc-viewer/dist/cjs/store/mainStateReducer";
import MarkdownRenderer from "../markdown_renderer";

vi.mock("../../lib/utils", () => ({ decodeBase64Data: () => "`inline`\n\n```ts\nconst value = 1;\n```" }));
vi.mock("../renderer_shell", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("react-syntax-highlighter", () => ({ Prism: ({ children }: { children: ReactNode }) => <pre data-testid="code-block">{children}</pre> }));
afterEach(cleanup);

it("preserves code nodes and horizontal scroll when the document rerenders", () => {
  const mainState: IMainState = { currentFileNo: 0, documents: [], language: "en",
    currentDocument: { uri: "blob:markdown", fileName: "notes.md", fileType: "md", fileData: "encoded" } };
  const view = render(<MarkdownRenderer mainState={mainState} />);
  const inline = screen.getByText("inline");
  const block = screen.getByTestId("code-block");
  block.scrollLeft = 480;
  view.rerender(<MarkdownRenderer mainState={mainState} />);
  expect(screen.getByText("inline")).toBe(inline);
  expect(screen.getByTestId("code-block")).toBe(block);
  expect(block.scrollLeft).toBe(480);
});
