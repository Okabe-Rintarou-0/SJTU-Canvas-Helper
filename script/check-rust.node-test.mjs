import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkRust, removeSnapshot, stagedSnapshot } from "./check-rust.mjs";

test("Rust checks export staged files and leave unstaged and untracked code out", () => {
  const cache = mkdtempSync(join(tmpdir(), "rust-check-test-"));
  const repo = join(cache, "repo");
  mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    git("init", "--quiet");
    git("config", "core.autocrlf", "false");
    mkdirSync(join(repo, "src-tauri"));
    writeFileSync(join(repo, "src-tauri", "example.rs"), "staged content\n");
    git("add", "--", "src-tauri/example.rs");
    const index = git("ls-files", "--stage");
    writeFileSync(join(repo, "src-tauri", "example.rs"), "uncommitted content\n");
    writeFileSync(join(repo, "src-tauri", "untracked.rs"), "untracked content\n");
    const snapshot = stagedSnapshot(repo, join(cache, "snapshots"));
    assert.equal(readFileSync(join(snapshot, "src-tauri", "example.rs"), "utf8"), "staged content\n");
    assert.equal(existsSync(join(snapshot, "src-tauri", "untracked.rs")), false);
    assert.equal(readFileSync(join(repo, "src-tauri", "example.rs"), "utf8"), "uncommitted content\n");
    assert.equal(git("ls-files", "--stage"), index);
  } finally {
    removeSnapshot(cache, tmpdir());
  }
});

test("a failed Clippy check prevents the test command from running", () => {
  const cache = mkdtempSync(join(tmpdir(), "rust-check-test-"));
  const calls = [];
  try {
    assert.throws(() => checkRust(cache, "all", (program, args) => {
      calls.push([program, args]);
      throw new Error("Clippy rejected the staged code");
    }), /Clippy rejected/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["cargo", ["clippy", "--locked", "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings"]]);
  } finally {
    removeSnapshot(cache, tmpdir());
  }
});
