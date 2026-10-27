import { describe, expect, it } from "vitest";
import { encode } from "js-base64";
import type { IMainState } from "@cyntler/react-doc-viewer/dist/cjs/store/mainStateReducer";
import CodeRenderer from "../code_renderer";
import { render, screen } from "../../test/test-utils";

const pyCode = `print("hello world")
for i in range(10):
    print(i)`;

const pyFileData = `data:text/plain;base64,${encode(pyCode)}`;

const largeLines = Array.from({ length: 5500 }, (_, i) => `line ${i + 1}`);
const largeCode = largeLines.join("\n");
const largeFileData = `data:text/plain;base64,${encode(largeCode)}`;

function createMainState(overrides?: Partial<IMainState>): IMainState {
  return {
    currentFileNo: 0,
    documents: [],
    language: "en" as const,
    ...overrides,
  };
}

describe("CodeRenderer", () => {
  it("returns null when no currentDocument", () => {
    const { container } = render(
      <CodeRenderer mainState={createMainState({ currentDocument: undefined })} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when fileData is undefined", () => {
    const { container } = render(
      <CodeRenderer
        mainState={createMainState({
          currentDocument: { uri: "blob:test", fileName: "test.py", fileType: "py" },
        })}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders code content from base64 fileData with syntax highlighting", () => {
    const { container } = render(
      <CodeRenderer
        mainState={createMainState({
          currentDocument: {
            uri: "blob:test",
            fileName: "test.py",
            fileType: "py",
            fileData: pyFileData,
          },
        })}
      />
    );

    // content is split into token spans by SyntaxHighlighter
    expect(container.textContent).toContain('print("hello world")');
    expect(container.textContent).toContain("for i in range(10):");
    expect(container.textContent).toContain("print(i)");

    // syntax-highlighted tokens should have Prism token classes
    expect(container.querySelector('code[class*="language-py"]')).toBeInTheDocument();
    expect(container.querySelector('span[class*="token"]')).toBeInTheDocument();
  });

  it("uses fileType as syntax language", () => {
    const { container } = render(
      <CodeRenderer
        mainState={createMainState({
          currentDocument: {
            uri: "blob:test",
            fileName: "test.py",
            fileType: "py",
            fileData: pyFileData,
          },
        })}
      />
    );

    const codeEl = container.querySelector('code[class*="language-"]');
    expect(codeEl).toBeInTheDocument();
    expect(codeEl!.className).toContain("language-py");
  });

  it("skips syntax highlighting for large files and shows warning", () => {
    const { container } = render(
      <CodeRenderer
        mainState={createMainState({
          currentDocument: {
            uri: "blob:test",
            fileName: "large.html",
            fileType: "html",
            fileData: largeFileData,
          },
        })}
      />
    );

    // should show the size warning
    expect(screen.getByText(/已跳过语法高亮/)).toBeInTheDocument();
    expect(screen.getByText(/5500 行/)).toBeInTheDocument();

    // content should still be visible as plain text (virtual scroll renders visible lines)
    expect(container.textContent).toContain("line 1");
    expect(container.textContent).toContain("line 50");

    // no Prism token spans
    expect(container.querySelector('span[class*="token"]')).not.toBeInTheDocument();
  });
});
