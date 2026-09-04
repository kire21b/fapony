import { execSync } from "node:child_process";

export interface GitFacts {
  files: number;
  lines: number;
  commits: string[];
  branch: string;
}

export interface ParsedHandoff {
  claimed?: string;
  commits?: string[];
  checks?: string;
  uncertain?: string[];
  not_done?: string[];
  missing: boolean;
}

const HANDOFF_START = "## HANDOFF";

export function gitFacts(worktree: string, baseSha: string): GitFacts {
  let files = 0;
  let lines = 0;
  let commits: string[] = [];
  let branch = "";

  try {
    const stat = execSync(
      `git diff --stat ${baseSha}..HEAD -- .`,
      { cwd: worktree, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const match = stat.match(/(\d+) files? changed/);
    files = match ? parseInt(match[1], 10) : 0;
    const ins = stat.match(/(\d+) insertions?\(\+\)/);
    const del = stat.match(/(\d+) deletions?\(-\)/);
    lines = (ins ? parseInt(ins[1], 10) : 0) + (del ? parseInt(del[1], 10) : 0);
  } catch {}

  try {
    const log = execSync(
      `git log --oneline ${baseSha}..HEAD`,
      { cwd: worktree, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    commits = log
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ")[0]);
  } catch {}

  try {
    branch = execSync("git branch --show-current", {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {}

  return { files, lines, commits, branch };
}

export function parseHandoff(stdout: string): ParsedHandoff {
  const idx = stdout.indexOf(HANDOFF_START);
  if (idx === -1) return { missing: true };

  const block = stdout.slice(idx);
  const lines = block.split("\n");
  const result: ParsedHandoff = { missing: false };

  for (const line of lines) {
    if (line.startsWith("claimed:")) {
      result.claimed = line.slice("claimed:".length).trim();
    } else if (line.startsWith("commits:")) {
      const val = line.slice("commits:".length).trim();
      result.commits = val && val !== "none"
        ? val.split(/\s+/).filter(Boolean)
        : [];
    } else if (line.startsWith("checks:")) {
      result.checks = line.slice("checks:".length).trim();
    } else if (line.startsWith("uncertain:")) {
      const val = line.slice("uncertain:".length).trim();
      result.uncertain = val && val !== "none" ? [val] : [];
    } else if (line.startsWith("not_done:")) {
      const val = line.slice("not_done:".length).trim();
      result.not_done = val && val !== "none" ? [val] : [];
    }
  }

  return result;
}

export function renderHandoff(facts: GitFacts, parsed: ParsedHandoff): string {
  const lines: string[] = [];
  lines.push("## HANDOFF SUMMARY");

  if (parsed.missing) {
    lines.push("(no ## HANDOFF block in output — using git-only data)");
  }

  lines.push("");
  lines.push("--- git facts ---");
  lines.push(`branch: ${facts.branch}`);
  lines.push(`files changed: ${facts.files}`);
  lines.push(`lines changed: ${facts.lines}`);
  lines.push(
    `commits: ${facts.commits.length ? facts.commits.join(", ") : "(none)"}`
  );

  if (!parsed.missing) {
    lines.push("");
    lines.push("--- executor report ---");
    if (parsed.claimed) lines.push(`claimed: ${parsed.claimed}`);
    if (parsed.checks) lines.push(`checks: ${parsed.checks}`);
    if (parsed.uncertain?.length) {
      lines.push(`uncertain: ${parsed.uncertain.join("; ")}`);
    }
    if (parsed.not_done?.length) {
      lines.push(`not_done: ${parsed.not_done.join("; ")}`);
    }
  }

  return lines.join("\n");
}
