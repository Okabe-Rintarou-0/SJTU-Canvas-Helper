export interface ReleaseChangeLog {
  version: string;
  date: string;
  items: string[];
}

function parseVersion(version: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z.-]+))?(?:\+[\da-zA-Z.-]+)?$/.exec(version);
  if (!match) return null;
  return { core: match.slice(1, 4).map(Number), pre: match[4]?.split(".") };
}

export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) - Number(y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function isReleaseChangeLog(value: unknown): value is ReleaseChangeLog {
  if (!value || typeof value !== "object") return false;
  const log = value as Partial<ReleaseChangeLog>;
  return typeof log.version === "string" && parseVersion(log.version) !== null &&
    typeof log.date === "string" && Array.isArray(log.items) &&
    log.items.length > 0 && log.items.every((item) => typeof item === "string");
}

/** Select the bundled release notes between the previously run and current versions. */
export function getCumulativeChanges(
  currentVersion: string,
  targetVersion: string,
  bundledLogs: unknown,
): ReleaseChangeLog[] {
  const logs = new Map<string, ReleaseChangeLog>();
  const candidates = Array.isArray(bundledLogs) ? bundledLogs : [];
  for (const log of candidates) {
    if (!isReleaseChangeLog(log)) continue;
    const sinceCurrent = compareVersions(log.version, currentVersion);
    const untilTarget = compareVersions(log.version, targetVersion);
    if (sinceCurrent !== null && untilTarget !== null && sinceCurrent > 0 && untilTarget <= 0) {
      logs.set(log.version.replace(/^v/, ""), log);
    }
  }
  return [...logs.values()].sort((a, b) => compareVersions(b.version, a.version) ?? 0);
}
