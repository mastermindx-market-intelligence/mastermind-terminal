// Mastermind Chart Engine — browser-side storage adapter for the engine preference.
//
// select.ts is sold on being a pure resolver whose SOURCE never references browser
// globals (chartEngineSelect.test.ts's purity case enforces that). This module is the
// only place in the selection corner allowed to reach for the host's storage object,
// so resolveMountEngineSelection can default its storage parameter to
// browserEngineStorage() without select.ts itself touching a global.
//
// The contract is two-valued and SSR-safe: a usable EngineStorage, or null meaning
// "this environment has no engine storage". null is returned when there is no window
// at all (server render) AND when merely TOUCHING the storage object throws — hosts
// can raise on the property access itself (e.g. cookies disabled), so the try/catch
// sits around the access, not just around later calls. Per-operation failures
// (quota, private mode on getItem/setItem) are deliberately NOT masked here: the
// never-throwing read/persist wrappers in select.ts already swallow them, and hiding
// them twice would blur the invalid/denied distinction those wrappers report.

import type { EngineStorage } from "./select";

/**
 * The per-browser EngineStorage backing the "mm.engine" preference, or null when this
 * environment has none (server render, or the host denies storage access entirely).
 */
export function browserEngineStorage(): EngineStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
