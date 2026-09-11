#!/bin/bash
# statusline/claude-statusline.sh — Claude Code statusline for fapony
#
# Reads JSON session data from stdin (Claude Code sends it automatically).
# Reads fapony's cached footprint from ~/.config/fapony/statusline (written
# by the fapony MCP server on each tool call — O(1), no spawn, no db).
#
# Output: one line combining Claude Code metrics + fapony footprint.
# Format: [Model] $cost · ctx% · fapony bytes

FAPONY_CACHE="${HOME}/.config/fapony/statusline"

input=$(cat)

# Claude Code fields — safe fallbacks for null/missing.
MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# Format cost: $0.0000 → $0.00 (2 decimal places for statusline brevity)
COST_FMT=$(printf "%.2f" "$COST" 2>/dev/null || echo "0.00")

# Read fapony cache — a single line written on MCP tool calls.
# Never spawns processes, never opens db, < 1ms read.
FAPONY_LINE=""
if [ -f "$FAPONY_CACHE" ]; then
  FAPONY_LINE=$(cat "$FAPONY_CACHE" 2>/dev/null)
fi

# Compose output.
if [ -n "$FAPONY_LINE" ]; then
  echo "[$MODEL] \$${COST_FMT} · ${PCT}% · ${FAPONY_LINE}"
else
  echo "[$MODEL] \$${COST_FMT} · ${PCT}%"
fi
