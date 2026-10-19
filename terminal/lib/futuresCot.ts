/**
 * Public CFTC Traders in Financial Futures (TFF), futures-only positioning.
 *
 * Weekly regulator-reported open interest, NOT live trades, MBO depth, options
 * dealer gamma, a contract-specific book or a historical replay source.
 * CFTC does not supply publication timestamps on these row records.
 */
export type CotPair = "ES" | "NQ";
export type CotCategoryKey = "dealer" | "assetManager" | "leveragedMoney" | "otherReportable";
export type CotCategory = {
  key: CotCategoryKey;
  long: number;
  short: number;
  spread: number;
  net: number;
  weeklyNetChange: number | null;
};
export type CotSummary = {
  kind: "weekly_cftc_tff_futures_only";
  pair: CotPair;
  cftcCode: string;
  market: string;
  reportDate: string;
  previousReportDate: string | null;
  retrievedAtMs: number;
  openInterest: number;
  openInterestChange: number | null;
  categories: CotCategory[];
  sourceUrl: string;
  // There is no per-row first-available timestamp: never join to a replay.
  replayEligible: false;
};

export const CFTC_TFF_SOURCE = "https://publicreporting.cftc.gov/Commitments-of-Traders/TFF-Futures-Only/gpe5-46if";
const ENDPOINT = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
const CODE = { ES: "13874A", NQ: "209742" } as const;
const MARKETS = { ES: "E-MINI S&P 500", NQ: "NASDAQ MINI" } as const;
const DAY_MS = 86_400_000;

const GROUPS: ReadonlyArray<{
  key: CotCategoryKey; long: string; short: string; spread: string;
}> = [
  { key: "dealer", long: "dealer_positions_long_all", short: "dealer_positions_short_all", spread: "dealer_positions_spread_all" },
  { key: "assetManager", long: "asset_mgr_positions_long", short: "asset_mgr_positions_short", spread: "asset_mgr_positions_spread" },
  { key: "leveragedMoney", long: "lev_money_positions_long", short: "lev_money_positions_short", spread: "lev_money_positions_spread" },
  { key: "otherReportable", long: "other_rept_positions_long", short: "other_rept_positions_short", spread: "other_rept_positions_spread" },
];

export function cotSourceUrl(pair: CotPair): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("$where", "cftc_contract_market_code = '" + CODE[pair] + "'");
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$limit", "2");
  return url.toString();
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function integer(value: unknown): number | null {
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function date(value: unknown): { text: string; ms: number } | null {
  if (typeof value !== "string") return null;
  const text = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?$/.test(value)) return null;
  const ms = Date.parse(text + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text ? { text, ms } : null;
}

export function parseCotTff(rows: unknown, pair: CotPair, retrievedAtMs: number): CotSummary | null {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 2 ||
      !Number.isFinite(retrievedAtMs) || retrievedAtMs <= 0) return null;
  const current = record(rows[0]), previous = rows.length > 1 ? record(rows[1]) : null;
  if (!current || (rows.length > 1 && !previous)) return null;

  function validIdentity(row: Record<string, unknown>): boolean {
    return row.cftc_contract_market_code === CODE[pair] &&
      typeof row.market_and_exchange_names === "string" &&
      row.market_and_exchange_names.includes(MARKETS[pair]) &&
      row.market_and_exchange_names.includes("CHICAGO MERCANTILE EXCHANGE");
  }
  if (!validIdentity(current) || (previous && !validIdentity(previous))) return null;
  const latestDate = date(current.report_date_as_yyyy_mm_dd);
  const previousDate = previous ? date(previous.report_date_as_yyyy_mm_dd) : null;
  if (!latestDate || (previous && !previousDate) ||
      (previousDate && previousDate.ms >= latestDate.ms)) return null;
  // COT is weekly: reject future timestamps and long-abandoned reports.
  if (latestDate.ms > retrievedAtMs + DAY_MS || retrievedAtMs - latestDate.ms > 28 * DAY_MS) return null;
  const openInterest = integer(current.open_interest_all);
  const prevInterest = previous ? integer(previous.open_interest_all) : null;
  if (openInterest === null || (previous && prevInterest === null)) return null;
  const comparable = !!previousDate && latestDate.ms - previousDate.ms >= 5 * DAY_MS &&
    latestDate.ms - previousDate.ms <= 14 * DAY_MS;
  const categories: CotCategory[] = [];
  for (const group of GROUPS) {
    const long = integer(current[group.long]), short = integer(current[group.short]);
    const spread = integer(current[group.spread]);
    if (long === null || short === null || spread === null) return null;
    let weeklyNetChange: number | null = null;
    if (previous) {
      const prevLong = integer(previous[group.long]), prevShort = integer(previous[group.short]);
      if (prevLong === null || prevShort === null) return null;
      if (comparable) weeklyNetChange = (long - short) - (prevLong - prevShort);
    }
    categories.push({ key: group.key, long, short, spread, net: long - short, weeklyNetChange });
  }
  return {
    kind: "weekly_cftc_tff_futures_only", pair, cftcCode: CODE[pair],
    market: current.market_and_exchange_names as string,
    reportDate: latestDate.text, previousReportDate: previousDate?.text ?? null,
    retrievedAtMs, openInterest, openInterestChange: comparable && prevInterest !== null
      ? openInterest - prevInterest : null,
    categories, sourceUrl: CFTC_TFF_SOURCE, replayEligible: false,
  };
}

/** Only approved CFTC origin and fixed CFTC contract codes are requested. */
export async function readCotTff(pair: CotPair, nowMs = Date.now()): Promise<CotSummary | null> {
  const response = await fetch(cotSourceUrl(pair), {
    next: { revalidate: 6 * 60 * 60 },
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 64_000) return null;
  const body = await response.text();
  if (body.length > 64_000) return null;
  try { return parseCotTff(JSON.parse(body), pair, nowMs); } catch { return null; }
}
