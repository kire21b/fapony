import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export interface TestRepo {
  dir: string;
  cleanup: () => void;
}

/**
 * Creates a temp git repo with an initial commit.
 * The repo is ready for fapony to run against.
 * Call cleanup() when done to remove the temp dir.
 */
export function createTestRepo(): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), "fapony-repo-"));

  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });

  writeFileSync(join(dir, "README.md"), "# test repo\n");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });

  return {
    dir,
    cleanup: () => {
      execSync(`rm -rf "${dir}"`, { stdio: "ignore" });
    },
  };
}
