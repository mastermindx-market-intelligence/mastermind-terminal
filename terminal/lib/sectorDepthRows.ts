/** Shared primitives for the rows-increment readers (wire v1.1 §1–§4).
 *
 * The five new carried blocks (`confluence_universe_<u>` ×4, `theme_rows`)
 * arrive on the served typed surface as ENTRIES — `{ status, reason?, value }`
 * — and every reader in this lane takes that entry, never the bare value, so
 * the same classification serves lane 3's one-line mounts.
 *
 * Laws implemented here (frozen wire + consumer round order):
 *  • Closed reason set: `audience_not_entitled | not_produced | invalid_shape
 *    | block_too_large`. Any other reason — or a missing one — reads the
 *    generic `unknown`; a reason word is never rendered raw.
 *  • Own-property reads only: a value whose key arrives via the prototype
 *    (Object.create probes, JSON `__proto__` keys) never resolves. An own
 *    `__proto__` key read through these helpers is data, not a prototype.
 *  • Envelope failures are whole-block failures (`invalid_shape`): there is no
 *    partial row set, ever.
 *  • Soft cells never invalidate a block: a non-finite or non-numeric number
 *    reads `null` (not stated), an absent allow-listed key stays absent, and
 *    unknown keys are ignored.
 *  • Never throws for any JSON-parsed value (N1: the readers sit behind
 *    JSON.parse; the claim is scoped to what a parsed document can hold, not
 *    to arbitrary JS objects such as cycles or getter-throwing proxies).
 */

import { isNavigableId } from "./sectorDepthCalls";

export type RowBlockReason =
  | "audience_not_entitled"
  | "not_produced"
  | "invalid_shape"
  | "block_too_large"
  | "unknown";

/** The closed reason set the served surface emits for the five row blocks. */
const KNOWN_REASONS: ReadonlySet<string> = new Set([
  "audience_not_entitled",
  "not_produced",
  "invalid_shape",
  "block_too_large",
]);

/** Own-property read: `undefined` for an absent key, the value otherwise —
 * never a value resolved through the prototype chain. */
export function ownOf(mapping: object, key: string): unknown {
  return Object.hasOwn(mapping, key) ? (mapping as Record<string, unknown>)[key] : undefined;
}

/** A plain mapping (not an array, not null). */
export function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Own string, `null` when absent or not a string (an empty string is kept —
 * callers decide whether empty fails their envelope). */
export function ownString(mapping: object, key: string): string | null {
  const v = ownOf(mapping, key);
  return typeof v === "string" ? v : null;
}

/** Own non-empty string, `null` otherwise — the wire's row-key / ticker / date
 * test. */
export function ownNonEmptyString(mapping: object, key: string): string | null {
  const v = ownString(mapping, key);
  return v !== null && v.length > 0 ? v : null;
}

/** Own finite number: `undefined` when the key is absent (absent stays
 * absent), `null` when present but not a finite number (finite numbers only). */
export function ownFinite(mapping: object, key: string): number | null | undefined {
  if (!Object.hasOwn(mapping, key)) return undefined;
  const v = (mapping as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Own boolean: `undefined` absent, `null` when not a boolean. */
export function ownBool(mapping: object, key: string): boolean | null | undefined {
  if (!Object.hasOwn(mapping, key)) return undefined;
  const v = (mapping as Record<string, unknown>)[key];
  return typeof v === "boolean" ? v : null;
}

/** Classified typed-block entry: either an own `status: "available"` with an
 * own mapping `value`, or the closed reason word. */
export type ClassifiedEntry =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: RowBlockReason };

/** Classify a served typed-block entry (the `{status, reason?, value}` the
 * route emits). Anything that is not an entry reads the generic unknown. */
export function classifyEntry(entry: unknown): ClassifiedEntry {
  if (!isMapping(entry)) return { ok: false, reason: "unknown" };
  const status = ownOf(entry, "status");
  if (status === "available") {
    const value = ownOf(entry, "value");
    return isMapping(value)
      ? { ok: true, value }
      : { ok: false, reason: "invalid_shape" };
  }
  if (status === "unavailable") {
    const reason = ownOf(entry, "reason");
    if (typeof reason === "string" && KNOWN_REASONS.has(reason)) {
      return { ok: false, reason: reason as RowBlockReason };
    }
    return { ok: false, reason: "unknown" };
  }
  return { ok: false, reason: "unknown" };
}

/** A chart key may compose a same-site detail link only when it satisfies the
 * existing navigable-id law (`isNavigableId`, single-sourced from the calls
 * reader) AND carries no `..` run — a key like `..` passes the id grammar but
 * must never become a path segment. N9: the FIRST character must also be a
 * letter or digit — ".", "-" and "_x" pass the id grammar yet compose no real
 * route segment ("/subsector/.html"). */
export function conformingChartKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    isNavigableId(key) &&
    !key.includes("..") &&
    /^[A-Za-z0-9]/.test(key)
  );
}
