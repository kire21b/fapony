import assert from "node:assert";
import {
  addEvent,
  type Config,
  loadConfig,
  newRun,
  openDb,
  setStatus,
} from "../src/db/index.js";
import { renderReportHtml } from "../src/report/index.js";
import { getStatsData } from "../src/stats/index.js";

function _baseConfig(): Config {
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
  const run = newRun(db, "/Users/test/project", null, null, "abc");
  addEvent(db, run, "spawn", { role: "executor", model: "m" });
  addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 1 });
  addEvent(db, run, "spawn", { role: "executor", model: "m" });
  addEvent(db, run, "gate", { verdict: "pass-good", note: "", round: 2 });
  setStatus(db, run, "passed");
}

export function testReportHtmlCanonicalQuality(): void {
  // pass-good = 4 via the shared helper — never a local score map.
  withTestDb((db) => {
    seedTwoRounds(db);
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
    assert.ok(html.includes("4.0"), "canonical quality rendered");
  });

  console.log("  ✓ report-html uses canonical quality scores");
}

export function testReportHtmlFiltersAndMethodology(): void {
  withTestDb((_db) => {
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
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

export function testReportHtmlByModelHasAttributionColumns(): void {
  // Spawn-based windows carry no client/provider/agent → "—", never blank.
  withTestDb((db) => {
    seedTwoRounds(db);
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
    for (const h of [
      "<th>Client</th>",
      "<th>Provider</th>",
      "<th>Agent</th>",
    ]) {
      assert.ok(html.includes(h), `By Model table has ${h}`);
    }
    assert.ok(html.includes("<td>—</td>"), "unknown dims render as —");
  });

  console.log("  ✓ report-html By Model shows client/provider/agent");
}

export function testReportHtmlEscapesContent(): void {
  // Worktree basenames are interpolated into HTML — must not break markup.
  withTestDb((db) => {
    newRun(db, "/x/<b>pwn", null, null, "abc");
    const html = renderReportHtml(getStatsData(), new Date().toISOString());
    assert.ok(!html.includes("<b>pwn"), "raw worktree markup must not appear");
    assert.ok(html.includes("&lt;b&gt;pwn"), "worktree markup escaped");
  });

  console.log("  ✓ report-html escapes interpolated strings");
}
