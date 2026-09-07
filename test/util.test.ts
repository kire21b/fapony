import assert from "node:assert";
import { isAffirmative } from "../src/util.js";

export function testIsAffirmative(): void {
  assert.equal(isAffirmative("y"), true);
  assert.equal(isAffirmative("yes"), true);
  assert.equal(isAffirmative("Y"), true);
  assert.equal(isAffirmative("YES"), true);
  assert.equal(isAffirmative("  yes  "), true);
  assert.equal(isAffirmative("n"), false);
  assert.equal(isAffirmative("no"), false);
  assert.equal(isAffirmative(""), false);
  assert.equal(isAffirmative("yeah"), false);
  assert.equal(isAffirmative("yep"), false);
  console.log("  ✓ isAffirmative");
}
