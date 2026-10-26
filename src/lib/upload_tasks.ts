import { invoke } from "@tauri-apps/api/core";
import { getOutputFile, type FileOutputFormat } from "./file_conversion";
import type { File, AppConfig } from "./model";
import type { TaskSpec } from "./task_manager";
import { currentSession, isSessionCurrent } from "./session";
import { captureOperationConfig, adoptOperationConfig, isConfigOwnerCurrent } from "./config";

function uploadError(message: string, cause: unknown) {
  return Object.assign(new Error(message), { cause });
}

/** Capture the destination before leaving the originating course/folder. */
export function createCloudUploadTask(file: File, outputFormat: FileOutputFormat, saveDir: string, context: string): TaskSpec {
  file = structuredClone(file);
  let session = currentSession();
  let config = captureOperationConfig();
  const ensureSession = () => {
    if (!isSessionCurrent(session) || !isConfigOwnerCurrent(config))
      throw new Error("账号已切换，请在当前账号重新创建上传任务。");
  };
  const outputFile = getOutputFile(file, outputFormat);
  const command = outputFormat === "pdf" ? "upload_file_as_pdf" : "upload_file";
  const stage = outputFormat === "pdf" ? "正在转换 PDF 并上传" : "正在上传至云盘";
  const event = { channel: "file_upload://progress", id: "" };
  const upload = async () => {
    ensureSession();
    await invoke(command, { file, saveDir, expectedOwner: config.__config_owner, operationId: event.id });
    ensureSession();
  };
  const conversionError = (error: unknown) => outputFormat === "pdf" &&
    /Document conversion failed|Unsupported file extension/.test(String(error));
  const describeError = (error: unknown) => conversionError(error)
    ? uploadError(`转换 PDF 失败：${String(error)}。自动转换需要可用的 LibreOffice，不会调用 Microsoft Office。`, error)
    : error;
  return {
    id: `upload:${session}:${saveDir}:${file.uuid}:${outputFormat}`, name: outputFile.display_name,
    source: "files", kind: outputFormat === "pdf" ? "upload-pdf" : "upload",
    context, outputPath: `交大云盘/${saveDir}/${outputFile.display_name}`,
    data: { file: structuredClone(file), outputFormat }, stage,
    event,
    // Cloud login and directory creation share mutable backend state.
    locks: ["jbox-upload"],
    run: async ({ update }) => {
      ensureSession();
      event.id = crypto.randomUUID();
      // Authenticate before the first mutation when no login is configured.
      // Never replay an upload merely because its response was lost.
      if (!config.jbox_login_info?.access_token) {
        update({ stage: "正在登录交大云盘", progress: undefined });
        const previousOwner = config.__config_owner!;
        let next: AppConfig;
        try { next = await invoke<AppConfig>("login_jbox", { expectedOwner: previousOwner }); }
        catch (error) {
          ensureSession();
          throw uploadError(`登录交大云盘失败：${String(error)}。请先登录后重试。`, error);
        }
        session = adoptOperationConfig(previousOwner, session, next);
        config = next;
        ensureSession();
        update({ stage, progress: undefined });
      }
      try { await upload(); }
      catch (error) {
        ensureSession();
        if (conversionError(error)) throw describeError(error);
        throw uploadError(`上传未能确认完成：${String(error)}。请先核对云盘结果，避免重复上传。`, error);
      }
    },
  };
}
