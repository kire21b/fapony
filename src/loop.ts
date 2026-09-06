// src/loop.ts — shim for backward compatibility.
// All logic now lives in src/loop/index.ts + sibling modules.
// Keep this file so existing `from "./src/loop.js"` imports keep working.
export * from "./loop/index.js";
