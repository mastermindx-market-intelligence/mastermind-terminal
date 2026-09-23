/** Read-only adapters for the chart's options companion. No financial formula lives here.
 * Matrix GEX is dollars / +1% spot; the canonical GEX ladder's Vanna is millions /
 * +1 absolute vol point. Legacy matrix vex_mn is NOT dealer-signed and is never used.
 */
import { isMatrixDocForRoot, type MatrixDoc } from "@/components/gexdesk/matrixDoc";
import type { GexPayload } from "@/components/gexdesk/GexDeskView";
import type { MatrixHeatCell, StrikeExpiryDoc } from "@/components/shared/StrikeExpiryMatrix";

export type OptionsPerspective = "gamma" | "vanna" | "oi" | "flow";
export interface OptionsChartLevel {
  root: string;
  price: number;
  session: string;
  label: string;
}
export type CompanionIssue = "unavailable" | "identity" | "session" | "malformed";
export type Receipt<T> = { ok: true; value: T } | { ok: false; reason: CompanionIssue };
export interface CompanionMatrix {
  doc: MatrixDoc & StrikeExpiryDoc;
  session: string;
  root: string;
  missingCells: number;
}
export interface VannaProfile {
  root: string;
  session: string;
  spot: number | null;
  rows: { strike: number; valueMn: number | null }[];
}

export const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Do not silently map a crypto, foreign listing or index alias to another instrument. */
export function optionsRoot(symbol: string): string | null {
  const value = symbol.trim().toUpperCase();
  return value.length <= 12 && /^[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)?$/.test(value) ? value : null;
}

export function isoSession(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}

/** UTC is used only to reject impossible future source sessions, not to infer 0DTE. */
function validSession(value: unknown, nowMs: number): string | null {
  const session = isoSession(value);
  if (!Number.isFinite(nowMs)) return null;
  return session && session <= new Date(nowMs).toISOString().slice(0, 10) ? session : null;
}

export function readCompanionMatrix(raw: unknown, root: string, nowMs = Date.now()): Receipt<CompanionMatrix> {
  if (raw == null) return { ok: false, reason: "unavailable" };
  if (!isMatrixDocForRoot(raw, root)) return { ok: false, reason: "identity" };
  // asof is a BUILD clock. Require the existing producer's explicit cell-session stamp.
  const session = validSession(raw._build_meta?.asof_date, nowMs);
  if (!session) return { ok: false, reason: "session" };
  if (!raw.cells?.length) return { ok: false, reason: "unavailable" };
  if (raw.cells.length > 100_000) return { ok: false, reason: "malformed" };
  const keys = new Set<string>();
  const cells: MatrixHeatCell[] = [];
  let missingCells = 0;
  for (const cell of raw.cells) {
    if (!object(cell) || finite(cell.strike) == null || cell.strike <= 0 || !isoSession(cell.expiry)) {
      return { ok: false, reason: "malformed" };
    }
    const key = `${cell.strike}|${cell.expiry}`;
    if (keys.has(key)) return { ok: false, reason: "malformed" };
    keys.add(key);
    const gex = finite(cell.gex);
    if (gex == null) missingCells++;
    const magnitude = (v: unknown) => { const n = finite(v); return n !== null && n >= 0 ? n : null; };
    const doi = object(cell.delta_oi)
      ? { call: finite(cell.delta_oi.call), put: finite(cell.delta_oi.put) }
      : finite(cell.delta_oi);
    cells.push({ strike: cell.strike, expiry: cell.expiry, gex,
      call_oi: magnitude(cell.call_oi), put_oi: magnitude(cell.put_oi),
      call_vol: magnitude(cell.call_vol), put_vol: magnitude(cell.put_vol), delta_oi: doi });
  }
  const spot = finite(raw.spot);
  return { ok: true, value: {
    root, session, missingCells,
    doc: { ...raw, spot: spot !== null && spot > 0 ? spot : null, cells } as MatrixDoc & StrikeExpiryDoc,
  } };
}

/** An exact session cut, not the matrix's historical nearest-expiry fallback. */
export function matrixForExpiry(receipt: CompanionMatrix, scope: "all" | "0dte"): StrikeExpiryDoc {
  return scope === "all" ? receipt.doc : {
    ...receipt.doc,
    cells: receipt.doc.cells?.filter((cell) => cell.expiry === receipt.session),
  };
}

export function readVannaProfile(raw: unknown, root: string, nowMs = Date.now()): Receipt<VannaProfile> {
  if (raw == null) return { ok: false, reason: "unavailable" };
  const candidate = object(raw) && object(raw[root]) ? raw[root] : raw;
  if (!object(candidate) || candidate.root !== root || candidate.schema !== "options_hub.gex/v1") return { ok: false, reason: "identity" };
  const session = validSession(typeof candidate.asof === "string" ? candidate.asof.slice(0, 10) : null, nowMs);
  if (!session) return { ok: false, reason: "session" };
  if (!Array.isArray(candidate.by_strike) || candidate.by_strike.length > 10_000) return { ok: false, reason: "malformed" };
  const rows: VannaProfile["rows"] = [];
  const seen = new Set<number>();
  for (const item of candidate.by_strike) {
    if (!object(item) || finite(item.strike) == null || Number(item.strike) <= 0 || seen.has(Number(item.strike))) {
      return { ok: false, reason: "malformed" };
    }
    const strike = Number(item.strike);
    seen.add(strike);
    rows.push({ strike, valueMn: finite(item.vanna_net) });
  }
  if (!rows.some((row) => row.valueMn !== null)) return { ok: false, reason: "unavailable" };
  const spot = finite(candidate.spot_ref);
  return { ok: true, value: { root, session, spot: spot !== null && spot > 0 ? spot : null,
    rows: rows.sort((a, b) => b.strike - a.strike) } };
}

/** Unit-aware formatting retains small nonzero exposures instead of a confident “0.0M”. */
export function formatExposureMn(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const dollars = Math.abs(value) * 1e6;
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  const [amount, unit] = dollars >= 1e9 ? [dollars / 1e9, "B"]
    : dollars >= 1e6 ? [dollars / 1e6, "M"] : dollars >= 1e3 ? [dollars / 1e3, "K"] : [dollars, ""];
  return `${sign}${amount === 0 ? "0" : amount < 0.01 ? "<0.01" : amount.toLocaleString("en-US", { maximumFractionDigits: amount < 10 ? 2 : 1 })}${unit}`;
}

export function validOptionsChartLevel(level: OptionsChartLevel | null | undefined, root: string): level is OptionsChartLevel {
  return !!level && level.root === root && Number.isFinite(level.price) && level.price > 0 && !!isoSession(level.session);
}

// Keep this contract checked against the existing source, without importing its UI at runtime.
export type CanonicalVannaStrike = Pick<GexPayload["by_strike"][number], "strike" | "vanna_net">;

export interface CompanionFlowEvent { id: string; ts: string; exp: string; strike: number; right: "C" | "P"; premium: number; size: number | null }
/** Project only fields actually consumed. Invalid, duplicate and other-root rows never reach the tape. */
export function readCompanionFlow(raw: unknown, root: string): CompanionFlowEvent[] | null {
  if (!object(raw) || !Array.isArray(raw.events) || raw.events.length > 50_000) return null;
  const ids = new Set<string>();
  const rows: CompanionFlowEvent[] = [];
  for (const event of raw.events) {
    if (!object(event) || event.root !== root || typeof event.id !== "string" || ids.has(event.id)
      || typeof event.ts !== "string" || !Number.isFinite(Date.parse(event.ts)) || !isoSession(event.exp)
      || (event.right !== "C" && event.right !== "P")) continue;
    const strike = finite(event.strike), premium = finite(event.premium), size = finite(event.size);
    if (strike == null || strike <= 0 || premium == null || premium < 0) continue;
    ids.add(event.id);
    rows.push({ id: event.id, ts: event.ts, exp: event.exp as string, right: event.right, strike, premium, size: size != null && size >= 0 ? size : null });
  }
  return rows.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}
