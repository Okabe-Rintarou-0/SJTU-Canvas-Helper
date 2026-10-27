import PDFMerger from "pdf-merger-js/browser";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import type { File } from "./model";
import { taskManager } from "./task_manager";

export function enqueuePDFMerge(files: File[], name: string) {
  const id = `pdf-merge:${crypto.randomUUID()}`;
  let resultUrl: string | undefined;
  return taskManager.enqueue({
    id, name, source: "files", kind: "pdf-merge", context: `${files.length} 个文件`,
    locks: ["pdf-merger"], stage: "准备合并",
    dispose: () => { if (resultUrl) URL.revokeObjectURL(resultUrl); },
    run: async ({ update, setSave }) => {
      const merger = new PDFMerger();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        update({ stage: `正在添加 ${file.display_name}（${i + 1}/${files.length}）`, progress: i / files.length * 90 });
        const extension = file.display_name.toLowerCase().split(".").pop();
        if (extension === "pptx" || extension === "docx") {
          const bytes = await invoke<number[]>(extension === "pptx" ? "convert_pptx_to_pdf" : "convert_docx_to_pdf", { file });
          await merger.add(new Uint8Array(bytes));
        } else {
          await merger.add(file.url);
        }
      }
      update({ stage: "正在生成合并结果", progress: undefined });
      const blob = await merger.saveAsBlob();
      resultUrl = URL.createObjectURL(blob);
      update({ result: { url: resultUrl, name } });
      setSave(async () => {
        const path = await save({ defaultPath: name, filters: [{ name: "PDF", extensions: ["pdf"] }] });
        if (!path) return;
        taskManager.enqueue({
          id: `${id}:save:${path}`, name, source: "files", kind: "pdf-save", outputPath: path,
          locks: [`path:${path.toLowerCase()}`], stage: "正在保存 PDF",
          run: async () => invoke("save_path_file", { path, content: Array.from(new Uint8Array(await blob.arrayBuffer())) }),
          open: () => open(path),
        });
      });
    },
  });
}
