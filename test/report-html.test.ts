import assert from "node:assert";
import { beginSpawn, endSpawn } from "../src/cost.js";
import {
  addEvent,
  type Config,
  loadConfig,
  newRun,
  openDb,
  setStatus,
} from "../src/db/index.js";
import { collectReportData, renderReportHtml } from "../src/report-html.js";

function baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

function withTestDb(fn: (db: ReturnType<typeof openDb>) => void): void {
  const prev = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = `/tmp/fapony-report-html-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    const db = openDb();
    fn(db);
    db.close();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
  }
}

function seedTwoRounds(db: ReturnType<typeof openDb>): void {
  const config: Config = {
    ...baseConfig(),
    roles: { executor: { model: "m" } },
    pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
  };
  const run = newRun(db, "/Users/test/project", null, null, "abc");
  const s1 = beginSpawn(db, run, config, "executor", "a".repeat(4000));
  endSpawn(db, s1, config, "executor", "b".repeat(4000));
  addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 1 });
  const s2 = beginSpawn(db, run, config, "executor", "a".repeat(4000));
  endSpawn(db, s2, config, "executor", "b".repeat(4000));
  addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 2 });
  setStatus(db, run, "passed");
}

export function testReportHtmlTotalCostCountsEachSpawnOnce(): void {
  // Two $8 rounds → total $16, not the per-gate window sum 8+(8+8) = $24.
  withTestDb((db) => {
    seedTwoRounds(db);
    const data = collectReportData();
    assert.equal(data.total_cost_usd, 16);
    const html = renderReportHtml(data);
    assert.ok(
      html.includes("~$16.0000 est."),
      "total cost rendered once per spawn",
    );
  });

  console.log("  ✓ report-html total cost counts each spawn once");
}

export function testReportHtmlCanonicalQuality(): void {
  // pass-good = 4 via the shared helper — never a local score map.
  withTestDb((db) => {
    seedTwoRounds(db);
    const html = renderReportHtml(collectReportData());
    assert.ok(html.includes("4.0"), "canonical quality rendered");
  });

  console.log("  ✓ report-html uses canonical quality scores");
}

export function testReportHtmlFiltersAndMethodology(): void {
  withTestDb((_db) => {
    const html = renderReportHtml(collectReportData());
    assert.ok(html.includes('id="f-model"'), "model filter present");
    assert.ok(html.includes('id="f-grade"'), "grade filter present");
    assert.ok(html.includes('id="f-worktree"'), "worktree filter present");
    assert.ok(html.includes("<script>"), "filter JS present");
    assert.ok(html.includes("Methodology"), "methodology present");
    assert.ok(
      html.includes("Insufficient data"),
      "insufficient-data banner on empty db",
    );
    assert.ok(html.includes("basename"), "basename note present");
  });

  console.log("  ✓ report-html has filters, methodology, insufficient-data");
}

export function testReportHtmlEscapesContent(): void {
  // Worktree basenames are interpolated into HTML — must not break markup.
  // (Basenames never contain "/" — that is the path separator — so the
  // payload uses an unclosed tag.)
  withTestDb((db) => {
    newRun(db, "/x/<b>pwn", null, null, "abc");
    const html = renderReportHtml(collectReportData());
    assert.ok(!html.includes("<b>pwn"), "raw worktree markup must not appear");
    assert.ok(html.includes("&lt;b&gt;pwn"), "worktree markup escaped");
  });

  console.log("  ✓ report-html escapes interpolated strings");
}
