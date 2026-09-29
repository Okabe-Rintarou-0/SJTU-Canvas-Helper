import { describe, expect, it } from "vitest";

import { canConvertFileToPdf, getPdfFileName } from "./file_conversion";

describe("file conversion helpers", () => {
  it.each(["讲义.doc", "讲义.DOCX", "课件.ppt", "课件.PPTX"])(
    "recognizes %s as PDF-convertible",
    (display_name) => {
      expect(canConvertFileToPdf({ display_name })).toBe(true);
    }
  );

  it.each(["讲义.pdf", "表格.xlsx", "无扩展名"])(
    "does not offer PDF conversion for %s",
    (display_name) => {
      expect(canConvertFileToPdf({ display_name })).toBe(false);
    }
  );

  it("only replaces the final extension", () => {
    expect(getPdfFileName("第一讲.final.PPTX")).toBe("第一讲.final.pdf");
  });
});
