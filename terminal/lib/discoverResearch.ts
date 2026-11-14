import { marketOf, type MarketId } from "./markets";
import { ORACLE_STALE_DAYS, verdictIsStale } from "./signalVerdict";
import { verdictLabel } from "./plainLabels";
import { combineAll, type ScanMatch } from "./screenerScan";
import type { GexRegime } from "./mscGlance";
import { isPriced } from "./smartScreen/predicate";

/** One normalized manifest row for membership, sorting and in-place research. */
export type DiscoverRow = {
  sym: string; name: string; zh?: string; sec: string; col: string; mkt?: string;
  last: number | null; chg: number | null; vol: number | null;
  hi52: number | null; lo52: number | null; gics: string | null; mcap: number | null;
  verdict: string | null; vts?: string | null; wr: number | null; pf: number | null;
  cagr: number | null; regimeBull: boolean | null;
  dv: number | null; offHi: number | null; offLo: number | null; mktId: MarketId;
  mscRank?: number | null; mscRegime?: GexRegime | null; mscNetGex?: number | null; mscFlip?: number | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const number = (v: unknown) => finite(v) ? v : null;
const positive = (v: unknown) => finite(v) && v > 0 ? v : null;
const nonnegative = (v: unknown) => finite(v) && v >= 0 ? v : null;
const text = (v: unknown) => typeof v === "string" && v.trim() ? v : null;

export function normalizeDiscoverRow(sym: string, value: unknown): DiscoverRow {
  const r = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sec = text(r.sec) ?? "", mkt = text(r.mkt) ?? undefined;
  // The saved-screen grammar owns price admissibility. Preserve signed observations
  // where that contract allows them, independently of percentage-range eligibility.
  const price = (value: unknown) => { const v = number(value); return isPriced({ last: v, sec }) ? v : null; };
  const last = price(r.last);
  const vol = nonnegative(r.vol), hi52 = price(r.hi52), lo52 = price(r.lo52);
  const ratioPrice = last !== null && last > 0 ? last : null;
  const coherent = hi52 === null || lo52 === null || hi52 >= lo52;
  const product = ratioPrice !== null && vol !== null ? ratioPrice * vol : null;
  return {
    sym, name: text(r.name) ?? sym, zh: text(r.zh) ?? undefined, sec, col: text(r.col) ?? "#888", mkt,
    last, chg: number(r.chg), vol, hi52, lo52, gics: text(r.gics), mcap: positive(r.mcap),
    verdict: text(r.verdict), vts: text(r.vts),
    wr: finite(r.wr) && r.wr >= 0 && r.wr <= 1 ? r.wr : null,
    pf: nonnegative(r.pf), cagr: finite(r.cagr) && r.cagr >= -1 ? r.cagr : null,
    regimeBull: typeof r.regimeBull === "boolean" ? r.regimeBull : null,
    dv: product !== null && Number.isFinite(product) ? product : null,
    offHi: coherent && ratioPrice !== null && hi52 !== null && hi52 > 0 ? number((ratioPrice / hi52 - 1) * 100) : null,
    offLo: coherent && ratioPrice !== null && lo52 !== null && lo52 > 0 ? number((ratioPrice / lo52 - 1) * 100) : null,
    mktId: marketOf(sym, { mkt, sec }),
  };
}

export const isDiscoverBuy = (v: string | null) => v === "BUY" || v === "REBUY" || v === "RECLAIM";

export type DiscoverSignalAge = "recorded" | "historical" | "undated" | "invalid" | "future" | "uncovered";
export function discoverSignal(row: Pick<DiscoverRow, "verdict" | "vts">, lang: string, now: number) {
  const zh = lang === "zh";
  const label = row.verdict === "REBUY" ? zh ? "快速再入" : "Re-buy"
    : row.verdict === "RECLAIM" ? zh ? "重新入场" : "Re-entry"
    : row.verdict ? verdictLabel(row.verdict, zh ? "zh" : "en") : zh ? "未覆盖" : "Not covered";
  const stamp = row.vts ? Date.parse(row.vts) : NaN;
  const day = row.vts?.slice(0, 10);
  const valid = !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(stamp)
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  const age: DiscoverSignalAge = !row.verdict ? "uncovered" : !row.vts ? "undated" : !valid ? "invalid"
    : stamp > now ? "future" : verdictIsStale(row.vts, now) ? "historical" : "recorded";
  const ageLabel = {
    recorded: zh ? "已记录事件" : "Recorded event", historical: zh ? "历史事件" : "Historical event",
    undated: zh ? "日期未知" : "Date unknown", invalid: zh ? "日期无效" : "Invalid date",
    future: zh ? "日期待核实" : "Date unverified", uncovered: zh ? "未覆盖" : "Not covered",
  }[age];
  return { label, age, ageLabel, date: valid ? day! : null, dim: age !== "recorded", staleDays: ORACLE_STALE_DAYS };
}

export type DiscoverSearch = { kind: "text"; query: string } | { kind: "symbols"; symbols: string[] };
export function normalizeDiscoverSymbol(value: string | null | undefined): string {
  const symbol = value?.trim().replace(/^\$/, "").toUpperCase() ?? "";
  return /^[A-Z0-9][A-Z0-9.:^-]{0,30}$/.test(symbol) ? symbol : "";
}
/** A comma/newline explicitly requests exact listing IDs. Ordinary company-name
 * search retains its substring meaning, including Chinese names. */
export function parseDiscoverSearch(value: string): DiscoverSearch {
  if (/[,;\n]/.test(value)) return { kind: "symbols", symbols: [...new Set(value.split(/[,;\n]+/)
    .map(s => s.trim().replace(/^\$/, "").toUpperCase()).filter(Boolean))] };
  return { kind: "text", query: value.trim().replace(/^\$/, "").toLocaleLowerCase() };
}
export function matchesDiscoverSearch(row: Pick<DiscoverRow, "sym" | "name" | "zh">, search: DiscoverSearch): boolean {
  if (search.kind === "symbols") return search.symbols.includes(row.sym.toUpperCase());
  const q = search.query;
  return !q || row.sym.toLowerCase().includes(q) || row.name.toLocaleLowerCase().includes(q) || !!row.zh?.toLocaleLowerCase().includes(q);
}

export type DiscoverBaseFilters = {
  market: "all" | MarketId; asset: string; signal: "any" | "buy" | "sell" | "tracked";
  uptrend: boolean; unpriced: boolean; mcap: number;
  w52: "any" | "nearHigh" | "within15" | "dd30" | "nearLow";
  move: "any" | "up3" | "down3" | "abs5";
};
export type DiscoverCheck = { id: "price" | "market" | "asset" | "signal" | "regime" | "mcap" | "w52" | "move" | "search"; match: ScanMatch };
export type ResearchCondition = { label: string; value: string; match: ScanMatch; admittedUnknown?: boolean };
/** The table and inspector share the manifest predicates; absent values stay unknown. */
export function evaluateDiscoverBase(row: DiscoverRow, f: DiscoverBaseFilters, search: DiscoverSearch) {
  const checks: DiscoverCheck[] = [];
  const check = (id: DiscoverCheck["id"], value: boolean | null) => checks.push({ id, match: value === null ? "unknown" : value ? "pass" : "fail" });
  if (!f.unpriced) check("price", row.last === null ? null : true);
  if (f.market !== "all") check("market", row.mktId === f.market);
  if (f.asset !== "all") check("asset", row.sec === f.asset);
  if (f.signal !== "any") check("signal", row.verdict === null ? null : f.signal === "buy" ? isDiscoverBuy(row.verdict) : f.signal === "sell" ? row.verdict === "SELL" : true);
  if (f.uptrend) check("regime", row.regimeBull);
  if (f.mcap > 0) check("mcap", row.mcap === null ? null : row.mcap >= f.mcap);
  if (f.w52 !== "any") {
    const v = f.w52 === "nearLow" ? row.offLo : row.offHi;
    check("w52", v === null ? null : f.w52 === "nearHigh" ? v >= -5 : f.w52 === "within15" ? v >= -15 : f.w52 === "dd30" ? v <= -30 : v <= 10);
  }
  if (f.move !== "any") check("move", row.chg === null ? null : f.move === "up3" ? row.chg >= 3 : f.move === "down3" ? row.chg <= -3 : Math.abs(row.chg) >= 5);
  if (search.kind === "symbols" || search.query) check("search", matchesDiscoverSearch(row, search));
  return { match: combineAll(checks.map(c => c.match)), checks };
}

export const DISCOVER_COMPARE_CAP = 4;
export function toggleDiscoverComparison(ids: readonly string[], symbol: string): { ids: string[]; full: boolean } {
  if (ids.includes(symbol)) return { ids: ids.filter(id => id !== symbol), full: false };
  return ids.length >= DISCOVER_COMPARE_CAP ? { ids: [...ids], full: true } : { ids: [...ids, symbol], full: false };
}
export function discoverRange(row: Pick<DiscoverRow, "last" | "lo52" | "hi52">): number | null {
  if (row.last === null || row.last <= 0 || row.lo52 === null || row.lo52 <= 0 || row.hi52 === null || row.hi52 <= row.lo52) return null;
  return number((row.last - row.lo52) / (row.hi52 - row.lo52) * 100);
}

/** One quote subscriber serves the table plus the research surface actually open.
 * Selecting a closed comparison tray creates no demand. Hidden columns only stop the table lane. */
export function discoverQuoteDemand(visible: readonly Pick<DiscoverRow, "sym" | "mktId">[], open: readonly Pick<DiscoverRow, "sym" | "mktId">[], regularColumns: boolean, overnightColumns: boolean) {
  const unique = (rows: readonly Pick<DiscoverRow, "sym" | "mktId">[]) => [...new Map(rows.map(row => [row.sym, row])).values()];
  return {
    regular: unique([...(regularColumns ? visible : []), ...open]).map(row => row.sym),
    overnight: unique([...(overnightColumns ? visible : []), ...open]).filter(row => row.mktId === "us").map(row => row.sym),
  };
}
