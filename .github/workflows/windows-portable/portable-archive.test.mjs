import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import AdmZip from "adm-zip";
import { createPortableArchive } from "./portable-archive.mjs";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-portable-"));
  t.after(() => fs.remove(dir));
  const configPath = path.join(dir, "tauri.conf.json");
  await fs.writeJson(configPath, {
    version: "3.0.13",
    productName: "SJTU Canvas Helper",
    mainBinaryName: "canvas-binary",
    bundle: { active: true },
  });
  await fs.writeFile(path.join(dir, "canvas-binary.exe"), "executable fixture");
  await fs.outputFile(path.join(dir, ".config/account.json"), "private fixture");
  return { configPath, releaseDir: dir, outputDir: dir };
}

test("packages both Windows architectures with the executable and a clean portable marker", async (t) => {
  const options = await fixture(t);
  const original = await fs.readFile(options.configPath);
  for (const [target, arch] of [["x86_64-pc-windows-msvc", "x64"], ["i686-pc-windows-msvc", "x86"]]) {
    const result = await createPortableArchive({ ...options, target });
    assert.equal(result.version, "3.0.13");
    assert.equal(result.zipFile, `SJTU.Canvas.Helper_3.0.13_${arch}_portable.zip`);
    const zip = new AdmZip(result.zipPath);
    assert.deepEqual(zip.getEntries().map((entry) => entry.entryName).sort(), [".config/PORTABLE", "canvas-binary.exe"]);
    assert.equal(zip.readAsText("canvas-binary.exe"), "executable fixture");
    assert.equal(zip.readFile(".config/PORTABLE").length, 0);
  }
  assert.deepEqual(await fs.readFile(options.configPath), original);
});

test("rejects an unsupported target or a missing executable instead of publishing an incomplete archive", async (t) => {
  const options = await fixture(t);
  await assert.rejects(createPortableArchive({ ...options, target: "unknown-target" }), /Unsupported Windows target/);
  await fs.remove(path.join(options.releaseDir, "canvas-binary.exe"));
  await assert.rejects(createPortableArchive({ ...options, target: "x86_64-pc-windows-msvc" }));
  assert.equal(await fs.pathExists(path.join(options.outputDir, "SJTU.Canvas.Helper_3.0.13_x64_portable.zip")), false);
});

test("the Windows upload entry point exits with a failure when the build is missing", { skip: process.platform !== "win32" }, async (t) => {
  const options = await fixture(t);
  const script = fileURLToPath(new URL("./portable.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "x86_64-pc-windows-msvc"], {
    cwd: options.outputDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not found the release dir/);
});
