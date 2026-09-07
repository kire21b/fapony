import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { Config } from "./types.js";

// XDG Base Directory convention (macOS ignores Apple's ~/Library/Application Support
// for CLI tools by common practice — gh, ripgrep-adjacent tools, etc. use ~/.config too)
// Override order: $FAPONY_STATE_DIR > config.paths.stateDir > $XDG_CONFIG_HOME > ~/.config
export function faponyDir(config?: Config): string {
  if (process.env.FAPONY_STATE_DIR) return process.env.FAPONY_STATE_DIR;
  if (config?.paths?.stateDir) return config.paths.stateDir;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fapony");
}

function _dbPath(config?: Config): string {
  return join(faponyDir(config), "state.db");
}

export function configFilePath(): string {
  if (process.env.FAPONY_CONFIG) return process.env.FAPONY_CONFIG;
  return join(process.cwd(), "fapony.config.json");
}

function freshDefaultConfig(): Config {
  return {
    ...DEFAULT_CONFIG,
    worktrees: { ...DEFAULT_CONFIG.worktrees },
    executor: { ...DEFAULT_CONFIG.executor },
    review: {
      ...DEFAULT_CONFIG.review,
      bigDiff: { ...DEFAULT_CONFIG.review.bigDiff },
    },
  };
}

export function loadConfig(configPath?: string): Config {
  const resolved = configPath ?? configFilePath();
  if (!existsSync(resolved)) return freshDefaultConfig();

  try {
    const raw = readFileSync(resolved, "utf-8");
    const file = JSON.parse(raw) as Partial<Config>;

    // B2: warn when both top-level executor.cmd and roles.executor.cmd exist
    // — roles wins silently, but the duplicate is a drift risk.
    if (file.executor?.cmd && file.roles?.executor?.cmd) {
      console.error(
        "⚠ config has both executor.cmd and roles.executor.cmd — roles.executor.cmd wins. " +
          "Remove top-level executor to avoid drift.",
      );
    }

    return {
      ...DEFAULT_CONFIG,
      ...file,
      executor: { ...DEFAULT_CONFIG.executor, ...file.executor },
      review: {
        ...DEFAULT_CONFIG.review,
        ...file.review,
        bigDiff: { ...DEFAULT_CONFIG.review.bigDiff, ...file.review?.bigDiff },
      },
      spec: file.spec ? { ...file.spec } : DEFAULT_CONFIG.spec,
      markers: file.markers ? { ...file.markers } : DEFAULT_CONFIG.markers,
      paths: file.paths ? { ...file.paths } : DEFAULT_CONFIG.paths,
      safety: file.safety ? { ...file.safety } : DEFAULT_CONFIG.safety,
      plan: file.plan ? { ...file.plan } : DEFAULT_CONFIG.plan,
      planmv: file.planmv ? { ...file.planmv } : DEFAULT_CONFIG.planmv,
      display: file.display ? { ...file.display } : DEFAULT_CONFIG.display,
      defaults: file.defaults ? { ...file.defaults } : DEFAULT_CONFIG.defaults,
      prompts: file.prompts ? { ...file.prompts } : DEFAULT_CONFIG.prompts,
    };
  } catch {
    return freshDefaultConfig();
  }
}
