import assert from "node:assert";
import {
  cmdUpdate,
  formatDirtyBlock,
  isUpToDate,
  parseDirtyLines,
  shouldProceedAfterDirty,
  type UpdateDeps,
} from "../src/update.js";

export function testParseDirtyLines(): void {
  assert.deepStrictEqual(parseDirtyLines(""), []);
  assert.deepStrictEqual(parseDirtyLines(" M src/a.ts"), [" M src/a.ts"]);
  assert.deepStrictEqual(parseDirtyLines(" M a.ts\n?? b.ts\n"), [
    " M a.ts",
    "?? b.ts",
  ]);
  // blank lines never count as dirty
  assert.deepStrictEqual(parseDirtyLines("\n\n"), []);
  console.log("  ✓ parseDirtyLines");
}

export function testFormatDirtyBlock(): void {
  assert.equal(formatDirtyBlock(""), "");
  assert.equal(formatDirtyBlock(" M a.ts\n?? b.ts"), "    M a.ts\n   ?? b.ts");
  console.log("  ✓ formatDirtyBlock");
}

export function testShouldProceedAfterDirty(): void {
  assert.equal(shouldProceedAfterDirty("y"), true);
  assert.equal(shouldProceedAfterDirty("yes"), true);
  assert.equal(shouldProceedAfterDirty("Y"), true);
  assert.equal(shouldProceedAfterDirty("n"), false);
  assert.equal(shouldProceedAfterDirty("no"), false);
  assert.equal(shouldProceedAfterDirty(""), false);
  console.log("  ✓ shouldProceedAfterDirty");
}

export function testIsUpToDate(): void {
  assert.equal(isUpToDate("abc123", "abc123"), true);
  assert.equal(isUpToDate("abc123", "def456"), false);
  assert.equal(isUpToDate("unknown", "unknown"), true);
  console.log("  ✓ isUpToDate");
}

// --- cmdUpdate orchestration (seam-based, no real git/stdin/process) ---

class TestExit extends Error {
  code: number;
  constructor(code: number) {
    super(`exit:${code}`);
    this.code = code;
  }
}

function testExit(code: number): never {
  throw new TestExit(code);
}

/** Map args→result fake git. `shas` feeds the two `rev-parse --short HEAD`
 *  calls (old, new) that share identical args; `log*` matches any log range. */
function mapGit(
  responses: Record<string, string | Error>,
  opts: { shas?: (string | Error)[] } = {},
): { git: (args: string) => string; calls: string[] } {
  const calls: string[] = [];
  let shaCalls = 0;
  const git = (args: string): string => {
    calls.push(args);
    if (args === "rev-parse --short HEAD" && opts.shas) {
      const r = opts.shas[Math.min(shaCalls++, opts.shas.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }
    if (args.startsWith("log ") && "log*" in responses) {
      const r = responses["log*"];
      if (r instanceof Error) throw r;
      return r as string;
    }
    const r = responses[args];
    if (r === undefined) return "";
    if (r instanceof Error) throw r;
    return r;
  };
  return { git, calls };
}

async function captureOutput(fn: () => Promise<void>): Promise<{
  out: string;
  err: string;
}> {
  const origLog = console.log;
  const origErr = console.error;
  let out = "";
  let err = "";
  console.log = (...a: unknown[]): void => {
    out += `${a.join(" ")}\n`;
  };
  console.error = (...a: unknown[]): void => {
    err += `${a.join(" ")}\n`;
  };
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out, err };
}

export async function testCmdUpdateNotARepo(): Promise<void> {
  const { git } = mapGit({ "rev-parse --is-inside-work-tree": "false" });
  let code: number | null = null;
  const { err } = await captureOutput(async () => {
    try {
      await cmdUpdate({ git, exit: testExit });
    } catch (e) {
      code = (e as TestExit).code;
    }
  });
  assert.equal(code, 1);
  assert.ok(err.includes("not a git repo"), `got: ${err}`);
  console.log("  ✓ cmdUpdate not-a-repo exit");
}

export async function testCmdUpdateDirtyDeclined(): Promise<void> {
  const { git, calls } = mapGit({
    "rev-parse --is-inside-work-tree": "true",
    "status --porcelain": " M a.ts",
  });
  let prompted = 0;
  const { out } = await captureOutput(async () => {
    await cmdUpdate({
      git,
      exit: testExit,
      prompt: async () => {
        prompted++;
        return "n";
      },
    });
  });
  assert.equal(prompted, 1);
  assert.ok(out.includes("Update cancelled"), `got: ${out}`);
  assert.ok(!calls.some((c) => c.startsWith("pull")), "pull must not run");
  console.log("  ✓ cmdUpdate dirty declined cancels");
}

export async function testCmdUpdateDirtyPullOk(): Promise<void> {
  const { git } = mapGit(
    {
      "rev-parse --is-inside-work-tree": "true",
      "status --porcelain": " M a.ts",
      "stash push -m 'fapony auto-stash before update'": "",
      "pull --ff-only": "",
      "stash pop": "",
      "log*": "bbb111 feat",
      "diff --name-only HEAD@{1} HEAD -- bun.lock": "",
    },
    { shas: ["aaa111", "bbb111"] },
  );
  let installCalls = 0;
  const { out } = await captureOutput(async () => {
    await cmdUpdate({
      git,
      exit: testExit,
      install: () => {
        installCalls++;
      },
      prompt: async () => "y",
    });
  });
  assert.equal(installCalls, 0);
  assert.ok(out.includes("Restored your stashed changes"), `got: ${out}`);
  assert.ok(out.includes("aaa111") && out.includes("bbb111"), `got: ${out}`);
  console.log("  ✓ cmdUpdate dirty pull-ok restores stash");
}

export async function testCmdUpdatePullFailPopOk(): Promise<void> {
  const { git } = mapGit(
    {
      "rev-parse --is-inside-work-tree": "true",
      "status --porcelain": " M a.ts",
      "stash push -m 'fapony auto-stash before update'": "",
      "pull --ff-only": new Error("non-fast-forward"),
      "stash pop": "",
    },
    { shas: ["aaa111"] },
  );
  let code: number | null = null;
  const { err } = await captureOutput(async () => {
    try {
      await cmdUpdate({ git, exit: testExit, prompt: async () => "y" });
    } catch (e) {
      code = (e as TestExit).code;
    }
  });
  assert.equal(code, 1);
  assert.ok(err.includes("restored"), `got: ${err}`);
  console.log("  ✓ cmdUpdate pull-fail pop-ok restores stash");
}

export async function testCmdUpdatePullFailPopFail(): Promise<void> {
  // Regression guard for c3a45a5 — pop failure must NOT be swallowed.
  const { git } = mapGit(
    {
      "rev-parse --is-inside-work-tree": "true",
      "status --porcelain": " M a.ts",
      "stash push -m 'fapony auto-stash before update'": "",
      "pull --ff-only": new Error("non-fast-forward"),
      "stash pop": new Error("conflict"),
    },
    { shas: ["aaa111"] },
  );
  let code: number | null = null;
  const { err } = await captureOutput(async () => {
    try {
      await cmdUpdate({ git, exit: testExit, prompt: async () => "y" });
    } catch (e) {
      code = (e as TestExit).code;
    }
  });
  assert.equal(code, 1);
  assert.ok(err.includes("still stashed"), `got: ${err}`);
  assert.ok(err.includes("do NOT `git stash drop`"), `got: ${err}`);
  console.log("  ✓ cmdUpdate pull-fail pop-fail warns (regression)");
}

export async function testCmdUpdateAlreadyUpToDate(): Promise<void> {
  const { git } = mapGit(
    {
      "rev-parse --is-inside-work-tree": "true",
      "status --porcelain": "",
      "pull --ff-only": "",
    },
    { shas: ["aaa111", "aaa111"] },
  );
  let prompted = 0;
  const deps: UpdateDeps = {
    git,
    exit: testExit,
    prompt: async () => {
      prompted++;
      return "y";
    },
  };
  const { out } = await captureOutput(async () => {
    await cmdUpdate(deps);
  });
  assert.equal(prompted, 0);
  assert.ok(out.includes("Already up to date"), `got: ${out}`);
  console.log("  ✓ cmdUpdate already up to date");
}

export async function testCmdUpdateLockfileTriggersInstall(): Promise<void> {
  const { git } = mapGit(
    {
      "rev-parse --is-inside-work-tree": "true",
      "status --porcelain": "",
      "pull --ff-only": "",
      "log*": "bbb111 new feature",
      "diff --name-only HEAD@{1} HEAD -- bun.lock": "bun.lock",
    },
    { shas: ["aaa111", "bbb111"] },
  );
  let installCalls = 0;
  const { out } = await captureOutput(async () => {
    await cmdUpdate({
      git,
      exit: testExit,
      install: () => {
        installCalls++;
      },
      prompt: async () => "y",
    });
  });
  assert.equal(installCalls, 1);
  assert.ok(out.includes("Recent changes"), `got: ${out}`);
  assert.ok(out.includes("bbb111 new feature"), `got: ${out}`);
  assert.ok(out.includes("Dependencies updated"), `got: ${out}`);
  console.log("  ✓ cmdUpdate lockfile change runs install");
}

export async function testCmdUpdateInstallFailureWarns(): Promise<void> {
  const { git } = mapGit(
    {
      "rev-parse --is-inside-work-tree": "true",
      "status --porcelain": "",
      "pull --ff-only": "",
      "log*": "",
      "diff --name-only HEAD@{1} HEAD -- bun.lock": "bun.lock",
    },
    { shas: ["aaa111", "bbb111"] },
  );
  const { out } = await captureOutput(async () => {
    await cmdUpdate({
      git,
      exit: testExit,
      install: () => {
        throw new Error("network down");
      },
      prompt: async () => "y",
    });
  });
  assert.ok(out.includes("bun install failed"), `got: ${out}`);
  console.log("  ✓ cmdUpdate install failure warns");
}
