import { invoke } from "@tauri-apps/api/core";
import type { Course } from "./model";

export interface DownloadCourse { id: string; name: string; term: string }
export type DownloadKind = "root" | "file" | "ppt" | "video" | "subtitle" | "reading" | "attachment" | "export";

export function downloadCourseContext(course: Course & { canvasId?: number; teachingClassId?: number }): DownloadCourse {
  return {
    id: course.canvasId !== undefined ? String(course.canvasId)
      : course.teachingClassId !== undefined ? `video-space-${course.teachingClassId}` : String(course.id),
    name: course.name, term: course.term.name,
  };
}

export function downloadDirectory(kind: DownloadKind, course?: DownloadCourse, root?: string) {
  return invoke<string>("download_directory", { kind, ...(course ? { course } : {}), ...(root ? { root } : {}) });
}

export interface DownloadedFile {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: number;
  stamp: string;
  external: boolean;
}
export interface DownloadOverview {
  directory: string;
  files: DownloadedFile[];
  totalBytes: number;
  warnings: string[];
  busy: boolean;
}
export type DownloadType = "all" | "document" | "video" | "subtitle" | "other";
export function downloadType(name: string): Exclude<DownloadType, "all"> {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext && ["mp4", "mkv", "mov", "avi", "webm", "m4v", "ts"].includes(ext)) return "video";
  if (ext && ["srt", "vtt", "ass", "lrc"].includes(ext)) return "subtitle";
  if (ext && ["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv"].includes(ext)) return "document";
  return "other";
}
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
export async function defaultDownloadPath(name: string, kind: DownloadKind = "export", course?: DownloadCourse) {
  const directory = await downloadDirectory(kind, course);
  const safeName = Array.from(name, (c) => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? "_" : c).join("");
  return `${directory.replace(/[/\\]+$/, "")}/${safeName}`;
}

// Only ordinary drive/UNC prefixes are presented differently. The backend keeps
// canonical paths for filesystem validation and the on-disk storage pointer.
export function displayLocalPath(path: string) {
  if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`;
  if (/^\\\\\?\\[a-z]:/i.test(path)) return path.slice(4);
  return path;
}
