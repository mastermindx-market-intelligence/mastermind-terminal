/**
 * Smart-screen predicate grammar v1 — the ONE interpretation of a saved screen (E04).
 *
 * Pure and dependency-light on purpose: the API route normalizes every definition it stores
 * with THIS module and the screener evaluates every row with THIS module, so the server and
 * the client cannot disagree about what a screen means (AC-E04-01). Nothing here is code,
 * a formula string or a natural-language score — a definition is a small typed tree over a
 * fixed list of admitted manifest fields, and anything else is rejected, never ignored.
 *
 * Null semantics (AC-E04-02). Every comparison is three-valued (Kleene logic): a leaf whose
 * field is missing on a row is UNKNOWN — not false. AND is false when any child is false,
 * else unknown when any child is unknown; OR is the mirror. A row whose result is unknown is
 * not a match (the table never shows it), but the diff layer reports a match that turned
 * unknown as "not evaluable now", never as a genuine exit.
 */

import { ALL_MARKETS, type MarketId } from "@/lib/markets";

export const GRAMMAR_VERSION = 1 as const;
export const MAX_DEPTH = 3;
export const MAX_LEAVES = 16;
export const MAX_ENUM_VALUES = 16;
export const MAX_CANONICAL_CHARS = 4096;
const MAX_ABS_NUMBER = 1e15;

export const NUMBER_FIELDS = ["last", "chg", "dv", "mcap", "offHi", "offLo"] as const;
export const ENUM_FIELDS = ["verdict", "gics"] as const;
export const BOOL_FIELDS = ["regimeBull"] as const;
export type NumberField = (typeof NUMBER_FIELDS)[number];
export type EnumField = (typeof ENUM_FIELDS)[number];
export type BoolField = (typeof BOOL_FIELDS)[number];
export type ScreenField = NumberField | EnumField | BoolField;

/** The Oracle verdict vocabulary the manifest publishes. Values outside it are rejected in a
 *  definition (a typo must not become a screen that silently never matches). */
export const VERDICT_VALUES = ["BUY", "CUT", "EARLY", "REBUY", "RECLAIM", "SELL", "STOP"] as const;
export const BUY_VERDICTS = ["BUY", "REBUY", "RECLAIM"] as const;
/** Manifest `sec` values a scope may name. */
export const ASSET_VALUES = ["Bonds", "Crypto", "Equities", "Forex", "Funds", "Futures", "Indices"] as const;
/** Asset classes whose price can never legitimately be 0 or negative — a 0 there is a missing
 *  print (cn-premarket-zero-ohlc law), so the row is treated as unpriced, not evaluated. */
const POSITIVE_PRICE_ASSETS = new Set(["Equities", "Funds", "Crypto", "Indices"]);
const GICS_RE = /^[A-Za-z][A-Za-z &,.'/-]{0,47}$/;

export type NumberLeaf = { f: NumberField; op: "gte" | "lte"; v: number };
export type EnumLeaf =
  | { f: EnumField; op: "in" | "nin"; v: string[] }
  | { f: EnumField; op: "present" };
export type BoolLeaf = { f: BoolField; op: "is"; v: boolean };
export type Leaf = NumberLeaf | EnumLeaf | BoolLeaf;
export type Group = { all: ScreenNode[] } | { any: ScreenNode[] };
export type ScreenNode = Leaf | Group;
export type ScreenScope = { markets: "all" | MarketId[]; asset: string | null; unpriced: boolean };
export type ScreenDefinition = { grammar: 1; scope: ScreenScope; where: Group };

export type NormalizeError =
  | "not_object" | "grammar_newer" | "grammar_invalid" | "unknown_key" | "bad_scope"
  | "unknown_field" | "unknown_op" | "bad_value" | "too_deep" | "too_many_leaves"
  | "empty_group" | "too_large";
export type NormalizeResult =
  | { ok: true; def: ScreenDefinition; canonical: string; hash: string }
  | { ok: false; error: NormalizeError; path: string };

// ── hashing (deterministic, identical in Node and every browser) ─────────────────────────

/** cyrb53 — a fast 53-bit string hash. Identity, not security: it names a definition or a
 *  bucket's membership so two devices can agree they are looking at the same thing. */
export function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const definitionHash = (canonical: string): string =>
  cyrb53(canonical).toString(16).padStart(14, "0");

// ── normalization ────────────────────────────────────────────────────────────────────────

const isObj = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const has = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

class Reject extends Error {
  constructor(readonly code: NormalizeError, readonly at: string) { super(code); }
}

function onlyKeys(value: Record<string, unknown>, allowed: string[], at: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Reject("unknown_key", `${at}.${key}`);
}

function normScope(raw: unknown): ScreenScope {
  if (!isObj(raw)) throw new Reject("bad_scope", "scope");
  onlyKeys(raw, ["markets", "asset", "unpriced"], "scope");
  let markets: ScreenScope["markets"];
  if (raw.markets === "all") markets = "all";
  else if (Array.isArray(raw.markets)) {
    const set = new Set<MarketId>();
    for (const m of raw.markets) {
      if (!has(ALL_MARKETS, m)) throw new Reject("bad_scope", "scope.markets");
      set.add(m);
    }
    if (!set.size) throw new Reject("bad_scope", "scope.markets");
    // Every market named is the same population as "all" — one spelling, one hash.
    markets = set.size === ALL_MARKETS.length ? "all" : [...set].sort();
  } else throw new Reject("bad_scope", "scope.markets");
  let asset: string | null = null;
  if (raw.asset !== null && raw.asset !== undefined) {
    if (!has(ASSET_VALUES, raw.asset)) throw new Reject("bad_scope", "scope.asset");
    asset = raw.asset;
  }
  if (raw.unpriced !== undefined && typeof raw.unpriced !== "boolean") throw new Reject("bad_scope", "scope.unpriced");
  return { markets, asset, unpriced: raw.unpriced === true };
}

function normLeaf(raw: Record<string, unknown>, at: string): Leaf {
  const f = raw.f;
  if (has(NUMBER_FIELDS, f)) {
    onlyKeys(raw, ["f", "op", "v"], at);
    if (raw.op !== "gte" && raw.op !== "lte") throw new Reject("unknown_op", `${at}.op`);
    const v = raw.v;
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > MAX_ABS_NUMBER) throw new Reject("bad_value", `${at}.v`);
    return { f, op: raw.op, v: v === 0 ? 0 : v };
  }
  if (has(ENUM_FIELDS, f)) {
    if (raw.op === "present") {
      onlyKeys(raw, ["f", "op"], at);
      return { f, op: "present" };
    }
    onlyKeys(raw, ["f", "op", "v"], at);
    if (raw.op !== "in" && raw.op !== "nin") throw new Reject("unknown_op", `${at}.op`);
    if (!Array.isArray(raw.v) || !raw.v.length || raw.v.length > MAX_ENUM_VALUES) throw new Reject("bad_value", `${at}.v`);
    const values = new Set<string>();
    for (const item of raw.v) {
      const ok = f === "verdict" ? has(VERDICT_VALUES, item) : typeof item === "string" && GICS_RE.test(item);
      if (!ok) throw new Reject("bad_value", `${at}.v`);
      values.add(item as string);
    }
    return { f, op: raw.op, v: [...values].sort() };
  }
  if (has(BOOL_FIELDS, f)) {
    onlyKeys(raw, ["f", "op", "v"], at);
    if (raw.op !== "is") throw new Reject("unknown_op", `${at}.op`);
    if (typeof raw.v !== "boolean") throw new Reject("bad_value", `${at}.v`);
    return { f, op: "is", v: raw.v };
  }
  throw new Reject("unknown_field", `${at}.f`);
}

type Counter = { leaves: number };

function normNode(raw: unknown, depth: number, at: string, counter: Counter): ScreenNode {
  if (!isObj(raw)) throw new Reject("not_object", at);
  if ("all" in raw || "any" in raw) return normGroup(raw, depth, at, counter);
  counter.leaves++;
  if (counter.leaves > MAX_LEAVES) throw new Reject("too_many_leaves", at);
  return normLeaf(raw, at);
}

function normGroup(raw: Record<string, unknown>, depth: number, at: string, counter: Counter): Group {
  if (depth > MAX_DEPTH) throw new Reject("too_deep", at);
  const kind = "all" in raw ? "all" : "any";
  onlyKeys(raw, [kind], at);
  const list = raw[kind];
  if (!Array.isArray(list)) throw new Reject("bad_value", `${at}.${kind}`);
  if (list.length > MAX_LEAVES) throw new Reject("too_many_leaves", `${at}.${kind}`);
  // Only the ROOT may be an empty AND ("everything in scope"). An empty nested group or an
  // empty OR is never a deliberate condition.
  if (!list.length && (depth > 1 || kind === "any")) throw new Reject("empty_group", at);
  const children: ScreenNode[] = [];
  list.forEach((child, i) => {
    const node = normNode(child, depth + 1, `${at}.${kind}[${i}]`, counter);
    // Flatten a same-kind child group and unwrap a single-child nested group, so equivalent
    // spellings share one canonical form (and one hash).
    if (isGroup(node)) {
      const [childKind, items] = groupParts(node);
      if (childKind === kind || items.length === 1) { children.push(...items); return; }
    }
    children.push(node);
  });
  // Operand order never changes meaning: sort by canonical text, then drop exact duplicates.
  const keyed = children.map((node) => [canonicalNode(node), node] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const unique = keyed.filter((entry, i) => i === 0 || entry[0] !== keyed[i - 1][0]).map((entry) => entry[1]);
  return kind === "all" ? { all: unique } : { any: unique };
}

export const isGroup = (node: ScreenNode): node is Group => "all" in node || "any" in node;
export const groupParts = (group: Group): ["all" | "any", ScreenNode[]] =>
  "all" in group ? ["all", group.all] : ["any", group.any];

function canonicalNode(node: ScreenNode): string {
  if (isGroup(node)) {
    const [kind, items] = groupParts(node);
    return `{"${kind}":[${items.map(canonicalNode).join(",")}]}`;
  }
  // Fixed key order — JSON.stringify of a literal keeps insertion order.
  return node.op === "present" ? JSON.stringify({ f: node.f, op: node.op }) : JSON.stringify({ f: node.f, op: node.op, v: node.v });
}

export function canonicalDefinition(def: ScreenDefinition): string {
  const scope = JSON.stringify({ markets: def.scope.markets, asset: def.scope.asset, unpriced: def.scope.unpriced });
  return `{"grammar":${def.grammar},"scope":${scope},"where":${canonicalNode(def.where)}}`;
}

/** Validate and canonicalize an untrusted definition. Unknown keys, fields, operators and
 *  values REJECT (with the path that failed); nothing is dropped silently. */
export function normalizeDefinition(input: unknown): NormalizeResult {
  try {
    if (!isObj(input)) throw new Reject("not_object", "$");
    if (typeof input.grammar === "number" && Number.isInteger(input.grammar) && input.grammar > GRAMMAR_VERSION) {
      throw new Reject("grammar_newer", "grammar");
    }
    if (input.grammar !== GRAMMAR_VERSION) throw new Reject("grammar_invalid", "grammar");
    onlyKeys(input, ["grammar", "scope", "where"], "$");
    const scope = normScope(input.scope);
    if (!isObj(input.where) || !("all" in input.where || "any" in input.where)) throw new Reject("bad_value", "where");
    let where = normGroup(input.where, 1, "where", { leaves: 0 });
    // An AND whose only operand is a group IS that group.
    if ("all" in where && where.all.length === 1 && isGroup(where.all[0])) where = where.all[0];
    const def: ScreenDefinition = { grammar: GRAMMAR_VERSION, scope, where };
    const canonical = canonicalDefinition(def);
    if (canonical.length > MAX_CANONICAL_CHARS) throw new Reject("too_large", "$");
    return { ok: true, def, canonical, hash: definitionHash(canonical) };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, error: error.code, path: error.at };
    return { ok: false, error: "bad_value", path: "$" };
  }
}

// ── evaluation ──────────────────────────────────────────────────────────────────────────

/** The subset of a screener row the grammar reads. ScreenerView's Row is a superset. */
export type ScreenRow = {
  sym: string;
  sec?: string | null;
  mktId: MarketId;
  last: number | null;
  chg: number | null;
  dv: number | null;
  mcap: number | null;
  offHi: number | null;
  offLo: number | null;
  verdict: string | null;
  gics: string | null;
  regimeBull: boolean | null;
};

/** `null` is UNKNOWN. */
export type Tri = boolean | null;
export type LeafTrace = {
  f: ScreenField;
  op: Leaf["op"];
  /** The threshold or value list the leaf compares against (absent for `present`). */
  v?: number | string[] | boolean;
  /** The row's value for the field, `null` when the field is missing. */
  value: number | string | boolean | null;
  result: Tri;
};

function fieldValue(row: ScreenRow, f: ScreenField): number | string | boolean | null {
  const value = (row as Record<string, unknown>)[f];
  if ((NUMBER_FIELDS as readonly string[]).includes(f)) return typeof value === "number" && Number.isFinite(value) ? value : null;
  if ((ENUM_FIELDS as readonly string[]).includes(f)) return typeof value === "string" && value ? value : null;
  return typeof value === "boolean" ? value : null;
}

function evalLeaf(leaf: Leaf, row: ScreenRow): LeafTrace {
  const value = fieldValue(row, leaf.f);
  const base = leaf.op === "present" ? { f: leaf.f, op: leaf.op } : { f: leaf.f, op: leaf.op, v: leaf.v };
  // Missing data is unknown for EVERY operator — including `nin` and `present`. A missing
  // verdict cannot prove a name left a signal screen; it can only say the verdict is missing.
  if (value === null) return { ...base, value: null, result: null };
  let result: boolean;
  switch (leaf.op) {
    case "gte": result = (value as number) >= leaf.v; break;
    case "lte": result = (value as number) <= leaf.v; break;
    case "in": result = leaf.v.includes(value as string); break;
    case "nin": result = !leaf.v.includes(value as string); break;
    case "present": result = true; break;
    case "is": result = value === leaf.v; break;
  }
  return { ...base, value, result };
}

function evalNode(node: ScreenNode, row: ScreenRow, trace: LeafTrace[]): Tri {
  if (!isGroup(node)) {
    const leafTrace = evalLeaf(node, row);
    trace.push(leafTrace);
    return leafTrace.result;
  }
  const [kind, items] = groupParts(node);
  // Evaluate EVERY child (no short-circuit) so the trace explains the whole verdict.
  const results = items.map((child) => evalNode(child, row, trace));
  if (kind === "all") {
    if (results.includes(false)) return false;
    return results.includes(null) ? null : true;
  }
  if (results.includes(true)) return true;
  return results.includes(null) ? null : false;
}

export type RowStatus = "match" | "fail" | "unknown" | "unpriced" | "out_of_scope";
export type RowVerdict = { status: RowStatus; trace: LeafTrace[] };

export const isPriced = (row: ScreenRow): boolean => {
  if (typeof row.last !== "number" || !Number.isFinite(row.last)) return false;
  return !(row.last <= 0 && POSITIVE_PRICE_ASSETS.has(row.sec || ""));
};

export const inScope = (scope: ScreenScope, row: ScreenRow): boolean =>
  (scope.markets === "all" || scope.markets.includes(row.mktId)) && (scope.asset === null || row.sec === scope.asset);

/** Where a row stands against a screen. `out_of_scope` and `unpriced` rows are outside the
 *  screen's population: they are never evaluated, so they can never "exit" by evaluation. */
export function classifyRow(def: ScreenDefinition, row: ScreenRow): RowVerdict {
  if (!inScope(def.scope, row)) return { status: "out_of_scope", trace: [] };
  if (!def.scope.unpriced && !isPriced(row)) return { status: "unpriced", trace: [] };
  const trace: LeafTrace[] = [];
  const result = evalNode(def.where, row, trace);
  return { status: result === true ? "match" : result === false ? "fail" : "unknown", trace };
}

// ── the screener filter bar ⇄ grammar ───────────────────────────────────────────────────

/** Structural mirror of ScreenerView's FilterState. */
export type ScreenerFilters = {
  market: "all" | MarketId;
  asset: string;
  sector: string;
  signal: "any" | "buy" | "sell" | "tracked";
  uptrend: boolean;
  liq: number;
  mcap: number;
  w52: "any" | "nearHigh" | "within15" | "dd30" | "nearLow";
  move: "any" | "up3" | "down3" | "abs5";
  unpriced: boolean;
};

export const DEFAULT_SCREENER_FILTERS: ScreenerFilters = {
  market: "all", asset: "all", sector: "all", signal: "any",
  uptrend: false, liq: 0, mcap: 0, w52: "any", move: "any", unpriced: false,
};

export type MarketContext = {
  /** The device's enabled markets once known; null while preferences are still loading. */
  prefsEnabled: MarketId[] | null;
  showAllMarkets: boolean;
};

/** The market population the screener table is currently drawing from. */
export function effectiveMarkets(f: ScreenerFilters, ctx: MarketContext): "all" | MarketId[] {
  if (f.market !== "all") return [f.market];
  const gated = ctx.prefsEnabled !== null && !ctx.showAllMarkets && ctx.prefsEnabled.length < ALL_MARKETS.length;
  return gated ? [...new Set(ctx.prefsEnabled)].sort() : "all";
}

/** Compile the filter bar into a definition. The result evaluates every row the way the
 *  table's filter does (asserted row-for-row in the tests), except that a 0 price on an asset
 *  that cannot trade at 0 counts as missing. */
export function compileFilters(f: ScreenerFilters, ctx: MarketContext): NormalizeResult {
  const leaves: ScreenNode[] = [];
  if (f.sector !== "all") leaves.push({ f: "gics", op: "in", v: [f.sector] });
  if (f.signal === "buy") leaves.push({ f: "verdict", op: "in", v: [...BUY_VERDICTS] });
  if (f.signal === "sell") leaves.push({ f: "verdict", op: "nin", v: [...BUY_VERDICTS] });
  if (f.signal === "tracked") leaves.push({ f: "verdict", op: "present" });
  if (f.uptrend) leaves.push({ f: "regimeBull", op: "is", v: true });
  if (f.liq > 0) leaves.push({ f: "dv", op: "gte", v: f.liq });
  if (f.mcap > 0) leaves.push({ f: "mcap", op: "gte", v: f.mcap });
  if (f.w52 === "nearHigh") leaves.push({ f: "offHi", op: "gte", v: -5 });
  if (f.w52 === "within15") leaves.push({ f: "offHi", op: "gte", v: -15 });
  if (f.w52 === "dd30") leaves.push({ f: "offHi", op: "lte", v: -30 });
  if (f.w52 === "nearLow") leaves.push({ f: "offLo", op: "lte", v: 10 });
  if (f.move === "up3") leaves.push({ f: "chg", op: "gte", v: 3 });
  if (f.move === "down3") leaves.push({ f: "chg", op: "lte", v: -3 });
  if (f.move === "abs5") leaves.push({ any: [{ f: "chg", op: "gte", v: 5 }, { f: "chg", op: "lte", v: -5 }] });
  const markets = effectiveMarkets(f, ctx);
  return normalizeDefinition({
    grammar: GRAMMAR_VERSION,
    scope: { markets, asset: f.asset === "all" ? null : f.asset, unpriced: f.unpriced },
    where: { all: leaves },
  });
}

export type Decompiled = {
  filters: ScreenerFilters;
  /** Set when the screen's population is a market subset the filter bar can only show through
   *  the device's market preferences — the caller compares it with the device's set. */
  marketSubset: MarketId[] | null;
};

const sameNumber = (leaf: ScreenNode, f: NumberField, op: "gte" | "lte", v: number): boolean =>
  !isGroup(leaf) && leaf.f === f && leaf.op === op && (leaf as NumberLeaf).v === v;

/** Back to the filter bar, or null when the definition uses a shape the bar cannot show. */
export function decompileToFilters(def: ScreenDefinition): Decompiled | null {
  const filters: ScreenerFilters = { ...DEFAULT_SCREENER_FILTERS };
  let marketSubset: MarketId[] | null = null;
  if (def.scope.markets !== "all") {
    if (def.scope.markets.length === 1) filters.market = def.scope.markets[0];
    else marketSubset = [...def.scope.markets];
  }
  if (def.scope.asset !== null) filters.asset = def.scope.asset;
  filters.unpriced = def.scope.unpriced;
  const [kind, items] = groupParts(def.where);
  if (kind !== "all") {
    // The only OR the bar has: |chg| ≥ 5, as the whole root.
    const abs5 = items.length === 2 && sameNumber(items[0], "chg", "gte", 5) && sameNumber(items[1], "chg", "lte", -5);
    return abs5 ? { filters: { ...filters, move: "abs5" }, marketSubset } : null;
  }
  const seen = new Set<string>();
  const claim = (slot: string): boolean => {
    if (seen.has(slot)) return false;
    seen.add(slot);
    return true;
  };
  for (const node of items) {
    if (isGroup(node)) {
      const [k, sub] = groupParts(node);
      const abs5 = k === "any" && sub.length === 2 && sameNumber(sub[0], "chg", "gte", 5) && sameNumber(sub[1], "chg", "lte", -5);
      if (!abs5 || !claim("move")) return null;
      filters.move = "abs5";
      continue;
    }
    const leaf = node;
    if (leaf.f === "gics" && leaf.op === "in" && leaf.v.length === 1 && claim("sector")) { filters.sector = leaf.v[0]; continue; }
    if (leaf.f === "verdict") {
      if (!claim("signal")) return null;
      const buySet = (values: string[]) => values.join(",") === [...BUY_VERDICTS].join(",");
      if (leaf.op === "in" && buySet(leaf.v)) { filters.signal = "buy"; continue; }
      if (leaf.op === "nin" && buySet(leaf.v)) { filters.signal = "sell"; continue; }
      if (leaf.op === "present") { filters.signal = "tracked"; continue; }
      return null;
    }
    if (leaf.f === "regimeBull" && leaf.op === "is" && leaf.v === true && claim("uptrend")) { filters.uptrend = true; continue; }
    if (leaf.f === "dv" && leaf.op === "gte" && leaf.v > 0 && claim("liq")) { filters.liq = leaf.v; continue; }
    if (leaf.f === "mcap" && leaf.op === "gte" && leaf.v > 0 && claim("mcap")) { filters.mcap = leaf.v; continue; }
    if (leaf.f === "offHi" || leaf.f === "offLo") {
      if (!claim("w52")) return null;
      if (sameNumber(leaf, "offHi", "gte", -5)) { filters.w52 = "nearHigh"; continue; }
      if (sameNumber(leaf, "offHi", "gte", -15)) { filters.w52 = "within15"; continue; }
      if (sameNumber(leaf, "offHi", "lte", -30)) { filters.w52 = "dd30"; continue; }
      if (sameNumber(leaf, "offLo", "lte", 10)) { filters.w52 = "nearLow"; continue; }
      return null;
    }
    if (leaf.f === "chg") {
      if (!claim("move")) return null;
      if (sameNumber(leaf, "chg", "gte", 3)) { filters.move = "up3"; continue; }
      if (sameNumber(leaf, "chg", "lte", -3)) { filters.move = "down3"; continue; }
      return null;
    }
    return null;
  }
  return { filters, marketSubset };
}
