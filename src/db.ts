// shim — re-export จาก src/db/index.ts เพื่อให้ import เดิม "./db.js" ใช้ได้
// ลบไฟล์นี้ได้เมื่อ migrate importers ทั้งหมดไป "./db/store.js" หรือ "./db/getters.js" ตรงๆ
export * from "./db/index.js";
