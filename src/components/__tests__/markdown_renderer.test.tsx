import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { IMainState } from "@cyntler/react-doc-viewer/dist/cjs/store/mainStateReducer";
import MarkdownRenderer from "../markdown_renderer";

const markdown = "`inline` `$literal$`\n\n公式 $x^2$\n\n$$\nx^2+1\n$$\n\n```ts\nconst value = '$x^2$';\n```";
vi.mock("../renderer_shell", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
afterEach(cleanup);

it("preserves code nodes and horizontal scroll when the document rerenders", () => {
  const mainState: IMainState = { currentFileNo: 0, documents: [], language: "en",
    currentDocument: { uri: "blob:markdown", fileName: "notes.md", fileType: "md", fileData: markdown } };
  const view = render(<MarkdownRenderer mainState={mainState} />);
  const inline = screen.getByText("inline");
  const block = view.container.querySelector("pre")!;
  expect(screen.getByText("$literal$", { selector: "code" })).toBeVisible();
  expect(view.container.querySelectorAll("math")).toHaveLength(2);
  expect(view.container.querySelector(".katex-display math annotation")?.textContent).toBe("x^2+1");
  expect(block).toHaveTextContent("const value = '$x^2$';");
  block.scrollLeft = 480;
  view.rerender(<MarkdownRenderer mainState={mainState} />);
  expect(screen.getByText("inline")).toBe(inline);
  expect(view.container.querySelector("pre")).toBe(block);
  expect(block.scrollLeft).toBe(480);
});
