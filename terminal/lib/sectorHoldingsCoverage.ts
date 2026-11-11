/** W2B holdings coverage: how much of a sector fund the listed members account for, by count and by weight,
 * with the top-three concentration kept separate. Count coverage, weight coverage and concentration have
 * different denominators and are never merged into one number. An unknown total stays unknown. */
export const HOLDINGS_COVERAGE_SCHEMA = "sector_holdings.coverage.v1" as const;

export interface SectorHoldingsListed {
  ticker: string;
  weightPct: number;
  rank: number;
}

export interface SectorHoldingsFund {
  fund: string;
  asOf: string;
  listed: SectorHoldingsListed[];
  count: { listed: number; total: number | null };
  weightPct: number;
  concentration: { top3OfFundPct: number | null; top3OfSamplePct: number | null };
}

export interface SectorHoldingsCoverage {
  schema: typeof HOLDINGS_COVERAGE_SCHEMA;
  asOf: string;
  source: string;
  funds: Record<string, SectorHoldingsFund>;
}

type Row = Record<string, unknown>;

const FUND_PATTERN = /^[A-Z][A-Z0-9.]{0,11}$/;
const TICKER_PATTERN = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)?$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FUNDS = 40;
const MAX_LISTED = 60;
const MAX_SOURCE = 64;
const MAX_WEIGHT_SUM = 100.0001;
const RECOMPUTE_TOLERANCE = 0.01;

const isRow = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const hasKeys = (row: Row, required: readonly string[]): boolean =>
  required.every(key => Object.hasOwn(row, key)) && Object.keys(row).every(key => required.includes(key));
const strictDay = (value: unknown): value is string => typeof value === "string" && DAY_PATTERN.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const percent = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const near = (value: unknown, expected: number): boolean => typeof value === "number" && Number.isFinite(value) && Math.abs(value - expected) <= RECOMPUTE_TOLERANCE;
const round2 = (value: number): number => Math.round(value * 100) / 100;

function readListed(value: unknown): SectorHoldingsListed[] | null {
  if (!Array.isArray(value) || value.length > MAX_LISTED) return null;
  const rows: SectorHoldingsListed[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRow(raw) || !hasKeys(raw, ["ticker", "weight_pct", "rank"])) return null;
    const { ticker, weight_pct: weightPct, rank } = raw;
    if (typeof ticker !== "string" || !TICKER_PATTERN.test(ticker) || seen.has(ticker) || !percent(weightPct)) return null;
    if (rank !== rows.length + 1) return null;
    if (rows.length > 0 && weightPct > rows[rows.length - 1].weightPct) return null;
    seen.add(ticker);
    rows.push({ ticker, weightPct, rank });
  }
  return rows;
}

function readFund(value: unknown, asOf: string): SectorHoldingsFund | null {
  if (!isRow(value) || !hasKeys(value, ["fund", "as_of", "n_holdings_total", "total_unknown", "listed", "coverage"])) return null;
  const { fund, as_of: fundAsOf, n_holdings_total: total, total_unknown: totalUnknown, coverage } = value;
  if (typeof fund !== "string" || !FUND_PATTERN.test(fund) || !strictDay(fundAsOf) || fundAsOf > asOf) return null;
  const listed = readListed(value.listed);
  if (!listed || typeof totalUnknown !== "boolean") return null;
  if (totalUnknown ? total !== null : !(Number.isSafeInteger(total) && (total as number) >= 1 && (total as number) >= listed.length)) return null;
  if (!isRow(coverage) || !hasKeys(coverage, ["count", "weight_pct", "concentration"])) return null;
  const { count, weight_pct: weightPct, concentration } = coverage;
  if (!isRow(count) || !hasKeys(count, ["listed", "total"]) || count.listed !== listed.length || count.total !== total) return null;
  const sum = round2(listed.reduce((acc, row) => acc + row.weightPct, 0));
  if (!near(weightPct, sum) || (weightPct as number) > MAX_WEIGHT_SUM) return null;
  if (!isRow(concentration) || !hasKeys(concentration, ["top3_of_fund_pct", "top3_of_sample_pct"])) return null;
  const { top3_of_fund_pct: top3OfFund, top3_of_sample_pct: top3OfSample } = concentration;
  if (listed.length < 3) {
    if (top3OfFund !== null || top3OfSample !== null) return null;
    return { fund, asOf: fundAsOf, listed, count: { listed: listed.length, total: total as number | null }, weightPct: weightPct as number,
      concentration: { top3OfFundPct: null, top3OfSamplePct: null } };
  }
  const top3 = round2(listed[0].weightPct + listed[1].weightPct + listed[2].weightPct);
  if (!near(top3OfFund, top3)) return null;
  if (sum === 0 ? top3OfSample !== null : !near(top3OfSample, round2(top3 / sum * 100))) return null;
  return { fund, asOf: fundAsOf, listed, count: { listed: listed.length, total: total as number | null }, weightPct: weightPct as number,
    concentration: { top3OfFundPct: top3OfFund as number, top3OfSamplePct: top3OfSample as number | null } };
}

/** Strict reader: any violation returns null so no partially trusted feed reaches the comparison header. */
export function sectorHoldingsCoverage(data: unknown): SectorHoldingsCoverage | null {
  if (!isRow(data) || !hasKeys(data, ["meta", "funds"])) return null;
  const { meta, funds } = data;
  if (!isRow(meta) || !hasKeys(meta, ["schema", "asOf", "source"])) return null;
  if (meta.schema !== HOLDINGS_COVERAGE_SCHEMA || !strictDay(meta.asOf)) return null;
  if (typeof meta.source !== "string" || meta.source.length === 0 || meta.source.length > MAX_SOURCE) return null;
  if (!Array.isArray(funds) || funds.length > MAX_FUNDS) return null;
  const byFund: Record<string, SectorHoldingsFund> = {};
  for (const raw of funds) {
    const fund = readFund(raw, meta.asOf);
    if (!fund || Object.hasOwn(byFund, fund.fund)) return null;
    byFund[fund.fund] = fund;
  }
  return { schema: HOLDINGS_COVERAGE_SCHEMA, asOf: meta.asOf, source: meta.source, funds: byFund };
}

/** Exact-case lookup; a fund that is not in the feed is absent, never an empty fund. */
export function holdingsCoverageFor(coverage: SectorHoldingsCoverage, fund: string): SectorHoldingsFund | null {
  return Object.hasOwn(coverage.funds, fund) ? coverage.funds[fund] : null;
}

const oneDecimal = (value: number): string => (Math.round(value * 10) / 10).toString();

/** One line, three separate facts: how many of the fund's holdings are listed, how much fund weight they carry,
 * and how concentrated the top three are. The total count is said to be unknown when it is unknown. */
export function holdingsCoverageLine(fund: SectorHoldingsFund, lang: "en" | "zh"): string {
  const { listed, total } = fund.count;
  if (listed === 0) return lang === "en" ? `No holdings listed for ${fund.fund}` : `${fund.fund} 暂无持仓列表`;
  const weight = oneDecimal(fund.weightPct);
  const top3 = fund.concentration.top3OfFundPct;
  const parts = lang === "en"
    ? [total === null ? `Covers ${listed} holdings · total count unknown` : `Covers ${listed} of ${total} holdings`, `${weight}% of fund weight`]
    : [total === null ? `覆盖 ${listed} 只持仓 · 总数未知` : `覆盖 ${listed}/${total} 只持仓`, `占基金权重 ${weight}%`];
  if (top3 !== null) parts.push(lang === "en" ? `top 3 = ${oneDecimal(top3)}% of fund` : `前三大 = 基金的 ${oneDecimal(top3)}%`);
  return parts.join(" · ");
}
