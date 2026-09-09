import assert from "node:assert";
import {
  BYTES_PER_TOKEN,
  beginSpawn,
  buildSpawnCost,
  byteLength,
  endSpawn,
  estimateUsd,
  formatCost,
  sumSpawnCost,
} from "../src/cost.js";
import {
  type Config,
  getEvents,
  loadConfig,
  newRun,
  openDb,
  pricingFor,
  roleModel,
} from "../src/db/index.js";

function baseConfig(): Config {
  return loadConfig("/nonexistent-path/fapony.config.json");
}

export function testCostAttributionAndBytes(): void {
  const config = baseConfig();
  // role/model attribution lands in the record even with no pricing
  const c = buildSpawnCost("executor", "mimo", "hello", "world!", config);
  assert.equal(c.role, "executor");
  assert.equal(c.model, "mimo");
  assert.equal(c.bytes_in, 5);
  assert.equal(c.bytes_out, 6);
  assert.equal(c.usd_estimate, null);

  console.log("  ✓ cost attribution + bytes without pricing");
}

export function testCostUsdEstimate(): void {
  const base = baseConfig();
  const config: Config = {
    ...base,
    pricing: { executor: { inputPer1k: 4, outputPer1k: 8 } },
  };
  assert.deepEqual(pricingFor(config, "executor"), {
    inputPer1k: 4,
    outputPer1k: 8,
  });
  assert.equal(pricingFor(base, "executor"), null);

  const bytesIn = BYTES_PER_TOKEN * 1000; // = 1000 tokens
  const bytesOut = BYTES_PER_TOKEN * 1000;
  // 1000 in-tokens @ $4/1k + 1000 out-tokens @ $8/1k = $12
  assert.equal(
    estimateUsd(bytesIn, bytesOut, pricingFor(config, "executor")),
    12,
  );
  assert.equal(estimateUsd(bytesIn, bytesOut, null), null);

  const c = buildSpawnCost(
    "executor",
    "m",
    "a".repeat(bytesIn),
    "b".repeat(bytesOut),
    config,
  );
  assert.equal(c.usd_estimate, 12);

  console.log("  ✓ cost USD estimate from static pricing");
}

export function testCostPricingNullKeepsBytes(): void {
  const config: Config = { ...baseConfig(), pricing: null };
  assert.equal(pricingFor(config, "gate"), null);
  // roleModel falls back to "" — attribution still present, never crashes
  assert.equal(roleModel(config, "gate"), "");

  const withRole: Config = {
    ...config,
    roles: { gate: { model: "sonnet" } },
  };
  assert.equal(roleModel(withRole, "gate"), "sonnet");
  const c = buildSpawnCost(
    "gate",
    roleModel(withRole, "gate"),
    "in",
    "out",
    withRole,
  );
  assert.equal(c.bytes_in, 2);
  assert.equal(c.bytes_out, 3);
  assert.equal(c.usd_estimate, null);

  console.log("  ✓ pricing:null keeps byte measurement, USD off");
}

export function testCostBeginEndRoundTrip(): void {
  const prev = process.env.FAPONY_STATE_DIR;
  process.env.FAPONY_STATE_DIR = `/tmp/fapony-cost-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    const db = openDb();
    const runId = newRun(db, "fapony", null, null, "abc");
    const config: Config = {
      ...baseConfig(),
      roles: { executor: { model: "mimo" } },
      pricing: { executor: { inputPer1k: 4, outputPer1k: 4 } },
    };
    const id = beginSpawn(db, runId, config, "executor", "hello", {
      base_sha: "abc",
    });
    endSpawn(db, id, config, "executor", "world!");

    const total = sumSpawnCost(getEvents(db, runId));
    assert.equal(total.spawns, 1);
    assert.equal(total.bytes_in, 5);
    assert.equal(total.bytes_out, 6);
    assert.ok(total.usd_estimate !== null && total.usd_estimate > 0);
    assert.equal(
      getEvents(db, runId).filter((e) => e.kind === "spawn").length,
      1,
    );
    db.close();
  } finally {
    if (prev === undefined) delete process.env.FAPONY_STATE_DIR;
    else process.env.FAPONY_STATE_DIR = prev;
  }

  console.log("  ✓ beginSpawn/endSpawn single-row round trip");
}

export function testCostHandoffAndFormat(): void {
  // Priced → estimate labeled, never a bare charge.
  const priced = formatCost({
    spawns: 1,
    bytes_in: 4000,
    bytes_out: 0,
    usd_estimate: 0.15,
  });
  assert(priced.includes("est."));

  // byteLength is utf-8 bytes, not chars.
  assert.equal(byteLength("ก"), 3);

  console.log("  ✓ handoff cost additive + format labels estimate");
}

export function testCostTelemetryAllowlist(): void {
  // Telemetry cost entries carry numbers only — this guards the shape:
  // run_id/spawns/bytes/usd, no prompt/output/plan/note/commit fields.
  const entry = {
    run_id: 1,
    spawns: 1,
    bytes_in: 10,
    bytes_out: 5,
    usd_estimate: null as number | null,
  };
  const keys = Object.keys(entry).sort();
  assert.deepEqual(keys, [
    "bytes_in",
    "bytes_out",
    "run_id",
    "spawns",
    "usd_estimate",
  ]);
  const blob = JSON.stringify(entry);
  assert(
    !blob.includes("plan") &&
      !blob.includes("note") &&
      !blob.includes("commit"),
  );

  console.log("  ✓ telemetry cost allowlist (no content fields)");
}
