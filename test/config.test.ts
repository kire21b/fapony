import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Config,
  DEFAULT_SPEC_MAX_LINES,
  dirtyPreviewLines,
  doneDirName,
  fileDoneMarker,
  handoffMarker,
  inboundWarnAt,
  linkScanDirs,
  loadConfig,
  memoryEntry,
  nextPromptMarker,
  planDir,
  planExtensions,
  promptFileFor,
  roleTimeoutMin,
  safetyDeny,
  shippedRE,
  shortShaLen,
  sourceSpecRE,
  specMaxLines,
  verdictRE,
} from "../src/db/index.js";
import { parseHandoff } from "../src/handoff.js";
import { renderRolePrompt } from "../src/loop/index.js";
import { parseGateVerdict, parsePlanUpdate } from "../src/parse.js";
import { assertSafe } from "../src/safety.js";
import { fillPrompt, templateArgs } from "../src/util.js";

function baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

export function testConfigDefaults(): void {
  const config = baseConfig();
  assert.equal(specMaxLines(config), DEFAULT_SPEC_MAX_LINES);
  assert.equal(handoffMarker(config), "## HANDOFF");
  assert.equal(nextPromptMarker(config), "## NEXT-PROMPT");
  assert.equal(fileDoneMarker(config), "## FILE_DONE");
  assert.equal(planDir(config), ".fapony/plan");
  assert.equal(memoryEntry(config), ".fapony/.memory/mem.ts");
  assert.equal(doneDirName(config), "done");
  assert.deepEqual(linkScanDirs(config), [
    ".fapony/plan/",
    ".fapony/spec/",
    "docs/",
  ]);
  assert.deepEqual(planExtensions(config), [".md"]);
  assert.equal(inboundWarnAt(config), 5);
  assert.equal(dirtyPreviewLines(config), 10);
  assert.equal(shortShaLen(config), 8);
  assert.equal(safetyDeny(config).length, 4);
  assert(
    promptFileFor(config, "gate") === null,
    "unset prompt → null (inline fallback)",
  );

  // per-role builtin timeout fallbacks preserved
  const noRoles: Config = { ...config, roles: {} };
  assert.equal(roleTimeoutMin(noRoles, "gate"), 10);
  assert.equal(roleTimeoutMin(noRoles, "planner"), 10);
  assert.equal(roleTimeoutMin(noRoles, "bigFixer"), 20);
  assert.equal(roleTimeoutMin(noRoles, "scrutinizeFix"), 15);

  console.log("  ✓ config defaults = old hardcodes");
}

export function testConfigFileOverrides(): void {
  const dir = mkdtempSync(join(tmpdir(), "fapony-cfg-"));
  try {
    const file = join(dir, "fapony.config.json");
    writeFileSync(
      file,
      JSON.stringify({
        spec: { maxLines: 50 },
        markers: {
          handoff: "## DONE",
          nextPrompt: "## NEXT",
          fileDone: "## DONE-FILE",
        },
        paths: { planDir: "plans", doneDir: "archived" },
        plan: { extensions: [".md", ".txt"] },
        display: { dirtyPreview: 3, shortSha: 7 },
        safety: { deny: ["custom-bad-cmd"] },
        defaults: { timeoutMin: 99 },
      }),
    );
    const config = loadConfig(file);
    assert.equal(specMaxLines(config), 50);
    assert.equal(handoffMarker(config), "## DONE");
    assert.equal(nextPromptMarker(config), "## NEXT");
    assert.equal(planDir(config), "plans");
    assert.equal(doneDirName(config), "archived");
    assert.deepEqual(planExtensions(config), [".md", ".txt"]);
    assert.equal(dirtyPreviewLines(config), 3);
    assert.equal(shortShaLen(config), 7);
    assert.deepEqual(safetyDeny(config), ["custom-bad-cmd"]);
    // defaults.timeoutMin applies to roles without explicit timeout
    assert.equal(roleTimeoutMin({ ...config, roles: {} }, "gate"), 99);
    // explicit role timeout still wins
    assert.equal(
      roleTimeoutMin(
        { ...config, roles: { gate: { cmd: ["x"], timeoutMin: 5 } } },
        "gate",
      ),
      5,
    );
    // unspecified sections keep defaults
    assert.equal(memoryEntry(config), ".fapony/.memory/mem.ts");
    assert.equal(fileDoneMarker(config), "## DONE-FILE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ config file overrides");
}

export function testCustomMarkersParse(): void {
  const config = baseConfig();
  config.markers = {
    handoff: "## DONE",
    verdict: "^RESULT:\\s*(pass|fail)\\s*$",
    nextPrompt: "## NEXT",
    fileDone: "## FINISHED",
  };

  const h = parseHandoff(
    "## DONE\nclaimed: x\ncommits: none\nchecks: ok\nuncertain: none\nnot_done: none",
    handoffMarker(config),
  );
  assert.equal(h.missing, false);
  assert.equal(h.claimed, "x");

  const g = parseGateVerdict("RESULT: fail\nbroken", config);
  assert(g !== null && g.verdict === "fail", "custom verdict re should parse");

  const p = parsePlanUpdate("## NEXT\nDo next thing", config);
  assert(
    p !== null && p.kind === "next_prompt",
    "custom next marker should parse",
  );

  const d = parsePlanUpdate("## FINISHED\nAll good", config);
  assert(
    d !== null && d.kind === "file_done",
    "custom done marker should parse",
  );

  // default markers must NOT match the custom text
  assert.equal(parseGateVerdict("RESULT: fail\nbroken"), null);

  console.log("  ✓ custom markers parse");
}

export function testCustomSafetyDeny(): void {
  // custom list replaces the default: default-dangerous now allowed…
  assertSafe(["git", "reset", "--hard"], ["my-own-ban"]);
  // …and the custom pattern blocks
  assert.throws(
    () => assertSafe(["run", "my-own-ban", "x"], ["my-own-ban"]),
    /dangerous/,
  );
  // default still blocks without override
  assert.throws(() => assertSafe(["git", "reset", "--hard"]), /dangerous/);
  // invalid regex source surfaces loudly (fail-fast, not silent allow)
  assert.throws(() => assertSafe(["anything"], ["([invalid"]), /./);

  console.log("  ✓ custom safety deny");
}

export function testTemplateArgsReplaceAll(): void {
  const out = templateArgs(["claude", "-p", "{model}", "{PROMPT}", "{model}"], {
    model: "opus",
    PROMPT: "hi",
  });
  assert.deepEqual(out, ["claude", "-p", "opus", "hi", "opus"]);

  const filled = fillPrompt("run {{RUN_ID}} in {{WORKTREE}} ({{RUN_ID}})", {
    RUN_ID: "7",
    WORKTREE: "wt",
  });
  assert.equal(filled, "run 7 in wt (7)");

  // $ sequences in values must be literal, not replace() special patterns
  const tricky = templateArgs(["echo", "{MSG}"], { MSG: "$& $' $` $$" });
  assert.equal(tricky[1], "$& $' $` $$");
  const trickyFilled = fillPrompt("PLAN:\n{{PLAN}}", {
    PLAN: "costs $100 and $& more",
  });
  assert.equal(trickyFilled, "PLAN:\ncosts $100 and $& more");

  console.log("  ✓ templateArgs replaceAll + fillPrompt");
}

export function testRenderRolePrompt(): void {
  const config = baseConfig();
  const fallback = "builtin fallback";
  // no prompt file → fallback verbatim
  assert.equal(
    renderRolePrompt(config, "gate", fallback, { RUN_ID: "1" }),
    fallback,
  );

  // prompt file with vars → filled
  const dir = mkdtempSync(join(tmpdir(), "fapony-prompt-"));
  try {
    const file = join(dir, "gate.md");
    writeFileSync(file, "Review {{RUN_ID}} in {{WORKTREE}} ({{RUN_ID}})");
    const withFile: Config = { ...config, prompts: { gate: file } };
    assert.equal(
      renderRolePrompt(withFile, "gate", fallback, {
        RUN_ID: "9",
        WORKTREE: "wt",
      }),
      "Review 9 in wt (9)",
    );

    // unreadable file → fallback, never throws
    const missing: Config = {
      ...config,
      prompts: { gate: join(dir, "nope.md") },
    };
    assert.equal(renderRolePrompt(missing, "gate", fallback, {}), fallback);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("  ✓ renderRolePrompt file + fallback");
}

export function testSourceAndShippedRE(): void {
  const config = baseConfig();
  assert("/x".match(sourceSpecRE(config)) === null, "sanity");
  const plan = "> **Source spec:** [s](spec/a.md)";
  assert(
    plan.match(sourceSpecRE(config)) !== null,
    "default source marker matches",
  );

  const custom: Config = {
    ...config,
    spec: { sourceMarker: "^SPEC:\\s*(.+)$" },
  };
  assert("SPEC: docs/b.md".match(sourceSpecRE(custom)) !== null);
  assert(plan.match(sourceSpecRE(custom)) === null);

  assert(
    shippedRE(config).test("> ✅ **shipped** (abc)"),
    "default shipped matches",
  );
  const customShip: Config = { ...config, markers: { shipped: "^DONE" } };
  assert(shippedRE(customShip).test("DONE stuff"));
  assert(!shippedRE(customShip).test("> ✅ **shipped** (abc)"));

  // verdictRE default still available
  assert("VERDICT: pass".match(verdictRE(config)) !== null);

  console.log("  ✓ source + shipped regex overrides");
}
