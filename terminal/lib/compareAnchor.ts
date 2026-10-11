// Anchored benchmark comparison (E08) — the ONE place a compare leg is aligned, rebased, and
// qualified. Pure and deterministic: no I/O, no clock, no chart. ChartPanel's compare adapter
// feeds it the host rows already on the chart plus each leg's loaded document, draws exactly the
// `series` it returns, and forwards the `study` receipt to the readout. Nothing else computes a
// comparison value, so the readout cannot disagree with the lines.
//
// ── Anchor policy ──────────────────────────────────────────────────────────────────────────────
//   auto    The legacy default, kept for every layout saved before E08: each percent leg is
//           rebased at its OWN first session in common with the host rows. It is a function of the
//           host rows and that leg's document only, so the order or timing in which other legs load
//           cannot move it — but it does move if the leg's history itself changes, which is why it
//           is disclosed as "auto" and not as a pinned study.
//   date    An explicit date the user pinned (CmpCfg.anchor).
//   window  The visible window start, captured ONCE at the moment the user pinned it and persisted
//           as a date. The policy is never stored as "follow the window": a later scroll or zoom
//           therefore cannot move a pinned study (AC-E08-04).
//
// ── Resolving a pinned date (documented rules; nothing is invented) ─────────────────────────────
//   1. Host session: the first host bar ON OR AFTER the pinned date ("next session" when they
//      differ), provided it is within ROLL_FORWARD_MAX_DAYS calendar days. Further away — the date
//      precedes the host's history, sits in a data hole, or is after the last bar shown (a replay
//      position) — the anchor is UNAVAILABLE and every percent leg is withheld with that reason.
//   2. Leg observation at that session: the leg's own bar for the same session (or, on calendar
//      timeframes, the same calendar bucket). On daily timeframes only, when the leg's market was
//      closed that day, the leg's latest EARLIER close within ASOF_MAX_DAYS calendar days is used
//      ("prior session") and disclosed with its own date. Never a later close (that would be look-
//      ahead) and never a synthesized one. Otherwise the leg is WITHHELD, not drawn.
//
// ── Plotting ──────────────────────────────────────────────────────────────────────────────────
//   A leg value is plotted only on host sessions where the leg has its own observation. The legacy
//   adapter carried the last leg close forward across every unmatched session, which drew invented
//   flat segments through holidays, suspensions, and pre-listing history. Unmatched sessions are
//   now left blank: lightweight-charts joins consecutive points of a line series, so the segment
//   that would bridge a gap is given a transparent per-point colour (LWC strokes the segment from
//   point i-1 to i with point i-1's style), and the count is reported.
//
// ── Comparability (AC-E08-03) ───────────────────────────────────────────────────────────────────
//   The source documents carry no currency and no explicit total-return flag, so both are derived
//   from what IS known — the listing venue and the writer that produced the file (`src`):
//     polygon / massive / coinbase           price return, split-adjusted, dividends excluded
//     yahoo + index / FX / crypto            price (index level / rate pair / spot)
//     yahoo + equity or ETF                  adjusted close whose dividend treatment is not
//                                            uniform (an auto-adjusted backfill with split-only
//                                            daily bars appended after it)
//     fred / benchmark yields                a level, not a return
//     anything else (deep, composite, none)  unknown
//   A spread is presented as like-for-like only for the same known currency AND the same price-
//   return basis. Two adjusted-close series get an explicitly caveated, uncoloured spread. Any
//   other pairing gets no spread at all, with the reason. There is no FX-converted basis here.

import type { CmpAnchorSrc, CmpCfg, CmpMode } from "./compare";
import { parseComposite } from "./composite";
import { isDailyOnlySymbol, isMacroSymbol, macroKind } from "./macroSymbols";
import { marketOf } from "./markets";

export interface CmpBar { time: string; c: number }

export type CmpLegLoad =
  | { status: "data"; rows: CmpBar[]; src?: string | null }
  | { status: "absent" }
  | { status: "unavailable" };

export interface CompareStudyInput {
  host: { symbol: string; rows: CmpBar[]; src?: string | null };
  timeframe: string;
  legs: { symbol: string; cfg: CmpCfg; load: CmpLegLoad }[];
  /** Decimal places for plotted values — the chart's own price precision. */
  prec: number;
}

export type AnchorPolicy = "auto" | "date" | "window";
export type ReturnBasis = "price" | "adjusted" | "level" | "unknown";
export type Comparability = "comparable" | "caveat" | "incomparable";
export type ComparabilityReason =
  | "currency_unknown" | "currency_mismatch" | "basis_unknown" | "basis_level" | "basis_mismatch" | "basis_adjusted";
export type WithheldReason =
  | "no_overlap"
  | "anchor_after_host_end"
  | "anchor_before_host_history"
  | "anchor_gap_too_wide"
  | "anchor_before_leg_history"
  | "anchor_no_observation"
  | "bad_close";
export type LegStatus = "drawn" | "withheld" | "absent" | "unavailable";

export interface CmpAnchorReceipt {
  /** Host session the leg is rebased at. */
  effective: string;
  /** How that host session was reached from the policy. */
  hostRule: "exact" | "next_session" | "first_common";
  /** The leg's own observation used as the base, and how it was matched. */
  legTime: string;
  legRule: "exact" | "prior_session";
  hostClose: number;
  legClose: number;
}

export interface CmpStat {
  /** Last host session at or after the anchor with the leg's own observation. */
  end: string;
  legRet: number;
  hostRet: number;
  /** (legRet − hostRet) in percentage points; null when the pair is not comparable. */
  spreadPp: number | null;
  comparability: Comparability;
  reason?: ComparabilityReason;
}

export interface CmpLegReceipt {
  symbol: string;
  mode: CmpMode;
  color: string;
  policy: AnchorPolicy;
  requested: string | null;
  status: LegStatus;
  reason?: WithheldReason;
  basis: ReturnBasis;
  currency: string | null;
  src: string | null;
  /** Input revision of this leg: clean bars on this timeframe and the last one. */
  firstTime: string | null;
  lastTime: string | null;
  bars: number;
  anchor: CmpAnchorReceipt | null;
  /** Host sessions inside the plotted span left blank because the leg has no observation there. */
  unmatched: number;
  points: number;
  stat: CmpStat | null;
  digest: string;
}

export interface CompareStudy {
  host: { symbol: string; basis: ReturnBasis; currency: string | null; src: string | null; firstTime: string | null; lastTime: string | null; bars: number };
  timeframe: string;
  legs: CmpLegReceipt[];
  /** True when the drawn rebased legs do not all share one effective anchor. */
  mixedAnchors: boolean;
  /** Deterministic fingerprint of everything plotted — equal input revision ⇒ equal digest. */
  digest: string;
}

export interface CmpPoint { time: string; value: number; color?: string }
export interface CmpSeries { symbol: string; mode: CmpMode; data: CmpPoint[] }
export interface CompareStudyBuild { study: CompareStudy; series: CmpSeries[] }

/** Daily timeframes only: how far back a closed-market leg may reach for its anchor close. */
export const ASOF_MAX_DAYS = 5;
/** How far forward a pinned date may roll to the next host session, per timeframe. A calendar
 *  bucket is keyed by its LAST session, so a monthly bar legitimately sits ~4 weeks after the
 *  first day it covers. */
export const ROLL_FORWARD_MAX_DAYS: Record<string, number> = { D: 7, "2D": 10, "3D": 12, W: 10, "2W": 17, "1M": 35, "3M": 95 };
/** Transparent stroke for the one segment that would otherwise bridge unmatched sessions. */
export const CMP_GAP_COLOR = "rgba(0, 0, 0, 0)";

const CALENDAR_TF = new Set(["W", "2W", "1M", "3M"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in canonical YYYY-MM-DD form. */
export function isAnchorDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The anchor policy a stored leg config asks for. Anything malformed is the disclosed default. */
export function anchorSpecOf(cfg: Pick<CmpCfg, "anchor" | "anchorSrc"> | null | undefined): { policy: AnchorPolicy; requested: string | null } {
  if (cfg && isAnchorDate(cfg.anchor)) return { policy: cfg.anchorSrc === "window" ? "window" : "date", requested: cfg.anchor };
  return { policy: "auto", requested: null };
}

/** Patch that pins a leg to `date`, or clears the pin (`null`) back to the legacy auto anchor. */
export function withAnchor(cfg: CmpCfg, date: string | null, src: CmpAnchorSrc = "date"): CmpCfg {
  const { anchor: _a, anchorSrc: _s, ...rest } = cfg;
  return date && isAnchorDate(date) ? { ...rest, anchor: date, anchorSrc: src } : rest;
}

/** A lightweight-charts time (business-day string, BusinessDay object, or UTC seconds) as the
 *  calendar date it names. Used once, when the user pins the visible window start. */
export function visibleStartDate(t: unknown): string | null {
  if (typeof t === "string") return isAnchorDate(t) ? t : null;
  if (typeof t === "number" && Number.isFinite(t)) {
    const d = new Date(t * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (t && typeof t === "object") {
    const { year, month, day } = t as { year?: unknown; month?: unknown; day?: unknown };
    if (typeof year === "number" && typeof month === "number" && typeof day === "number") {
      const s = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return isAnchorDate(s) ? s : null;
    }
  }
  return null;
}

const dayNum = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86_400_000);

function isoWeek(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

/** Join key: the session itself on daily timeframes, the calendar bucket on W/2W/1M/3M (the same
 *  bucketing the chart's resampler uses), so a leg whose week ends on a different weekday than the
 *  host's (a market holiday) still joins its own week instead of leaving a false gap. */
export function joinKey(tf: string, time: string): string {
  if (!CALENDAR_TF.has(tf)) return time;
  if (tf === "W") return isoWeek(time);
  if (tf === "2W") return "b" + Math.floor(dayNum(isoWeek(time)) / 14);
  if (tf === "1M") return time.slice(0, 7);
  const m = +time.slice(5, 7) - 1;
  return `${time.slice(0, 4)}-Q${Math.floor(m / 3)}`;
}

/** Return basis of one series, from the writer that produced it and the symbol's shape. */
export function basisOf(symbol: string, src: string | null | undefined): ReturnBasis {
  if (parseComposite(symbol)) return "unknown";
  if (isDailyOnlySymbol(symbol)) return "level";
  const s = String(src ?? "").trim().toLowerCase();
  if (s === "fred") return "level";
  const kind = macroKind(symbol);
  if (kind === "rate") return "level";
  if (kind === "future") return "unknown";        // continuous contract; roll treatment undeclared
  if (s === "polygon" || s === "massive" || s === "coinbase") return "price";
  if (s === "yahoo") return kind === "index" || kind === "fx" || /-USDT?$/i.test(symbol) ? "price" : "adjusted";
  return "unknown";
}

/** Quote currency from the listing venue; null where the source does not establish it. */
export function currencyOf(symbol: string): string | null {
  if (parseComposite(symbol) || isMacroSymbol(symbol) || isDailyOnlySymbol(symbol)) return null;
  if (/-USDT$/i.test(symbol)) return "USDT";
  if (/-USD$/i.test(symbol)) return "USD";
  switch (marketOf(symbol)) {
    case "us": return "USD";
    case "cn": return "CNY";
    case "hk": return "HKD";
    case "ca": return "CAD";
    default: return null;
  }
}

export function comparabilityOf(
  host: { basis: ReturnBasis; currency: string | null },
  leg: { basis: ReturnBasis; currency: string | null },
): { state: Comparability; reason?: ComparabilityReason } {
  if (host.currency == null || leg.currency == null) return { state: "incomparable", reason: "currency_unknown" };
  if (host.currency !== leg.currency) return { state: "incomparable", reason: "currency_mismatch" };
  if (host.basis === "level" || leg.basis === "level") return { state: "incomparable", reason: "basis_level" };
  if (host.basis === "unknown" || leg.basis === "unknown") return { state: "incomparable", reason: "basis_unknown" };
  if (host.basis !== leg.basis) return { state: "incomparable", reason: "basis_mismatch" };
  if (host.basis === "adjusted") return { state: "caveat", reason: "basis_adjusted" };
  return { state: "comparable" };
}

/** FNV-1a 32-bit, hex. Deterministic and dependency-free; a fingerprint, not a security hash. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const goodClose = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

type HostAnchor =
  | { ok: true; index: number; rule: "exact" | "next_session" }
  | { ok: false; reason: WithheldReason };

/** Resolve a pinned date onto the host rows (rule 1). Shared by every leg with the same pin. */
export function resolveHostAnchor(rows: CmpBar[], timeframe: string, requested: string): HostAnchor {
  if (!rows.length) return { ok: false, reason: "anchor_after_host_end" };
  let index = -1;
  for (let i = 0; i < rows.length; i++) if (rows[i].time >= requested) { index = i; break; }
  if (index < 0) return { ok: false, reason: "anchor_after_host_end" };
  const at = rows[index].time;
  if (at === requested) return { ok: true, index, rule: "exact" };
  const tolerance = ROLL_FORWARD_MAX_DAYS[timeframe] ?? ROLL_FORWARD_MAX_DAYS.D;
  if (dayNum(at) - dayNum(requested) > tolerance) {
    return { ok: false, reason: index === 0 ? "anchor_before_host_history" : "anchor_gap_too_wide" };
  }
  return { ok: true, index, rule: "next_session" };
}

interface LegIndex { byKey: Map<string, CmpBar>; rows: CmpBar[] }

function indexLeg(rows: CmpBar[], timeframe: string): LegIndex {
  const byKey = new Map<string, CmpBar>();
  const clean: CmpBar[] = [];
  for (const r of rows) {
    if (!r || typeof r.time !== "string" || !goodClose(r.c)) continue;
    clean.push(r);
    byKey.set(joinKey(timeframe, r.time), r);
  }
  return { byKey, rows: clean };
}

/** Leg observation at host session `at` (rule 2). */
function legObservation(leg: LegIndex, timeframe: string, at: string):
  | { ok: true; bar: CmpBar; rule: "exact" | "prior_session" }
  | { ok: false; reason: WithheldReason } {
  const exact = leg.byKey.get(joinKey(timeframe, at));
  if (exact) return { ok: true, bar: exact, rule: "exact" };
  if (!leg.rows.length || leg.rows[0].time > at) return { ok: false, reason: "anchor_before_leg_history" };
  if (!CALENDAR_TF.has(timeframe)) {
    let prior: CmpBar | null = null;
    for (const r of leg.rows) { if (r.time < at) prior = r; else break; }
    if (prior && dayNum(at) - dayNum(prior.time) <= ASOF_MAX_DAYS) return { ok: true, bar: prior, rule: "prior_session" };
  }
  return { ok: false, reason: "anchor_no_observation" };
}

const fmt = (v: number, prec: number) => +v.toFixed(prec);

/** Build every compare leg against the host rows. Leg order in the output = input order. */
export function buildCompareStudy(input: CompareStudyInput): CompareStudyBuild {
  const { timeframe, prec } = input;
  const hostRows = input.host.rows.filter((r) => r && typeof r.time === "string" && goodClose(r.c));
  const hostSrc = input.host.src ?? null;
  const host = {
    symbol: input.host.symbol,
    basis: basisOf(input.host.symbol, hostSrc),
    currency: currencyOf(input.host.symbol),
    src: hostSrc,
    firstTime: hostRows[0]?.time ?? null,
    lastTime: hostRows[hostRows.length - 1]?.time ?? null,
    bars: hostRows.length,
  };
  const pinned = new Map<string, HostAnchor>();
  const legs: CmpLegReceipt[] = [];
  const series: CmpSeries[] = [];

  for (const { symbol, cfg, load } of input.legs) {
    const spec = anchorSpecOf(cfg);
    const src = load.status === "data" ? load.src ?? null : null;
    const base: CmpLegReceipt = {
      symbol, mode: cfg.mode, color: cfg.color, policy: spec.policy, requested: spec.requested,
      status: "withheld", basis: basisOf(symbol, src), currency: currencyOf(symbol), src,
      firstTime: null, lastTime: null, bars: 0, anchor: null, unmatched: 0, points: 0, stat: null, digest: fnv1a(""),
    };
    if (load.status !== "data") { legs.push({ ...base, status: load.status }); continue; }
    const leg = indexLeg(load.rows, timeframe);
    base.firstTime = leg.rows[0]?.time ?? null;
    base.lastTime = leg.rows[leg.rows.length - 1]?.time ?? null;
    base.bars = leg.rows.length;

    // Host rows that carry this leg's own observation — the only places it is ever plotted.
    const matched: (CmpBar | null)[] = hostRows.map((r) => leg.byKey.get(joinKey(timeframe, r.time)) ?? null);
    const firstMatch = matched.findIndex((m) => m != null);
    if (firstMatch < 0) { legs.push({ ...base, reason: "no_overlap" }); continue; }

    let scale = 1;
    let anchor: CmpAnchorReceipt | null = null;
    let anchorIndex = -1;
    if (cfg.mode === "percent") {
      if (spec.requested == null) {
        const hb = hostRows[firstMatch], lb = matched[firstMatch]!;
        anchorIndex = firstMatch;
        anchor = { effective: hb.time, hostRule: "first_common", legTime: lb.time, legRule: "exact", hostClose: hb.c, legClose: lb.c };
      } else {
        let ha = pinned.get(spec.requested);
        if (!ha) { ha = resolveHostAnchor(hostRows, timeframe, spec.requested); pinned.set(spec.requested, ha); }
        if (!ha.ok) { legs.push({ ...base, reason: ha.reason }); continue; }
        const hb = hostRows[ha.index];
        const obs = legObservation(leg, timeframe, hb.time);
        if (!obs.ok) { legs.push({ ...base, reason: obs.reason }); continue; }
        anchorIndex = ha.index;
        anchor = { effective: hb.time, hostRule: ha.rule, legTime: obs.bar.time, legRule: obs.rule, hostClose: hb.c, legClose: obs.bar.c };
      }
      scale = anchor.hostClose / anchor.legClose;
      if (!Number.isFinite(scale) || scale <= 0) { legs.push({ ...base, reason: "bad_close" }); continue; }
    }

    // Plot only observed sessions; blank (transparent) the one segment bridging each gap.
    const data: CmpPoint[] = [];
    let unmatched = 0, pendingGap = false, lastMatch = firstMatch;
    for (let i = firstMatch; i < hostRows.length; i++) {
      const m = matched[i];
      if (!m) { pendingGap = true; continue; }
      if (pendingGap && data.length) {
        data[data.length - 1] = { ...data[data.length - 1], color: CMP_GAP_COLOR };
        unmatched += i - lastMatch - 1;
      }
      pendingGap = false; lastMatch = i;
      data.push({ time: hostRows[i].time, value: fmt(m.c * scale, prec) });
    }

    let stat: CmpStat | null = null;
    if (anchor) {
      let endIndex = -1;
      for (let i = hostRows.length - 1; i >= anchorIndex; i--) if (matched[i]) { endIndex = i; break; }
      if (endIndex < 0) endIndex = anchorIndex;   // only the as-of anchor exists; no later shared session
      const legEnd = matched[endIndex]?.c ?? anchor.legClose;
      const legRet = legEnd / anchor.legClose - 1;
      const hostRet = hostRows[endIndex].c / anchor.hostClose - 1;
      const cmp = comparabilityOf(host, base);
      stat = {
        end: hostRows[endIndex].time, legRet, hostRet,
        spreadPp: cmp.state === "incomparable" ? null : (legRet - hostRet) * 100,
        comparability: cmp.state, ...(cmp.reason ? { reason: cmp.reason } : {}),
      };
    }

    const digest = fnv1a(`${symbol}|${cfg.mode}|${anchor?.effective ?? "-"}|${anchor?.legTime ?? "-"}|` +
      data.map((p) => `${p.time}:${p.value}${p.color ? "~" : ""}`).join(","));
    legs.push({ ...base, status: "drawn", anchor, unmatched, points: data.length, stat, digest });
    series.push({ symbol, mode: cfg.mode, data });
  }

  const effectiveAnchors = new Set(legs.filter((l) => l.status === "drawn" && l.anchor).map((l) => l.anchor!.effective));
  const digest = fnv1a(`${host.symbol}|${timeframe}|${host.bars}|${host.firstTime}|${host.lastTime}|` +
    legs.map((l) => `${l.symbol}:${l.status}:${l.reason ?? ""}:${l.digest}`).join(";"));
  return { study: { host, timeframe, legs, mixedAnchors: effectiveAnchors.size > 1, digest }, series };
}
