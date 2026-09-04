#!/usr/bin/env bun
// .memory/mem.ts — append-only work log for fapony's own development.
// ห้ามแก้บรรทัดเก่า — ปิดงาน = close (tombstone), git = ประวัติ
// ponytail: minimal core (add/close/now) เท่านั้น — claim/release/synced/staleReport
// ของ vela เกิดจาก pain จริง (multi-agent ชนงาน, decision ตกหล่น) ยังไม่เจอที่นี่ อย่า copy มาเผื่อ

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";

const dir = import.meta.dir;
const LOG = `${dir}/log.jsonl`;
const agent = process.env.MEM_AGENT || process.env.USER || "unknown";

type Row = {
  ts: string;
  agent: string;
  id?: string;
  kind: "next" | "bug" | "decision" | "note" | "close" | "claim";
  text: string;
  ref?: string;
  spec?: string;
};

function rows(): Row[] {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line, i) => {
      try {
        return [JSON.parse(line) as Row];
      } catch {
        console.error(`[mem] ข้ามบรรทัดที่ ${i + 1} (JSON เสีย)`);
        return [];
      }
    });
}

function put(r: Omit<Row, "ts" | "agent">) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), agent, ...r }) + "\n");
}

function openRows(all: Row[]): Row[] {
  const dead = new Set(all.filter((r) => r.kind === "close").map((r) => r.ref));
  return all.filter((r) => r.id && !dead.has(r.id));
}

const [cmd, ...a] = process.argv.slice(2);

if (cmd === "add") {
  // mem add next|bug|decision|note "text" [spec]
  const [kind, text, spec] = a;
  if (!kind || !text) {
    console.error('usage: mem add next|bug|decision|note "text" [spec]');
    process.exit(1);
  }
  const id = Date.now().toString(36);
  put({ id, kind: kind as Row["kind"], text, ...(spec ? { spec } : {}) });
  console.log(id);
} else if (cmd === "close") {
  // mem close <id> "why"
  const [ref, text] = a;
  if (!ref) {
    console.error('usage: mem close <id> "why"');
    process.exit(1);
  }
  put({ kind: "close", ref, text: text ?? "" });
} else if (cmd === "claim") {
  // mem claim <id> — fapony run เรียกตอนเริ่ม, แค่ log ไว้เป็น audit ไม่ได้ enforce lock
  const [ref] = a;
  if (!ref) {
    console.error("usage: mem claim <id>");
    process.exit(1);
  }
  put({ kind: "claim", ref, text: "" });
} else {
  // mem now (default) — งานที่ยังเปิด
  const open = openRows(rows()).filter((r) => r.kind !== "claim");
  if (!open.length) {
    console.log("(no open items)");
  } else {
    for (const r of open) {
      console.log(`- [${r.id}] ${r.kind} ${r.text}${r.spec ? ` → ${r.spec}` : ""}`);
    }
  }
}
