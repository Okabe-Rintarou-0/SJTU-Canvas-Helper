import { invoke } from "@tauri-apps/api/core";
import { getOutputFile, type FileOutputFormat } from "./file_conversion";
import type { File } from "./model";
import type { TaskSpec } from "./task_manager";

function uploadError(message: string, cause: unknown) {
  return Object.assign(new Error(message), { cause });
}

/** Capture the destination before leaving the originating course/folder. */
export function createCloudUploadTask(file: File, outputFormat: FileOutputFormat, saveDir: string, context: string): TaskSpec {
  const outputFile = getOutputFile(file, outputFormat);
  const command = outputFormat === "pdf" ? "upload_file_as_pdf" : "upload_file";
  const stage = outputFormat === "pdf" ? "正在转换 PDF 并上传" : "正在上传至云盘";
  const upload = () => invoke(command, { file, saveDir });
  const conversionError = (error: unknown) => outputFormat === "pdf" &&
    /Document conversion failed|Unsupported file extension/.test(String(error));
  const describeError = (error: unknown) => conversionError(error)
    ? uploadError(`转换 PDF 失败：${String(error)}。请确认系统已安装 Microsoft Office 或 LibreOffice。`, error)
    : error;
  return {
    id: `upload:${saveDir}:${file.uuid}:${outputFormat}`, name: outputFile.display_name,
    source: "files", kind: outputFormat === "pdf" ? "upload-pdf" : "upload",
    context, outputPath: `交大云盘/${saveDir}/${outputFile.display_name}`,
    data: { file, outputFormat }, stage,
    event: { channel: "file_upload://progress", id: file.uuid },
    // Cloud login and directory creation share mutable backend state.
    locks: ["jbox-upload"],
    run: async ({ update }) => {
      try { await upload(); return; }
      catch (error) { if (conversionError(error)) throw describeError(error); }
      update({ stage: "正在重新登录交大云盘", progress: undefined });
      try { await invoke("login_jbox"); }
      catch (error) { throw uploadError(`登录交大云盘失败：${String(error)}。请先登录后重试。`, error); }
      update({ stage, progress: undefined });
      try { await upload(); }
      catch (error) {
        if (conversionError(error)) throw describeError(error);
        throw uploadError(`已尝试自动登录交大云盘，但上传仍失败：${String(error)}`, error);
      }
    },
  };
}
