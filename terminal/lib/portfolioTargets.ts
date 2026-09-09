// B-F08-B5-1 — portfolio construction targets over canonical holdings.
//
// TWO-ORGANISMS LAW (UWP-R2): this module never scores, ranks, or recommends. It reports the
// user's own typed weight targets against the same cost-basis weights portfolioRisk.ts already
// uses. No React, no fetch. Authority ceiling is human_research_only: a drift fact, never a trade.
//
// STUB: the tests in lib/__tests__/portfolioTargets.test.ts are written first and must fail
// against this file before the implementation lands.

import type { Lang, Bilingual, RiskInputPosition } from "@/lib/portfolioRisk";

export type { Lang, Bilingual };

export type NumericField =
  | { kind: "value"; value: number }
  | { kind: "invalid" };

export type PortfolioTarget = {
  ticker: string;
  targetWeightPct: number;
  bandPct: number;
  updatedAt: string | null;
};

export type TargetStatus = "within_band" | "outside_band" | "unweighable";

export type TargetDrift = {
  ticker: string;
  currentWeightPct: number | null;
  targetWeightPct: number;
  bandPct: number;
  driftPct: number | null;
  status: TargetStatus;
};

export type UntargetedHolding = { ticker: string; currentWeightPct: number | null };
export type OrphanedTarget = { ticker: string; targetWeightPct: number; bandPct: number };

export interface PortfolioTargetsSummary {
  schema: "portfolio_targets.v1";
  weightBasis: "cost";
  targetsSumPct: number | null;
  targetsSumOffBy100: number | null;
  drifts: TargetDrift[];
  untargeted: UntargetedHolding[];
  orphaned: OrphanedTarget[];
}

export const DEFAULT_BAND_PCT = 5;

export const EN_DENYLIST: readonly string[] =
  ["rebalance", "buy", "sell", "trim", "recommend", "suggest", "execute", "optimal"];
export const ZH_DENYLIST: readonly string[] =
  ["再平衡", "买入", "卖出", "建议", "增持", "减持", "下单", "最优", "执行交易"];

export function normalizeWeightPct(_value: unknown): NumericField {
  throw new Error("not implemented");
}

export function normalizeBandPct(_value: unknown): NumericField {
  throw new Error("not implemented");
}

export function computePortfolioTargets(
  _positions: readonly RiskInputPosition[],
  _targets: readonly PortfolioTarget[],
): PortfolioTargetsSummary {
  throw new Error("not implemented");
}

export function targetsCopy(_summary: PortfolioTargetsSummary, _lang: Lang): {
  title: Bilingual; standing: Bilingual; basis: Bilingual;
  rows: { ticker: string; current: Bilingual | null; target: Bilingual; drift: Bilingual | null;
    band: Bilingual; status: Bilingual; unweighableNote: Bilingual | null }[];
  untargeted: { header: Bilingual; rows: { ticker: string; hint: Bilingual }[] } | null;
  orphaned: { header: Bilingual; explanation: Bilingual;
    rows: { ticker: string; targetWeightPct: number; bandPct: number }[] } | null;
  sumNote: Bilingual | null;
  emptyState: Bilingual | null;
} {
  throw new Error("not implemented");
}

export const T_TITLE: Bilingual = { en: "rebalance", zh: "建议" };
export const T_UNAVAILABLE: Bilingual = { en: "rebalance", zh: "建议" };
export const T_ERR_INVALID_TARGET: Bilingual = { en: "rebalance", zh: "建议" };
export const T_ERR_INVALID_BAND: Bilingual = { en: "rebalance", zh: "建议" };
export const T_ERR_NOT_HOLDING: Bilingual = { en: "rebalance", zh: "建议" };
export const T_ERR_NOT_FOUND: Bilingual = { en: "rebalance", zh: "建议" };
export const T_ARIA_TARGET: Bilingual = { en: "rebalance {ticker}", zh: "建议 {ticker}" };
export const T_ARIA_BAND: Bilingual = { en: "rebalance {ticker}", zh: "建议 {ticker}" };
export const T_CLEAR: Bilingual = { en: "rebalance", zh: "建议" };
export const T_SAVED: Bilingual = { en: "rebalance", zh: "建议" };
export const T_SAVE_FAIL: Bilingual = { en: "rebalance", zh: "建议" };
export const T_CURRENT: Bilingual = { en: "rebalance", zh: "建议" };
export const T_TARGET: Bilingual = { en: "rebalance", zh: "建议" };
export const T_DRIFT: Bilingual = { en: "rebalance", zh: "建议" };
export const T_BAND: Bilingual = { en: "rebalance", zh: "建议" };
