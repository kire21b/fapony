// test/mcp/helpers.ts — shared test helpers for MCP tests

import { createTestRepo } from "../fixtures/repo.js";

export function withTempRepo(fn: (dir: string) => void): void {
  const repo = createTestRepo();
  try {
    fn(repo.dir);
  } finally {
    repo.cleanup();
  }
}
