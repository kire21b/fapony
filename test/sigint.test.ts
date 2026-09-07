import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRun, openDb } from "../src/db/index.js";

// Integration test for the SIGINT handler's REAL contract (src/sigint.ts):
// Ctrl-C -> log "interrupted" event + mark run stopped + exit 130.
// Runs in a child process (the handler calls process.exit) with an isolated
// FAPONY_STATE_DIR (db.test.ts:20 lesson: HOME is cached, never use it).

const CHILD_SRC = `
const DB = ${JSON.stringify(new URL("../src/db/index.js", import.meta.url).href)};
const SIG = ${JSON.stringify(new URL("../src/sigint.js", import.meta.url).href)};
const dbmod = await import(DB);
const sigmod = await import(SIG);

const db = dbmod.openDb();
const runId = dbmod.newRun(db, "sigint-test-wt", null, null, "deadbeef");
if (process.argv[2] === "passed") dbmod.setStatus(db, runId, "passed");
db.close(); // handler reopens its own connection — exercise that path

sigmod.installSigintHandler();
sigmod.setSigintRunId(runId);
console.log("READY " + runId);
setTimeout(() => process.exit(99), 15_000); // failsafe if SIGINT is never handled
`;

async function spawnSigintChild(
  stateDir: string,
  mode: "running" | "passed",
): Promise<{ exitCode: number | null; runId: number }> {
  const dir = mkdtempSync(join(tmpdir(), "fapony-sigint-test-"));
  const script = join(dir, "child.ts");
  writeFileSync(script, CHILD_SRC);
  try {
    const proc = Bun.spawn(["bun", script, mode], {
      env: { ...process.env, FAPONY_STATE_DIR: stateDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let out = "";
    while (!out.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
    assert.ok(out.includes("READY"), "child must reach READY");
    const runId = parseInt(out.match(/READY (\d+)/)![1], 10);
    proc.kill("SIGINT");
    const exitCode = await proc.exited;
    return { exitCode, runId };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function testSigintMarksStoppedAndLogs(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "fapony-sigint-state-"));
  const orig = process.env.FAPONY_STATE_DIR;
  try {
    const { exitCode, runId } = await spawnSigintChild(dir, "running");
    assert.equal(exitCode, 130, `SIGINT must exit 130, got ${exitCode}`);

    process.env.FAPONY_STATE_DIR = dir;
    const db = openDb();
    try {
      const run = getRun(db, runId);
      assert.equal(run?.status, "stopped", "run must be marked stopped");
      const events = db
        .prepare("SELECT kind, data FROM events WHERE run_id = ?")
        .all(runId) as { kind: string; data: string }[];
      const interrupted = events.filter((e) => e.kind === "interrupted");
      assert.equal(interrupted.length, 1, "exactly one interrupted event");
      assert.deepEqual(
        JSON.parse(interrupted[0].data),
        { during: "spawn" },
        "interrupted event records the phase",
      );
    } finally {
      db.close();
    }
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ sigint: interrupted logged + run stopped + exit 130");
}

export async function testSigintSkipsTerminalRuns(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "fapony-sigint-state-"));
  const orig = process.env.FAPONY_STATE_DIR;
  try {
    const { exitCode, runId } = await spawnSigintChild(dir, "passed");
    assert.equal(exitCode, 130);

    process.env.FAPONY_STATE_DIR = dir;
    const db = openDb();
    try {
      const run = getRun(db, runId);
      assert.equal(run?.status, "passed", "passed run must stay passed");
      const n = db
        .prepare("SELECT COUNT(*) AS c FROM events WHERE run_id = ?")
        .get(runId) as { c: number };
      assert.equal(n.c, 0, "no interrupted event for terminal runs");
    } finally {
      db.close();
    }
  } finally {
    if (orig === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = orig;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("  ✓ sigint: passed run untouched, still exits 130");
}
