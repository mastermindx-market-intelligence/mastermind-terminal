/**
 * sectorCallNavigation.ts — the lane-3 consumer side of the calls board's
 * navigation callback (COO order 2026-11-10 19:15Z, item 3).
 *
 * Lane 7's board emits a `CallsNavigateTarget` per actionable row — the
 * owner's same-site href beside the row's entity identity — and (with #1445)
 * emits NOTHING for a row whose id/ticker fails the identifier rule
 * `isNavigableId`. This module turns a fired target into the workspace's
 * routing decision, under three laws:
 *
 *   1. Route by kind+id, with the validated ticker riding along for
 *      symbol-keyed consumers. The workspace's subject selection is id-keyed
 *      (`change({ sector: id })`); company-level surfaces read the ticker.
 *   2. href is NEVER a route. This side never reads the field — not to
 *      route, not to validate — and the decision type has no href slot, so
 *      no downstream consumer can route by owner text. (Owner link targets
 *      are Macro static-site paths; COO ruling 2026-11-10 14:45Z.)
 *   3. The identifier rule is INJECTED, never re-derived here. One rule in
 *      the system: lane 7's `isNavigableId` from lib/sectorDepthCalls.ts,
 *      passed by the mount once #1445 is merged into this branch.
 *
 * `none` is a normal outcome — the decision-level analogue of the board
 * firing no callback — and nothing here throws: a malformed, hostile or
 * refused target simply produces no route. N-3 (third review): the same
 * silence covers a throwing INJECTED rule and a target whose property reads
 * trap (Proxy/getter) — the reader treats any throw mid-decision as "no
 * callback fired", never a propagated error.
 */
import type { CallsNavigateTarget } from "./sectorDepthCalls";

/** Lane 7's identifier rule, injected by the mount (`isNavigableId`). */
export type CallsIdRule = (value: string) => boolean;

/** A lawful target: select this entity. The only strings a route may be
 * built from are `id` (subject-keyed selection) and `ticker` (symbol-keyed
 * consumers); both arrived here validated. */
export interface CallsNavigateSelection {
  state: "select";
  kind: CallsNavigateTarget["kind"];
  id: string;
  ticker: string;
}

/** The board's callback decision: a selection, or nothing (normal silence). */
export type CallsNavigateDecision = CallsNavigateSelection | { state: "none" };

const has = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;

/**
 * Pure decision for a calls-board navigation target. Never throws; hostile
 * or refused input yields `{ state: "none" }`. Only OWN properties of the
 * target are read (prototype-chain values are not the board's emission),
 * only `kind`/`id`/`ticker` are examined, and the href is never touched.
 * N-3 (third review): a throwing injected rule or a trapped property read
 * (Proxy/getter) is caught and read as silence — `{ state: "none" }` —
 * because the reader cannot distinguish it from a board that fired nothing.
 */
export function callsNavigateDecision(
  target: CallsNavigateTarget | null | undefined,
  isNavigableId: CallsIdRule | null | undefined,
): CallsNavigateDecision {
  try {
    if (typeof target !== "object" || target === null || Array.isArray(target)) return { state: "none" };
    const kind = has(target, "kind");
    const id = has(target, "id");
    const ticker = has(target, "ticker");
    if (kind !== "theme" && kind !== "sector") return { state: "none" };
    if (typeof id !== "string" || typeof ticker !== "string") return { state: "none" };
    if (typeof isNavigableId !== "function") return { state: "none" };
    if (!isNavigableId(id) || !isNavigableId(ticker)) return { state: "none" };
    return { state: "select", kind, id, ticker };
  } catch {
    return { state: "none" };
  }
}
