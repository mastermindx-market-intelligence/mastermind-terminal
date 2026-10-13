/**
 * Reviewed-result references and on-demand changes for a smart screen (E04, AC-E04-05).
 *
 * "Mark reviewed" stores the SMALLEST reference that still lets a later generation say, with
 * proof, why a name entered or left:
 *
 *   - the definition hash it was evaluated under (predicate version + scope),
 *   - the universe id and the source generation (`asOf`) it was evaluated against,
 *   - the explicit list of matching symbols (an exit always needs the name), and
 *   - 128 bucket digests of the whole evaluated population, each a hash of the bucket's
 *     `symbol|state` pairs (state = m match, f evaluated-false, u unknown).
 *
 * No prices, no row data and no per-name history are retained. A later diff re-evaluates the
 * current generation with the same predicate module and classifies every change:
 *
 *   exits   — `exited` only when the current data PROVES the name now fails a condition (the
 *             failing leaves and their current values travel with it). A name that lost its
 *             price, left the data, changed market/asset class or now has a missing field is
 *             a coverage change, never an exit.
 *   entries — the bucket digests are used to PROVE the prior state of a new match: evaluated
 *             false (a genuine entry), unknown (newly evaluable) or outside the population
 *             (coverage gained). When no hypothesis reproduces the stored digest the entry is
 *             reported as unverified instead of guessed.
 *
 * Comparability is declared, not assumed: a diff is only computed when the definition, the
 * review format and the universe match, and the current generation is not older than the
 * reviewed one. A same-generation re-read is a correction and every change is labeled so.
 */

import { classifyRow, cyrb53, type LeafTrace, type RowStatus, type ScreenDefinition, type ScreenRow } from "./predicate";

export const REVIEW_VERSION = 1 as const;
export const REVIEW_BUCKETS = 128;
export const MAX_REVIEW_MATCHES = 1000;
export const MAX_POPULATION = 200_000;
/** The screener's universe: the published manifest the Terminal reads. */
export const SCREEN_UNIVERSE = "terminal.manifest";
const DIGEST_CHARS = 8;
const SYMBOL_RE = /^[^,|\s]{1,32}$/;

export type ReviewSnapshot = {
  v: 1;
  /** Definition hash the review was evaluated under. */
  hash: string;
  /** Universe id. */
  u: string;
  /** Source generation (the manifest `as_of`) the review was evaluated against. */
  asOf: string;
  /** Wall-clock time the user marked it reviewed. */
  at: string;
  /** Evaluated population size (match + fail + unknown). */
  pop: number;
  /** Sorted, comma-joined matching symbols. */
  m: string;
  /** REVIEW_BUCKETS × DIGEST_CHARS base-36 digests. */
  d: string;
};

/** FNV-1a 32-bit — the bucket a symbol lives in. Stable across devices and versions. */
export function bucketOf(sym: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < sym.length; i++) {
    h ^= sym.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % REVIEW_BUCKETS;
}

type State = "m" | "f" | "u";

function digestOf(entries: Map<string, State>): string {
  const lines = [...entries].map(([sym, state]) => `${sym}|${state}`).sort();
  // 40 bits of cyrb53, base 36 → exactly 8 chars.
  return (cyrb53(lines.join("\n")) % 1099511627776).toString(36).padStart(DIGEST_CHARS, "0");
}

const stateOf = (status: RowStatus): State | null =>
  status === "match" ? "m" : status === "fail" ? "f" : status === "unknown" ? "u" : null;

type Classified = { row: ScreenRow; status: RowStatus; trace: LeafTrace[] };

function classifyAll(def: ScreenDefinition, rows: readonly ScreenRow[]): Map<string, Classified> {
  const out = new Map<string, Classified>();
  for (const row of rows) {
    if (!row || typeof row.sym !== "string") continue;
    const { status, trace } = classifyRow(def, row);
    out.set(row.sym, { row, status, trace });
  }
  return out;
}

export type BuildReviewResult =
  | { ok: true; review: ReviewSnapshot; matches: number }
  | { ok: false; error: "generation_unknown" | "too_many_matches" | "population_too_large" | "bad_symbol"; count?: number };

export function buildReview(
  def: ScreenDefinition,
  hash: string,
  rows: readonly ScreenRow[],
  meta: { asOf: string | null; at?: string },
): BuildReviewResult {
  if (!validGeneration(meta.asOf)) return { ok: false, error: "generation_unknown" };
  const classified = classifyAll(def, rows);
  const buckets: Map<string, State>[] = Array.from({ length: REVIEW_BUCKETS }, () => new Map());
  const matches: string[] = [];
  let pop = 0;
  for (const [sym, { status }] of classified) {
    const state = stateOf(status);
    if (!state) continue;
    // A symbol the reference format cannot carry cannot be reviewed — refuse, never drop it.
    if (!SYMBOL_RE.test(sym)) return { ok: false, error: "bad_symbol" };
    pop++;
    buckets[bucketOf(sym)].set(sym, state);
    if (state === "m") matches.push(sym);
  }
  if (matches.length > MAX_REVIEW_MATCHES) return { ok: false, error: "too_many_matches", count: matches.length };
  if (pop > MAX_POPULATION) return { ok: false, error: "population_too_large", count: pop };
  matches.sort();
  return {
    ok: true,
    matches: matches.length,
    review: {
      v: REVIEW_VERSION,
      hash,
      u: SCREEN_UNIVERSE,
      asOf: meta.asOf as string,
      at: meta.at ?? new Date().toISOString(),
      pop,
      m: matches.join(","),
      d: buckets.map(digestOf).join(""),
    },
  };
}

const validGeneration = (asOf: unknown): asOf is string =>
  typeof asOf === "string" && asOf.length <= 32 && /^\d{4}-\d{2}-\d{2}/.test(asOf) && Number.isFinite(Date.parse(asOf));

export type ReviewError = "not_object" | "unsupported" | "hash_mismatch" | "bad_field";

/** Validate an untrusted review reference against the definition hash it claims. Used by the
 *  API before storing one and by the client before trusting one read back. */
export function normalizeReview(input: unknown, expectedHash: string): { ok: true; review: ReviewSnapshot } | { ok: false; error: ReviewError } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "not_object" };
  const r = input as Record<string, unknown>;
  for (const key of Object.keys(r)) if (!["v", "hash", "u", "asOf", "at", "pop", "m", "d"].includes(key)) return { ok: false, error: "bad_field" };
  if (r.v !== REVIEW_VERSION) return { ok: false, error: "unsupported" };
  if (r.hash !== expectedHash) return { ok: false, error: "hash_mismatch" };
  if (r.u !== SCREEN_UNIVERSE) return { ok: false, error: "bad_field" };
  if (!validGeneration(r.asOf)) return { ok: false, error: "bad_field" };
  if (typeof r.at !== "string" || r.at.length > 40 || !Number.isFinite(Date.parse(r.at))) return { ok: false, error: "bad_field" };
  if (typeof r.pop !== "number" || !Number.isInteger(r.pop) || r.pop < 0 || r.pop > MAX_POPULATION) return { ok: false, error: "bad_field" };
  if (typeof r.m !== "string") return { ok: false, error: "bad_field" };
  const syms = r.m ? r.m.split(",") : [];
  if (syms.length > MAX_REVIEW_MATCHES || syms.length > r.pop) return { ok: false, error: "bad_field" };
  for (let i = 0; i < syms.length; i++) {
    if (!SYMBOL_RE.test(syms[i]) || (i > 0 && syms[i - 1] >= syms[i])) return { ok: false, error: "bad_field" };
  }
  if (typeof r.d !== "string" || r.d.length !== REVIEW_BUCKETS * DIGEST_CHARS || !/^[0-9a-z]+$/.test(r.d)) return { ok: false, error: "bad_field" };
  return {
    ok: true,
    review: { v: REVIEW_VERSION, hash: r.hash, u: r.u, asOf: r.asOf, at: r.at, pop: r.pop, m: r.m, d: r.d },
  };
}

// ── comparability ───────────────────────────────────────────────────────────────────────

export type NotComparable =
  | "data_unavailable" | "no_review" | "review_unsupported" | "definition_changed"
  | "universe_changed" | "generation_unknown" | "older_data";
export type Comparability =
  | { ok: true; correction: boolean; fromAsOf: string; toAsOf: string }
  | { ok: false; reason: NotComparable };

export function comparability(
  review: ReviewSnapshot | null | undefined,
  current: { hash: string; asOf: string | null; dataReady: boolean },
): Comparability {
  if (!current.dataReady) return { ok: false, reason: "data_unavailable" };
  if (!review) return { ok: false, reason: "no_review" };
  if (review.v !== REVIEW_VERSION) return { ok: false, reason: "review_unsupported" };
  if (review.hash !== current.hash) return { ok: false, reason: "definition_changed" };
  if (review.u !== SCREEN_UNIVERSE) return { ok: false, reason: "universe_changed" };
  if (!validGeneration(review.asOf) || !validGeneration(current.asOf)) return { ok: false, reason: "generation_unknown" };
  const from = Date.parse(review.asOf);
  const to = Date.parse(current.asOf);
  if (to < from) return { ok: false, reason: "older_data" };
  return { ok: true, correction: to === from, fromAsOf: review.asOf, toAsOf: current.asOf };
}

// ── the diff ────────────────────────────────────────────────────────────────────────────

export type ChangeKind =
  // left the result set
  | "exited" | "not_evaluable" | "coverage_lost" | "out_of_scope"
  // joined the result set
  | "entered" | "newly_evaluable" | "coverage_gained" | "unverified";
export type ChangeGroup = "entered" | "exited" | "coverage" | "unverified";

export const CHANGE_GROUP: Record<ChangeKind, ChangeGroup> = {
  exited: "exited",
  entered: "entered",
  not_evaluable: "coverage",
  coverage_lost: "coverage",
  out_of_scope: "coverage",
  newly_evaluable: "coverage",
  coverage_gained: "coverage",
  unverified: "unverified",
};

export type ScreenChange = {
  sym: string;
  kind: ChangeKind;
  group: ChangeGroup;
  direction: "in" | "out";
  /** The current row's status (`absent` = not in the current data at all). */
  now: RowStatus | "absent";
  /** The current per-condition evaluation — the retained predicate applied to current data. */
  trace: LeafTrace[];
  /** Leaves that decide the change: the failing ones for an exit, the missing ones for a
   *  not-evaluable exit, every leaf for an entry. */
  because: LeafTrace[];
  /** Same-generation change: the data for the reviewed `asOf` was republished. */
  correction: boolean;
};

export type ScreenDiff =
  | { ok: false; reason: NotComparable }
  | {
    ok: true;
    correction: boolean;
    fromAsOf: string;
    toAsOf: string;
    reviewedAt: string;
    changes: ScreenChange[];
    stayed: number;
    matchesNow: number;
    populationNow: number;
    populationThen: number;
  };

/** Every assignment of prior states to a bucket's new matches that we are willing to test. */
function* hypotheses(count: number): Generator<(State | null)[]> {
  const options: (State | null)[] = ["f", "u", null];
  if (count <= 4) {
    const total = 3 ** count;
    for (let n = 0; n < total; n++) {
      const combo: (State | null)[] = [];
      let k = n;
      for (let i = 0; i < count; i++) { combo.push(options[k % 3]); k = Math.floor(k / 3); }
      yield combo;
    }
    return;
  }
  for (const option of options) yield Array.from({ length: count }, () => option);
}

export function diffScreen(
  def: ScreenDefinition,
  hash: string,
  review: ReviewSnapshot | null | undefined,
  rows: readonly ScreenRow[],
  current: { asOf: string | null; dataReady: boolean },
): ScreenDiff {
  const comp = comparability(review, { hash, asOf: current.asOf, dataReady: current.dataReady });
  if (!comp.ok) return comp;
  const reviewed = review as ReviewSnapshot;
  const classified = classifyAll(def, rows);
  const priorMatches = new Set(reviewed.m ? reviewed.m.split(",") : []);
  const changes: ScreenChange[] = [];
  const correction = comp.correction;
  let stayed = 0;
  let matchesNow = 0;
  let populationNow = 0;

  // Current population per bucket, and the new matches each bucket must explain.
  const buckets: Map<string, State>[] = Array.from({ length: REVIEW_BUCKETS }, () => new Map());
  const newMatches: string[][] = Array.from({ length: REVIEW_BUCKETS }, () => []);
  for (const [sym, { status }] of classified) {
    const state = stateOf(status);
    if (!state) continue;
    populationNow++;
    buckets[bucketOf(sym)].set(sym, state);
    if (state === "m") {
      matchesNow++;
      if (priorMatches.has(sym)) stayed++;
      else newMatches[bucketOf(sym)].push(sym);
    }
  }

  // Exits: the prior state is explicit (a match), so every one is classified from current data.
  for (const sym of priorMatches) {
    const hit = classified.get(sym);
    if (hit?.status === "match") continue;
    let kind: ChangeKind;
    let because: LeafTrace[] = [];
    if (!hit) kind = "coverage_lost";
    else if (hit.status === "unpriced") kind = "coverage_lost";
    else if (hit.status === "out_of_scope") kind = "out_of_scope";
    else if (hit.status === "unknown") { kind = "not_evaluable"; because = hit.trace.filter((leaf) => leaf.result === null); }
    else { kind = "exited"; because = hit.trace.filter((leaf) => leaf.result === false); }
    changes.push({
      sym, kind, group: CHANGE_GROUP[kind], direction: "out", now: hit ? hit.status : "absent",
      trace: hit?.trace ?? [], because, correction,
    });
  }

  // Entries: prove the prior state from the bucket digest, or say it is unverified.
  const priorByBucket: string[][] = Array.from({ length: REVIEW_BUCKETS }, () => []);
  for (const sym of priorMatches) priorByBucket[bucketOf(sym)].push(sym);
  for (let b = 0; b < REVIEW_BUCKETS; b++) {
    const entrants = newMatches[b];
    if (!entrants.length) continue;
    const stored = reviewed.d.slice(b * DIGEST_CHARS, (b + 1) * DIGEST_CHARS);
    // What we KNOW about the reviewed bucket: every prior match was a match. Everything else
    // in the bucket is hypothesized unchanged; the entrants are what we are solving for.
    const known = new Map(buckets[b]);
    for (const sym of priorByBucket[b]) known.set(sym, "m");
    const proofs: (State | null)[][] = [];
    for (const combo of hypotheses(entrants.length)) {
      const prior = new Map(known);
      entrants.forEach((sym, i) => {
        const state = combo[i];
        if (state === null) prior.delete(sym);
        else prior.set(sym, state);
      });
      if (digestOf(prior) === stored) proofs.push(combo);
      if (proofs.length > 1) break;
    }
    const proof = proofs.length === 1 ? proofs[0] : null;
    entrants.forEach((sym, i) => {
      const hit = classified.get(sym) as Classified;
      const priorState = proof ? proof[i] : undefined;
      const kind: ChangeKind = priorState === "f" ? "entered" : priorState === "u" ? "newly_evaluable" : priorState === null ? "coverage_gained" : "unverified";
      changes.push({
        sym, kind, group: CHANGE_GROUP[kind], direction: "in", now: hit.status,
        trace: hit.trace, because: hit.trace, correction,
      });
    });
  }

  changes.sort((a, b) => (a.group === b.group ? (a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0) : GROUP_ORDER[a.group] - GROUP_ORDER[b.group]));
  return {
    ok: true,
    correction,
    fromAsOf: comp.fromAsOf,
    toAsOf: comp.toAsOf,
    reviewedAt: reviewed.at,
    changes,
    stayed,
    matchesNow,
    populationNow,
    populationThen: reviewed.pop,
  };
}

const GROUP_ORDER: Record<ChangeGroup, number> = { entered: 0, exited: 1, coverage: 2, unverified: 3 };
