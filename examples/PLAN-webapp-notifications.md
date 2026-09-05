# PLAN-webapp-notifications — in-app notification system

> **Status:** 🚧 in-progress · **Owner:** delamind · **Created:** 2026-09-05
> **Source spec:** [spec/notifications.md](../spec/notifications.md)

---

## 1. Goal (why)

ตอนนี้ user ต้องเปิดหน้า dashboard ทุกครั้งเพื่อดูว่ามีอะไรใหม่ — ไม่มี way ที่จะรู้ว่า
มี task ใหม่ assignment หรือ comment โดยไม่ต้อง refresh เอง ระบบนี้จะ push notification
ให้ user รู้ทันทีว่าเกิดอะไรขึ้นโดยไม่ต้องเปิดหน้าเว็บ

## 2. Scope (do / don't do)

**ทำ:**
- WebSocket connection สำหรับ real-time notification ไปที่ browser
- Bell icon บน navbar ที่แสดง unread count + dropdown .list
- Notification page ที่ list ทั้งหมด + mark as read / mark all as read
- Backend: notification table (_prisma_) + API endpoints (GET /notifications, PATCH /notifications/:id/read)
- สร้าง notification record เมื่อเกิด event (new task, assignment, comment)

**ไม่ทำ:**
- ไม่ทำ push notification บน mobile (ไม่มี mobile app ตอนนี้)
- ไม่ทำ email digest — ต้องเร็ว ไม่ใช่ summarize รายวัน
- ไม่ทำ notification preferences (mute/unmute) — user รับทุกอย่างก่อน ค่อย filter ทีหลัง
- ไม่ refactor notification เป็น microservice — monolith พอสำหรับ scale ตอนนี้

## 3. Done criteria (how we know it's finished)

- `npx prisma migrate dev` สร้าง notifications table สำเร็จ
- เปิด browser tab 2 หน้า → assign task ใน tab 1 → bell icon ใน tab 2 ขึ้น count ภายใน 2 วินาที
- คลิก bell → dropdown แสดง notification ใหม่ล่าสุด
- คลิก notification → navigate ไปหน้า task ที่เกี่ยวข้อง + mark as read
- ไปหน้า /notifications → เห็น list ทั้งหมด + unread ขึ้น bold
- คลิก "Mark all as read" → unread count หาย + ทุก item ไม่ bold
- `npm run typecheck` ผ่าน, `npm test` ไม่มี test ใหม่ fail

## 4. Constraints / Hard rules (must not violate)

- ห้ามใช้ third-party push service (Firebase, OneSignal) — ต้อง WebSocket ล้วน ไม่เพิ่ม infra
- ห้ามเก็บ notification payload เป็น JSON blob — ต้องมี foreign key กลับไป source entity (task, comment)
- ห้าม re-fetch ทั้ง list ทุกครั้งที่มี notification ใหม่ — ใช้ WebSocket push เฉพาะ delta
- ห้าม query notifications table โดยไม่มี index บน `(user_id, read_at)` — table จะโตเร็ว
- ห้าม让用户 dismiss notification ได้ — มีแค่ read/unread state ไม่ใช่ archive

## 5. Risks & Escape hatches (if it fails)

| เสี่ยง | โอกาส | ผลกระทบ | ทางหนี |
|---|---|---|---|
| WebSocket connection หลุดบ่อย (mobile browser, sleep tab) | สูง | user ไม่ได้รับ notification | fallback: polling ทุก 30 วินาทีเมื่อ WebSocket ไม่ connected |
| notifications table โตเร็ว (task activity สูง) | กลาง | query ช้า | เพิ่ม index + TTL cleanup job (delete unread > 30 วัน) |
| Race condition: read พร้อม push | ต่ำ | notification หายจาก list | use DB transaction + optimistic locking บน updated_at |
| Browser หลาย tab conflict WebSocket | ต่ำ | duplicate notification | use BroadcastChannel API ให้ tab หลัก handle WS เดียว |

## 6. Steps (what in which order)

1. **Prisma schema + migration** — สร้าง notifications table + index · verify: `npx prisma migrate dev` สำเร็จ + `npx prisma db seed` ใส่ test data ได้
2. **Backend API** — GET /notifications (paginated), PATCH /:id/read, POST /notifications/read-all · verify: `curl` ทั้ง 3 endpoint ได้ response ถูก
3. **WebSocket server** — เพิ่ม WS handler บน existing server, broadcast เมื่อสร้าง notification · verify: test script connect WS + trigger notification ได้รับ event
4. **Frontend: Bell icon + dropdown** — component ที่ navbar, connect WS, update unread count real-time · verify: เปิด 2 tabs → assign → bell ขึ้น
5. **Frontend: Notification page** — /notifications route, list + mark read + mark all · verify: navigate ได้ + interaction ทำงาน
6. **E2E test** — test script ที่ simulates full flow · verify: `npm run test:e2e` ผ่าน

## 7. Examples (make it concrete)

```bash
# Prisma migration
npx prisma migrate dev --name add-notifications

# Backend: curl test
curl -X GET http://localhost:3000/api/notifications \
  -H "Authorization: Bearer $TOKEN" | jq '.[0]'
# → { "id": 1, "type": "task_assigned", "read_at": null, ... }

# WebSocket connect + trigger
node -e "
  const ws = new WebSocket('ws://localhost:3000');
  ws.on('message', d => console.log(JSON.parse(d)));
  // trigger: assign task in another tab
"

# Frontend: manual check
open http://localhost:3000/notifications
# → see list, unread items bold, mark all button works
```

## 8. References

- [spec/notifications.md](../spec/notifications.md) — API contract + entity schema
- [templates/PLAN.md](../templates/PLAN.md) — Plan Core template
- [skill/plan-with-me.md](../skill/plan-with-me.md) — วิธีสร้าง plan นี้
