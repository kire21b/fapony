import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert";
import { initProject } from "../src/init.js";

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-init-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function testInitCreatesDirectories(): void {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");
    initProject(target);

    assert(existsSync(join(target, ".fapony", "README")), ".fapony/README");
    assert(existsSync(join(target, "plan")), "plan/");
    assert(existsSync(join(target, "spec")), "spec/");
    assert(existsSync(join(target, ".memory", "mem.ts")), ".memory/mem.ts");
  });

  console.log("  ✓ init creates directories");
}

export function testInitIdempotent(): void {
  withTmpDir((tmp) => {
    const target = join(tmp, "project");
    initProject(target);

    // Second run should throw
    assert.throws(() => initProject(target), /already exists/);
  });

  console.log("  ✓ init idempotent (re-run errors)");
}

export function testInitNoArgs(): void {
  // cmdInit handles the no-args case; test the function behavior
  // initProject requires a path, so empty string would fail at mkdirSync
  assert.throws(() => initProject(""), /ENOENT|enoent/i);
  console.log("  ✓ init no path errors");
}
