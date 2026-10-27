import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function command(program, args, cwd, options = {}) {
  const result = spawnSync(program, args, { cwd, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} failed (${result.status ?? result.signal})`);
  return result.stdout;
}

function git(args, cwd) {
  return command("git", args, cwd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

export function stagedSnapshot(root, cache) {
  mkdirSync(cache, { recursive: true });
  const snapshot = mkdtempSync(join(cache, "index-"));
  git(["checkout-index", "--all", `--prefix=${snapshot.replaceAll(sep, "/")}/`], root);
  return snapshot;
}

export function removeSnapshot(snapshot, cache) {
  const within = relative(resolve(cache), resolve(snapshot));
  if (!within || within.startsWith("..") || isAbsolute(within)) throw new Error("Invalid snapshot path");
  rmSync(snapshot, { recursive: true, force: true });
}

export function checkRust(root, mode = "all", execute = command) {
  mkdirSync(join(root, "dist"), { recursive: true });
  const cwd = join(root, "src-tauri");
  if (mode !== "test") {
    execute("cargo", ["clippy", "--locked", "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings"], cwd);
  }
  if (mode !== "lint") execute("cargo", ["test", "--locked", "--workspace"], cwd);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !["--staged", "--lint", "--test"].includes(flag)) || (flags.includes("--lint") && flags.includes("--test"))) {
    throw new Error("Usage: node script/check-rust.mjs [--staged] [--lint | --test]");
  }
  const mode = flags.includes("--lint") ? "lint" : flags.includes("--test") ? "test" : "all";
  if (!flags.includes("--staged")) return checkRust(root, mode);
  const paths = git(["diff", "--cached", "--name-only", "-z"], root).split("\0");
  if (!paths.some((path) => /^(src-tauri\/|rust-toolchain\.toml$|script\/check-rust|\.github\/workflows\/rust_)/.test(path))) return;
  const cache = join(root, "node_modules", ".cache", "check-rust");
  let snapshot;
  try {
    snapshot = stagedSnapshot(root, cache);
    // Share build artifacts, while compiling only files exported from the index.
    process.env.CARGO_TARGET_DIR ||= join(root, "src-tauri", "target");
    if (!existsSync(join(snapshot, "rust-toolchain.toml"))) throw new Error("Stage rust-toolchain.toml before checking Rust changes");
    checkRust(snapshot, mode);
  } finally {
    if (snapshot) removeSnapshot(snapshot, cache);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
