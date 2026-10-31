import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function prepareUpdateManifest(manifest, logs) {
  if (!manifest || typeof manifest.version !== "string" || !manifest.platforms ||
      typeof manifest.platforms !== "object" || Array.isArray(manifest.platforms)) {
    throw new Error("Invalid updater manifest");
  }
  const validLogs = Array.isArray(logs) ? logs.filter((log) =>
    log && typeof log.version === "string" && typeof log.date === "string" &&
    Array.isArray(log.items) && log.items.length > 0 && log.items.every((item) => typeof item === "string")
  ) : [];
  if (!validLogs.some((log) => log.version.replace(/^v/, "") === manifest.version.replace(/^v/, ""))) return manifest;
  return { ...manifest, changelog: validLogs };
}

export function enrichUpdateManifest(manifestPath, logsPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  let logs;
  try {
    logs = JSON.parse(readFileSync(logsPath, "utf8"));
  } catch {
    console.warn("Update changelog unavailable; keeping the original updater manifest.");
    return;
  }
  const enriched = prepareUpdateManifest(manifest, logs);
  if (enriched === manifest) {
    console.warn(`No changelog for ${manifest.version}; keeping the original updater manifest.`);
    return;
  }
  // A failed write must leave the original manifest available for publication.
  const temporaryPath = `${manifestPath}.changelog.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(enriched, null, 2) + "\n", "utf8");
  renameSync(temporaryPath, manifestPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  enrichUpdateManifest(process.argv[2] ?? "latest.json", new URL("../src/lib/change_logs.json", import.meta.url));
}
