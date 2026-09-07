# SPEC-resilience.md — รายละเอียด backoff + retry + interrupt logging

> **Used by:** [PLAN-resilience.md](../plan/PLAN-resilience.md)
> (plan = what/why/order · spec นี้ = how ทั้งหมด — shape, policy, edge cases)
>
> **Scope cut (2026-09-07):** circuit breaker (state machine, `BreakerPolicy`,
> `breakerFromEvents`, event `breaker_open`/`breaker_close`) ถูกตัดออกจาก scope ปัจจุบัน —
> เก็บ type/design ไว้ท้ายไฟล์ใน § Deferred: circuit breaker เผื่อทำ PLAN-2 อย่าลบทิ้ง

---

## Shape (data / API)

```ts
// src/resilience.ts — pure core (ไม่แตะ process/db โดยตรง)

type FailureClass = "limit" | "auth" | "timeout" | "crash" | "empty";

interface FailureInfo {
  cls: FailureClass;
  exitCode: number;      // จาก proc.exited (timeout path = kill → non-zero)
  timedOut: boolean;     // true เมื่อ timeout timer เป็นคน kill
  tail: string;          // 200 ตัวอักษรท้าย stdout+stderr (ใช้เข้า event)
}

function classifyFailure(input: {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  limitPatterns?: string[];  // regex source — default ตามตารางด้านล่าง
  authPatterns?: string[];
}): FailureInfo;
// ลำดับชี้ขาด: auth → timeout (timedOut=true) → limit (pattern match) →
//             exitCode ≠ 0 → crash · exitCode = 0 แต่ stdout ว่าง → empty
//             exitCode = 0 + stdout มี → ไม่ใช่ failure (caller เรียก classify เองเมื่อพัง)

function backoffDelayMs(
  attempt: number,                    // 1-based
  p: { baseMs: number; maxMs: number; rand?: () => number },
): number;
// raw = min(maxMs, baseMs × 2^(attempt-1)) แล้ว equal jitter:
// delay = raw/2 + rand() × raw/2 (floor = raw/2 — full jitter เคยให้ 0 ได้
// ซึ่งเท่ากับยิงซ้ำใส่ rate limit ทันที) · rand inject ได้เพื่อเทสแบบ deterministic

interface RetryPolicy {
  maxAttempts: number;   // รวม attempt แรก (default 3)
  limitBaseMs: number;   // default 60_000
  crashBaseMs: number;   // default 5_000
  maxMs: number;         // default 600_000
  retryable: FailureClass[];  // default ["limit", "crash", "empty"]
}

async function withRetry<T>(
  attempt: (n: number) => Promise<{ ok: true; value: T } | { ok: false; fail: FailureInfo }>,
  opts: {
    policy: RetryPolicy;
    isAborted: () => Promise<boolean>;  // poll: run status = stopped | SIGINT ยิงแล้ว
    canRetry: () => Promise<boolean>;   // executor path: clean-tree gate
    onRetry: (fail: FailureInfo, nextAttempt: number, delayMs: number) => void;
  },
): Promise<{ ok: true; value: T } | { ok: false; fail: FailureInfo; exhausted: boolean }>;
// วง retry: isAborted ก่อนทุก attempt + ระหว่าง backoff sleep (แบ่งช่อง ≤1s)
// canRetry false → คืน fail ทันที (ไม่ท่อง attempt เพิ่ม)
// onRetry(fail, nextAttempt, delayMs): terminal call (ไม่ retry ต่อ) ก็ส่ง
// nextAttempt = n+1 เหมือน retry path — consumer ที่ log attempt = nextAttempt-1
// จะได้เลข attempt จริง (เคยส่ง n ทำให้ attempt 0)
// flow.ts: withRetry คืน fail แบบ !exhausted + isAborted() = true → run นี้คือ
// abort (SIGINT/stop) ต้อง mark stopped ไม่ใช่ stalled
```

### Config (optional — ใส่ใน `fapony.config.json`)

```json
{
  "resilience": {
    "retry": { "maxAttempts": 3, "limitBaseMs": 60000, "crashBaseMs": 5000, "maxMs": 600000 },
    "patterns": {
      "limit": ["rate\\s*limit", "429.{0,30}(too many|rate|limit|quota)|too many.{0,30}429", "usage limit", "credit.{0,30}(exceed|limit|quota|exhaust|insufficient)|insufficient.{0,30}credit", "quota", "overloaded"],
      "auth": ["unauthorized", "invalid api key", "authentication"]
    }
  }
}
```

- **ไม่ใส่ `resilience` = ใช้ default ทั้งหมด (เปิดใช้)** · `resilience: null` = ปิดทั้งชั้น
  คืนพฤติกรรมเดิม (พัง → stalled ทันที) — ทำ pattern เดียวกับ `memory: null`
- getters ใหม่ที่ `src/db/getters.ts`: `retryPolicy()`, `resiliencePatterns()`
  + defaults ที่ `src/db/defaults.ts` — ห้าม hardcode ที่ call site
- `patterns.limit` ปรับได้เพราะแต่ละ agent แจ้ง limit ไม่เหมือนกัน (opencode/claude/codex)

### Policy ต่อ class

| class | retry? | backoff เริ่ม | หมายเหตุ |
|---|---|---|---|
| `limit` | ใช่ | 60s | สาเหตุหลัก — provider ตัด quota/rate |
| `crash` | ใช่ | 5s | exit ≠ 0 ไม่เข้า pattern อื่น |
| `empty` | ใช่ | 5s | exit 0 แต่ output ว่าง/marker หาย — เป็นอาการ agent มากกว่า provider |
| `timeout` | ไม่ (default) | — | re-run agent 45 นาทีอัตโนมัติ = แพง; เจอบ่อยให้ปรับ timeoutMin |
| `auth` | ไม่ | — | key หมด/ผิด — retry ไม่มีทางหายเอง, fail ทันที |

### Event kinds ใหม่ (data — ไม่แตะ schema)

| kind | data |
|---|---|
| `spawn_fail` | `{ role, cls, exit_code, attempt, tail }` — log ทุกครั้งที่ classify เจอ failure (ก่อนตัดสิน retry/stalled) |
| `interrupted` | `{ during: "spawn" \| "backoff", role, attempt }` — log ทุกครั้งที่ `fapony stop` หรือ SIGINT ตัดกลางคัน |

นับย้อนหลังได้ตรงๆ ด้วย SQL ธรรมดา ไม่ต้องมี CLI ใหม่:

```sql
-- กี่ครั้งที่โดน SIGINT/stop กลางคัน
SELECT COUNT(*) FROM events WHERE kind = 'interrupted';
-- แยก class ว่า limit ชนบ่อยแค่ไหนเทียบ crash/empty
SELECT json_extract(data,'$.cls') AS cls, COUNT(*)
FROM events WHERE kind = 'spawn_fail' GROUP BY cls;
```

### SIGINT handling (ใหม่ทั้งหมด — ไม่มี signal handler อยู่ก่อนในโค้ด)

- `fapony.ts` (entry เดียว) ตั้ง `process.on("SIGINT", handler)` ตอนเริ่ม `run`/`loop`
- ครั้งแรก: log event `interrupted` (ถ้ามี runId ปัจจุบันในสโคป) → mark run `stopped` +
  release memory (เรียก path เดียวกับ [src/stop.ts](../src/stop.ts)) → `process.exit(130)`
- ครั้งที่สอง (กดซ้ำระหว่าง cleanup ครั้งแรกยังไม่จบ): `process.exit(130)` ทันทีไม่รอ
- child (Bun.spawn) อยู่ process group เดียวกับ terminal → อาจได้ SIGINT จาก OS พร้อมกัน
  อยู่แล้ว — handler ฝั่ง parent ไม่ต้อง kill child เอง แค่ log + mark state ให้ทัน (เร็ว,
  ไม่มี await ที่พึ่ง child ตอบสนอง)
- `fapony stop <id>` จากอีก terminal (คนละ process) → ไม่ใช้ signal เลย, `isAborted()`
  poll status จาก db เห็นเปลี่ยนก่อน attempt ถัดไป/ระหว่าง backoff sleep chunk → ออกทันที
  (path เดิมของ `fapony stop` อยู่แล้ว ไม่ต้องแก้)

### ลำดับเหตุการณ์ตัวอย่าง (agent ติด limit)

```
spawn #1 → exit 1 "rate limit exceeded"      → event spawn_fail {attempt:1, cls:"limit"}
         → backoff ~30–60s (equal jitter ของ base 60s, แบ่งช่อง 1s, เช็ค abort ทุกช่อง)
spawn #2 → exit 1 "rate limit exceeded"      → event spawn_fail {attempt:2}
         → backoff ~60–120s
spawn #3 → ok                                 → run ไปต่อตามปกติ (ไม่มี stalled)
```

Ctrl-C ระหว่างรอ backoff:

```
spawn #1 → exit 1 "rate limit" → spawn_fail {attempt:1} → backoff 60s เริ่มนับ
[Ctrl-C]  → event interrupted {during:"backoff", attempt:1} → run stopped + memory release
          → exit 130 (กดซ้ำ = force exit ทันที)
```

## Edge cases

| input | expected behavior |
|---|---|
| executor ติด limit, HEAD ขยับระหว่าง attempt (commit บางก้อนแล้ว) | ไม่ retry — mark stalled (pre-spawn sha snapshot ต่างจาก HEAD ปัจจุบัน) |
| executor ติด limit ตั้งแต่ยังไม่แตะ worktree (HEAD = snapshot, porcelain ว่าง) | retry ตาม policy |
| fixing round (worktree มี commit ของรอบก่อนอยู่แล้ว) | snapshot จับก่อน spawn ทุก attempt → commit เก่าไม่บล็อก retry |
| gate/planner พัง | retry ได้เลย (ไม่ commit อะไร) — กลับ null เมื่อ exhaust แล้ว loop จัดการตามเดิม |
| auth fail | ไม่ retry — fail ทันที (event `spawn_fail` cls:"auth" ยังถูก log ไว้ดูย้อนหลังได้) |
| timeout (timedOut=true) | ไม่ auto-retry — stalled ตามเดิม + event spawn_fail log ไว้ |
| `fapony stop` ระหว่างรอ backoff | isAborted เห็น status=stopped → ออกทันที ก่อน attempt ถัดไป + memory release + event `interrupted` |
| SIGINT ระหว่าง spawn (agent กำลังรัน) | event `interrupted {during:"spawn"}`, mark stopped + release memory, exit 130 — ไม่รอ child เอง |
| SIGINT ระหว่าง backoff sleep | event `interrupted {during:"backoff"}`, mark stopped + release memory, exit 130 |
| SIGINT กดซ้ำ (2 ครั้งติด) | ครั้งที่สอง force `process.exit(130)` ทันที ไม่รอ cleanup ครั้งแรก |
| `resilience: null` | ทุก code path ใหม่เป็น no-op สำหรับ retry/backoff — พัง = stalled ทันทีเหมือนก่อนแก้
  (SIGINT handler ยังทำงานอยู่เสมอ ไม่ผูกกับ config นี้ เพราะเป็นคนละปัญหา — "ยกเลิกได้สะอาด" ควรมีเสมอ) |

## Deferred: circuit breaker (ไม่ทำรอบนี้ — เก็บ design ไว้เผื่อ PLAN-2)

ถ้า event `spawn_fail` (ดูด้วย SQL ด้านบน) โชว์ว่า retry อย่างเดียวไม่พอจริง (เผา token
ซ้ำๆ ข้าม run เพราะ limit ยังไม่ปล่อย) ค่อยกลับมาทำส่วนนี้:

```ts
interface BreakerPolicy {
  failThreshold: number;   // default 3
  windowMin: number;       // default 15
  cooldownMin: number;     // default 10
  maxCooldownMin: number;  // default 60
}

interface BreakerState {
  state: "closed" | "open" | "half_open";
  openUntil: string | null;
  recentFails: number;
}

function breakerFromEvents(
  events: { ts: string; kind: string; data: string | null }[],
  policy: BreakerPolicy,
  now: Date,
): BreakerState;
// closed → (spawn_fail นับได้ ≥ threshold ใน window | auth fail 1 ครั้ง) → open
// open → พ้น openUntil → half_open (ยอมให้ spawn 1 ครั้งเป็น probe)
// probe สำเร็จ → closed (log breaker_close) · probe พัง → open อีก (cooldown ×2 จน cap)
```

เพิ่ม event kind `breaker_open` / `breaker_close`, config `resilience.breaker`, getter
`breakerPolicy()`, จุดเชื่อม `src/loop/index.ts` (เช็คก่อน spawn ทุกจุด) + `src/status.ts`
(แสดง state/recentFails/openUntil) — breaker เป็นต่อ worktree/in-process เท่านั้น ไม่ทำ
distributed lock ข้าม process ([AGENTS.md](../AGENTS.md) § Don't do เดิม)

## Examples

Test fixtures ที่ต้องมี (`test/fixtures/`, ต่อยอด stub เดิม ไม่มี network):

- `flaky-agent.ts` — exit 1 พร้อม `"rate limit exceeded"` ตามจำนวนที่ env
  `FAPONY_FLAKY_FAILS` กำหนด แล้วครั้งถัดไปสำเร็จ (นับจาก marker file ใน cwd ของ fixture)
- ลงทะเบียนใน `test/index.ts` ผ่าน `test/resilience.test.ts`

จุดเชื่อมในโค้ดเดิม (แก้ตรงนี้เท่านั้น):

- `src/loop/spawn.ts` `runSpawn()` — ครอบ body เดิมด้วย withRetry, outcome → classify จาก
  stdout ว่าง/null + exitCode (ตอนนี้คืน `string | null` — ต้องคืน info พอสำหรับ classify)
- `src/run/spawn.ts` `spawnExecutor()` — จุดเดียวที่มี timeout flag + sha snapshot ก่อน spawn
- `src/run/flow.ts` ที่ `exitCode !== 0 → stalled` — เปลี่ยนเป็น classify ก่อน แล้วค่อยตัดสิน
- `fapony.ts` — เพิ่ม `process.on("SIGINT", ...)` (ไม่มีอยู่ก่อน), เรียก `src/stop.ts` path
  เดิม + log event `interrupted`
- `src/stop.ts` — ใช้ path เดิมซ้ำจาก SIGINT handler ไม่เขียนใหม่คู่ขนาน
