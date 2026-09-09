// test/telemetry/self-reported.test.ts — telemetry self-reported metadata

import assert from "node:assert";
import { buildPayload } from "../../src/telemetry.js";
import { withTempConfig, withTmpDb } from "./helpers.js";

export function testTelemetrySelfReportedFromConfig(): void {
  // Self-reported metadata comes from config.telemetry.metadata
  // We test the shape here; actual config wiring is in config.test
  const payload = buildPayload();
  // No metadata configured → self_reported should be absent or empty
  if (payload.self_reported) {
    const keys = Object.keys(payload.self_reported);
    assert.ok(
      keys.every((k) => ["task_category", "stack", "notes"].includes(k)),
      "only known self-reported fields",
    );
  }

  console.log("  ✓ telemetry self-reported metadata shape");
}

export function testTelemetrySelfReportedRoundTrip(): void {
  // Metadata set in fapony.config.json must arrive verbatim in the payload.
  withTmpDb((_db) => {
    withTempConfig(
      {
        telemetry: {
          metadata: { task_category: "bugfix", stack: "bun" },
        },
      },
      () => {
        const payload = buildPayload();
        assert.deepEqual(payload.self_reported, {
          task_category: "bugfix",
          stack: "bun",
        });
      },
    );
  });

  console.log("  ✓ telemetry self-reported metadata round-trips from config");
}
