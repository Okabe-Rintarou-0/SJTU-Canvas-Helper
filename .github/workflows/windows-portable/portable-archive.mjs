import fs from "fs-extra";
import path from "path";
import AdmZip from "adm-zip";

const ARCH_MAP = {
  "x86_64-pc-windows-msvc": "x64",
  "i686-pc-windows-msvc": "x86",
  "aarch64-pc-windows-msvc": "arm64",
};

export async function createPortableArchive({ target, configPath, releaseDir, outputDir = "." }) {
  const arch = ARCH_MAP[target];
  if (target && !arch) throw new Error(`Unsupported Windows target: ${target}`);

  const { version, productName, mainBinaryName } = await fs.readJson(configPath);
  if (!version || !productName) throw new Error("Missing Tauri version or productName");

  const zip = new AdmZip();
  zip.addLocalFile(path.join(releaseDir, `${mainBinaryName || productName}.exe`));
  // Include only the portable marker, never cached configuration or account data.
  zip.addFile(".config/PORTABLE", Buffer.alloc(0));

  const zipFile = `SJTU.Canvas.Helper_${version}${arch ? `_${arch}` : ""}_portable.zip`;
  const zipPath = path.join(outputDir, zipFile);
  zip.writeZip(zipPath);
  return { version, zipFile, zipPath };
}
