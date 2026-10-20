/** Read-only adapters for the chart's options companion. No financial formula lives here.
 * Matrix GEX is dollars / +1% spot; the canonical GEX ladder's Vanna is millions /
 * +1 absolute vol point. Legacy matrix vex_mn is NOT dealer-signed and is never used.
 */
import { isMatrixDocForRoot, type MatrixDoc } from "@/components/gexdesk/matrixDoc";
import type { GexPayload } from "@/components/gexdesk/GexDeskView";
import type { MatrixHeatCell, StrikeExpiryDoc } from "@/components/shared/StrikeExpiryMatrix";
import { isGexDates } from "@/lib/gexSessions";
import { isoSession } from "@/lib/dte";
import { createExposureMapReader, type ExposureMapRead } from "@/lib/exposureMap";
import { exposureValueFingerprint } from "@/lib/exposureChartLink";
import type { ExposureLens, ProjectionReportedGamma } from "@/lib/exposureMapProjection";
import { compareReportedGamma, type ReportedGammaChange } from "@/lib/exposureReportedChange";

export type OptionsPerspective = "gamma" | "vanna" | "oi" | "flow";
export interface OptionsChartLevel {
  root: string;
  price: number;
  session: string;
  label: string;
}
export type CompanionIssue = "unavailable" | "identity" | "session" | "malformed" | "scope";
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

export interface CompanionGexSnapshot {
  root: string;
  session: string;
  spot: number | null;
  netGexBn: number | null;
  rows: { strike: number; gammaMn: number | null }[];
  measurement?: Pick<ExposureMapRead, "qualification" | "coverage" | "sourceRef"> & {
    coveredOnly: boolean; reportedGamma?: ProjectionReportedGamma;
  };
}

export interface CompanionGexMemory {
  current: CompanionGexSnapshot;
  previous: CompanionGexSnapshot;
  previousSession: string;
  strike: number | null;
  currentStrikeMn: number | null;
  previousStrikeMn: number | null;
  changeBasis: "aggregate_reference" | "unestablished";
  reportedChange?: ReportedGammaChange;
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

/** One strict session validator, owned by lib/dte and re-exported for existing callers. */
export { isoSession };

/** UTC is used only to reject impossible future source sessions, not to infer 0DTE. */
function validSession(value: unknown, nowMs: number): string | null {
  const session = isoSession(value);
  if (!Number.isFinite(nowMs)) return null;
  return session && session <= new Date(nowMs).toISOString().slice(0, 10) ? session : null;
}

export function readCompanionMatrix(raw: unknown, root: string, nowMs = Date.now()): Receipt<CompanionMatrix> {
  if (raw == null || (object(raw) && Object.keys(raw).length === 0)) return { ok: false, reason: "unavailable" };
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
    const pair = (left: unknown, right: unknown): [number | null, number | null] => {
      const a = magnitude(left), b = magnitude(right);
      return a != null && b != null ? [a, b] : [null, null];
    };
    const [callOi, putOi] = pair(cell.call_oi, cell.put_oi);
    const [callVol, putVol] = pair(cell.call_vol, cell.put_vol);
    const deltaCall = object(cell.delta_oi) ? finite(cell.delta_oi.call) : null;
    const deltaPut = object(cell.delta_oi) ? finite(cell.delta_oi.put) : null;
    const doi = object(cell.delta_oi)
      ? (deltaCall != null && deltaPut != null ? { call: deltaCall, put: deltaPut } : null)
      : finite(cell.delta_oi);
    // A missing side cannot become a confident total, especially a false measured zero.
    cells.push({ strike: cell.strike, expiry: cell.expiry, gex,
      call_oi: callOi, put_oi: putOi, call_vol: callVol, put_vol: putVol, delta_oi: doi });
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
    // Selected display axes change with the deliberate expiry filter; no front-expiry fallback.
    ...(Array.isArray(receipt.doc.expiries) ? { expiries: receipt.doc.expiries.filter(e => e === receipt.session) } : {}),
  };
}

/** Validate the canonical all-expiry GEX ladder without borrowing UI component state. */
export function readCompanionGexSnapshot(raw: unknown, root: string, nowMs = Date.now(), lens: ExposureLens = { kind: "all" }): Receipt<CompanionGexSnapshot> {
  if (raw == null || (object(raw) && Object.keys(raw).length === 0)) return { ok: false, reason: "unavailable" };
  const candidate = object(raw) && object(raw[root]) ? raw[root] : raw;
  if (!object(candidate) || candidate.root !== root || candidate.schema !== "options_hub.gex/v1") {
    return { ok: false, reason: "identity" };
  }
  const session = validSession(typeof candidate.asof === "string" ? candidate.asof.slice(0, 10) : null, nowMs);
  if (!session) return { ok: false, reason: "session" };
  if (candidate.exposure_projection != null) {
    const reader = createExposureMapReader(candidate, root, null, new Date(nowMs).toISOString().slice(0, 10), nowMs);
    const read = reader(lens, "gamma");
    if (read.state !== "data") {
      // A validated book can have no usable measurements in this exact lens.
      // Inspect all only to classify the failure, never to substitute its value.
      const full = lens.kind !== "all" ? reader({ kind: "all" }, "gamma") : null;
      return { ok: false, reason: full?.state === "data"
        && ["qualified", "dated"].includes(full.qualification) ? "scope" : "unavailable" };
    }
    if (read.qualification === "qualified" || read.qualification === "dated") {
      const reportedGamma = reader.reportedGamma(lens);
      return { ok: true, value: {
        root, session, spot: read.spot,
        netGexBn: read.summary.netTotalMn == null ? null : read.summary.netTotalMn / 1_000,
        rows: read.summary.nodes.map(row => ({ strike: row.strike, gammaMn: row.netMn }))
          .sort((a, b) => b.strike - a.strike),
        measurement: { qualification: read.qualification, coverage: read.coverage,
          sourceRef: read.sourceRef, coveredOnly: !!read.summary.coveredOnly,
          ...(reportedGamma ? { reportedGamma } : {}) },
      } };
    }
  }
  if (!Array.isArray(candidate.by_strike) || candidate.by_strike.length === 0 || candidate.by_strike.length > 10_000) {
    return { ok: false, reason: "malformed" };
  }
  const rows: CompanionGexSnapshot["rows"] = [];
  const seen = new Set<number>();
  for (const item of candidate.by_strike) {
    if (!object(item) || finite(item.strike) == null || Number(item.strike) <= 0 || seen.has(Number(item.strike))) {
      return { ok: false, reason: "malformed" };
    }
    const strike = Number(item.strike);
    seen.add(strike);
    rows.push({ strike, gammaMn: finite(item.gamma_net) });
  }
  if (!rows.some((row) => row.gammaMn !== null)) return { ok: false, reason: "unavailable" };
  // A valid aggregate archive exists, but cannot supply an expiry-specific value.
  if (lens.kind !== "all") return { ok: false, reason: "scope" };
  const spot = finite(candidate.spot_ref);
  return { ok: true, value: {
    root,
    session,
    spot: spot !== null && spot > 0 ? spot : null,
    netGexBn: finite(candidate.net_gex_bn),
    rows: rows.sort((a, b) => b.strike - a.strike),
  } };
}

/** Bind every admitted contribution and its source identity. Failure affects
 * comparison only; the already-validated snapshot remains inspectable. */
export async function bindCompanionGexComparison(snapshot: CompanionGexSnapshot): Promise<CompanionGexSnapshot> {
  const basis = snapshot.measurement?.reportedGamma;
  if (!basis) return snapshot;
  try {
    // Canonical exact coordinates plus value preserve every member while
    // keeping a 100k-member comparison inside the shared value-count bound.
    const members = basis.members.map(m => [JSON.stringify([m.expiry, m.strike, m.right]), m.valueUsd]);
    const sourceKey = await exposureValueFingerprint({ ...basis, members, sourceKey: null });
    return { ...snapshot, measurement: { ...snapshot.measurement!, reportedGamma: { ...basis, sourceKey } } };
  } catch {
    const measurement = { ...snapshot.measurement! };
    delete measurement.reportedGamma;
    return { ...snapshot, measurement };
  }
}

/** Pick the closest listed snapshot strictly before the matrix session. */
export function previousAvailableGexSession(raw: unknown, root: string, currentSession: string): Receipt<{ session: string | null }> {
  if (raw == null || (object(raw) && Object.keys(raw).length === 0)) return { ok: false, reason: "unavailable" };
  if (!isGexDates(raw)) return { ok: false, reason: "malformed" };
  if (raw.root.trim().toUpperCase() !== root) return { ok: false, reason: "identity" };
  const current = isoSession(currentSession);
  if (!current || raw.dates.some((date) => !isoSession(date))) return { ok: false, reason: "session" };
  return { ok: true, value: { session: raw.dates.find((date) => date < current) ?? null } };
}

/** Preserve each snapshot's measurement basis. A pair of projections does not
 * establish comparable contract membership, model history or correction vintage. */
export function buildCompanionGexMemory(
  current: CompanionGexSnapshot,
  previous: CompanionGexSnapshot,
  strike: number | null,
  originMs = Date.now(),
): CompanionGexMemory | null {
  if (current.root !== previous.root || previous.session >= current.session) return null;
  const exactStrike = strike != null && Number.isFinite(strike) && strike > 0 ? strike : null;
  const currentStrike = exactStrike == null ? undefined : current.rows.find((row) => row.strike === exactStrike);
  const previousStrike = exactStrike == null ? undefined : previous.rows.find((row) => row.strike === exactStrike);
  return {
    current,
    previous,
    previousSession: previous.session,
    strike: exactStrike,
    currentStrikeMn: currentStrike?.gammaMn ?? null,
    previousStrikeMn: previousStrike?.gammaMn ?? null,
    changeBasis: current.measurement || previous.measurement ? "unestablished" : "aggregate_reference",
    ...(current.measurement || previous.measurement ? { reportedChange: compareReportedGamma(
      current.measurement?.reportedGamma, previous.measurement?.reportedGamma, originMs) } : {}),
  };
}

export function readVannaProfile(raw: unknown, root: string, nowMs = Date.now()): Receipt<VannaProfile> {
  if (raw == null || (object(raw) && Object.keys(raw).length === 0)) return { ok: false, reason: "unavailable" };
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

/** Clocks carried on a matrix receipt. A missing field stays null; nothing is inferred from another clock. */
export interface MatrixReceipts {
  session: string;
  build: string | null;
  eod: string | null;
  greeks: string | null;
  oiPublication: string | null;
  previousOiPublication: string | null;
  latestOiPublication: string | null;
  spotClock: null;
  mixed: boolean;
}

/** Admits a real date, a clock time and an explicit zone, and returns that text unchanged. */
function buildClock(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const date = match[1];
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const zone = match[6];
  if (isoSession(date) === null) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return null;
  }
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function sourceClock(source: Record<string, unknown> | null, field: string): string | null {
  return source ? isoSession(source[field]) : null;
}

/** Read source, build and open-interest clocks only where this receipt actually carries them. */
export function readMatrixReceipts(receipt: CompanionMatrix): MatrixReceipts {
  let session = "";
  try {
    session = typeof receipt?.session === "string" ? receipt.session : "";
    const docUnknown: unknown = receipt?.doc;
    const doc = object(docUnknown) ? docUnknown : null;
    const build = doc ? buildClock(doc.asof) : null;
    const metaUnknown: unknown = doc?._build_meta;
    const meta = object(metaUnknown) ? metaUnknown : null;
    const source = meta && object(meta.source_dates) ? meta.source_dates : null;
    const eod = sourceClock(source, "eod");
    const greeks = sourceClock(source, "greeks");
    const oiPublication = sourceClock(source, "oi_publication");
    const previousOiPublication = sourceClock(source, "previous_oi_publication");
    const latestOiPublication = sourceClock(source, "latest_oi_publication");
    const mixed = [eod, greeks, oiPublication].some((clock) => clock !== null && clock !== session);
    return { session, build, eod, greeks, oiPublication, previousOiPublication, latestOiPublication, spotClock: null, mixed };
  } catch {
    return {
      session, build: null, eod: null, greeks: null, oiPublication: null,
      previousOiPublication: null, latestOiPublication: null, spotClock: null, mixed: false,
    };
  }
}

/** Identity of one published matrix build. Two reads of that build match; a new asof or session does not. Cells are not visited. */
export function matrixSnapshotKey(raw: unknown, root: string): string | null {
  try {
    if (!isMatrixDocForRoot(raw, root)) return null;
    const session = isoSession(raw._build_meta?.asof_date);
    if (!session) return null;
    return `${root}|${session}|${typeof raw.asof === "string" ? raw.asof : ""}`;
  } catch {
    return null;
  }
}
