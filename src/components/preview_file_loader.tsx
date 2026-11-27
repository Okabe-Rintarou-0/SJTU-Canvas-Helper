import type { DocRenderer } from "@cyntler/react-doc-viewer";
import { CODE_LIKE_EXTENSIONS } from "../lib/constants";

export const PREVIEW_SAMPLE_BYTES = 8192;

export function textPreviewType(fileType: string) {
  return ["md", "markdown", "text/markdown", "csv", "ipynb"].includes(fileType)
    || CODE_LIKE_EXTENSIONS.includes(fileType);
}

export function knownPreviewType(fileType: string, contentType: string, renderers: readonly DocRenderer[]) {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const supported = (type: string) =>
    textPreviewType(type) || renderers.some((renderer) => renderer.fileTypes.includes(type));

  if (supported(fileType)) return fileType;
  if (supported(mime)) return mime;
  if (mime.startsWith("text/")) {
    const subtype = mime.slice(5);
    return supported(subtype) ? subtype : "txt";
  }
  if (mime === "application/json" || mime.endsWith("+json")) return "json";
  if (mime === "application/xml" || mime.endsWith("+xml")) return "xml";
  return undefined;
}

export function isPreviewText(bytes: Uint8Array) {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  try {
    // A prefix can end partway through the last encoded character.
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: bytes.length === PREVIEW_SAMPLE_BYTES });
    for (const character of text) {
      const code = character.charCodeAt(0);
      if (code < 32 && !"\t\n\f\r".includes(character)) return false;
      if (code >= 127 && code <= 159) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchPreviewSample(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) return undefined;
  const reader = response.body.getReader();
  const bytes = new Uint8Array(PREVIEW_SAMPLE_BYTES);
  let length = 0;
  try {
    while (length < bytes.length) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, bytes.length - length);
      bytes.set(chunk, length);
      length += chunk.length;
    }
    return bytes.subarray(0, length);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export function createPreviewRenderers(renderers: DocRenderer[], onFailure: () => void): DocRenderer[] {
  return renderers.map((Renderer) => {
    if (Renderer.fileLoader !== undefined) return Renderer;
    const readAsText = Renderer.fileTypes.includes("md");
    const WithFileLoader: DocRenderer = (props) => <Renderer {...props} />;
    WithFileLoader.fileTypes = Renderer.fileTypes;
    WithFileLoader.weight = Renderer.weight;
    WithFileLoader.fileLoader = ({ documentURI, signal, fileLoaderComplete, headers }) => {
      const fail = () => { if (!signal.aborted) onFailure(); };
      void fetch(documentURI, { signal, headers }).then(async (response) => {
        if (!response.ok) throw new Error("File unavailable");
        const blob = await response.blob();
        if (signal.aborted) return;
        const reader = new FileReader();
        reader.onload = () => { if (!signal.aborted) fileLoaderComplete(reader); };
        reader.onerror = fail;
        if (readAsText) reader.readAsText(blob);
        else reader.readAsDataURL(blob);
      }).catch(fail);
    };
    return WithFileLoader;
  });
}
