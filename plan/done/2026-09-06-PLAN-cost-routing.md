> ✅ **shipped** (0473228)

# PLAN-cost-routing — วัดต้นทุนก่อนสร้าง router

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-06
> **Source spec:** ไม่มี — แผนนี้เป็นการลด scope จาก audit และ review ของ cost-routing

---

## 1. เป้าหมาย (ทำไม)

ทำให้ fapony วัดได้ว่าแต่ละ agent spawn ใช้ model/role อะไร และใช้ทรัพยากรเท่าไร
โดยไม่ผูกกับ vendor ใด ก่อนตัดสินใจสร้าง cost-aware router จริง ต้องมีข้อมูลจากการใช้งาน
จริงก่อน ไม่ใช้ threshold จากจำนวนไฟล์หรือบรรทัดเป็นสมมติฐานล่วงหน้า.

## 2. ขอบเขต (ทำอะไรไม่ทำอะไร)

**ทำ:**
- รวม model attribution และ byte-based cost measurement เป็น implementation slice เดียว
- เก็บ role, model, bytes เข้า/ออก และ USD เมื่อมี static pricing config ใน `events.data`
- แสดง cost รวมของ run ใน `fapony stats` และ handoff โดยไม่ทำให้ config ที่ไม่มี pricing พัง
- ส่ง cost fields แบบไม่มีเนื้อหา plan/note ผ่าน telemetry ที่ opt-in เท่านั้น
- รัน test, dogfood และเก็บข้อมูลจริงเพื่อใช้ตัดสินใจเรื่อง routing

**ไม่ทำ:**
- ยังไม่สร้าง `pickExecutorRole` หรือ threshold `files/lines` — ยังไม่มีข้อมูลยืนยันว่า heuristic นี้สัมพันธ์กับ cost หรือ success
- ยังไม่เพิ่ม cost breakdown ตาม role/worktree/pass — เพิ่มเมื่อมีคำถามใช้งานจริงที่ต้องตอบ
- ยังไม่ทำ realtime pricing, token counter จริง หรือ `charsPerToken` override — byte เป็น proxy ที่ประกาศข้อจำกัดชัดเจนพอสำหรับ slice แรก
- ไม่เปลี่ยน default ให้ auto-loop หรือ bypass `maxRounds` — ไม่เกี่ยวกับ measurement

## 3. เกณฑ์จบ (รู้ได้ว่าเสร็จ)

- ทุก spawn ที่ fapony สร้างมี role/model และ byte input/output ใน event โดยไม่เพิ่ม DB table หรือ event kind ใหม่
- เมื่อไม่ตั้ง pricing ระบบยังวัด bytes ได้และไม่แสดง USD ปลอม; เมื่อมี pricing ระบบคำนวณ USD ได้ตาม config
- `fapony test` ผ่าน และมี test ใหม่อย่างน้อย 3 กรณีสำหรับ attribution/cost รวมถึง `pricing: null`
- `fapony stats` และ handoff แสดง cost รวมของ run ได้; telemetry ส่งเฉพาะ cost ที่อนุญาตและไม่ส่ง plan/note content
- รัน dogfood บน `wt-fapony` อย่างน้อย 1 round และบันทึกผลลัพธ์ที่ใช้ตัดสินใจขั้นถัดไป
- มี changelog entry ของ slice นี้ และ archive plan ด้วย `fapony plan-mv` หลัง gate ผ่าน

## 4. ข้อจำกัด / กฎเหล็ก (ห้ามละเมิด)

- Config fields ใหม่ต้อง optional และ additive; `pricing` ที่ไม่มีหรือเป็น `null` ต้องปิดเฉพาะ USD ไม่ปิด byte measurement
- ใช้ `events.data` เท่านั้น ห้ามเพิ่มตาราง SQLite หรือเขียน cost ลง worktree เป้าหมาย
- ทุก command ที่ spawn จาก config ยังต้องผ่าน `assertSafe()` เหมือนเดิม
- `memory: null` ต้องไม่ปิดหรือทำให้ cost telemetry ล้มเหลว
- ห้ามอ้างว่า USD เป็นค่าใช้จ่ายจริง; เป็น estimate จาก bytes และ static pricing เท่านั้น
- ห้ามสร้าง abstraction ที่มี implementation/caller เดียวเพียงเพื่อรองรับ router ในอนาคต
- round cap เดิมต้องไม่ถูก bypass และ executor timeout/stall ต้องยังเป็น failure ตาม behavior เดิม

## 5. ความเสี่ยง & ทางหนี (ถ้าจะ fail)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| executor หรือ role บางตัวไม่รายงาน stdout ครบ | กลาง | bytes_out ต่ำกว่าความจริง | วัดจาก buffer ที่ fapony รับได้จริง และระบุเป็น proxy ใน output |
| pricing config ผิดหน่วยหรือราคาล้าสมัย | กลาง | USD estimate ทำให้เข้าใจผิด | ระบุหน่วยราคาต่อ 1k tokens และแสดง USD เป็น estimate เท่านั้น |
| telemetry เผลอส่งข้อมูลอ่อนไหวผ่าน event data | ต่ำ | privacy leak | สร้าง payload จาก allowlist cost/identity fields ไม่ส่ง raw `data` |
| ข้อมูลน้อยเกินไปสำหรับตัดสินใจ router | สูง | สร้าง threshold ผิด | ไม่ทำ 2g; เก็บข้อมูลต่อและเปิด decision gate ใหม่ |
| stats/handoff เปลี่ยน output กระทบ fixture | กลาง | test หรือ script เดิมพัง | เพิ่มส่วน cost แบบ additive และรักษา output เดิมเมื่อไม่มีข้อมูล |

## 6. ขั้นตอน (ทำอะไรก่อน-หลัง)

1. **รวม 2e+2f: attribution + measurement** — เพิ่ม role/model และ byte cost ให้ทุก spawn path
   (`executor`, `gate`, `planner`, `bigFixer`, `scrutinizeFix`) พร้อม optional pricing getter;
   verify: unit/self-tests ครบอย่างน้อย 3 กรณี และ `fapony test` ผ่าน
2. **เติม cost surface ขั้นต่ำ** — เพิ่ม cost รวมของ run ใน stats, handoff และ opt-in telemetry
   โดยไม่ส่ง plan/note content; verify: mock-event tests ตรวจตัวเลขและ allowlist ของ payload
3. **Dogfood measurement slice** — รันบน `wt-fapony` อย่างน้อย 1 round และตรวจ spawn/route
   events, `fapony stats`, handoff และ behavior เมื่อ `pricing` ไม่มีค่า; verify: output สอดคล้องกับ
   event bytes และไม่มี USD เมื่อไม่ได้ตั้งราคา
4. **เก็บข้อมูลก่อนตัดสินใจ router** — ใช้งานจริงหลายรอบและสรุป bytes, estimated USD,
    success/pass, retry และ stall แยกตาม role/model เท่าที่ข้อมูลรองรับ; verify: มีบันทึก decision
   ว่า threshold ใดมีหลักฐาน หรือระบุชัดว่ายังไม่ควร route
5. **Decision gate สำหรับ 2g** — ถ้าข้อมูลชี้ว่าการเลือก model ลด cost โดยไม่ลด pass rate ให้
   เขียน plan/spec แยกสำหรับ router; ถ้าไม่เช่นนั้นคง single executor role และไม่เพิ่ม abstraction;
   verify: มี acceptance criteria จากข้อมูลจริงก่อนเริ่ม implementation
6. **Ship/archive** — เพิ่ม changelog entry, commit แยก concern ตาม repo convention และรัน
   `fapony plan-mv plan/PLAN-cost-routing.md` หลัง gate ผ่าน; verify: plan ถูก archive พร้อม shipped marker

## 7. ตัวอย่าง (เห็นภาพ)

```bash
# measurement ต้องทำงานได้แม้ไม่มี pricing
fapony stats
fapony handoff <run-id>
```

รายละเอียด field และ test shape ให้อยู่ใน implementation/spec ที่สร้างตอนเริ่ม step 1 ไม่ขยาย
plan นี้เป็น schema ล่วงหน้า.

## 8. อ้างอิง

- [ROADMAP.md](../ROADMAP.md) — วิสัยทัศน์ model-agnostic ของ fapony
- [templates/PLAN.md](../templates/PLAN.md) — กฎของ plan core
- [src/run.ts](../src/run.ts) — executor spawn และ route ปัจจุบัน
- [src/loop.ts](../src/loop.ts) — gate/planner/fixer spawn paths
- [src/db.ts](../src/db.ts) — config และ event persistence
- [src/stats.ts](../src/stats.ts) — human-facing KPI
- [src/telemetry.ts](../src/telemetry.ts) — opt-in remote payload
