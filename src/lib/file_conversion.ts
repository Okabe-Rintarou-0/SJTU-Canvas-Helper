import type { File } from "./model";

export type FileOutputFormat = "original" | "pdf";

const PDF_CONVERTIBLE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
]);
const POWERPOINT_EXTENSIONS = new Set([".ppt", ".pptx"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

function fileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

export function canConvertFileToPdf(file: Pick<File, "display_name">) {
  return PDF_CONVERTIBLE_EXTENSIONS.has(fileExtension(file.display_name));
}

export function isPowerPointFile(file: Pick<File, "display_name">) {
  return POWERPOINT_EXTENSIONS.has(fileExtension(file.display_name));
}

export function isPdfFile(file: Pick<File, "display_name">) {
  return PDF_EXTENSIONS.has(fileExtension(file.display_name));
}

export function getPdfFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return `${baseName}.pdf`;
}

export function getOutputFile(
  file: File,
  outputFormat: FileOutputFormat
): File {
  if (outputFormat === "original") {
    return file;
  }

  return {
    ...file,
    display_name: getPdfFileName(file.display_name),
    filename: getPdfFileName(file.filename),
    mime_class: "pdf",
    "content-type": "application/pdf",
  };
}
