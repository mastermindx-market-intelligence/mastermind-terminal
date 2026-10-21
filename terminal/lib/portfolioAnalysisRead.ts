import { finite, priceCurrency } from "@/lib/portfolioMoney";
import type { PortfolioRisk } from "@/lib/portfolioRisk";
import type { PortfolioRiskHistory } from "@/lib/portfolioRiskHistory";

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const nullableNumber = (v: unknown) => v === null || finite(v);
const count = (v: unknown) => finite(v) && Number.isInteger(v) && v >= 0;
const bilingual = (v: unknown) => object(v) && text(v.en) && text(v.zh);
const list = (v: unknown, check: (item: unknown) => boolean) => Array.isArray(v) && v.every(check);
const oneOf = (v: unknown, choices: readonly string[]) => text(v) && choices.includes(v);
const riskReasons = ["no_size", "no_page", "page_locked", "page_unreadable", "no_industry", "no_company_size", "no_thickness", "too_many_positions", "currency_unknown", "currency_mismatch", "amount_overflow"];
const historyExclusions = ["short", "unsized", "not_positive", "missing_price_history", "unreadable_price_history", "skipped_session"];
const historyReasons = [...historyExclusions, "risk-free series not published yet", "risk-free series could not be read", "could not read any holding's price history", "risk-free series is stale", "not enough history", "benchmark missing", "zero volatility", "zero downside deviation", "zero benchmark variance", "currency_unknown", "currency_mismatch", "amount_overflow"];

function concentration(v: unknown) {
  return v === null || (object(v) && (v.top1 === null || object(v.top1) && text(v.top1.ticker) && finite(v.top1.weightPct))
    && count(v.topNCount) && nullableNumber(v.topNWeightPct) && list(v.topNames, text));
}

/** Validate optional analysis once at the response boundary. A 200 response is
 * not proof that nested arrays/numbers are usable by the existing readouts. */
export function isPortfolioRisk(value: unknown): value is PortfolioRisk {
  if (!object(value)) return false;
  const v = value;
  return v.schema === "portfolio_risk.v1" && v.weightBasis === "cost"
    && oneOf(v.coverageSource, ["credentialed", "anonymous"])
    && object(v.counts) && ["total", "sized", "read"].every(k => count(v.counts && (v.counts as Record<string, unknown>)[k]))
    && nullableNumber(v.totalCost) && (v.totalCost === null || priceCurrency(v.costCurrency) !== null)
    && concentration(v.concentration)
    && list(v.sectors, row => object(row) && text(row.key) && bilingual(row.label) && finite(row.weightPct))
    && finite(v.sectorUncoveredPct) && finite(v.sizeUncoveredPct)
    && list(v.sizes, row => object(row) && oneOf(row.bucket, ["very_large", "large", "medium", "small", "very_small"]) && finite(row.weightPct))
    && (v.liquidity === null || object(v.liquidity) && finite(v.liquidity.thinPct) && list(v.liquidity.thinNames, text) && count(v.liquidity.readCount))
    && list(v.gaps, row => object(row) && text(row.ticker) && oneOf(row.reason, riskReasons));
}

export function isPortfolioRiskHistory(value: unknown): value is PortfolioRiskHistory {
  if (!object(value)) return false;
  const v = value;
  return v.schema === "portfolio_risk_history.v1" && v.weightBasis === "cost"
    && oneOf(v.coverageSource, ["credentialed", "anonymous"])
    && oneOf(v.coverageStatus, ["empty", "partial", "ready", "unavailable"])
    && v.basis === "cost-weighted, positive open holdings"
    && object(v.counts) && ["total", "open", "foldedTickers", "included", "excluded"].every(k => count((v.counts as Record<string, unknown>)[k]))
    && object(v.cost) && ["included", "excluded", "known"].every(k => nullableNumber((v.cost as Record<string, unknown>)[k]))
    && (v.cost.included === null || v.cost.included === 0 || priceCurrency(v.costCurrency) !== null)
    && object(v.sources) && ["ohlcAsOf", "spyAsOf", "riskFreeAsOf"].every(k => nullableText((v.sources as Record<string, unknown>)[k]))
    && v.sources.benchmark === "SPY" && oneOf(v.sources.riskFreeSource, ["DGS3MO", "us3m", "unpublished", "unreadable"])
    && object(v.window) && nullableText(v.window.firstSession) && nullableText(v.window.lastSession)
    && ["n", "requested", "minimum"].every(k => count((v.window as Record<string, unknown>)[k]))
    && list(v.included, row => object(row) && text(row.ticker) && finite(row.weightPct) && finite(row.cost))
    && list(v.excluded, row => object(row) && text(row.ticker) && oneOf(row.reason, historyExclusions))
    && list(v.gaps, row => object(row) && nullableText(row.ticker) && oneOf(row.reason, historyReasons))
    && ["sharpe", "sortino", "beta"].every(k => nullableNumber(v[k]))
    && ["sharpeReason", "sortinoReason", "betaReason"].every(k => v[k] === null || oneOf(v[k], historyReasons))
    && concentration(v.concentration);
}
