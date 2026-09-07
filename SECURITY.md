# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in fapony, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting: [Report a vulnerability](https://github.com/kire21b/fapony/security/advisories/new).

## Scope

fapony is a CLI orchestrator that runs locally. It does not expose network services. The primary security concerns are:

- **Command injection** — fapony spawns shell commands from config. `assertSafe()` deny-lists dangerous git commands (`reset --hard`, `clean -f`, `checkout --`, `git stash`), but always verify before running untrusted configs.
- **Path traversal** — fapony must not write files into the target worktree. DB lives in `~/.config/fapony/` only.
- **Memory claims** — memory commands are executed via shell adapter. Ensure memory scripts are trusted.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Best Practices

- Never run fapony with `--allow-dirty` in CI without understanding the implications
- Review executor/gate prompts before injecting into AI agents
- Keep `fapony.config.json` in version control but never commit secrets
