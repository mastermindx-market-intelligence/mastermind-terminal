/** Returns Intelligence v1: observations are separate from forecasts.
 * All percentages are percentage points, except efficiency/concentration (fractions).
 * Trading-session membership comes from the existing Macro session projection.
 */
import { deriveDataOrigin } from "./dataOrigin";
import { usRegularSessionWindow, usEquitySessionCoverage } from "./usEquitySessionClock";

export const RETURNS_METHOD = "returns.trajectory.v1" as const;
export const RETURNS_HORIZONS = [5, 21, 63] as const;
export type ReturnsHorizon = typeof RETURNS_HORIZONS[number];
export type ReturnBasis = "adjusted_view" | "split_adjusted_price" | "reported_price";
export type ReturnQuality = "qualified" | "unverified" | "refused";
export type ReturnBar = { date: string; close: number; open: number | null; high: number | null; low: number | null; volume: number | null };
export interface ReturnSeries {
  symbol: string; bars: ReturnBar[]; basis: ReturnBasis; quality: ReturnQuality;
  source: string | null; issues: string[]; breaks: string[]; asOf: string | null;
  /** A current-member basket has no security OHLC or option root. */
  composite?: { members: string[]; membershipAsOf: string; weighting: "daily_rebalanced_equal_weight"; history: "current_members_reconstructed" };
}
export type Direction = "rising" | "falling" | "sideways" | "mixed" | "unqualified";
export type PaceChange = "rising_faster" | "rising_slower" | "falling_faster" | "falling_slower" | "turned_up" | "turned_down" | "steady" | "mixed" | "unqualified";
export interface Trajectory {
  horizon: ReturnsHorizon; start: string | null; end: string | null; complete: boolean;
  returnPct: number | null; pacePct: number | null; priorPacePct: number | null; paceDeltaPp: number | null;
  volatilityPct: number | null; drawdownPct: number | null; efficiency: number | null;
  concentration: number | null; upSessions: number | null; observedSessions: number;
  direction: Direction; paceChange: PaceChange; thresholdPct: number | null;
  issues: string[];
}
export type PathPoint = { date: string; value: number | null; benchmark: number | null; relative: number | null; drawdown: number | null };
export interface DailyMove { date: string; previousDate: string | null; bar: ReturnBar; returnPct: number | null; openingGapPct: number | null; intradayPct: number | null }
export type BasketResult =
  | { status: "ready"; series: ReturnSeries; members: { symbol: string; returnPct: number; relativePp: number; weight: number }[]; upShare: number; medianReturnPct: number; commonStart: string; commonEnd: string }
  | { status: "incomplete"; reason: string; missing: string[] };

export const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const validSymbol = (v: unknown): v is string => typeof v === "string" && /^[A-Z][A-Z0-9.-]{0,14}$/.test(v) && !/(-USD|\.(HK|TO|L|SS|SZ|AX|T))$/.test(v);
export function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith("0000")) return null;
  const d = new Date(v + "T00:00:00Z");
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** No new holiday authority. A missing/out-of-range projection is a failure. */
export function returnSessions(from: string, to: string): string[] | null {
  if (!isoDay(from) || !isoDay(to) || from > to) return null;
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
  if ((b - a) / 86400000 > 7300) return null;
  const days: string[] = [];
  try {
    for (let t = a; t <= b; t += 86400000) if (usRegularSessionWindow(t / 1000)) days.push(new Date(t).toISOString().slice(0, 10));
  } catch { return null; }
  return days;
}

/** Latest completed regular US-equity session; early closes use the same owner. */
export function completedReturnSession(now = new Date()): string | null {
  if (!Number.isFinite(now.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`, minute = Number(get("hour")) * 60 + Number(get("minute"));
  const end = Date.parse(day + "T00:00:00Z");
  try {
    for (let i = 0; i < 14; i++) {
      const t = end - i * 86400000, window = usRegularSessionWindow(t / 1000);
      if (window && (i > 0 || minute >= window[1])) return new Date(t).toISOString().slice(0, 10);
    }
  } catch { return null; }
  return null;
}

/** Strict symbol/date/close boundary. Invalid rows remain visible as missing sessions. */
export function decodeReturnSeries(symbol: string, input: unknown, through?: string | null): ReturnSeries {
  const doc = record(input), origin = deriveDataOrigin(symbol, input), issues: string[] = [];
  const publishedView = record(doc.view), contract = record(publishedView.contract), listing = record(publishedView.listing);
  const contractValid = contract.schema === "dataos.view_contract.v1" && contract.purpose === "terminal_daily_ohlc"
    && typeof contract.identity_namespace === "string" && !!contract.identity_namespace
    && Object.keys(record(contract.field_units)).length > 0 && Object.keys(record(contract.coverage)).length > 0
    && record(contract.evidence_mode).mode === "CURRENT" && ["XNYS", "XNAS", "XASE", "ARCX"].includes(String(listing.mic));
  let quality: ReturnQuality = origin.state === "known" && contractValid && !origin.basisDrift && !origin.suspectedBreaks ? "qualified" : "unverified";
  const basis: ReturnBasis = contractValid && origin.basis === "tradj" ? "adjusted_view" : "reported_price";
  const raw = Array.isArray(doc.bars) ? doc.bars : [];
  const byDate = new Map<string, ReturnBar>(), conflicts = new Set<string>();
  if (!validSymbol(symbol) || doc.t !== symbol || !Array.isArray(doc.bars) || raw.length > 30000) {
    return { symbol, bars: [], basis, quality: "refused", source: origin.src, issues: ["INVALID_SERIES"], breaks: [], asOf: null };
  }
  if (origin.state === "refused" || origin.basisDrift) { quality = "refused"; issues.push(...origin.refusals, ...(origin.basisDrift ? ["BASIS_DRIFT_SUSPECTED"] : [])); }
  const view = record(doc.view);
  const breaks = (Array.isArray(view.suspected_breaks) ? view.suspected_breaks : []).map(v => isoDay(record(v).at)).filter((v): v is string => v !== null);
  if (origin.suspectedBreaks && breaks.length !== origin.suspectedBreaks) { quality = "refused"; issues.push("UNLOCATED_BREAK"); }
  for (const value of raw) {
    const a = Array.isArray(value) ? value : null, o = record(value);
    const date = isoDay(a ? a[0] : o.time), close = a ? a[4] : o.c;
    if (!date || !finite(close) || close <= 0) { issues.push("INVALID_BAR"); continue; }
    if (through && date > through) continue;
    const vals = [a ? a[1] : o.o, a ? a[2] : o.h, a ? a[3] : o.l, a ? a[5] : o.v];
    const real = vals.slice(0, 3).every(v => finite(v) && v > 0)
      && (vals[1] as number) >= Math.max(vals[0] as number, close)
      && (vals[2] as number) <= Math.min(vals[0] as number, close)
      && !origin.openReconstructed && doc.bar_quality !== "synthetic_open_deepstore";
    const bar: ReturnBar = { date, close, open: real ? vals[0] as number : null, high: real ? vals[1] as number : null, low: real ? vals[2] as number : null, volume: finite(vals[3]) && vals[3] >= 0 ? vals[3] : null };
    const prev = byDate.get(date);
    if (prev && JSON.stringify(prev) !== JSON.stringify(bar)) conflicts.add(date);
    else byDate.set(date, bar);
  }
  for (const date of conflicts) byDate.delete(date);
  if (conflicts.size) issues.push("CONFLICTING_DUPLICATE");
  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Data OS remains the adjustment authority. A vendor name or a locally invented
  // receipt must never upgrade a missing Macro view contract into an adjusted series.
  if (quality === "unverified") issues.push("ADJUSTMENT_UNVERIFIED");
  if (!bars.length) issues.push("NO_HISTORY");
  return { symbol, bars, basis, quality, source: origin.src, issues: [...new Set(issues)], breaks, asOf: bars.at(-1)?.date ?? null };
}

function windowBars(series: ReturnSeries, n: number, offset = 0): { rows: ReturnBar[]; days: string[]; complete: boolean; issue?: string } {
  const last = series.asOf;
  if (!last || !series.bars.length) return { rows: [], days: [], complete: false, issue: "INSUFFICIENT_HISTORY" };
  const back = new Date(Date.parse(last + "T00:00:00Z") - (n + offset + 30) * 2 * 86400000).toISOString().slice(0, 10);
  const coverage = usEquitySessionCoverage();
  const all = coverage ? returnSessions(back < coverage.start ? coverage.start : back, last) : null;
  if (!all) return { rows: [], days: [], complete: false, issue: "SESSION_CLOCK_UNAVAILABLE" };
  const end = all.length - offset, days = all.slice(Math.max(0, end - n - 1), end), map = new Map(series.bars.map(b => [b.date, b]));
  const rows = days.flatMap(day => map.has(day) ? [map.get(day)!] : []);
  const crosses = days.length > 0 && series.breaks.some(day => day > days[0] && day <= days.at(-1)!);
  return { rows, days, complete: days.length === n + 1 && rows.length === days.length && !crosses && series.quality !== "refused",
    issue: crosses ? "SUSPECTED_BREAK" : series.quality === "refused" ? "SOURCE_REFUSED" : rows.length !== n + 1 ? "MISSING_SESSIONS" : undefined };
}
const mean = (v: readonly number[]) => v.reduce((s, n) => s + n, 0) / v.length;
function stdev(v: readonly number[]): number { if (v.length < 2) return 0; const m = mean(v); return Math.sqrt(v.reduce((s, n) => s + (n - m) ** 2, 0) / (v.length - 1)); }
function slope(rows: readonly ReturnBar[]): number {
  const mid = (rows.length - 1) / 2, logs = rows.map(b => Math.log(b.close)), y = mean(logs);
  return logs.reduce((s, n, i) => s + (i - mid) * (n - y), 0) / logs.reduce((s, _, i) => s + (i - mid) ** 2, 0);
}
const logMoves = (rows: readonly ReturnBar[]) => rows.slice(1).map((b, i) => Math.log(b.close / rows[i].close));

/** Window is h sessions + its prior close; there is no interpolation or compressed gap. */
export function trajectory(series: ReturnSeries, horizon: ReturnsHorizon): Trajectory {
  const w = windowBars(series, horizon), rows = w.rows;
  const first = rows.find(b => b.date === w.days[0]), last = rows.find(b => b.date === w.days.at(-1));
  const base: Trajectory = { horizon, start: w.days[0] ?? null, end: w.days.at(-1) ?? null, complete: w.complete,
    returnPct: first && last && series.quality !== "refused" && !series.breaks.some(d => d > first.date && d <= last.date) ? (last.close / first.close - 1) * 100 : null,
    pacePct: null, priorPacePct: null, paceDeltaPp: null, volatilityPct: null, drawdownPct: null, efficiency: null, concentration: null,
    upSessions: null, observedSessions: Math.max(0, rows.length - 1), direction: "unqualified", paceChange: "unqualified", thresholdPct: null,
    issues: [...series.issues, ...(w.issue ? [w.issue] : [])] };
  if (!w.complete) return base;
  const logs = logMoves(rows), beta = slope(rows), abs = logs.reduce((s, n) => s + Math.abs(n), 0), total = Math.log(last!.close / first!.close);
  let peak = rows[0].close, dd = 0;
  for (const b of rows) { peak = Math.max(peak, b.close); dd = Math.min(dd, b.close / peak - 1); }
  Object.assign(base, { pacePct: Math.expm1(beta) * 100, volatilityPct: stdev(logs) * Math.sqrt(252) * 100, drawdownPct: dd * 100,
    efficiency: abs > 0 ? total / abs : null, concentration: abs > 0 ? Math.max(...logs.map(Math.abs)) / abs : null, upSessions: logs.filter(r => r > 0).length });
  const prior = windowBars(series, horizon, horizon);
  if (prior.complete) { base.priorPacePct = Math.expm1(slope(prior.rows)) * 100; base.paceDeltaPp = base.pacePct! - base.priorPacePct; }
  let ref = windowBars(series, 63);
  if (!ref.complete) ref = windowBars(series, 21);
  if (series.quality !== "qualified" || !ref.complete) { base.issues.push(!ref.complete ? "VOLATILITY_REFERENCE_MISSING" : "STATE_UNQUALIFIED"); return base; }
  const theta = Math.max(Math.log(1.005), 0.5 * stdev(logMoves(ref.rows)) * Math.sqrt(horizon));
  base.thresholdPct = Math.expm1(theta) * 100;
  const fitted = horizon * beta, logPrices = rows.map(b => Math.log(b.close)), range = Math.max(...logPrices) - Math.min(...logPrices);
  base.direction = total >= theta && fitted >= theta ? "rising" : total <= -theta && fitted <= -theta ? "falling"
    : Math.abs(total) < theta && Math.abs(fitted) < theta && range <= 2 * theta ? "sideways" : "mixed";
  if (prior.complete) {
    const old = slope(prior.rows), change = horizon * (beta - old), oldFit = horizon * old;
    base.paceChange = Math.abs(change) < theta ? "steady"
      : fitted >= theta ? oldFit <= -theta ? "turned_up" : change >= theta ? "rising_faster" : "rising_slower"
      : fitted <= -theta ? oldFit >= theta ? "turned_down" : change <= -theta ? "falling_faster" : "falling_slower" : "mixed";
  }
  return base;
}

/** Full displayed path, sharing a baseline and date axis. Relative is wealth-ratio return. */
export function returnPath(series: ReturnSeries, benchmark: ReturnSeries | null, sessions: number): PathPoint[] {
  const w = windowBars(series, sessions), map = new Map(series.bars.map(b => [b.date, b.close]));
  const bmap = new Map(benchmark?.bars.map(b => [b.date, b.close]) ?? []);
  const first = w.days.findIndex(day => map.has(day));
  if (first < 0 || series.quality === "refused") return [];
  const days = w.days.slice(first), anchor = map.get(days[0])!, bAnchor = bmap.get(days[0]);
  // Both unverified series remain explicitly reported-price comparisons. Different
  // published bases never get a relative line or benchmark performance number.
  const comparable = benchmark?.quality !== "refused" && series.basis === benchmark?.basis && !!bAnchor;
  let peak = anchor, intact = true;
  return days.map((date, i) => {
    const close = map.get(date), b = bmap.get(date), broken = series.breaks.some(d => d > days[0] && d <= date);
    if (close == null || broken) { intact = false; return { date, value: null, benchmark: null, relative: null, drawdown: null }; }
    peak = Math.max(peak, close);
    const value = (close / anchor - 1) * 100, bench = comparable && b != null && !benchmark!.breaks.some(d => d > days[0] && d <= date) ? (b / bAnchor! - 1) * 100 : null;
    return { date, value, benchmark: bench, relative: bench !== null ? ((1 + value / 100) / (1 + bench / 100) - 1) * 100 : null,
      drawdown: intact || i === 0 ? (close / peak - 1) * 100 : null };
  });
}

export function dailyMoves(series: ReturnSeries): DailyMove[] {
  const map = new Map(series.bars.map(b => [b.date, b]));
  if (!series.bars.length) return [];
  const coverage = usEquitySessionCoverage();
  const supportedBars = coverage ? series.bars.filter(b => b.date >= coverage.start && b.date <= coverage.end) : [];
  const days = supportedBars.length ? returnSessions(supportedBars[0].date, supportedBars.at(-1)!.date) : null;
  const positions = new Map(days?.map((d, i) => [d, i]) ?? []);
  return supportedBars.map(bar => {
    const index = positions.get(bar.date), previousDate = index != null && index > 0 ? days![index - 1] : null;
    const prev = previousDate ? map.get(previousDate) : null;
    const usable = !!prev && series.quality !== "refused" && !series.breaks.some(d => d > prev.date && d <= bar.date);
    return { date: bar.date, previousDate, bar, returnPct: usable ? (bar.close / prev!.close - 1) * 100 : null,
      openingGapPct: usable && bar.open !== null ? (bar.open / prev!.close - 1) * 100 : null,
      intradayPct: bar.open !== null && series.quality !== "refused" ? (bar.close / bar.open - 1) * 100 : null };
  });
}

export function buildCurrentBasket(inputs: readonly ReturnSeries[], horizon: ReturnsHorizon, membershipAsOf: string): BasketResult {
  const fail = (reason: string, missing: string[] = []): BasketResult => ({ status: "incomplete", reason, missing });
  if (inputs.length < 2 || inputs.length > 256 || new Set(inputs.map(s => s.symbol)).size !== inputs.length || !isoDay(membershipAsOf)) return fail("INVALID_MEMBERSHIP");
  const bad = inputs.filter(s => !s.bars.length || !s.asOf || s.quality === "refused");
  if (bad.length) return fail("MEMBERS_UNAVAILABLE", bad.map(s => s.symbol));
  if (new Set(inputs.map(s => s.basis)).size !== 1) return fail("INCOMPARABLE_BASES");
  const end = inputs.map(s => s.asOf!).sort()[0];
  const back = new Date(Date.parse(end + "T00:00:00Z") - 600 * 86400000).toISOString().slice(0, 10);
  const requested = returnSessions(back, end)?.slice(-253);
  if (!requested?.length) return fail("SESSION_CLOCK_UNAVAILABLE");
  const start = [...inputs.map(s => s.bars[0].date), requested[0]].sort().at(-1)!;
  const days = requested.filter(d => d >= start);
  if (!days || days.length <= horizon) return fail("INSUFFICIENT_COMMON_HISTORY");
  const maps = inputs.map(s => new Map(s.bars.map(b => [b.date, b.close])));
  const incomplete = inputs.filter((s, i) => days.some(d => !maps[i].has(d)) || s.breaks.some(d => d > start && d <= end));
  if (incomplete.length) return fail("INCOMPLETE_MEMBERSHIP_HISTORY", incomplete.map(s => s.symbol));
  let wealth = 100;
  const bars: ReturnBar[] = days.map((date, i) => {
    if (i > 0) wealth *= 1 + mean(maps.map(m => m.get(date)! / m.get(days[i - 1])! - 1));
    return { date, close: wealth, open: null, high: null, low: null, volume: null };
  });
  const series: ReturnSeries = { symbol: "BASKET", bars, asOf: end, basis: inputs[0].basis,
    quality: inputs.every(s => s.quality === "qualified") ? "qualified" : "unverified", source: "constituent_daily_closes",
    issues: inputs.every(s => s.quality === "qualified") ? [] : ["ADJUSTMENT_UNVERIFIED"], breaks: [],
    composite: { members: inputs.map(s => s.symbol), membershipAsOf, weighting: "daily_rebalanced_equal_weight", history: "current_members_reconstructed" } };
  const hStart = days.at(-horizon - 1)!, total = trajectory(series, horizon).returnPct!;
  const members = inputs.map((s, i) => ({ symbol: s.symbol, returnPct: (maps[i].get(end)! / maps[i].get(hStart)! - 1) * 100, relativePp: 0, weight: 1 / inputs.length }));
  for (const m of members) m.relativePp = m.returnPct - total;
  const sorted = members.map(m => m.returnPct).sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { status: "ready", series, members, upShare: members.filter(m => m.returnPct > 0).length / members.length,
    medianReturnPct: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, commonStart: start, commonEnd: end };
}
