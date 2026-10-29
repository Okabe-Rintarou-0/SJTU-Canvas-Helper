import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { enrichUpdateManifest, prepareUpdateManifest } from "./prepare-update-manifest.mjs";

function fixture(t) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "canvas-update-manifest-"));
  t.after(() => {
    if (dirname(root) !== parent) throw new Error("Invalid test cleanup path");
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

const logs = [{ version: "v3.0.14", date: "2026/10/29", items: ["修复启动"] }];

test("attaches cumulative UTF-8 logs while preserving signatures, platform URLs and notes", () => {
  const manifest = {
    version: "3.0.14", notes: "发布说明", pub_date: "2026-10-29T00:00:00Z",
    platforms: { "windows-x86_64": { signature: "signed", url: "https://example.com/update.zip" } },
  };
  const logs = [
    { version: "v3.0.14", date: "2026/10/29", items: ["修复启动"] },
    { version: "v3.0.13", date: "2026/10/1", items: ["改善体验"] },
  ];
  const result = JSON.parse(JSON.stringify(prepareUpdateManifest(manifest, logs)));
  assert.deepEqual(result, { ...manifest, changelog: logs });
  assert.equal(manifest.changelog, undefined);
  assert.equal(prepareUpdateManifest(manifest, []), manifest);
  assert.equal(prepareUpdateManifest(manifest, null), manifest);
  assert.equal(prepareUpdateManifest({ ...manifest, version: "3.0.15" }, logs).changelog, undefined);
});

test("the current app version has a release log ready for publication", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const logs = JSON.parse(readFileSync(new URL("../src/lib/change_logs.json", import.meta.url), "utf8"));
  assert.ok(logs.some((log) => log.version.replace(/^v/, "") === config.version), "Add release notes for the current version");
});

test("preserves all native platform, installer and v1-compatible bundle entries exactly", () => {
  const platforms = Object.fromEntries([
    ["windows-x86_64", "windows-x64.msi.zip"],
    ["windows-i686", "windows-x86.msi.zip"],
    ["windows-x86_64-msi", "windows-x64.msi.zip"],
    ["windows-i686-nsis", "windows-x86.nsis.zip"],
    ["darwin-aarch64", "mac-arm.app.tar.gz"],
    ["darwin-x86_64", "mac-intel.app.tar.gz"],
    ["darwin-aarch64-app", "mac-arm.app.tar.gz"],
    ["linux-x86_64", "linux.AppImage.tar.gz"],
    ["linux-x86_64-appimage", "linux.AppImage"],
  ].map(([platform, asset]) => [platform, {
    signature: `untrusted comment: signature\n${platform}==\n`,
    url: `https://github.com/example/app/releases/download/app-v3.0.14/${asset}`,
  }]));
  const manifest = { version: "3.0.14", platforms, notes: "Original notes", pub_date: "2026-10-29T00:00:00Z", extra: { preserved: true } };
  const result = JSON.parse(JSON.stringify(prepareUpdateManifest(manifest, logs)));
  const { changelog, ...legacyFields } = result;
  assert.deepEqual(legacyFields, manifest);
  assert.deepEqual(changelog, logs);
  assert.deepEqual(prepareUpdateManifest(manifest, [null, {}, ...logs]), result);
});

test("the CLI works in a Windows-compatible Unicode path with only Node.js built-ins", (t) => {
  const root = fixture(t);
  const manifestPath = join(root, "更新清单.json");
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const manifest = { version: config.version, platforms: { "windows-x86_64": { signature: "signed", url: "https://example.com/app.msi.zip" } } };
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./prepare-update-manifest.mjs", import.meta.url)), manifestPath], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const enriched = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.deepEqual(enriched.platforms, manifest.platforms);
  assert.ok(enriched.changelog.some((log) => log.version.replace(/^v/, "") === config.version));
});

test("missing or malformed optional logs keep the original manifest byte-for-byte", (t) => {
  const root = fixture(t);
  const manifestPath = join(root, "latest.json");
  const logsPath = join(root, "logs.json");
  const original = '{ "version": "3.0.14", "platforms": {}, "notes": "原说明" }\r\n';
  writeFileSync(manifestPath, original, "utf8");
  enrichUpdateManifest(manifestPath, logsPath);
  assert.equal(readFileSync(manifestPath, "utf8"), original);
  for (const content of ["invalid JSON", "null", "[]", JSON.stringify([{ ...logs[0], version: "v3.0.13" }]), JSON.stringify([{ ...logs[0], items: [null] }])]) {
    writeFileSync(logsPath, content, "utf8");
    enrichUpdateManifest(manifestPath, logsPath);
    assert.equal(readFileSync(manifestPath, "utf8"), original);
  }
});

test("a failed write cannot truncate the original updater manifest", (t) => {
  const root = fixture(t);
  const manifestPath = join(root, "latest.json");
  const logsPath = join(root, "logs.json");
  const original = '{ "version": "3.0.14", "platforms": {} }\n';
  writeFileSync(manifestPath, original, "utf8");
  writeFileSync(logsPath, JSON.stringify(logs), "utf8");
  mkdirSync(`${manifestPath}.changelog.tmp`);
  assert.throws(() => enrichUpdateManifest(manifestPath, logsPath));
  assert.equal(readFileSync(manifestPath, "utf8"), original);
});
