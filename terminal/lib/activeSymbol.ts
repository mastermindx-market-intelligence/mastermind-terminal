"use client";
/**
 * activeSymbol.ts — THE cross-route cursor for "the company I am looking at right now".
 *
 * ── The bug this exists to close ───────────────────────────────────────────────────────────
 *
 * Every workspace resolved its own symbol from its own URL, and nothing carried the symbol
 * ACROSS a navigation. So a user on `/terminal` charting SMR who opened Analysis from the
 * mobile drawer landed on a bare `/analysis`, whose composer had no symbol to work from and
 * fell back to its literal default — NVDA. The user had not asked for NVDA, had never looked
 * at NVDA, and got a full company-intelligence read on the wrong company. The same hole runs
 * the other way: change the company on `/analysis` and the chart still opens on its own
 * landing symbol.
 *
 * The fix is a single device-local cursor that every symbol-bearing surface publishes to and
 * every symbol-bearing surface can seed from. It is deliberately NOT a router concern: a
 * client-side `<Link>` is rendered long before it is clicked, and the workspace that owns the
 * symbol is not the component that renders the nav.
 *
 * ── Why device-local, and not owner-scoped ─────────────────────────────────────────────────
 *
 * This is a UI cursor, not owned data: it names where you are, not what you own. It follows
 * `lib/recentlyViewed.ts` (same shape of state, same deliberate choice) rather than
 * `lib/watchlistOwner.ts`. Nothing is disclosed by it that the same browser's Recently Viewed
 * list does not already hold, and scoping a cursor per account would leave a signed-out tab
 * and a signed-in tab in the same browser disagreeing about which company is on screen.
 *
 * ── Why composites are refused ─────────────────────────────────────────────────────────────
 *
 * `AAPL+MSFT` is a valid CHART subject and is not a company: there is no `/analysis` page, no
 * fundamentals and no intelligence read for it. Writing one here would hand `/analysis` a
 * symbol it must then reject, which is the NVDA fallback all over again. A composite chart
 * therefore leaves the cursor on the last real company — the most useful thing Analysis can
 * open on — and the rule lives HERE, at the boundary, rather than at each call site.
 */
import { useSyncExternalStore } from "react";
import { canonicalChartSymbol } from "./terminalBoot";

export const ACTIVE_SYMBOL_KEY = "mm.activeSymbol";
/** Same-tab change notification. `storage` only fires in OTHER tabs, so both are needed. */
export const ACTIVE_SYMBOL_EVENT = "mm:active-symbol";

/**
 * The cursor's grammar: a canonical chart symbol that is not a composite expression.
 * `null` = "no usable cursor", never a string to navigate with.
 */
export function normalizeActiveSymbol(value: unknown): string | null {
  const symbol = canonicalChartSymbol(value);
  if (!symbol || symbol.includes("+")) return null;
  return symbol;
}

function readStorage(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return normalizeActiveSymbol(localStorage.getItem(ACTIVE_SYMBOL_KEY));
  } catch {
    // Private-mode / blocked site data. A cursor is a convenience; its absence is not an error.
    return null;
  }
}

// `useSyncExternalStore` calls getSnapshot on every render and compares with Object.is, so the
// read has to be both cheap and stable. `undefined` = "not read yet"; EVERY notification path
// invalidates it, so the cache can never outlive the value it mirrors.
//
// "Every" is load-bearing, not belt-and-braces. The bundler does not guarantee one instance of
// this module across chunks — the chart shell and the nav rail are in different ones — and a
// second copy holding its own `cache` would never see the writer's in-memory update. Measured:
// the drawer's Analysis link stayed bare while `mm.activeSymbol` in the SAME tab already read
// AAPL. localStorage is the source of truth; this variable is only a memo of it, so a change
// notification always drops it and the next read goes back to storage.
let cache: string | null | undefined;

/** The current cursor, or `null` when nothing usable is stored. */
export function readActiveSymbol(): string | null {
  if (cache === undefined) cache = readStorage();
  return cache;
}

/**
 * Publish the cursor. A value that is not a usable single-instrument symbol (a composite, a
 * path-like string, an empty field) is IGNORED rather than stored — see the module note.
 * Writing the value already held is a no-op, so a re-render storm cannot churn listeners.
 */
export function writeActiveSymbol(value: unknown): void {
  const symbol = normalizeActiveSymbol(value);
  if (!symbol || symbol === readActiveSymbol()) return;
  cache = symbol;
  try { localStorage.setItem(ACTIVE_SYMBOL_KEY, symbol); } catch {}
  try {
    window.dispatchEvent(new CustomEvent<string>(ACTIVE_SYMBOL_EVENT, { detail: symbol }));
  } catch {}
}

/** Subscribe to cursor changes in this tab AND in the browser's other tabs. */
export function subscribeActiveSymbol(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = () => { cache = undefined; onChange(); };
  const cross = (e: StorageEvent) => {
    // A `null` key is a storage.clear() — it invalidates every key, this one included.
    if (e.key !== null && e.key !== ACTIVE_SYMBOL_KEY) return;
    cache = undefined;
    onChange();
  };
  window.addEventListener(ACTIVE_SYMBOL_EVENT, local);
  window.addEventListener("storage", cross);
  return () => {
    window.removeEventListener(ACTIVE_SYMBOL_EVENT, local);
    window.removeEventListener("storage", cross);
  };
}

/** Test seam: drop the memoized read so a fresh localStorage state is observed. */
export function resetActiveSymbolCache(): void {
  cache = undefined;
}

/**
 * The cursor as React state, live across tabs.
 *
 * The server snapshot is `null` by contract: localStorage does not exist there, so any other
 * answer would be a hydration mismatch. Consumers must render correctly with no cursor — the
 * nav links simply omit `?symbol=` until hydration, which costs nothing because a link cannot
 * be clicked before it is interactive.
 */
export function useActiveSymbol(): string | null {
  return useSyncExternalStore(subscribeActiveSymbol, readActiveSymbol, () => null);
}
