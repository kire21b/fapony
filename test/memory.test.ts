import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/db/index.js";
import { claimMemory, closeMemory, DEFAULT_MEMORY, resolveMemoryConfig } from "../src/memory.js";

const BASE_CONFIG: Config = {
  worktrees: { test: "/tmp/test" },
  executor: { cmd: ["opencode", "run"], timeoutMin: 45 },
  review: {
    bigDiff: { files: 15, lines: 400 },
    maxRounds: 2,
    gate: ["claude", "-p", "/code-review high"],
    prefilter: null,
  },
  memory: null,
};

export function testMemoryDefaultWiringWithFile(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "mem.ts"), "// stub");

    const result = resolveMemoryConfig(BASE_CONFIG, dir);
    assert.deepEqual(result, DEFAULT_MEMORY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ memory default-wiring with .fapony/.memory/mem.ts");
}

export function testMemoryDefaultWiringNoFile(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-"));
  try {
    const result = resolveMemoryConfig(BASE_CONFIG, dir);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ memory default-wiring without .fapony/.memory/mem.ts");
}

export function testMemoryExplicitConfigWins(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-mem-"));
  try {
    const memDir = join(dir, ".fapony", ".memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "mem.ts"), "// stub");

    const explicitConfig: Config = {
      ...BASE_CONFIG,
      memory: {
        claim: ["custom", "claim", "{id}"],
        close: ["custom", "close", "{id}", "{msg}"],
        add: ["custom", "add", "{kind}", "{text}"],
      },
    };

    const result = resolveMemoryConfig(explicitConfig, dir);
    assert.deepEqual(result, explicitConfig.memory);
    assert.notDeepEqual(result, DEFAULT_MEMORY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ memory explicit config wins over default");
}

export function testClaimMemoryFailGracefully(): void {
  // Config with a claim command that always fails ("false" exits 1)
  const failingConfig: Config = {
    ...BASE_CONFIG,
    memory: {
      claim: ["false"],
      close: ["true"],
      add: ["true"],
    },
  };

  const result = claimMemory(failingConfig, "/tmp", "test-id");
  assert.equal(result, false, "should return false when shell command fails");

  // No memory config → returns false
  const noMemResult = claimMemory(BASE_CONFIG, "/tmp", "test-id");
  assert.equal(noMemResult, false, "should return false when memory is null");

  console.log("  ✓ claimMemory fails gracefully");
}

// Regression: execSync must have timeout so hanging scripts don't block the process.
// "sleep 999" should complete in ~15s (timeout), not 999s (the sleep duration).
export function testClaimMemoryTimeout(): void {
  const hangingConfig: Config = {
    ...BASE_CONFIG,
    memory: {
      claim: ["sleep", "999"],
      close: ["true"],
      add: ["true"],
    },
  };

  const start = Date.now();
  const result = claimMemory(hangingConfig, "/tmp", "test-id");
  const elapsed = Date.now() - start;

  assert.equal(result, false, "should return false for hanging command");
  // Should complete in ~15s (timeout), not 999s (the sleep)
  if (elapsed > 20_000) {
    throw new Error(`timeout test took too long: ${elapsed}ms — execSync may be hanging`);
  }

  console.log("  ✓ claimMemory timeout prevents hang");
}
