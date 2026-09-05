# PLAN-refactor-auth — extract auth middleware to standalone module

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** ไม่มี (refactor ไม่ต้องมี spec, มี code เดิมเป็น spec อยู่แล้ว)

---

## 1. Goal (why)

ตอนนี้ auth logic (JWT verify, permission check, role guard) กระจายอยู่ใน 5+ route handlers
ทำให้แก้ auth flow ทีต้องแก้หลายที่ + ทดสอบซ้ำยาก ต้องย้ายออกมาเป็น middleware
เดียวที่ test ได้แบบ isolated

## 2. Scope (do / don't do)

**ทำ:**
- สร้าง `src/middleware/auth.ts` — verifyJWT + requireRole + requirePermission
- ย้าย auth logic จาก `src/routes/tasks.ts`, `src/routes/users.ts`, `src/routes/projects.ts`
- ใช้ middleware chain ใน route handlers แทน inline auth code
- เพิ่ม unit tests สำหรับ middleware แต่ละตัว (mock JWT, mock user)

**ไม่ทำ:**
- ไม่ refactor auth library (ยังใช้ jsonwebtoken เดิม)
- ไม่เปลี่ยน JWT payload structure — เปลี่ยนแค่ location ของ logic
- ไม่ทำ RBAC system ใหม่ — permission string เดิม ย้ายแค่ที่ check

## 3. Done criteria (how we know it's finished)

- `npm run typecheck` ผ่านหลัง refactor
- `npm test` ไม่มี test ใหม่ fail (existing tests ยัง pass ทุกตัว)
- มี unit test ใหม่ 3 ตัว: valid token → pass, expired token → 401, wrong role → 403
- Auth code ใน route handlers เหลือแค่ `router.get('/tasks', verifyJWT, requireRole('admin'), handler)`
- ไม่มี auth logic ซ้ำกันใน route files (grep ไม่เจอ duplicate)

## 4. Constraints / Hard rules (must not violate)

- ห้ามเปลี่ยน behavior ของ auth — refactor คือย้าย ไม่ใช่แก้ logic
- ห้ามลบ middleware เดิมที่ route level ก่อน unit test ใหม่เขียนเสร็จ — เขียน test ก่อน ค่อยลบ
- ห้ามสร้าง dependency cycle — auth.ts ห้าม import จาก routes/
- ห้าม-cache JWT verify result — verify ทุก request เสมอ

## 5. Risks & Escape hatches (if it fails)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| Route handlers มี auth logic ที่ไม่เหมือนกัน (variant) | สูง | middleware ครอบไม่หมด | inventory auth patterns ก่อน ถ้ามี 2 แบบ → ทำ 2 middleware |
| Existing tests break หลัง refactor | กลาง | ต้อง rollback | run full test suite ก่อน commit, compare coverage |
| Middleware chain order mistake (permission check ก่อน auth) | ต่ำ | security hole | enforce order ใน test: auth → role → permission |

## 6. Steps (what in which order)

1. **Inventory auth patterns** — grep หา JWT verify / permission check ทุกที่ · verify: มี list ของ route files + pattern ที่ใช้
2. **Write middleware unit tests** — test 3 ตัวก่อนเขียน code · verify: test 3 ตัว fail ก่อน (RED)
3. **Implement middleware** — สร้าง auth.ts + implement ทั้ง 3 functions · verify: test 3 ตัว pass (GREEN)
4. **Migrate routes ทีละไฟล์** — เปลี่ยน tasks.ts → users.ts → projects.ts · verify: `npm test` pass หลังย้ายแต่ละไฟล์
5. **Cleanup** — ลบ auth code เก่าที่ไม่ใช้แล้ว · verify: `grep -r "jwt.verify" src/routes/` ไม่เจอ

## 7. Examples (make it concrete)

```bash
# ก่อน refactor — auth code ซ้ำใน route
grep -n "jwt.verify" src/routes/tasks.ts
# 42:  const decoded = jwt.verify(token, SECRET);
# 43:  if (!decoded.role.includes('admin')) return res.status(403)...

# หลัง refactor — clean middleware chain
cat src/routes/tasks.ts | head -5
# import { verifyJWT, requireRole } from '../middleware/auth';
# router.get('/tasks', verifyJWT, requireRole('admin'), getTasks);

# Unit test
npx vitest run src/middleware/auth.test.ts
# ✓ verifyJWT valid token → passes
# ✓ verifyJWT expired → 401
# ✓ requireRole wrong role → 403
```

## 8. References

- [templates/PLAN.md](../templates/PLAN.md) — Plan Core template
- [skill/plan-with-me.md](../skill/plan-with-me.md) — วิธีสร้าง plan นี้
