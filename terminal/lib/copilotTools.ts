// copilotTools.ts — SERVER-ONLY curated tool surface for the Mastermind AI copilot.
//
// Every executor returns a COMPACT, curated JSON object (hard-capped at ~2KB by capJson)
// so the model never burns tokens on raw file dumps (the old get_intel returned a 48KB
// file verbatim). Contract for every tool:
//   • SYMBOL_RE allowlist runs BEFORE any fs path is built (path-traversal guard).
//   • A missing/unreadable surface returns an explicit { no_data: true, reason } —
//     executors NEVER fabricate values.
//   • Percent-like fund.json fields are 0..1 FRACTIONS → converted to labeled "%"
//     strings here; debt_to_equity stays a raw ratio and is labeled as such
//     (units contract — see memory/fund-json-units-contract).
//
// Pure curators (curate*) are exported separately from the fs/network executors so unit
// tests can drive them with small fixtures. Do NOT import this module from any
// 'use client' component — it reads the server filesystem and internal upstreams.

import { promises as fs } from "fs";
import path from "path";
import { computeRatings, type Row as RatingRow } from "@/lib/techRating";
import { ema, atr, supertrend, bollingerBands, type Bar } from "@/lib/indicatorMath";
import { verdictIsStale, ORACLE_STALE_DAYS, anchorSignal, signalKnownTs, isBlockedSignal, sliceSignalBasis } from "@/lib/signalVerdict";
import { isStalePlane, type MarketPlane } from "@/lib/nwPlane";
import { normalizeMarketRisk } from "@/lib/marketRisk";
import { nextDateCountdown } from "@/lib/finFormat";
// Same upstream topology as app/api/flow/route.ts (Python hub first, R2 mirror second) and
// app/api/nw/route.ts — the shared endpoint constants live in lib/upstreams (the routes
// themselves must not be imported from a lib).
import { FLOW_BACKEND, R2_BASE, NW_BASE } from "@/lib/upstreams";

const DATA = path.join(process.cwd(), "public", "data");

// Strict allowlist for symbol values sourced from AI tool-call arguments.
// Prevents path-traversal: only A-Z, 0-9, dot, and hyphen; 1–15 chars.
export const SYMBOL_RE = /^[A-Z0-9.\-]{1,15}$/i;

/* ── small helpers ─────────────────────────────────────────────────────────── */

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);
const rnd = (v: unknown, d = 2): number | null => {
  const n = num(v);
  return n == null ? null : Number(n.toFixed(d));
};
/** 0..1 fraction → labeled percent string ("46.5%"). null-safe. */
export const fracToPct = (v: unknown, d = 1): string | null => {
  const n = num(v);
  return n == null ? null : `${(n * 100).toFixed(d)}%`;
};
const trimStr = (v: unknown, max = 220): string | null =>
  typeof v === "string" && v.length ? (v.length > max ? v.slice(0, max - 1) + "…" : v) : null;

/** Keep only scalar fields (short strings / finite numbers / booleans) of an unknown
 *  object, plus arrays of scalars (first 6). Used for intel sub-blocks whose exact
 *  shape varies by pipeline version — honest passthrough without a raw dump. */
export function scalarize(o: unknown, maxKeys = 12): Record<string, unknown> | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (n >= maxKeys) break;
    if (typeof v === "number" && isFinite(v)) out[k] = rnd(v, 4);
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = trimStr(v, 160);
    else if (Array.isArray(v)) {
      const scalars = v.filter((x) => typeof x === "string" || (typeof x === "number" && isFinite(x))).slice(0, 6);
      if (scalars.length) out[k] = scalars.map((x) => (typeof x === "string" ? trimStr(x, 120) : rnd(x, 4)));
      else continue;
    } else continue;
    n++;
  }
  return n ? out : null;
}

/* ── payload size cap ──────────────────────────────────────────────────────── */

const CAP_CHARS = 2000;
/** Budget floor: the smallest typed oversize refusal (with a 15-char symbol and root) is ~256
 *  bytes, so a smaller requested cap is raised to this floor rather than broken. The production
 *  cap (CAP_CHARS) is far above it. */
export const MIN_CAP_BYTES = 320;
/** Explicit budget unit for capJson. JS string length is UTF-16 code units and
 *  would silently under-count multibyte payloads relative to JSON/network size. */
export const CAP_UNIT = "utf8_bytes" as const;

/** Compact identity / clock / status scalars. Nested payloads (state, ladder,
 *  facts) are not in this set — they can exceed the budget and must compact. */
const IDENTITY_KEYS = new Set([
  "truncated",
  "oversize",
  "no_data",
  "symbol",
  "reason",
  "error",
  "root",
  "schema",
  "asof",
  "built",
  "age_hours",
  "stale",
  "freshness",
  "clock_status",
  "clock",
  "basis",
  "mixed_source",
  "cap_unit",
  "identity",
  "asof_state",
  "asof_ladder",
  "session",
  "revision",
  "correction_revision",
  "trade_authority",
  "presentable_as_fresh",
  "status",
  "source",
  "unavailable",
]);

/** Caveats that travel with identity: a reader must never keep a verdict while losing why it
 *  is stale, what was withheld, or what the cap omitted. */
const QUALIFIER_KEYS = new Set(["coverage", "limitations", "withheld", "stale_reasons", "omitted", "read_failures"]);
const NESTED_EVIDENCE_KEYS = new Set(["state", "ladder", "facts", "gex", "market_risk"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function jsonUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function trimEllipsis(s: string, maxChars: number): string {
  if (maxChars <= 1) return "…";
  return s.length > maxChars ? s.slice(0, maxChars - 1) + "…" : s;
}

function isEvidenceShaped(v: unknown): v is Record<string, unknown> {
  const rec = asRecord(v);
  if (!rec) return false;
  return (
    rec.mixed_source === true ||
    rec.freshness != null ||
    rec.clock_status != null ||
    rec.limitations != null ||
    rec.coverage != null ||
    rec.no_data === true
  );
}

function shrinkInPlace(o: unknown): void {
  if (!o || typeof o !== "object") return;
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (IDENTITY_KEYS.has(k) || QUALIFIER_KEYS.has(k)) continue;
    const v = rec[k];
    if (typeof v === "string" && v.length > 200) rec[k] = v.slice(0, 197) + "…";
    else if (Array.isArray(v)) {
      if (v.length > 3) rec[k] = v.slice(0, Math.max(3, Math.ceil(v.length / 2)));
      for (const item of rec[k] as unknown[]) shrinkInPlace(item);
    } else if (v && typeof v === "object") shrinkInPlace(v);
  }
}

function dropKeys(
  out: Record<string, unknown>,
  cap: number,
  keep: (key: string, value: unknown) => boolean,
): void {
  const droppable = Object.entries(out)
    .filter(([k, v]) => !keep(k, v))
    .sort((a, b) => jsonUtf8Bytes(b[1] ?? null) - jsonUtf8Bytes(a[1] ?? null));
  for (const [k] of droppable) {
    delete out[k];
    noteOmitted(out, k);
    if (jsonUtf8Bytes(out) <= cap) return;
  }
}

/** A key removed for budget is named, so a reader can tell "dropped" from "never present". */
function noteOmitted(out: Record<string, unknown>, key: string): void {
  const prev = Array.isArray(out.omitted) ? (out.omitted as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (!prev.includes(key)) out.omitted = [...prev, key];
}

function identityStub(v: unknown): Record<string, unknown> {
  if (Array.isArray(v)) return { omitted: true, n: v.length };
  const rec = asRecord(v);
  if (!rec) return {};
  const stub: Record<string, unknown> = {};
  for (const k of IDENTITY_KEYS) {
    if (k in rec && k !== "truncated" && k !== "cap_unit" && k !== "oversize") stub[k] = rec[k];
  }
  for (const k of QUALIFIER_KEYS) {
    if (k in rec) stub[k] = rec[k];
  }
  if (rec.reason != null && stub.reason == null) stub.reason = rec.reason;
  // Nested subrecords (a separate state / ladder) keep their own identity and clock.
  for (const k of NESTED_EVIDENCE_KEYS) {
    if (asRecord(rec[k])) stub[k] = identityStub(rec[k]);
  }
  return stub;
}

function compactNestedEvidence(out: Record<string, unknown>): void {
  for (const k of Object.keys(out)) {
    if (!NESTED_EVIDENCE_KEYS.has(k) && !isEvidenceShaped(out[k]) && !Array.isArray(out[k])) continue;
    if (IDENTITY_KEYS.has(k) || QUALIFIER_KEYS.has(k)) continue;
    out[k] = identityStub(out[k]);
  }
}

function compactQualifiersToFit(out: Record<string, unknown>, cap: number): void {
  for (let guard = 0; guard < 24 && jsonUtf8Bytes(out) > cap; guard++) {
    const lim = out.limitations;
    if (typeof lim === "string" && lim.length > 48) {
      out.limitations = trimEllipsis(lim, Math.max(24, Math.floor(lim.length / 2)));
      continue;
    }
    const cov = out.coverage;
    const covRec = asRecord(cov);
    if (covRec) {
      let trimmed = false;
      for (const [k, v] of Object.entries(covRec)) {
        if (typeof v === "string" && v.length > 24) {
          covRec[k] = trimEllipsis(v, Math.max(12, Math.floor(v.length / 2)));
          trimmed = true;
        }
      }
      if (trimmed) {
        out.coverage = covRec;
        continue;
      }
    }
    if (typeof cov === "string" && cov.length > 24) {
      out.coverage = trimEllipsis(cov, Math.max(12, Math.floor(cov.length / 2)));
      continue;
    }
    break;
  }
}

function oversizeRefusal(src: Record<string, unknown>, cap: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    truncated: true,
    oversize: true,
    no_data: true,
    cap_unit: CAP_UNIT,
    reason: "protected evidence envelope exceeds utf8_bytes budget",
    trade_authority: false,
  };
  for (const k of [
    "symbol",
    "root",
    "schema",
    "asof",
    "built",
    "session",
    "basis",
    "revision",
    "freshness",
    "stale",
    "clock_status",
    "mixed_source",
  ]) {
    const v = src[k];
    if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && isFinite(v))) out[k] = v;
  }
  if (out.stale === true && Array.isArray(src.stale_reasons)) {
    out.stale_reasons = src.stale_reasons.filter((r) => typeof r === "string").slice(0, 6);
  }
  const dropped = Array.isArray(src.omitted) ? (src.omitted as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const omitted = [
    ...new Set([...dropped, ...Object.keys(src).filter((k) => NESTED_EVIDENCE_KEYS.has(k) || isEvidenceShaped(src[k]))]),
  ];
  if (omitted.length) out.omitted = omitted;
  out.limitations =
    typeof src.limitations === "string" && src.limitations.trim()
      ? src.limitations
      : "protected evidence exceeded utf8_bytes budget; nested payload omitted";
  const cov = asRecord(src.coverage);
  if (cov) {
    const compact: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cov)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) compact[k] = v;
      if (Object.keys(compact).length >= 6) break;
    }
    if (Object.keys(compact).length) out.coverage = compact;
  }
  compactQualifiersToFit(out, cap);
  if (jsonUtf8Bytes(out) <= cap) return out;
  const minimal: Record<string, unknown> = {
    truncated: true,
    oversize: true,
    no_data: true,
    cap_unit: CAP_UNIT,
    reason: "protected evidence envelope exceeds utf8_bytes budget",
    limitations: "oversize",
    trade_authority: false,
  };
  if (typeof src.symbol === "string") minimal.symbol = src.symbol.slice(0, 15);
  if (typeof src.root === "string") minimal.root = src.root.slice(0, 15);
  if (omitted.length && jsonUtf8Bytes({ ...minimal, omitted }) <= cap) minimal.omitted = omitted;
  return minimal;
}

/** Enforce the ≤~2KB curated-payload contract in utf8 bytes. Over-cap objects
 *  shrink arrays / long strings, then drop optional fields. Nested protected
 *  state/ladder/facts are compacted to identity/clock/limitations rather than
 *  emitted unbounded. If the remainder still cannot fit, a typed oversize
 *  refusal is returned — never sliced JSON, never financials without limitations. */
export function capJson(obj: Record<string, unknown>, requestedCap = CAP_CHARS): Record<string, unknown> {
  const cap = Math.max(requestedCap, MIN_CAP_BYTES);
  try {
    if (jsonUtf8Bytes(obj) <= cap) return obj;
  } catch {
    return { no_data: true, reason: "unserializable tool payload" };
  }
  const out: Record<string, unknown> = structuredClone(obj);
  out.truncated = true;
  out.cap_unit = CAP_UNIT;
  for (let pass = 0; pass < 12; pass++) {
    shrinkInPlace(out);
    if (jsonUtf8Bytes(out) <= cap) return out;
  }
  dropKeys(out, cap, (k, v) => IDENTITY_KEYS.has(k) || QUALIFIER_KEYS.has(k) || NESTED_EVIDENCE_KEYS.has(k) || isEvidenceShaped(v));
  if (jsonUtf8Bytes(out) <= cap) return out;

  compactNestedEvidence(out);
  if (jsonUtf8Bytes(out) <= cap) return out;

  // Compacted evidence (identity stubs) is never dropped silently: if it still cannot fit,
  // the typed refusal below names what was omitted instead.
  dropKeys(out, cap, (k, v) => IDENTITY_KEYS.has(k) || QUALIFIER_KEYS.has(k) || NESTED_EVIDENCE_KEYS.has(k) || isEvidenceShaped(v));
  if (jsonUtf8Bytes(out) <= cap) return out;

  compactQualifiersToFit(out, cap);
  if (jsonUtf8Bytes(out) <= cap) return out;

  return oversizeRefusal(out, cap);
}

/* ── fs / fetch plumbing ───────────────────────────────────────────────────── */

async function readDataJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, file), "utf8"));
  } catch {
    return null;
  }
}

/** Like readDataJson, but a file that exists and could not be read or parsed is a failed read,
 *  not a missing file (only ENOENT is absence). */
async function readDataFile(file: string): Promise<{ kind: "data"; payload: unknown } | { kind: "absent" } | { kind: "failed"; reason: string }> {
  let text: string;
  try {
    text = await fs.readFile(path.join(DATA, file), "utf8");
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "failed", reason: `file read error${typeof code === "string" ? ` ${code}` : ""}` };
  }
  try {
    return { kind: "data", payload: JSON.parse(text) };
  } catch {
    return { kind: "failed", reason: "unparseable file" };
  }
}

async function fetchJson(url: string, timeoutMs = 3000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "mastermind-copilot/1.0" }, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// manifest.json is 1.9MB in prod — parse once per nightly refresh, keyed on mtime.
let manifestCache: { mtimeMs: number; data: Record<string, unknown> } | null = null;
async function getManifest(): Promise<Record<string, unknown> | null> {
  try {
    const p = path.join(DATA, "manifest.json");
    const st = await fs.stat(p);
    if (manifestCache && manifestCache.mtimeMs === st.mtimeMs) return manifestCache.data;
    const data = JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    manifestCache = { mtimeMs: st.mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

/** Manifest row for a (pre-validated) symbol — also used by the route to inject
 *  cheap chart context into the system prompt. */
export async function getManifestRow(sym: string): Promise<Record<string, unknown> | null> {
  const m = await getManifest();
  const row = (m?.symbols as Record<string, unknown> | undefined)?.[sym];
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

// Full-history OHLC files run ~600KB (AAPL.json) and get_price_summary + get_technicals
// each want the same file, often within one copilot turn — mtime-keyed parsed cache like
// the manifest above, small LRU since chats revisit only a handful of symbols.
const OHLC_CACHE_MAX = 8;
const ohlcCache = new Map<string, { mtimeMs: number; data: unknown }>();
async function readOhlcCached(sym: string): Promise<unknown | null> {
  try {
    const p = path.join(DATA, `${sym}.json`);
    const st = await fs.stat(p);
    const hit = ohlcCache.get(sym);
    if (hit && hit.mtimeMs === st.mtimeMs) {
      ohlcCache.delete(sym); ohlcCache.set(sym, hit);   // LRU refresh (Map = insertion order)
      return hit.data;
    }
    const data: unknown = JSON.parse(await fs.readFile(p, "utf8"));
    ohlcCache.delete(sym);
    ohlcCache.set(sym, { mtimeMs: st.mtimeMs, data });
    if (ohlcCache.size > OHLC_CACHE_MAX) ohlcCache.delete(ohlcCache.keys().next().value as string);
    return data;
  } catch {
    return null;
  }
}

// NW plane: 5-min in-memory cache (mirrors /api/nw); serve last-good on upstream hiccup.
let planeCache: { ts: number; data: MarketPlane } | null = null;
const PLANE_TTL_MS = 300_000;
async function fetchPlane(): Promise<MarketPlane | null> {
  // NW_FIXTURE parity with /api/nw: fixture dev boxes serve the checked-in sample and
  // never touch the live producer.
  if (process.env.NW_FIXTURE === "1") return (await readDataJson("nw_plane_fixture.json")) as MarketPlane | null;
  const now = Date.now();
  if (planeCache && now - planeCache.ts < PLANE_TTL_MS) return planeCache.data;
  try {
    const data = (await fetchJson(`${NW_BASE}/market_plane.json`, 4000)) as MarketPlane;
    planeCache = { ts: now, data };
    return data;
  } catch {
    return planeCache?.data ?? null;
  }
}

/** A GEX read that did not land: 5xx, network error, timeout or an unparseable body. Distinct
 *  from an absent payload (null), which means every store asked answered 404. A failed read
 *  leaves that half unknown; it is never reported as "not published" or "no coverage". */
export class GexReadFailure {
  constructor(readonly reason: string) {}
}

type StoreRead = { kind: "data"; payload: Record<string, unknown> } | { kind: "absent" } | { kind: "failed"; reason: string };

async function readStore(url: string, label: string, timeoutMs = 3000): Promise<StoreRead> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const timedOut = (e: unknown) => ctrl.signal.aborted || (e as { name?: unknown } | null)?.name === "AbortError";
  const timeoutReason = `${label} timed out after ${timeoutMs / 1000}s`;
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "mastermind-copilot/1.0" }, cache: "no-store" });
    } catch (e) {
      return { kind: "failed", reason: timedOut(e) ? timeoutReason : `${label} network error` };
    }
    if (res.status === 404) return { kind: "absent" };
    if (!res.ok) return { kind: "failed", reason: `${label} HTTP ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      return { kind: "failed", reason: timedOut(e) ? timeoutReason : `${label} returned an unparseable body` };
    }
    const rec = asRecord(body);
    return rec ? { kind: "data", payload: rec } : { kind: "failed", reason: `${label} returned a non-object body` };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGexPayloads(root: string): Promise<{ gex: unknown; state: unknown }> {
  // FLOW_FIXTURE parity with /api/flow (f=gex:/gexstate:): fixture dev boxes must not hit
  // the live hub or R2. Same files, same keying (gex by root; gexstate single-root sample).
  if (process.env.FLOW_FIXTURE === "1") {
    const all = (await readDataJson("gex_fixture.json")) as Record<string, unknown> | null;
    const state = await readDataJson("gexstate_fixture.json");
    return { gex: all?.[root.toUpperCase()] ?? null, state };
  }
  // The hub is primary and R2 the mirror. Absent only when both answer 404; any other miss is a
  // failed read (a mirror 404 behind a failed hub read cannot prove the hub had nothing).
  const grab = async (backendPath: string, r2Key: string): Promise<unknown> => {
    const hub = await readStore(`${FLOW_BACKEND}${backendPath}`, "hub");
    if (hub.kind === "data") return hub.payload;
    const r2 = await readStore(`${R2_BASE}/${r2Key}`, "R2 mirror");
    if (r2.kind === "data") return r2.payload;
    if (hub.kind === "absent" && r2.kind === "absent") return null;
    return new GexReadFailure(
      [hub, r2]
        .map((r) => (r.kind === "failed" ? r.reason : r.kind === "absent" ? "not found" : ""))
        .filter(Boolean)
        .join("; "),
    );
  };
  const [gex, state] = await Promise.all([
    grab(`/api/hub/gex/${root}`, `options_hub/gex/${root}.json`),
    grab(`/api/hub/gexstate/${root}`, `options_structure/gex_state/${root}.json`),
  ]);
  return { gex, state };
}

/* ── bar mapping (raw <SYM>.json → Bar[]) ─────────────────────────────────── */

/** Raw OHLC file rows are [date, o, h, l, c, v] (see lib/fund.ts getBars). */
export function toBars(ohlc: unknown): Bar[] {
  const rows = (ohlc as { bars?: unknown })?.bars;
  if (!Array.isArray(rows)) return [];
  const out: Bar[] = [];
  for (const b of rows) {
    if (Array.isArray(b) && b.length >= 5) out.push({ time: String(b[0]), o: +b[1], h: +b[2], l: +b[3], c: +b[4], v: +(b[5] ?? 0) });
  }
  return out;
}

function retPct(closes: number[], nBack: number): number | null {
  if (closes.length <= nBack) return null;
  const last = closes[closes.length - 1];
  const base = closes[closes.length - 1 - nBack];
  if (!isFinite(last) || !isFinite(base) || base === 0) return null;
  return rnd((last / base - 1) * 100);
}

function ytdPct(bars: Bar[]): number | null {
  if (!bars.length) return null;
  const lastB = bars[bars.length - 1];
  const year = String(lastB.time).slice(0, 4);
  for (let i = bars.length - 1; i >= 0; i--) {
    if (String(bars[i].time).slice(0, 4) !== year) {
      const base = bars[i].c;
      return isFinite(base) && base !== 0 ? rnd((lastB.c / base - 1) * 100) : null;
    }
  }
  return null;
}

/* ── curators (pure; unit-tested with fixtures) ────────────────────────────── */

export function curatePriceSummary(row: Record<string, unknown> | null, ohlc: unknown): Record<string, unknown> {
  const bars = toBars(ohlc);
  if (!row && !bars.length) return { no_data: true, reason: "symbol not in manifest and no OHLC history file" };
  const lastBar = bars.length ? bars[bars.length - 1] : null;
  const closes = bars.map((b) => b.c);
  const tail = bars.slice(-300);
  const last = num(row?.last) ?? (lastBar ? lastBar.c : null);

  let atr14: number | null = null;
  if (tail.length >= 15) {
    const a = atr(tail, 14);
    atr14 = rnd(a[a.length - 1]);
  }
  let avgVol20: number | null = null;
  if (bars.length >= 20) {
    const v20 = bars.slice(-20).map((b) => b.v).filter((v) => isFinite(v));
    if (v20.length) avgVol20 = Math.round(v20.reduce((s, v) => s + v, 0) / v20.length);
  }
  let dist200: number | null = null;
  if (closes.length >= 200 && last != null) {
    const m200 = closes.slice(-200).reduce((s, c) => s + c, 0) / 200;
    if (m200 > 0) dist200 = rnd((last / m200 - 1) * 100);
  }
  const hi52 = num(row?.hi52) ?? (closes.length ? rnd(Math.max(...bars.slice(-252).map((b) => b.h))) : null);
  const lo52 = num(row?.lo52) ?? (closes.length ? rnd(Math.min(...bars.slice(-252).map((b) => b.l))) : null);

  return {
    name: trimStr(row?.name, 60),
    last: rnd(last, 4),
    chg_pct: rnd(row?.chg),
    today: {
      o: rnd(row?.open ?? lastBar?.o, 4),
      h: rnd(row?.high ?? lastBar?.h, 4),
      l: rnd(row?.low ?? lastBar?.l, 4),
      vol: num(row?.vol) ?? (lastBar ? lastBar.v : null),
    },
    hi52,
    lo52,
    returns_pct: bars.length
      ? { w1: retPct(closes, 5), m1: retPct(closes, 21), m3: retPct(closes, 63), m6: retPct(closes, 126), ytd: ytdPct(bars) }
      : { no_data: true, reason: "no OHLC history file" },
    atr14,
    avg_vol_20: avgVol20,
    dist_200dma_pct: dist200,
    asof: lastBar?.time ?? null,
  };
}

const ratingVal = (rows: RatingRow[], prefix: string): number | null => {
  const r = rows.find((x) => x.name.startsWith(prefix));
  return r && r.value != null ? rnd(r.value) : null;
};

export function curateTechnicals(ohlc: unknown): Record<string, unknown> {
  const bars = toBars(ohlc).slice(-400);
  if (bars.length < 30) return { no_data: true, reason: "not enough daily bars for technicals (need ≥30)" };
  // techRating.Bar and indicatorMath.Bar are structurally identical {time,o,h,l,c,v}.
  const ratings = computeRatings(bars as Parameters<typeof computeRatings>[0]);
  const [oscG, maG, allG] = ratings.summary;

  // MACD histogram (computeRatings only exposes the line): EMA12−EMA26, signal EMA9.
  const closes: (number | null)[] = bars.map((b) => b.c);
  const e12 = ema(closes, 12);
  const e26 = ema(closes, 26);
  const line = e12.map((v, i) => (v != null && e26[i] != null ? v - (e26[i] as number) : null));
  const sig = ema(line, 9);
  const lastLine = line[line.length - 1];
  const lastSig = sig[sig.length - 1];
  const macdHist = lastLine != null && lastSig != null ? rnd(lastLine - lastSig, 3) : null;

  const st = supertrend(bars, 10, 3);
  const stTrend = st.trend[st.trend.length - 1];

  const bb = bollingerBands(bars, 20, 2);
  const up = bb.upper[bb.upper.length - 1];
  const lo = bb.lower[bb.lower.length - 1];
  const c = bars[bars.length - 1].c;
  let bbPos: string | null = null;
  let pctB: number | null = null;
  if (up != null && lo != null && up > lo) {
    pctB = rnd((c - lo) / (up - lo), 2);
    bbPos = c > up ? "above_upper_band" : c < lo ? "below_lower_band" : (pctB as number) >= 0.5 ? "upper_half" : "lower_half";
  }

  const piv = ratings.pivots.classic;
  return {
    verdicts: {
      summary: allG.verdict,
      score: rnd(allG.score),
      oscillators: { verdict: oscG.verdict, buy: oscG.buy, sell: oscG.sell, neutral: oscG.neutral },
      moving_averages: { verdict: maG.verdict, buy: maG.buy, sell: maG.sell, neutral: maG.neutral },
    },
    values: {
      rsi14: ratingVal(ratings.oscillators, "RSI"),
      stoch_k: ratingVal(ratings.oscillators, "Stochastic %K"),
      adx14: ratingVal(ratings.oscillators, "ADX"),
      macd_line: ratingVal(ratings.oscillators, "MACD"),
      macd_hist: macdHist,
      ema50: ratingVal(ratings.mas, "EMA (50)"),
      sma200: ratingVal(ratings.mas, "SMA (200)"),
    },
    pivots_classic: { P: rnd(piv.p), R1: rnd(piv.r1), S1: rnd(piv.s1), R2: rnd(piv.r2), S2: rnd(piv.s2) },
    supertrend: stTrend == null ? null : stTrend ? "up" : "down",
    bollinger: bbPos == null ? null : { position: bbPos, pct_b: pctB },
    asof: bars[bars.length - 1].time,
    basis: "daily bars",
  };
}

/** Drop the deprecated `extended` alias from the model-facing state when the honest name is
 *  present. Never removes information: `strong_bull` carries the same boolean. On a legacy
 *  slice that has only `extended`, it is kept — losing the field would be worse than the name. */
function omitDeprecatedExtended(state: Record<string, unknown>): Record<string, unknown> {
  if (!("extended" in state) || !("strong_bull" in state)) return state;
  const { extended: _deprecated, ...rest } = state;
  return rest;
}

export function curateSignals(slice: unknown, nowMs: number = Date.now()): Record<string, unknown> {
  const ind = (slice as { indicator?: Record<string, unknown> })?.indicator;
  if (!ind || typeof ind !== "object") return { no_data: true, reason: "no Golden-Oracle slice for symbol" };
  const state = (ind.state as Record<string, unknown>) ?? null;
  const rawSigs = Array.isArray(ind.signals) ? (ind.signals as Record<string, unknown>[]) : [];
  const last_signals = rawSigs.slice(-3).map((s) => ({
    ts: s?.ts ?? null,
    known_ts: s?.known_ts ?? null,
    type: s?.type ?? null,
    price: rnd(s?.price, 4),
    // HK-O1: the model must not infer a momentum call from a bare type:"SELL" (every SELL in
    // this stream is a trailing structure stop) nor an entry from a refused BUY. Both facts
    // ride along explicitly rather than living only in the label.
    basis: sliceSignalBasis(s) ?? null,
    blocked: isBlockedSignal(s) || undefined,
    quality: s?.quality ?? rnd(s?.strength, 3),
    reason:
      trimStr(s?.quality_reason, 160) ??
      (Array.isArray(s?.reasons) ? (s.reasons as unknown[]).slice(0, 4).join(", ") : trimStr(s?.reason, 160)),
  }));

  const bt = ((slice as { backtest?: Record<string, unknown> })?.backtest ?? {}) as Record<string, unknown>;
  const met = (bt.metrics ?? {}) as Record<string, unknown>;
  const vsBH = (met.vs_buy_hold ?? {}) as Record<string, unknown>;

  // Staleness anchors on the newest signal the engine did NOT refuse — signalVerdict.anchorSignal,
  // the SAME helper the rail card runs, which includes unscored-but-real RECLAIMs (decay-class
  // names: last_scored_ts can be months older than the fresh re-entry the rail card shows).
  // Fallback: last_scored_ts.
  const lastTs = signalKnownTs(anchorSignal(rawSigs).anchor)
    ?? (state?.last_scored_ts as string | undefined) ?? null;
  const ageDays = lastTs && Number.isFinite(Date.parse(lastTs)) ? Math.floor((nowMs - Date.parse(lastTs)) / 86_400_000) : null;

  return {
    // Verbatim per spec (small object; capJson trims if a pipeline ever bloats it) MINUS the
    // one field whose NAME contradicts its value: HK-O1 — `state.extended` carries strong_bull,
    // not overbought, and the stock card beside this shows the cycles pipeline's unrelated
    // "Extended — don't chase". Handing a model a key that means the opposite of what it reads
    // is a labeling bug, not a payload saving; `strong_bull` ships the identical value by its
    // own name, and `overbought` is the field the caution actually rides.
    state: state ? omitDeprecatedExtended(state) : state,
    last_signals,
    backtest: {
      n_trades: num(met.n_trades) ?? num(bt.n_trades),
      win_rate: fracToPct(met.win_rate),
      profit_factor: rnd(met.profit_factor),
      expectancy: fracToPct(met.expectancy),
      cagr: fracToPct(met.cagr),
      sharpe: rnd(met.sharpe),
      max_dd: fracToPct(met.max_dd),
      exposure: fracToPct(met.exposure),
      bh_total_return: fracToPct(vsBH.bh_total_return),
      beats_buy_hold: typeof vsBH.beats_return === "boolean" ? vsBH.beats_return : null,
    },
    honest_read: trimStr(bt.honest_read ?? ind.honest_read, 240),
    signal_age_days: ageDays,
    // > ORACLE_STALE_DAYS calendar days ⇒ historical, not a current call (lib/signalVerdict semantics)
    stale: verdictIsStale(lastTs, nowMs),
    stale_after_days: ORACLE_STALE_DAYS,
  };
}

export function curateOpts(opts: unknown): Record<string, unknown> {
  const o = opts as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.term)) {
    return { no_data: true, reason: "no options IV file for symbol (~297 liquid names have one)" };
  }
  const term = (o.term as Record<string, unknown>[]).filter((t) => t && num(t.iv) != null);
  const iv_term = term.map((t) => ({ label: t.label, dte: num(t.dte), iv_pct: rnd((t.iv as number) * 100, 1) }));
  let term_slope: string | null = null;
  if (term.length >= 2) {
    const d = ((term[term.length - 1].iv as number) - (term[0].iv as number)) * 100;
    term_slope = `${d > 0.5 ? "upward (contango)" : d < -0.5 ? "inverted (near-term stress)" : "flat"} (${rnd(d, 1)} pts front→back)`;
  }
  // Smile skew from strike moneyness (real shape: smile = {expiry, dte, strikes[], iv[]}):
  // IV at ~90% of spot (put side) minus IV at ~110% (call side); positive ⇒ downside puts bid.
  let skew_summary: Record<string, unknown> | null = null;
  const smile = o.smile as Record<string, unknown> | undefined;
  const spotN = num(o.spot);
  if (smile && spotN != null && Array.isArray(smile.strikes) && Array.isArray(smile.iv) && smile.strikes.length === smile.iv.length && smile.strikes.length > 2) {
    const nearest = (target: number): number | null => {
      let best = -1;
      let bestD = Infinity;
      (smile.strikes as number[]).forEach((k, i) => {
        const d = Math.abs(k - target);
        const ivv = (smile.iv as number[])[i];
        if (isFinite(d) && d < bestD && typeof ivv === "number" && isFinite(ivv)) {
          bestD = d;
          best = i;
        }
      });
      return best >= 0 ? (smile.iv as number[])[best] : null;
    };
    const putIv = nearest(spotN * 0.9);
    const callIv = nearest(spotN * 1.1);
    if (putIv != null && callIv != null) {
      const pts = rnd((putIv - callIv) * 100, 1) as number;
      skew_summary = { skew_pts_90_110_moneyness: pts, smile_dte: num(smile.dte), read: pts > 1 ? "puts bid over calls (downside hedging)" : pts < -1 ? "calls bid over puts (upside chase)" : "flat" };
    }
  }
  return { spot: rnd(o.spot, 4), asof: o.asof ?? null, iv_term, term_slope, skew_summary };
}

type GexIdentity = {
  root: string | null;
  session: string | null;
  basis: string | null;
  revision: string | null;
};

function asIdentityString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const GEX_DAY = /^\d{4}-\d{2}-\d{2}$/;
const GEX_ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const GEX_CLOSE_MINUTES = 16 * 60;
const GEX_ET = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function gexEtClock(ms: number): { date: string; minutes: number; hhmm: string } {
  const p: Record<string, string> = {};
  for (const part of GEX_ET.formatToParts(new Date(ms))) p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, "0")}:${p.minute}`,
  };
}

/** Session receipt per the producers (Macro origin/main): options_hub.gex/v1 stamps the bare
 *  reference session date; options_structure.gex_state/v1 stamps the session's 16:00 New York
 *  close with an explicit offset (a UTC build time when no session was passed). So a session is
 *  the New York trading date of a close receipt. A stamp before that date's 16:00 ET close is an
 *  intraday observation keyed to its minute — it never equals an end-of-day session. A timestamp
 *  without a zone, or an explicit session the clock contradicts, stays unknown (null). */
function gexSession(o: Record<string, unknown>): string | null {
  const explicitRaw = asIdentityString(o.session);
  const explicit = explicitRaw && GEX_DAY.test(explicitRaw.slice(0, 10)) ? explicitRaw.slice(0, 10) : null;
  if (explicitRaw && !explicit) return null;
  const asof = asIdentityString(o.asof);
  if (!asof) return explicit;
  if (GEX_DAY.test(asof)) return explicit && explicit !== asof ? null : asof;
  const ms = Date.parse(asof);
  if (!GEX_ZONED.test(asof) || !Number.isFinite(ms)) return null;
  const et = gexEtClock(ms);
  const intraday = `${et.date} intraday ${et.hhmm} ET`;
  if (explicit) {
    if (et.date < explicit) return null;
    return et.date === explicit && et.minutes < GEX_CLOSE_MINUTES ? intraday : explicit;
  }
  return et.minutes >= GEX_CLOSE_MINUTES ? et.date : intraday;
}

/** Identity slots reused from owner GEX envelopes (root, session, basis, correction revision).
 *  Missing or malformed clocks stay unknown — they are never inferred from the other envelope
 *  or from a URL-bound symbol. */
function gexIdentity(o: Record<string, unknown> | null | undefined): GexIdentity {
  if (!o || typeof o !== "object") return { root: null, session: null, basis: null, revision: null };
  const rootRaw = asIdentityString(o.root);
  const root = rootRaw ? rootRaw.toUpperCase() : null;
  const session = gexSession(o);
  const passport = o.regime_passport && typeof o.regime_passport === "object" ? (o.regime_passport as Record<string, unknown>) : null;
  const profile = o.profile && typeof o.profile === "object" ? (o.profile as Record<string, unknown>) : null;
  const basis = asIdentityString(o.basis) ?? asIdentityString(o.convention) ?? asIdentityString(passport?.basis) ?? asIdentityString(profile?.method);
  const revision = asIdentityString(o.revision) ?? asIdentityString(o.correction_revision) ?? asIdentityString(o.source_revision);
  return { root, session, basis, revision };
}

function identitySlotConflict(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  return a !== b;
}

function gexIdentitiesConflict(ladder: GexIdentity, state: GexIdentity): boolean {
  return (
    identitySlotConflict(ladder.root, state.root) ||
    identitySlotConflict(ladder.session, state.session) ||
    identitySlotConflict(ladder.basis, state.basis) ||
    identitySlotConflict(ladder.revision, state.revision)
  );
}

function gexClockValid(v: unknown): v is string {
  const s = asIdentityString(v);
  return !!s && (GEX_DAY.test(s) || Number.isFinite(Date.parse(s)));
}

function gexWalls(g: Record<string, unknown> | null, ok: boolean) {
  const strikes = ok && Array.isArray(g!.by_strike) ? (g!.by_strike as Record<string, unknown>[]).filter((r) => r && num(r.strike) != null) : [];
  const call_walls = strikes
    .filter((r) => num(r.gamma_call) != null)
    .sort((a, b) => (b.gamma_call as number) - (a.gamma_call as number))
    .slice(0, 3)
    .map((r) => ({ strike: r.strike, gamma: rnd(r.gamma_call, 3) }));
  const put_walls = strikes
    .filter((r) => num(r.gamma_put) != null)
    .sort((a, b) => (a.gamma_put as number) - (b.gamma_put as number))
    .slice(0, 3)
    .map((r) => ({ strike: r.strike, gamma: rnd(r.gamma_put, 3) }));
  return {
    call_walls: call_walls.length ? call_walls : null,
    put_walls: put_walls.length ? put_walls : null,
  };
}

type GexSide = "ladder" | "state";
type GexSource =
  | { kind: "absent" }
  | { kind: "failed"; reason: string }
  | { kind: "withheld"; record: Record<string, unknown> }
  | { kind: "bound"; payload: Record<string, unknown>; id: GexIdentity; clocked: boolean };

/** A source is bound to the requested symbol only when it is a measured payload whose own
 *  producer root equals that symbol. Anything else is withheld with its identity and a reason —
 *  never folded into, or shown as, the symbol's GEX. */
function bindGexSource(side: GexSide, raw: unknown, owner: string | undefined): GexSource {
  if (raw instanceof GexReadFailure) return { kind: "failed", reason: raw.reason };
  const o = asRecord(raw);
  if (!o) return { kind: "absent" };
  const id = gexIdentity(o);
  const withheld = (reason: string): GexSource => ({
    kind: "withheld",
    record: {
      root: id.root,
      asof: typeof o.asof === "string" ? o.asof : null,
      ...(typeof o.schema === "string" ? { schema: o.schema } : {}),
      reason,
    },
  });
  if (!id.root) return withheld(`${side} payload carries no producer root, so it cannot be bound to ${owner ?? "a symbol"}`);
  if (owner && id.root !== owner) return withheld(`${side} payload is for root ${id.root}, not ${owner}`);
  const measured =
    side === "state"
      ? num(o.net_gex_bn) != null
      : num(o.net_gex_bn) != null ||
        (Array.isArray(o.by_strike) &&
          (o.by_strike as unknown[]).some((r) => {
            const row = asRecord(r);
            return !!row && num(row.strike) != null && (num(row.gamma_call) != null || num(row.gamma_put) != null);
          }));
  if (!measured) return withheld(`${side} for ${id.root} was published without measured gamma (empty producer shell)`);
  return { kind: "bound", payload: o, id, clocked: gexClockValid(o.asof) };
}

function gexStateFields(s: Record<string, unknown>): Record<string, unknown> {
  return {
    spot: rnd(s.spot, 4),
    net_gex_bn: rnd(s.net_gex_bn),
    gamma_flip: rnd(s.gamma_flip),
    call_wall: rnd(s.call_wall),
    put_wall: rnd(s.put_wall),
    gamma_regime: s.gamma_regime ?? null,
    pin_probability: rnd(s.pin_probability),
    magnet: rnd(s.magnet),
    max_pain: rnd(s.max_pain),
    dist_to_flip_pct: rnd(s.dist_to_flip_pct),
  };
}

function gexLadderFields(g: Record<string, unknown>): Record<string, unknown> {
  return {
    spot: rnd(g.spot_ref, 4),
    net_gex_bn: rnd(g.net_gex_bn),
    gamma_flip: rnd(g.gamma_flip),
    call_wall: rnd(g.call_wall),
    put_wall: rnd(g.put_wall),
    ...gexWalls(g, true),
  };
}

/** Curate the ladder (options_hub.gex) and state (options_structure.gex_state) for one root.
 *  Result is exactly one of:
 *    matched     — both bound and identical in root, session, basis and revision: one fused read
 *                  dated by its shared session, with both producer clocks exposed;
 *    separate    — both bound but not identical (mixed_source): two subrecords, each with its own
 *                  identity and clock, never fused (a subrecord without a valid clock keeps only
 *                  its identity);
 *    partial     — one bound source with its own clock; the other half named as absent/withheld;
 *    unavailable — no_data, with every withheld source's identity and reason.
 *  A GexReadFailure input (the read did not land) is named in read_failures and worded as a
 *  failed read with the half unknown — never as "not published" or "no coverage". */
export function curateGex(gex: unknown, state: unknown, ownerRoot?: string): Record<string, unknown> {
  const owner = typeof ownerRoot === "string" && ownerRoot.trim() ? ownerRoot.trim().toUpperCase() : undefined;
  const ladder = bindGexSource("ladder", gex, owner);
  const st = bindGexSource("state", state, owner);
  const withheld: Record<string, unknown> = {};
  if (ladder.kind === "withheld") withheld.ladder = ladder.record;
  if (st.kind === "withheld") withheld.state = st.record;
  const readFailures: Record<string, string> = {};
  if (ladder.kind === "failed") readFailures.ladder = ladder.reason;
  if (st.kind === "failed") readFailures.state = st.reason;
  const failedNote = (side: GexSide) => `${side} read failed (${readFailures[side]}), so the ${side} is unknown`;

  if (ladder.kind === "bound" && st.kind === "bound" && (ladder.clocked || st.clocked)) {
    const g = ladder.payload;
    const s = st.payload;
    if (ladder.clocked && st.clocked && !gexIdentitiesConflict(ladder.id, st.id)) {
      const session = st.id.session as string;
      return {
        status: "matched",
        ...st.id,
        asof: GEX_DAY.test(session) ? session : (s.asof as string),
        asof_state: s.asof,
        asof_ladder: g.asof,
        ...gexStateFields(s),
        spot: rnd(s.spot ?? g.spot_ref, 4),
        net_gex_bn: rnd(s.net_gex_bn ?? g.net_gex_bn),
        gamma_flip: rnd(s.gamma_flip ?? g.gamma_flip),
        call_wall: rnd(s.call_wall ?? g.call_wall),
        put_wall: rnd(s.put_wall ?? g.put_wall),
        ...gexWalls(g, true),
      };
    }
    const sub = (src: Extract<GexSource, { kind: "bound" }>, fields: Record<string, unknown>) =>
      src.clocked
        ? { ...src.id, asof: src.payload.asof, ...fields }
        : { ...src.id, asof: src.payload.asof ?? null, unavailable: "no valid producer clock; numbers withheld" };
    return {
      status: "separate",
      mixed_source: true,
      reason: "GEX state and ladder disagree on root, session, basis or revision, or identity is unknown",
      limitations: "state and ladder are separate evidence; one clock does not certify the other",
      state: sub(st, gexStateFields(s)),
      ladder: sub(ladder, gexLadderFields(g)),
    };
  }

  const one = st.kind === "bound" && st.clocked ? { side: "state" as const, src: st } : ladder.kind === "bound" && ladder.clocked ? { side: "ladder" as const, src: ladder } : null;
  if (one) {
    const other: GexSide = one.side === "state" ? "ladder" : "state";
    const otherSrc = other === "state" ? st : ladder;
    // The other half cannot be bound here: a bound other half would have taken the pair path.
    const otherNote =
      otherSrc.kind === "withheld"
        ? `the ${other} is withheld (${String(otherSrc.record.reason)})`
        : otherSrc.kind === "failed"
          ? `the ${failedNote(other)}`
          : `no ${other} was published for this root`;
    const p = one.src.payload;
    return {
      status: "partial",
      source: one.side,
      ...one.src.id,
      asof: p.asof,
      asof_state: one.side === "state" ? p.asof : null,
      asof_ladder: one.side === "ladder" ? p.asof : null,
      ...(one.side === "state" ? gexStateFields(p) : gexLadderFields(p)),
      limitations: `${one.side}-only GEX read on the ${one.side}'s own clock; ${otherNote}; nothing from the ${other} is included`,
      ...(Object.keys(withheld).length ? { withheld } : {}),
      ...(Object.keys(readFailures).length ? { read_failures: readFailures } : {}),
    };
  }

  for (const [side, src] of [["ladder", ladder], ["state", st]] as const) {
    if (src.kind === "bound") withheld[side] = { root: src.id.root, asof: src.payload.asof ?? null, reason: "no valid producer clock" };
  }
  if (Object.keys(readFailures).length) {
    const parts = (["state", "ladder"] as const).map((side) =>
      readFailures[side]
        ? failedNote(side)
        : withheld[side]
          ? `${side} withheld (${String((withheld[side] as Record<string, unknown>).reason)})`
          : `${side} not found in the hub or R2 mirror`,
    );
    return {
      status: "unavailable",
      no_data: true,
      reason: `GEX read failed, so GEX for ${owner ?? "the requested root"} is unknown, not absent: ${parts.join("; ")}`,
      read_failures: readFailures,
      ...(Object.keys(withheld).length ? { withheld } : {}),
    };
  }
  if (!Object.keys(withheld).length) {
    return { status: "unavailable", no_data: true, reason: "no GEX coverage for this root (options-hub covers liquid names only)" };
  }
  const reasons = Object.values(withheld).map((r) => String((r as Record<string, unknown>).reason));
  return {
    status: "unavailable",
    no_data: true,
    reason: `no GEX source could be bound to ${owner ?? "the requested root"}: ${reasons.join("; ")}`,
    withheld,
  };
}

export function curateFundamentals(fund: unknown): Record<string, unknown> {
  const f = fund as Record<string, unknown> | null;
  if (!f || typeof f !== "object" || !f.schema) return { no_data: true, reason: "no fundamentals file for symbol" };
  const profile = (f.profile ?? {}) as Record<string, unknown>;
  const stats = (f.stats ?? {}) as Record<string, unknown>;
  const cur = (((f.ratios ?? {}) as Record<string, unknown>).current ?? {}) as Record<string, unknown>;
  const earn = (f.earnings ?? {}) as Record<string, unknown>;
  const analyst = f.analyst as Record<string, unknown> | null;
  const divs = (f.dividends ?? {}) as Record<string, unknown>;

  const profileBits = [profile.sector, profile.industry, profile.hq, num(profile.employees) != null ? `${profile.employees} employees` : null].filter(Boolean);
  const q = Array.isArray(earn.q) ? (earn.q as Record<string, unknown>[]) : [];
  const nextEarnings = nextDateCountdown(earn.next_date) == null ? null : earn.next_date;

  return {
    asof: f.asof ?? null,
    currency: f.quote_currency ?? null,
    profile: trimStr([profileBits.join(" · "), trimStr(profile.description, 140)].filter(Boolean).join(" — "), 240),
    stats: { mktcap: num(stats.mktcap), beta: rnd(stats.beta), shares_out: num(stats.shares_out) },
    valuation: { pe_ttm: rnd(cur.pe_ttm), pe_fwd: rnd(cur.pe_fwd), ps: rnd(cur.ps), pb: rnd(cur.pb) },
    // fund.json percent fields are 0..1 FRACTIONS → labeled % strings (units contract)
    margins: { gross: fracToPct(cur.gross_margin), net: fracToPct(cur.net_margin), roe: fracToPct(cur.roe), roa: fracToPct(cur.roa) },
    debt_to_equity: num(cur.debt_to_equity) != null ? `${rnd(cur.debt_to_equity)} (raw ratio, not %)` : null,
    div_yield: fracToPct(num(divs.yield_ttm) ?? cur.div_yield, 2),
    next_earnings: nextEarnings,
    last_earnings: q.slice(-4).map((r) => ({
      period: r.period ?? null,
      eps_est: rnd(r.eps_e, 3),
      eps_act: rnd(r.eps_a, 3),
      // surp_pct is the units-contract exception: already percent points (AAPL Q3'20 = 24.47)
      surprise: num(r.surp_pct) != null ? `${rnd(r.surp_pct, 1)}%` : null,
    })),
    analyst: analyst
      ? {
          rating: analyst.rating_label ?? null,
          pt_mean: rnd((analyst.target as Record<string, unknown>)?.mean),
          pt_high: rnd((analyst.target as Record<string, unknown>)?.high),
          pt_low: rnd((analyst.target as Record<string, unknown>)?.low),
          n: num((analyst.target as Record<string, unknown>)?.n),
          dist: scalarize(analyst.dist),
        }
      : null,
  };
}

export function curateInsiders(ins: unknown): Record<string, unknown> {
  const i = ins as Record<string, unknown> | null;
  if (!i || typeof i !== "object" || num(i.score) == null) return { no_data: true, reason: "no insider-power file for symbol" };
  return {
    score: rnd(i.score, 1),
    signal: i.signal ?? null,
    confidence: i.confidence ?? null,
    net_usd: num(i.net_usd) != null ? Math.round(i.net_usd as number) : null,
    n_buyers: num(i.buyers),
    n_sellers: num(i.sellers),
    window_days: num(i.window_days),
    asof: i.asof ?? null,
    analysis: trimStr(i.analysis, 200),
  };
}

export function curateIntel(intel: unknown): Record<string, unknown> {
  const it = intel as Record<string, unknown> | null;
  if (!it || typeof it !== "object") return { no_data: true, reason: "no research-desk intel for symbol" };
  const cards = (it.cards ?? {}) as Record<string, unknown>;
  const tape = (it.tape ?? {}) as Record<string, unknown>;
  const analysis = (it.analysis ?? {}) as Record<string, unknown>;
  const aj = cards.ai_judgment as Record<string, unknown> | undefined;
  const conv = cards.conviction as Record<string, unknown> | undefined;
  const lean = tape.ai_lean as Record<string, unknown> | undefined;
  const sm = (cards.smart_money ?? analysis.smart_money) as Record<string, unknown> | undefined;
  const pulse = tape.sector_pulse as Record<string, unknown> | undefined;

  const holders = Array.isArray(sm?.holders) ? (sm!.holders as Record<string, unknown>[]) : [];
  const out: Record<string, unknown> = {
    asof: tape.asof ?? it.asof ?? null,
    ai_judgment: aj ? { verdict: aj.verdict ?? null, gloss: trimStr(aj.gloss, 200), size_pct: num(aj.size_pct) } : null,
    conviction: conv
      ? {
          score: num(conv.score),
          band: conv.band ?? null,
          drivers: Array.isArray(conv.drivers) ? (conv.drivers as unknown[]).slice(0, 4).map((d) => trimStr(d, 120)) : null,
          cautions: Array.isArray(conv.cautions) ? (conv.cautions as unknown[]).slice(0, 4).map((d) => trimStr(d, 120)) : null,
        }
      : null,
    ai_lean: lean ? { dir: lean.dir ?? null, band: lean.band ?? null, entry: lean.entry ?? null, score: num(lean.score) } : null,
    key_levels: scalarize(cards.levels),
    smart_money_summary: sm
      ? {
          n_holders: num(sm.n_holders),
          n_buying: num(sm.n_buying),
          n_selling: num(sm.n_selling),
          is_vip: typeof sm.is_vip === "boolean" ? sm.is_vip : null,
          top_holders: holders.slice(0, 3).map((h) => trimStr(h?.name, 60)).filter(Boolean),
        }
      : null,
    confluence_take: typeof analysis.confluence === "string" ? trimStr(analysis.confluence, 280) : scalarize(analysis.confluence),
    sector_pulse: pulse ? { theme: trimStr(pulse.theme, 80), heat: pulse.heat ?? null, reco: trimStr(pulse.reco, 120) } : null,
  };
  return out;
}

export function curateMarketRisk(mr: unknown, nowMs: number = Date.now()): Record<string, unknown> {
  const read = normalizeMarketRisk(mr, nowMs);
  if (!read) return { no_data: true, reason: "market_risk.json unavailable or invalid" };
  const obj = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fields = (value: unknown, keys: string[]) => {
    const input = obj(value);
    return Object.fromEntries(keys.map(key => [key, typeof input[key] === "string" ? trimStr(input[key], 96) : input[key] ?? null]));
  };
  const env = read.risk_envelope, transition = obj(env?.market_transition);
  const change = obj(transition.latest_recorded_change);
  const envelope = env ? {
    ...fields(env, ["bundle_id", "source_session", "revision", "data_state", "observed_at", "produced_at", "stale_after"]),
    measured_state: fields(env.measured_state, ["verdict", "score", "usable"]),
    hazard_summary: fields(env.hazard_summary, ["stage"]),
    policy_summary: fields(env.policy_summary, ["posture", "basis"]),
    rotation_context: fields(env.rotation_context, ["state", "as_of", "usable", "coverage"]),
    confluence: fields(env.confluence, ["state", "lineage_status", "nonredundant_component_count",
      "statistical_independence_established", "changes_hazard_stage", "changes_policy"]),
    market_transition: {
      current_matches_latest_record: transition.current_matches_latest_record ?? null,
      latest_recorded_change: Object.keys(change).length ? {
        before: fields(change.before, ["asof", "verdict"]), after: fields(change.after, ["asof", "verdict"]),
        verdict_changed: change.verdict_changed ?? null,
      } : null,
    },
    authority: fields(env.authority, ["envelope_may_rank", "envelope_may_gate", "envelope_may_size", "envelope_may_execute"]),
  } : null;
  return {
    verdict: read.verdict, score: rnd(read.score, 0), label: trimStr(read.label_en ?? read.verdict, 48),
    asof: read.asof, built: read.built, source_event_time: read.source_event_time, stale_after: read.stale_after,
    source_basis: read.source_basis, cause_basis: read.cause_basis,
    ...(read.display_pending || (read.source_verdict && read.source_verdict !== read.verdict)
      ? { source_verdict: read.source_verdict, display_pending: fields(read.display_pending, ["verdict", "ticks", "needs"]) } : {}),
    score_source: read.score_source, raw_score: read.raw_score, capped: read.capped,
    score_caps: read.score_caps.slice(0, 2).map(cap => scalarize(cap, 4)),
    stale: read.stale, stale_reasons: read.stale_reasons, age_hours: read.age_hours,
    risk_envelope: envelope,
    ...(envelope ? {} : { risk_envelope_freshness: read.risk_envelope_freshness }),
    is_display_only: true,
  };
}

export function curatePlane(plane: MarketPlane | null, nowMs: number = Date.now()): Record<string, unknown> {
  if (!plane || typeof plane !== "object" || (plane as Record<string, unknown>).error) {
    return { no_data: true, reason: "neural-web market plane feed unavailable" };
  }
  return {
    asof: plane.asof ?? null,
    verdict: plane.verdict?.verdict ?? null,
    verdict_score: rnd(plane.verdict?.score),
    label: plane.verdict?.label_en ?? null,
    regime: plane.regime
      ? {
          quad: plane.regime.quad_name ?? plane.regime.quad ?? null,
          confidence: rnd(plane.regime.confidence),
          cycle: plane.regime.cycle_tag ?? null,
          transition: plane.regime.transition_state ?? null,
        }
      : null,
    vol: plane.vol ? { regime: plane.vol.regime ?? null, risk_score: rnd(plane.vol.risk_score) } : null,
    liquidity: plane.liquidity_plumbing ? { state: plane.liquidity_plumbing.state ?? null, netliq_bn: rnd(plane.liquidity_plumbing.netliq_bn) } : null,
    contradictions: num(plane.contradiction_count),
    stale: isStalePlane(plane, nowMs),
    note: "display-only context — never a trade gate",
  };
}

/* ── tool schemas (OpenAI function format) ─────────────────────────────────── */

const symParam = { type: "object", properties: { symbol: { type: "string", description: "Ticker, e.g. AAPL or 0700.HK" } }, required: ["symbol"] };

export const COPILOT_TOOLS = [
  { type: "function", function: { name: "get_price_summary", description: "Price snapshot for a ticker: last, % change, today's OHLC/volume, 52-week high/low, trailing returns (1w/1m/3m/6m/YTD), ATR(14), 20-day avg volume, distance to 200-DMA.", parameters: symParam } },
  { type: "function", function: { name: "get_technicals", description: "Computed technicals from daily bars: TradingView-style Summary/Oscillators/Moving-Averages verdicts, RSI/Stoch/ADX/MACD values, classic pivots (P/R1/S1/R2/S2), Supertrend direction, Bollinger position.", parameters: symParam } },
  { type: "function", function: { name: "get_signals", description: "Golden-Oracle signal state for a ticker: current indicator state (position hint, last signal, regime flags), last 3 signals with reasons, condensed backtest metrics, honest read, and staleness.", parameters: symParam } },
  { type: "function", function: { name: "get_options_summary", description: "Options view for a ticker: IV term structure + slope, 25-delta skew, and dealer-gamma (GEX) positioning — net GEX, gamma flip, call/put walls, pin/magnet levels. Either half may report no_data.", parameters: symParam } },
  { type: "function", function: { name: "get_fundamentals", description: "Fundamentals for a ticker: profile one-liner, market cap/beta, valuation (P/E, P/S, P/B), margins & ROE (labeled %), debt-to-equity (raw ratio), dividend yield, last 4 earnings vs estimates, analyst rating and price targets.", parameters: symParam } },
  { type: "function", function: { name: "get_insiders", description: "Insider Power read for a ticker: score (0-100, 50 neutral), BUY/SELL/NEUTRAL signal, confidence, net insider dollars, buyer/seller counts and window.", parameters: symParam } },
  { type: "function", function: { name: "get_intel", description: "Research-desk intelligence for a ticker (curated): AI judgment + conviction score/drivers, desk lean, key levels, smart-money summary, confluence take, sector pulse.", parameters: symParam } },
  { type: "function", function: { name: "get_market_state", description: "Market-wide state (not per-ticker): risk-radar verdict/score plus the neural-web plane — macro regime quad, vol regime, liquidity state, contradiction count. Use for 'how's the market' context.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "screen", description: "Scan the universe. Optionally filter by verdict (BUY|SELL) and/or regime (bull|mixed). Returns up to 12 tickers ranked by win rate.", parameters: { type: "object", properties: { verdict: { type: "string" }, regime: { type: "string" } }, required: [] } } },
  { type: "function", function: { name: "annotate_chart", description: "Draw price levels onto the user's active chart. Use when the user asks you to mark/draw/annotate/show support, resistance, targets or notes. Derive prices from real data you fetched (e.g. 52-week highs/lows from get_price_summary, gamma walls from get_options_summary, key levels from get_intel) — never invent levels.", parameters: { type: "object", properties: { annotations: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["support", "resistance", "target", "level", "note"] }, price: { type: "number" }, label: { type: "string" } }, required: ["type", "price"] } } }, required: ["annotations"] } } },
];

/* ── executors ─────────────────────────────────────────────────────────────── */

async function runScreen(args: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const m = await getManifest();
  const syms = (m?.symbols ?? {}) as Record<string, Record<string, unknown>>;
  let rows: Record<string, unknown>[] = Object.entries(syms).map(([s, r]) => ({ ...r, symbol: s }));
  const verdict = typeof args?.verdict === "string" ? args.verdict.toUpperCase() : null;
  if (verdict) rows = rows.filter((r) => String(r.verdict ?? "").toUpperCase() === verdict || (verdict === "BUY" && ["BUY", "REBUY", "RECLAIM"].includes(String(r.verdict ?? "").toUpperCase())));
  const regime = typeof args?.regime === "string" ? args.regime.toLowerCase() : null;
  if (regime) rows = rows.filter((r) => (regime.startsWith("bull") ? !!r.regimeBull : !r.regimeBull));
  rows.sort((a, b) => ((b.wr as number) ?? 0) - ((a.wr as number) ?? 0));
  return {
    count: rows.length,
    results: rows.slice(0, 12).map((r) => ({
      symbol: r.symbol,
      last: r.last,
      chg: r.chg,
      verdict: r.verdict,
      verdict_date: r.vts ?? undefined,
      wr: r.wr,
      pf: r.pf,
      cagr: r.cagr,
      regimeBull: r.regimeBull,
    })),
  };
}

async function runMarketState(): Promise<Record<string, unknown>> {
  const [mr, plane] = await Promise.all([readDataJson("market_risk.json"), fetchPlane()]);
  const marketRisk = curateMarketRisk(mr);
  const result: Record<string, unknown> = { market_risk: marketRisk, neural_web_plane: curatePlane(plane) };
  // The generic cap may drop its largest root key. Preserve the actual market and
  // rotation reader by trimming verbose detail before that fallback can erase it.
  if (JSON.stringify(result).length > CAP_CHARS) {
    result.truncated = true;
    delete marketRisk.label;
    delete marketRisk.age_hours;
    if (Array.isArray(marketRisk.score_caps)) marketRisk.score_caps_omitted = marketRisk.score_caps.length;
    delete marketRisk.score_caps;
    const planeBudget = Math.max(100, CAP_CHARS - JSON.stringify(marketRisk).length - 70);
    result.neural_web_plane = capJson(result.neural_web_plane as Record<string, unknown>, planeBudget);
  }
  return result;
}

/**
 * execTool — the single server-side dispatcher historically used by /api/copilot.
 * annotate_chart is NOT handled here: it is client-executed (the route streams the
 * levels to the browser via the {type:"annotate"} SSE event).
 *
 * The shipped Terminal UI now uses the Mastermind Brain widget via /api/brain/*.
 * /api/copilot is a deprecated rollback proxy and is not the live consumer.
 * Original live-tool integration remains owed through owning Brain/Macro contracts.
 */
export async function execTool(name: string, args: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  try {
    if (name === "screen") return capJson(await runScreen(args));
    if (name === "get_market_state") return capJson(await runMarketState());

    // Everything below consumes a symbol → allowlist BEFORE any fs path is built.
    const raw = String(args?.symbol ?? "");
    if (!SYMBOL_RE.test(raw)) return { error: "invalid symbol" };
    const sym = raw.toUpperCase();

    switch (name) {
      case "get_price_summary": {
        const [row, ohlc] = await Promise.all([getManifestRow(sym), readOhlcCached(sym)]);
        return capJson({ symbol: sym, ...curatePriceSummary(row, ohlc) });
      }
      case "get_technicals": {
        const ohlc = await readOhlcCached(sym);
        return capJson({ symbol: sym, ...curateTechnicals(ohlc) });
      }
      case "get_signals": {
        const slice = await readDataJson(`${sym}.slice.json`);
        return capJson({ symbol: sym, ...curateSignals(slice) });
      }
      case "get_options_summary": {
        const [opts, gexPair] = await Promise.all([readDataFile(`${sym}.opts.json`), fetchGexPayloads(sym)]);
        const iv =
          opts.kind === "failed"
            ? { status: "unavailable", no_data: true, reason: `options IV file could not be read (${opts.reason}), so IV is unknown, not absent` }
            : curateOpts(opts.kind === "data" ? opts.payload : null);
        return capJson({ symbol: sym, iv, gex: curateGex(gexPair.gex, gexPair.state, sym) });
      }
      case "get_fundamentals": {
        const fund = await readDataJson(`${sym}.fund.json`);
        return capJson({ symbol: sym, ...curateFundamentals(fund) });
      }
      case "get_insiders": {
        const ins = await readDataJson(`${sym}.insider.json`);
        return capJson({ symbol: sym, ...curateInsiders(ins) });
      }
      case "get_intel": {
        const intel = await readDataJson(`${sym}.intel.json`);
        return capJson({ symbol: sym, ...curateIntel(intel) });
      }
      default:
        return { error: "unknown tool" };
    }
  } catch (e) {
    // Log server-side so a curator bug is distinguishable from genuinely missing coverage — the
    // model relays no_data as "surface isn't available", which would otherwise hide the bug forever.
    console.error(`[copilot] tool ${name} failed:`, e);
    return { no_data: true, reason: `tool ${name} failed (server error, not missing data)` };
  }
}
