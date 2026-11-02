/**
 * flowPrintInspector.ts — W3A print-inspector projector (pure).
 *
 * Options R1 packet 3, "who traded this contract" (docs/OPTIONS_R1_W3_FREEZE § W3A
 * A1 + the 2026-10-21 field-policy amendment). Turns the flow owner's contract-level
 * event into an honest per-print view:
 *   - identity, premium arithmetic with the multiplier shown;
 *   - side as a named-method ESTIMATE — never a fact, never a confidence;
 *   - every clock/field the owner does not carry stays null (receipt clock,
 *     conditions, lineage, quote context) and renders "not supplied";
 *   - the dated contracts-over-prior-OI ratio only when OI is present;
 *   - "no package source is admitted" — similar timestamps alone never group.
 *
 * No React, no DOM, no network. Every field read from the payload is validated;
 * a row that fails identity/premium validation projects to null, never a partial.
 *
 * NOTE: this module is reached from client bundles (FeedPane/InspectorPane), so it
 * must not import lib/flowScore.ts — the tape score is read from the precomputed
 * payload field, exactly as the desk does (see flowRootCallSites boundary guard).
 */

import { FD } from "@/lib/flowdeskStrings";

// ─── Print view types ─────────────────────────────────────────────────────────

export type FlowPrintSide = "bought" | "sold" | "mixed" | "unknown";
export type FlowPrintMethod = "tape" | "floor" | "unknown";

export interface FlowPrintView {
  id: string;
  contract: { root: string; exp: string; strike: number; right: "C" | "P" };
  /** The owner's event clock, untouched. Never reused as a receipt clock. */
  eventTs: string;
  /** Not supplied by the flow owner — the wire is contract-level (W3A amendment). */
  receiptTs: null;
  conditions: null;
  lineage: null;
  quote: null;
  size: number;
  avgPrice: number;
  multiplier: 100;
  /** The owner's figure — shown as-is, with the arithmetic check beside it. */
  premium: number;
  /** |size × avgPrice × 100 − premium| ≤ 0.5 % of premium. */
  arithmeticReproduces: boolean;
  side: { estimate: FlowPrintSide; method: FlowPrintMethod; confidence: null };
  /** size / prior OI, only when OI is a finite number > 0. */
  ratio: { value: number; oiAsOf: string | null } | null;
  packages: "no_source_admitted";
}

/** Accepts a FlowEvent or any loose payload row — every field read is validated. */
export type FlowPrintInput = { [k: string]: unknown };

// TypeScript will not give an interface (FeedPane's FlowEvent) an implicit index
// signature, so the public entry points accept any object row and the internals
// read through the validated wire shape below. Validation is unchanged.
function wireRow(v: unknown): FlowPrintInput {
  return (typeof v === "object" && v !== null ? v : {}) as FlowPrintInput;
}

export interface FlowPrintCtx {
  /** Publication date of the prior-open-interest figure, when the desk has one. */
  oiAsOf?: string | null;
}

// ─── Validators ───────────────────────────────────────────────────────────────

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function tsTime(ts: unknown): number | null {
  if (!isStr(ts) || ts.length === 0) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

// ─── Projector ────────────────────────────────────────────────────────────────

export function projectFlowPrint(
  event: object,
  ctx?: FlowPrintCtx,
): FlowPrintView | null {
  if (!event || typeof event !== "object") return null;
  const ev = wireRow(event);

  const { root, exp, strike, right, ts, premium } = ev;
  if (!isStr(root) || root.length === 0) return null;
  if (!isStr(exp) || exp.length === 0) return null;
  if (!isNum(strike)) return null;
  if (right !== "C" && right !== "P") return null;
  if (!isStr(ts) || ts.length === 0) return null;
  if (!isNum(premium) || premium < 0) return null;

  const id = isStr(ev.id) ? ev.id : "";
  // Missing size/price project as NaN and render "not supplied" — never 0.
  const size = isNum(ev.size) ? ev.size : Number.NaN;
  const avgPrice = isNum(ev.avg_price) ? ev.avg_price : Number.NaN;
  const arithmeticReproduces =
    isNum(size) &&
    isNum(avgPrice) &&
    Math.abs(size * avgPrice * 100 - premium) <= 0.005 * premium;

  // Side is the owner's classification, mapped verbatim; anything outside the
  // owner's Side union (or absent) is unknown — never coerced.
  const estimate: FlowPrintSide =
    ev.side === "~buy"
      ? "bought"
      : ev.side === "~sell"
        ? "sold"
        : ev.side === "mixed"
          ? "mixed"
          : "unknown";

  // The method name replaces a confidence: the owner's signing evidence.
  const method: FlowPrintMethod =
    ev.signing_source === "tape"
      ? "tape"
      : ev.signing_source === "floor"
        ? "floor"
        : "unknown";

  // Contracts ÷ prior OI — only on a real, positive OI figure and a real size.
  const ratio =
    isNum(ev.oi) && ev.oi > 0 && isNum(size)
      ? { value: size / ev.oi, oiAsOf: ctx?.oiAsOf ?? null }
      : null;

  return {
    id,
    contract: { root, exp, strike, right },
    eventTs: ts,
    receiptTs: null,
    conditions: null,
    lineage: null,
    quote: null,
    size,
    avgPrice,
    multiplier: 100,
    premium,
    arithmeticReproduces,
    side: { estimate, method, confidence: null },
    ratio,
    packages: "no_source_admitted",
  };
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

export interface FlowCoverage {
  /** Eligible premium: every row with a finite premium, unknown included. */
  total: number;
  classified: number;
  unknown: number;
  /** Fractions 0..1; null when total is 0. Unknown never leaves the denominator. */
  classifiedShare: number | null;
  unknownShare: number | null;
  /** Unsigned totals by right — a different fact from the side estimate. */
  callPremium: number;
  putPremium: number;
  rows: number;
}

export function flowCoverage(events: readonly object[]): FlowCoverage {
  let total = 0;
  let classified = 0;
  let unknown = 0;
  let calls = 0;
  let puts = 0;
  let rows = 0;

  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const ev = wireRow(e);
    rows += 1;
    const prem = ev.premium;
    if (!isNum(prem)) continue;
    total += prem;
    if (ev.side === "~buy" || ev.side === "~sell" || ev.side === "mixed") {
      classified += prem;
    } else {
      unknown += prem;
    }
    if (ev.right === "C") calls += prem;
    else if (ev.right === "P") puts += prem;
  }

  return {
    total,
    classified,
    unknown,
    classifiedShare: total > 0 ? classified / total : null,
    unknownShare: total > 0 ? unknown / total : null,
    callPremium: calls,
    putPremium: puts,
    rows,
  };
}

// ─── Tape order ───────────────────────────────────────────────────────────────

/** Payload tape score (precomputed server-side). Malformed/missing = 0. */
function tapeScore(ev: FlowPrintInput): number {
  const fs = ev.flowScore;
  if (fs && typeof fs === "object" && isNum((fs as FlowPrintInput).score)) {
    return (fs as FlowPrintInput).score as number;
  }
  return 0;
}

function idCompare(a: FlowPrintInput, b: FlowPrintInput): number {
  const ia = isStr(a.id) ? a.id : "";
  const ib = isStr(b.id) ? b.id : "";
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

/**
 * Stable tape order for the feed. NEW: event time descending (invalid last), then
 * id ascending so equal timestamps never reorder across updates. SCORE: tape score
 * descending (missing = 0), then the NEW order.
 */
export function compareTape(a: object, b: object, mode: "NEW" | "SCORE"): number {
  if (mode === "SCORE") {
    const byScore = tapeScore(wireRow(b)) - tapeScore(wireRow(a));
    if (byScore !== 0) return byScore;
  }
  const ta = tsTime(wireRow(a).ts);
  const tb = tsTime(wireRow(b).ts);
  if (ta === null && tb === null) return idCompare(wireRow(a), wireRow(b));
  if (ta === null) return 1; // an invalid clock never wins the tape
  if (tb === null) return -1;
  if (tb !== ta) return tb - ta;
  return idCompare(wireRow(a), wireRow(b));
}

// ─── Localised label set ──────────────────────────────────────────────────────
// Every user-visible string lives in flowdeskStrings.ts (FD); this assembles the
// print-inspector subset so a view test can assert EN and ZH without rendering.

export interface FlowPrintStrings {
  eyebrow: string;
  eventLabel: string;
  receiptNotSupplied: string;
  exchCondNotSupplied: string;
  ownerFigure: string;
  notReproducibleFrom: string;
  arithNotSupplied: string;
  sideHeading: string;
  sideBought: string;
  sideSold: string;
  sideMixed: string;
  sideUnknown: string;
  methodPrefix: string;
  methodTape: string;
  methodFloor: string;
  methodNotSupplied: string;
  confidenceNotSupplied: string;
  lineageHeading: string;
  lineageNotSupplied: string;
  quoteNotSupplied: string;
  packagesHeading: string;
  packagesNone: string;
  activityHeading: string;
  ratioUnit: string;
  oiAsOfPrefix: string;
  oiDateNotSupplied: string;
  ratioNotSupplied: string;
  coverageClassifiedPart: string;
  coverageUnknownPart: string;
  coverageCalls: string;
  coveragePuts: string;
  coverageUnsigned: string;
  coverageEmpty: string;
}

export function flowPrintStrings(lang: "en" | "zh"): FlowPrintStrings {
  // The print-inspector keys are FD-native pairs (bi), not FLOW_LEX rows, so they
  // are read from FD directly — the same access pattern the flowdesk components use.
  const s = (key: keyof typeof FD) => (lang === "zh" ? FD[key].zh : FD[key].en);
  return {
    eyebrow: s("printEyebrow"),
    eventLabel: s("printEventLabel"),
    receiptNotSupplied: s("printReceiptNotSupplied"),
    exchCondNotSupplied: s("printExchCondNotSupplied"),
    ownerFigure: s("printOwnerFigure"),
    notReproducibleFrom: s("printNotReproducibleFrom"),
    arithNotSupplied: s("printArithNotSupplied"),
    sideHeading: s("printSideHeading"),
    sideBought: s("printSideBought"),
    sideSold: s("printSideSold"),
    sideMixed: s("printSideMixed"),
    sideUnknown: s("printSideUnknown"),
    methodPrefix: s("printMethodPrefix"),
    methodTape: s("printMethodTape"),
    methodFloor: s("printMethodFloor"),
    methodNotSupplied: s("printMethodNotSupplied"),
    confidenceNotSupplied: s("printConfidenceNotSupplied"),
    lineageHeading: s("printLineageHeading"),
    lineageNotSupplied: s("printLineageNotSupplied"),
    quoteNotSupplied: s("printQuoteNotSupplied"),
    packagesHeading: s("printPackagesHeading"),
    packagesNone: s("printPackagesNone"),
    activityHeading: s("printActivityHeading"),
    ratioUnit: s("printRatioUnit"),
    oiAsOfPrefix: s("printOiAsOfPrefix"),
    oiDateNotSupplied: s("printOiDateNotSupplied"),
    ratioNotSupplied: s("printRatioNotSupplied"),
    coverageClassifiedPart: s("coverageClassifiedPart"),
    coverageUnknownPart: s("coverageUnknownPart"),
    coverageCalls: s("coverageCalls"),
    coveragePuts: s("coveragePuts"),
    coverageUnsigned: s("coverageUnsigned"),
    coverageEmpty: s("coverageEmpty"),
  };
}

// ─── Pure formatters (shared by the inspector and the coverage line) ──────────

/** Full-figure premium with thousands separators: 504000 → "$504,000". */
export function formatPrintUsd(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** Contract price: 0.84 → "$0.84". */
export function formatPrintPrice(v: number): string {
  return `$${v.toFixed(2)}`;
}

/** Thousands-separated contract count: 6000 → "6,000". */
export function formatPrintSize(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

/** Compact signed-never premium for the coverage line: 2321000 → "$2.3M". */
export function formatCoverageUsd(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

/** Contracts ÷ prior OI, two decimals: 1.6304 → "1.63". */
export function formatRatio(v: number): string {
  return v.toFixed(2);
}

const ZH_MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

/** OI publication date: "2026-10-20" → "20 Oct" / "10月20日"; unparseable → raw. */
export function formatOiDate(iso: string, lang: "en" | "zh"): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return lang === "zh"
    ? `${d.getUTCDate()}日${ZH_MONTHS[d.getUTCMonth()]}`
    : `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

/** Event clock in the desk's ET convention: "10:40:12 ET". */
export function formatEventClock(ts: string): string {
  try {
    return `${new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "America/New_York", hour12: false,
    })} ET`;
  } catch {
    return ts;
  }
}
