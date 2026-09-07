import { execSync } from "node:child_process";
import { formatCost, type RunCost, sumSpawnCost } from "./cost.js";
import { getEvents, getRun, handoffMarker, openDb } from "./db/index.js";

export interface GitFacts {
  files: number;
  lines: number;
  commits: string[];
  branch: string;
  gitError?: string;
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
  let gitError: string | undefined;

  try {
    const stat = execSync(`git diff --stat ${baseSha}..HEAD -- .`, {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    const match = stat.match(/(\d+) files? changed/);
    files = match ? parseInt(match[1], 10) : 0;
    const ins = stat.match(/(\d+) insertions?\(\+\)/);
    const del = stat.match(/(\d+) deletions?\(-\)/);
    lines = (ins ? parseInt(ins[1], 10) : 0) + (del ? parseInt(del[1], 10) : 0);
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && ("stderr" in e || "message" in e)
        ? String(
            (e as { stderr?: string; message?: string }).stderr ??
              (e as { message?: string }).message ??
              "unknown",
          )
        : "unknown";
    gitError = `git diff failed: ${msg.trim()}`;
  }

  try {
    const log = execSync(`git log --oneline ${baseSha}..HEAD`, {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    commits = log
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ")[0]);
  } catch {
    if (!gitError) {
      // git log failure is non-fatal (e.g. detached HEAD), but diff failure above
      // is more concerning — only set gitError if not already set.
    }
  }

  try {
    branch = execSync("git branch --show-current", {
      cwd: worktree,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
  } catch {}

  return { files, lines, commits, branch, ...(gitError ? { gitError } : {}) };
}

export function parseHandoff(stdout: string, marker?: string): ParsedHandoff {
  const start = marker ?? HANDOFF_START;
  const idx = stdout.indexOf(start);
  if (idx === -1) return { missing: true };

  const block = stdout.slice(idx);
  const lines = block.split("\n");
  const result: ParsedHandoff = { missing: false };

  const FIELDS = ["claimed:", "commits:", "checks:", "uncertain:", "not_done:"];
  let currentField: keyof ParsedHandoff | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      currentField = null;
      continue;
    }

    const fieldMatch = FIELDS.find((f) => trimmed.startsWith(f));
    if (fieldMatch) {
      currentField = fieldMatch.slice(0, -1) as keyof ParsedHandoff;
      const val = trimmed.slice(fieldMatch.length).trim();
      if (currentField === "claimed") {
        result.claimed = val || undefined;
      } else if (currentField === "checks") {
        result.checks = val || undefined;
      } else if (currentField === "commits") {
        result.commits =
          val && val !== "none" ? val.split(/\s+/).filter(Boolean) : [];
      } else if (currentField === "uncertain") {
        result.uncertain = val && val !== "none" ? [val] : [];
      } else if (currentField === "not_done") {
        result.not_done = val && val !== "none" ? [val] : [];
      }
    } else if (currentField === "uncertain" || currentField === "not_done") {
      const arr = result[currentField] as string[] | undefined;
      if (arr) arr.push(trimmed);
    }
  }

  return result;
}

export function renderHandoff(
  facts: GitFacts,
  parsed: ParsedHandoff,
  marker?: string,
  cost?: RunCost,
): string {
  const lines: string[] = [];
  lines.push("## HANDOFF SUMMARY");

  if (parsed.missing) {
    lines.push(
      `(no ${marker ?? HANDOFF_START} block in output — using git-only data)`,
    );
  }

  lines.push("");
  lines.push("--- git facts ---");
  if (facts.gitError) {
    lines.push(`⚠ ${facts.gitError}`);
  }
  lines.push(`branch: ${facts.branch}`);
  lines.push(`files changed: ${facts.files}`);
  lines.push(`lines changed: ${facts.lines}`);
  lines.push(
    `commits: ${facts.commits.length ? facts.commits.join(", ") : "(none)"}`,
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

  // Additive: only when spawn events carry byte fields. USD is an estimate
  // from static pricing over byte proxy — never a real charge.
  if (cost && cost.spawns > 0) {
    lines.push("");
    lines.push("--- cost (bytes proxy, USD est. only) ---");
    lines.push(`cost: ${formatCost(cost)}`);
  }

  return lines.join("\n");
}

export function cmdHandoff(args: string[]): void {
  const runId = parseInt(args[0], 10);
  if (!runId || Number.isNaN(runId)) {
    console.error("usage: fapony handoff <run-id>");
    process.exit(1);
  }

  const db = openDb();
  const run = getRun(db, runId);
  if (!run) {
    console.error(`run ${runId} not found`);
    process.exit(1);
  }

  const facts = gitFacts(run.worktree, run.base_sha);

  // Prefer the executor report captured at run time; fall back to git-only
  // for runs started before handoff events existed.
  let parsed: ParsedHandoff = { missing: true };
  const events = getEvents(db, runId);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind !== "handoff") continue;
    try {
      parsed = JSON.parse(events[i].data ?? "") as ParsedHandoff;
    } catch {
      parsed = { missing: true };
    }
    break;
  }

  console.log(
    renderHandoff(facts, parsed, handoffMarker(), sumSpawnCost(events)),
  );
}
