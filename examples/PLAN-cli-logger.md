# PLAN-cli-logger — structured JSON logger for CLI tools

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** ไม่มี (scope เล็ก, ไม่ต้องมี spec)

---

## 1. Goal (why)

ตอนนี้ CLI tools ใน repo ใช้ `console.log` ปน output ที่ user ต้องเห็น — debug log หลุดไป
จอ user, error log หายไปไม่มีทางตามหา ต้องมี structured logger ที่แยก debug/info/error
ได้ชัด + output เป็น JSON เพื่อ pipe ไป tool อื่นได้

## 2. Scope (do / don't do)

**ทำ:**
- สร้าง `src/logger.ts` — drop-in replacement สำหรับ console.log ที่มี level (debug/info/warn/error)
- JSON output mode (--json flag หรือ LOG_FORMAT=json env)
- Pretty-print mode สำหรับ human reading (default)
- Log file output (--log-file flag) ที่ append JSONL
- TypeScript types สำหรับ structured log context

**ไม่ทำ:**
- ไม่ทำ log rotation — ไฟล์โตไปค่อยจัดการเอง (user น้อย)
- ไม่ทำ remote logging (Sentry, Datadog) — ยังไม่มี infra รองรับ
- ไม่ migrate console.log ทั้งหมดในครั้งนี้ — ทำเฉพาะ src/ ที่เขียนใหม่ก่อน

## 3. Done criteria (how we know it's finished)

- `npx tsx src/logger.ts` ทำงานได้ + แสดง log level สีต่างกัน
- `LOG_FORMAT=json npx tsx src/logger.ts` แสดง JSON ที่ valid ทุก line
- `npx tsx src/logger.ts --log-file /tmp/test.log` สร้างไฟล์ JSONL ที่ `cat | jq` ได้
- `npm run typecheck` ผ่าน
- มี unit test 3 ตัว: level filtering, JSON format, file output

## 4. Constraints / Hard rules (must not violate)

- ห้าม dependencies ภายนอก (winston, pino) — ใช้แค่ `console.*` + `fs.appendFileSync`
- ห้าม log sensitive data (password, token, API key) — มี allowlist ของ field ที่ log ได้
- ห้ามเขียน log file ใน working directory ของ user — ต้อง mirror path จาก root
- ห้าม format string interpolation ใน log message — ต้องเป็น structured object เสมอ

## 5. Risks & Escape hatches (if it fails)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| Pretty-print format ซับซ้อนเกินไป | กลาง | code ใหญ่ไม่คุ้ม | keep ANSI color ง่ายๆ ไม่ต้อง align columns |
| JSONL file โตเร็ว (debug mode) | ต่ำ | disk เต็ม | default level = info, debug ต้อง opt-in |
| Type safety ของ log context | ต่ำ | log ข้อมูลผิด type | generic type parameter สำหรับ context object |

## 6. Steps (what in which order)

1. **Logger core** — class Logger ที่มี debug/info/warn/error methods · verify: `npx tsx -e "import {Logger} from './src/logger'; const l = new Logger(); l.info('test', {foo:1})"` แสดง output ถูก
2. **JSON mode** — LOG_FORMAT=json สลับ output format · verify: output เป็น valid JSON ทุก line
3. **File output** — --log-file flag · verify: ไฟล์สร้างได้ + append ทุก log call
4. **Unit tests** — test 3 ตัว · verify: `npm test` ผ่านทั้งหมด

## 7. Examples (make it concrete)

```bash
# Pretty mode (default)
npx tsx src/logger.ts
# [INFO] 2026-09-05 10:30:00 server started { port: 3000 }
# [WARN] 2026-09-05 10:30:01 slow query { duration: 1523 }

# JSON mode
LOG_FORMAT=json npx tsx src/logger.ts
# {"level":"info","ts":"2026-09-05T10:30:00Z","msg":"server started","port":3000}

# File logging
npx tsx src/logger.ts --log-file /tmp/app.log
cat /tmp/app.log | jq '.level'
# "info"
# "warn"
```

## 8. References

- [templates/PLAN.md](../templates/PLAN.md) — Plan Core template
- [skill/plan-with-me.md](../skill/plan-with-me.md) — วิธีสร้าง plan นี้
