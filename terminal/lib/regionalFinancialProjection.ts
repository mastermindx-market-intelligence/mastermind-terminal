/** Select the versioned CN financial projection without changing the cached envelope. */
import type { Fund } from "./fund";

const FIELD = "regional_financials";
const SCHEMA = "mastermind.regional-financials/v1";
const KEYS = ["statements", "earnings", "src", "data_freshness"] as const;
const PERIOD_ARRAYS = [
  "period_end", "period_start", "source_period_start", "fiscal_year", "period_kind",
  "period_number", "period_duration_months", "source_period_label", "is_cumulative",
  "normalization_method", "src_by_period", "comparison_basis", "source_family_by_period",
  "filed_by_period", "restated_by_period",
] as const;
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const hashShape = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

export function financialProjection(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(KEYS.map((key) => [key, raw[key] ?? null]));
}

/** Mirrors ingest/regional_financial_projection.py; no decimal formatting assumptions. */
export function canonicalFinancialProjection(value: unknown): string {
  const normalize = (item: unknown, depth = 0): unknown => {
    if (depth > 64) throw new Error("financial projection nesting too deep");
    if (item === null) return ["null"];
    if (typeof item === "boolean") return ["boolean", item];
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("financial projection number is not finite");
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, item, false);
      return ["number", [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")];
    }
    if (typeof item === "string") return ["string", item];
    if (Array.isArray(item)) return ["array", item.map((entry) => normalize(entry, depth + 1))];
    if (isObject(item) && Object.keys(item).every((key) => /^[\x00-\x7f]*$/.test(key))) {
      return ["object", Object.keys(item).sort().map((key) => [key, normalize(item[key], depth + 1)])];
    }
    throw new Error("invalid financial projection value");
  };
  return JSON.stringify(normalize(value));
}

function qualifiedShape(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).sort().join("|") !== [...KEYS].sort().join("|")
      || !isObject(value.statements) || !isObject(value.earnings) || !isObject(value.src)
      || value.src.statement_coverage_policy !== "yahoo_append_only") return false;
  for (const basis of ["annual", "quarterly"]) {
    const set = value.statements[basis];
    if (set === null) continue;
    if (!isObject(set) || set.flow_basis !== "mixed_period" || set.source_market !== "cn"
        || !Array.isArray(set.periods) || !set.periods.length) return false;
    const n = set.periods.length;
    if (!PERIOD_ARRAYS.every((key) => Array.isArray(set[key]) && set[key].length === n)) return false;
    const ends = set.period_end as unknown[];
    if (new Set(ends).size !== n || !ends.every((end) => typeof end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(end))) return false;
    if (!isObject(set.period_provenance)) return false;
    for (const section of ["income", "balance", "cashflow"]) {
      const values = set[section], receipts = set.period_provenance[section];
      if (!isObject(values) || !Array.isArray(receipts) || receipts.length !== n
          || !Object.values(values).every((series) => Array.isArray(series) && series.length === n
            && series.every((v) => v === null || (typeof v === "number" && Number.isFinite(v))))) return false;
    }
  }
  return Array.isArray(value.earnings.q) && Array.isArray(value.earnings.fy);
}

type Selection = {
  raw: Record<string, unknown>;
  selected: Record<string, unknown>;
  base: string;
  encoded: string;
  baseHash: string;
  payloadHash: string;
};
function selection(input: unknown, ticker: string): Selection | null {
  // Verify and adopt one detached value, even if a caller mutates its cache while
  // WebCrypto is pending. The ordinary legacy path retains its existing identity.
  const raw: unknown = structuredClone(input);
  if (!isObject(raw) || !/^[0-9]{6}\.(SS|SZ|BJ)$/.test(ticker)
      || raw.schema !== "mastermind.fund/v1" || raw.ticker !== ticker
      || raw.quote_currency !== "CNY" || raw.stmt_currency !== "CNY") return null;
  const envelope = raw[FIELD];
  if (!isObject(envelope) || envelope.schema !== SCHEMA || envelope.ticker !== ticker
      || !hashShape(envelope.base_sha256) || !hashShape(envelope.payload_sha256)
      || typeof envelope.payload_json !== "string" || envelope.payload_json.length > 2_000_000) return null;
  const selected: unknown = JSON.parse(envelope.payload_json);
  if (!qualifiedShape(selected)) return null;
  return { raw, selected, base: canonicalFinancialProjection(financialProjection(raw)),
    encoded: envelope.payload_json, baseHash: envelope.base_sha256, payloadHash: envelope.payload_sha256 };
}
function adopt(s: Selection, baseHash: string, payloadHash: string): Fund | null {
  if (baseHash !== s.baseHash || payloadHash !== s.payloadHash) return null;
  const result = { ...s.raw, ...s.selected };
  delete result[FIELD];
  return result as unknown as Fund;
}
async function digest(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function materializeRegionalFund(raw: unknown, ticker: string): Promise<Fund | null> {
  if (!isObject(raw)) return null;
  if (!(FIELD in raw)) return raw as unknown as Fund;
  try {
    const s = selection(raw, ticker);
    if (!s) return null;
    const [baseHash, payloadHash] = await Promise.all([digest(s.base), digest(s.encoded)]);
    return adopt(s, baseHash, payloadHash);
  } catch { return null; }
}
/** The nightly Node producer supplies its existing native synchronous SHA implementation. */
export function materializeRegionalFundSync(
  raw: unknown, ticker: string, sha256: (text: string) => string,
): Fund | null {
  if (!isObject(raw)) return null;
  if (!(FIELD in raw)) return raw as unknown as Fund;
  try {
    const s = selection(raw, ticker);
    return s ? adopt(s, sha256(s.base), sha256(s.encoded)) : null;
  } catch { return null; }
}
