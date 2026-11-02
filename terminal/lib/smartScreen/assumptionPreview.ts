/**
 * Assumption preview (J6 candidate) — "what would ONE threshold change have done?"
 *
 * A saved screen (A) and an unsaved trial copy of it (B) that differs in exactly one numeric
 * leaf are both evaluated over the SAME deliberately captured scan, and the overlap is named:
 * matched by both, A-only, B-only, plus the coverage that can never be read as entries/exits
 * (unknown / failed / unpriced / out of scope). This answers a threshold assumption; it is NOT
 * a history — nothing here says a name "entered" or "exited" in time.
 *
 * Boundaries this module keeps by construction:
 *  • Pure. No I/O, no storage, no clock, no fetch. The component and the panel own the capture
 *    moment; this file only transforms what it is handed.
 *  • ONE grammar. Evaluation, canonicalization and hashing are always delegated to the owner
 *    module (`predicate.ts`): a trial definition is built structurally and then re-validated
 *    with `normalizeDefinition`, never re-implemented here. Current grammar v1 ONLY — anything
 *    newer is refused with an explicit reason, never downgraded or silently dropped.
 *  • ONE input. `compareDefinitions` takes a single rows array, so the two recipes are
 *    structurally unable to classify different rows or different generations.
 *  • Nothing mutates. The saved definition is cloned before any edit; untouched leaves, scope
 *    and group structure are carried through byte-for-byte into the trial draft.
 */

import {
  classifyRow, groupParts, isGroup, normalizeDefinition, NUMBER_FIELDS,
  type Group, type NumberField, type NumberLeaf, type RowStatus, type ScreenDefinition,
  type ScreenNode, type ScreenRow,
} from "./predicate";

/** The only grammar this preview interprets. `predicate.ts` owns the value; restated here as
 *  the refusal boundary so a newer grammar is REFUSED, not guessed at. */
export const ASSUMPTION_GRAMMAR = 1 as const;

/** Readable refusal boundary for a threshold. `normalizeDefinition` enforces the same numeric
 *  bound when the trial draft is re-validated; stating it here lets the UI refuse a value with
 *  a named reason instead of an opaque normalize error. */
export const MAX_THRESHOLD_ABS = 1e15;

/** Every rendered list is bounded at this many symbols, with the remainder counted, so a broad
 *  screen cannot render an unbounded page. */
export const PREVIEW_LIST_CAP = 60;

// ── enumerating the numeric leaves of a definition ───────────────────────────────────────

/** Where one leaf sits inside `def.where`: index steps from the root group plus a stable,
 *  human-readable key (`where.all[2]`, `where.all[0].any[1]`). The stored definition is already
 *  canonical (flattened, sorted, deduped), so these indexes are stable for a given record. */
export type LeafPath = { readonly key: string; readonly steps: readonly number[] };

export type NumericLeafRef = { readonly path: LeafPath; readonly leaf: NumberLeaf };

const isNumberLeaf = (node: ScreenNode): node is NumberLeaf =>
  !isGroup(node)
  && (NUMBER_FIELDS as readonly string[]).includes(node.f)
  && (node.op === "gte" || node.op === "lte");

function walk(node: ScreenNode, steps: number[], key: string, out: NumericLeafRef[]): void {
  if (isGroup(node)) {
    const [kind, items] = groupParts(node);
    items.forEach((child, i) => walk(child, [...steps, i], `${key}.${kind}[${i}]`, out));
    return;
  }
  if (isNumberLeaf(node)) out.push({ path: { key, steps }, leaf: node });
}

/** The numeric leaves a threshold trial may target, in canonical order. Enum, boolean and
 *  present-leaves are deliberately NOT listed (the trial only changes numeric thresholds) and
 *  are just as deliberately never dropped: `buildTrialDefinition` clones the whole tree. */
export function listNumericLeaves(def: ScreenDefinition): NumericLeafRef[] {
  const out: NumericLeafRef[] = [];
  if (def.grammar !== ASSUMPTION_GRAMMAR) return out; // unsupported grammar: nothing is offered
  walk(def.where, [], "where", out);
  return out;
}

// ── building the trial definition B ──────────────────────────────────────────────────────

export type PreviewRefusal =
  | "grammar_newer" | "grammar_invalid" | "no_numeric_leaf" | "leaf_not_found"
  | "bad_op" | "bad_threshold" | "not_normalized";

export type TrialResult =
  | { ok: true; def: ScreenDefinition; canonical: string; hash: string }
  | { ok: false; reason: PreviewRefusal };

/** First refusal an assumption preview must make: this candidate interprets current grammar v1
 *  only. A record written by a newer Terminal is refused by name — it is never coerced, and
 *  its fund/technical/enum leaves are never quietly reinterpreted under v1 rules. */
export function checkSupportedGrammar(def: ScreenDefinition): PreviewRefusal | null {
  if (def.grammar === ASSUMPTION_GRAMMAR) return null;
  return def.grammar > ASSUMPTION_GRAMMAR ? "grammar_newer" : "grammar_invalid";
}

function replaceAt(node: ScreenNode, steps: readonly number[], i: number, next: NumberLeaf): ScreenNode {
  if (!isGroup(node)) return next; // the path was validated against this same tree
  const [kind, items] = groupParts(node);
  const idx = steps[i];
  const rebuilt = items.map((child, j) => (j === idx ? replaceAt(child, steps, i + 1, next) : child));
  return kind === "all" ? { all: rebuilt } : { any: rebuilt };
}

/**
 * B = A with exactly one numeric leaf's threshold (and only its threshold) changed.
 *
 * The saved definition is deep-cloned, the selected leaf is swapped for `{ f, op, v }`, and the
 * draft is re-validated with the owner's `normalizeDefinition` — so B's canonical form and hash
 * come from the same law that produced A's, never from a local re-implementation. Scope, group
 * structure and every untouched predicate are carried through the clone unchanged.
 */
export function buildTrialDefinition(def: ScreenDefinition, path: LeafPath, op: "gte" | "lte", v: number): TrialResult {
  const grammarRefusal = checkSupportedGrammar(def);
  if (grammarRefusal) return { ok: false, reason: grammarRefusal };
  if (op !== "gte" && op !== "lte") return { ok: false, reason: "bad_op" };
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > MAX_THRESHOLD_ABS) return { ok: false, reason: "bad_threshold" };

  const target = listNumericLeaves(def).find((ref) => ref.path.key === path.key);
  if (!target) return { ok: false, reason: path.key ? "leaf_not_found" : "no_numeric_leaf" };

  if (op !== target.leaf.op) return { ok: false, reason: "bad_op" };

  // Plain-JSON clone: a normalized definition is JSON by construction (canonical form is JSON).
  const draft = JSON.parse(JSON.stringify(def)) as ScreenDefinition;
  draft.where = replaceAt(draft.where, target.path.steps, 0, { f: target.leaf.f, op, v: v === 0 ? 0 : v }) as Group;

  const normalized = normalizeDefinition(draft);
  if (!normalized.ok) return { ok: false, reason: "not_normalized" };
  return { ok: true, def: normalized.def, canonical: normalized.canonical, hash: normalized.hash };
}

// ── the frozen capture ───────────────────────────────────────────────────────────────────

export type AssumptionCapture = {
  readonly screenId: string;
  readonly name: string;
  /** Recipe A: the saved definition, read-only. Never mutated by this module. */
  readonly def: ScreenDefinition;
  /** The scan generation at capture — the ONLY as-of the comparison may claim. */
  readonly asOf: string;
  /** Frozen copy of the captured rows: the only rows the comparison reads, however the panel's
   *  own scan changes afterwards. */
  readonly rows: readonly ScreenRow[];
  /** The panel's live rows array at capture — drift detection only, never evaluated. */
  readonly sourceRows: readonly ScreenRow[];
};

/** Freeze only our detached JSON definition, never caller-owned data. */
function freezeDefinition<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDefinition(child);
    Object.freeze(value);
  }
  return value;
}

/** Freeze the capture ONCE, on the deliberate open. No I/O happens here: the caller hands over
 *  rows it already holds in memory. */
export function captureAssumptionSnapshot(input: {
  screenId: string; name: string; def: ScreenDefinition; asOf: string; rows: readonly ScreenRow[];
}): AssumptionCapture {
  return Object.freeze({
    screenId: input.screenId,
    name: input.name,
    def: freezeDefinition(JSON.parse(JSON.stringify(input.def)) as ScreenDefinition),
    asOf: input.asOf,
    rows: Object.freeze(input.rows.map((row) => Object.freeze({ ...row }))),
    sourceRows: input.rows,
  });
}

// ── A/B comparison over the captured rows ────────────────────────────────────────────────

export type PreviewBucket = "both" | "aOnly" | "bOnly" | "unknown" | "failed" | "unpriced" | "outOfScope";

export type PreviewComparison = {
  /** Rows in the capture — the single population both recipes classified. */
  readonly population: number;
  readonly counts: Readonly<Record<PreviewBucket, number>>;
  /** Symbols per bucket, capped at `PREVIEW_LIST_CAP`. */
  readonly lists: Readonly<Record<PreviewBucket, readonly string[]>>;
  /** How many symbols per bucket are not shown because of the cap. */
  readonly hidden: Readonly<Record<PreviewBucket, number>>;
};

/**
 * Where the two recipes disagree over ONE captured population. The single `rows` parameter is
 * the design guard against mixed generations: there is no second argument to pass a different
 * row set to.
 *
 * Buckets are overlap labels, NOT historical entries/exits: "bOnly" means "B matches this
 * captured row and A does not", nothing about time. A row that either recipe could not truly
 * evaluate lands in a coverage bucket — a missing field is `unknown`, never `false`.
 */
export function compareDefinitions(defA: ScreenDefinition, defB: ScreenDefinition, rows: readonly ScreenRow[]): PreviewComparison {
  const syms: Record<PreviewBucket, string[]> = {
    both: [], aOnly: [], bOnly: [], unknown: [], failed: [], unpriced: [], outOfScope: [],
  };
  for (const row of rows) {
    const a: RowStatus = classifyRow(defA, row).status;
    const b: RowStatus = classifyRow(defB, row).status;
    syms[bucketFor(a, b)].push(row.sym);
  }
  const counts = {} as Record<PreviewBucket, number>;
  const lists = {} as Record<PreviewBucket, readonly string[]>;
  const hidden = {} as Record<PreviewBucket, number>;
  for (const bucket of Object.keys(syms) as PreviewBucket[]) {
    counts[bucket] = syms[bucket].length;
    lists[bucket] = Object.freeze(syms[bucket].slice(0, PREVIEW_LIST_CAP));
    hidden[bucket] = Math.max(0, syms[bucket].length - PREVIEW_LIST_CAP);
  }
  return { population: rows.length, counts: Object.freeze(counts), lists: Object.freeze(lists), hidden: Object.freeze(hidden) };
}

function bucketFor(a: RowStatus, b: RowStatus): PreviewBucket {
  if (a === "match" && b === "match") return "both";
  // A one-sided match is a difference only if the other recipe actually fails. Name WHY, in the conservative order: outside the population first,
  // then unpriced, then missing data — a row whose field is missing stays `unknown` even if the
  // other recipe evaluated to false, because unknown is not false.
  if (a === "out_of_scope" || b === "out_of_scope") return "outOfScope";
  if (a === "unpriced" || b === "unpriced") return "unpriced";
  if (a === "unknown" || b === "unknown") return "unknown";
  if (a === "match") return "aOnly";
  if (b === "match") return "bOnly";
  return "failed";
}

/** The numeric field of a leaf, for the UI's unit-aware formatting. */
export const numericFieldOf = (leaf: NumberLeaf): NumberField => leaf.f;
