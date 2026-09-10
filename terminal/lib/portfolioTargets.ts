// Portfolio construction targets — pure computation + all bilingual copy (B-F08-B5-1).
//
// TWO-ORGANISMS LAW (UWP-R2): this module never scores, ranks, or recommends. It describes the
// user's own typed weight targets against the same cost-basis weights `portfolioRisk.ts` already
// uses ("what you paid"). No React, no fetch: every I/O concern lives in the route. None of this
// feeds a signal, score, ranker or alert.
//
// Authority ceiling (ledger row MO-DELTA-003): human_research_only; a drift fact (current weight
// minus typed target), never a dollar amount, never a trade, never an imperative.
//
// Weight basis is COST (shares * entryPrice) over open sized positions, independently rounded to
// one decimal for single-item facts — the same convention as concentration.top1, not
// allocatePercentages (that is reserved for stacked bars that must visually sum to 100).

import { tickerKey, type Lang, type Bilingual, type RiskInputPosition } from "@/lib/portfolioRisk";

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

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function bounded(value: unknown, min: number, max: number): NumericField {
  const parsed = parseNumber(value);
  if (parsed === null) return { kind: "invalid" };
  if (parsed < min || parsed > max) return { kind: "invalid" };
  return { kind: "value", value: parsed };
}

export function normalizeWeightPct(value: unknown): NumericField {
  return bounded(value, 0, 100);
}

export function normalizeBandPct(value: unknown): NumericField {
  return bounded(value, 0, 50);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computePortfolioTargets(
  positions: readonly RiskInputPosition[],
  targets: readonly PortfolioTarget[],
): PortfolioTargetsSummary {
  const open = positions.filter((p) => p.status === "open");
  const costByTicker = new Map<string, number>();
  const openTickers = new Set<string>();
  for (const p of open) {
    const key = tickerKey(p.ticker);
    openTickers.add(key);
    // ONE weight formula (round-2 ruling R2). This is `portfolioRisk.ts`'s own guard verbatim: a
    // position whose cost is null or not greater than zero is `no_size` there and `unweighable`
    // here. `portfolio.ts` documents a negative `shares` as a legitimate short, and a zero-cost
    // row is creatable through the existing POST route, so both must contribute NOTHING to
    // totalCost — otherwise every OTHER holding's weight moves and the two readouts on the same
    // page disagree while the basis note claims they agree.
    const cost = isFiniteNum(p.shares) && isFiniteNum(p.entryPrice) ? p.shares * p.entryPrice : null;
    if (cost == null || !(cost > 0)) continue;
    costByTicker.set(key, (costByTicker.get(key) ?? 0) + cost);
  }
  const totalCost = [...costByTicker.values()].reduce((a, c) => a + c, 0);
  const pctOf = (cost: number): number | null =>
    totalCost > 0 ? round1((cost / totalCost) * 100) : null;

  const targetByTicker = new Map<string, PortfolioTarget>();
  for (const t of targets) {
    const key = tickerKey(t.ticker);
    if (!targetByTicker.has(key)) targetByTicker.set(key, { ...t, ticker: key });
  }

  const drifts: TargetDrift[] = [];
  const orphaned: OrphanedTarget[] = [];
  for (const [key, t] of targetByTicker) {
    const hasOpen = openTickers.has(key);
    const cost = costByTicker.get(key);
    if (!hasOpen) {
      orphaned.push({
        ticker: key,
        targetWeightPct: t.targetWeightPct,
        bandPct: t.bandPct,
      });
      continue;
    }
    // `?? 0` used to live on the next line. A fabricated 0% weight also fabricated a full drift
    // and a definite band verdict on a position nobody could weigh, against a type contract that
    // says `currentWeightPct: number | null`. Both no-weight routes now land on `unweighable`.
    const currentWeightPct = cost == null ? null : pctOf(cost);
    if (currentWeightPct == null) {
      drifts.push({
        ticker: key,
        currentWeightPct: null,
        targetWeightPct: t.targetWeightPct,
        bandPct: t.bandPct,
        driftPct: null,
        status: "unweighable",
      });
      continue;
    }
    const driftPct = round1(currentWeightPct - t.targetWeightPct);
    const status: TargetStatus = Math.abs(driftPct) <= t.bandPct ? "within_band" : "outside_band";
    drifts.push({
      ticker: key,
      currentWeightPct,
      targetWeightPct: t.targetWeightPct,
      bandPct: t.bandPct,
      driftPct,
      status,
    });
  }

  // Every OPEN holding without a target, weighable or not — an unweighable one is listed with a
  // null weight and picks up the unweighable hint (R6 c) instead of disappearing from the page.
  const untargeted: UntargetedHolding[] = [];
  for (const key of openTickers) {
    if (targetByTicker.has(key)) continue;
    const cost = costByTicker.get(key);
    untargeted.push({ ticker: key, currentWeightPct: cost == null ? null : pctOf(cost) });
  }

  const typed = [...targetByTicker.values()];
  const targetsSumPct = typed.length ? typed.reduce((a, t) => a + t.targetWeightPct, 0) : null;
  const targetsSumOffBy100 = targetsSumPct == null ? null : targetsSumPct - 100;

  return {
    schema: "portfolio_targets.v1",
    weightBasis: "cost",
    targetsSumPct,
    targetsSumOffBy100,
    drifts,
    untargeted,
    orphaned,
  };
}

export const T_TITLE: Bilingual = {
  en: "Your targets vs. what you hold",
  zh: "你的目标权重与实际持仓",
};
export const T_STANDING: Bilingual = {
  en: "These are the targets you typed, for your own holdings only. This page shows the gap between them — it never tells you what to do next.",
  zh: "这些是你自己为持仓输入的目标权重。本页只显示目标与实际持仓之间的差距，不会告诉你接下来该怎么做。",
};
export const T_BASIS: Bilingual = {
  en: "Weighted by what you paid, same as the shape readout above.",
  zh: "按你的建仓成本加权，与上方的持仓构成保持一致。",
};
/** Round-2 ruling R6 (e): the long form names the shape readout, so it may only be used when
 *  that readout is actually on the page. When it is not (its own availability gate is separate),
 *  the short form says the same true thing without the cross-reference. */
export const T_BASIS_SHORT: Bilingual = {
  en: "Weighted by what you paid.",
  zh: "按你的建仓成本加权。",
};
export const T_CURRENT: Bilingual = { en: "What it is today", zh: "目前占比" };
export const T_TARGET: Bilingual = { en: "Your target", zh: "你的目标" };
export const T_DRIFT: Bilingual = { en: "Gap", zh: "差距" };
export const T_DRIFT_VALUE: Bilingual = { en: "{sign}{pct} pts", zh: "{sign}{pct} 个百分点" };
export const T_BAND: Bilingual = { en: "Your band", zh: "你的容忍区间" };
export const T_WITHIN: Bilingual = { en: "Inside your band", zh: "在容忍区间内" };
export const T_OUTSIDE: Bilingual = { en: "Outside your band", zh: "超出容忍区间" };
export const T_UNWEIGHABLE: Bilingual = {
  en: "No share count or entry price yet — this target can't be measured.",
  zh: "还没有记录股数或建仓价，暂时无法衡量这个目标。",
};
export const T_UNTARGETED_HEADER: Bilingual = {
  en: "Holdings with no target set",
  zh: "还没有设定目标的持仓",
};
export const T_UNTARGETED_HINT: Bilingual = {
  en: "{ticker} — {pct}% of your book today",
  zh: "{ticker} — 目前占你持仓的 {pct}%",
};
/** Round-2 ruling R6 (c): a holding with no weight must not be described with the ordinary hint,
 *  whose "{pct}%" slot degrades to an em dash beside a percent sign. */
export const T_UNTARGETED_HINT_UNWEIGHABLE: Bilingual = {
  en: "{ticker} — not weighable yet (size or price missing).",
  zh: "{ticker}——暂时无法计算权重（缺少数量或价格）。",
};
export const T_ORPHANED_HEADER: Bilingual = {
  en: "Targets on positions you no longer hold",
  zh: "你已不再持有，但仍设有目标的持仓",
};
export const T_ORPHANED_EXPLAIN: Bilingual = {
  en: "You set a target here, but this position is closed or no longer sized. The target is kept, not deleted, in case you reopen it.",
  zh: "你曾为这里设定过目标，但该持仓已平仓或不再有完整的股数与建仓价。目标会被保留，不会删除，方便你之后重新开仓时继续使用。",
};
export const T_SUM_NOTE: Bilingual = {
  en: "Your targets add up to {sum}%, not 100%. Nothing is scaled to fit — this is exactly what you typed.",
  zh: "你输入的目标合计为 {sum}%，并非 100%。系统不会自动调整以凑成 100%——这就是你输入的原始数值。",
};
export const T_NO_TARGETS: Bilingual = {
  en: "You haven't set any targets yet.",
  zh: "你还没有设定任何目标。",
};
export const T_EMPTY_BOOK: Bilingual = {
  en: "Add a position with a share count and entry price to start setting targets.",
  zh: "先为持仓添加股数和建仓价，才能开始设定目标。",
};
export const T_UNAVAILABLE: Bilingual = {
  en: "We could not read your targets in time. It will try again next time you reload.",
  zh: "暂时未能及时读取你的目标设置，下次刷新会重新尝试。",
};
export const T_ERR_INVALID_TARGET: Bilingual = {
  en: "A target has to be a number from 0 to 100.",
  zh: "目标权重必须是 0 到 100 之间的数字。",
};
export const T_ERR_INVALID_BAND: Bilingual = {
  en: "Your band has to be a number from 0 to 50 points.",
  zh: "容忍区间必须是 0 到 50 个百分点之间的数字。",
};
export const T_ERR_NOT_HOLDING: Bilingual = {
  en: "You can only set a target on a position you currently hold with a share count and entry price.",
  zh: "只能为你目前持有、且已记录股数和建仓价的持仓设定目标。",
};
export const T_ERR_NOT_FOUND: Bilingual = {
  en: "There's no target set on this position yet.",
  zh: "这个持仓还没有设定目标。",
};
export const T_ARIA_TARGET: Bilingual = {
  en: "Target weight for {ticker}, percent",
  zh: "{ticker} 的目标权重，百分比",
};
export const T_ARIA_BAND: Bilingual = {
  en: "Band for {ticker}, percentage points",
  zh: "{ticker} 的容忍区间，百分点",
};
export const T_CLEAR: Bilingual = { en: "Clear target", zh: "清除目标" };
export const T_SAVED: Bilingual = { en: "Saved", zh: "已保存" };
/** Round-2 ruling R6 (d): clearing a target is not a save, so it must not borrow the save
 *  confirmation. Same flash slot, same duration, its own sentence. */
export const T_CLEARED: Bilingual = { en: "Target cleared.", zh: "已清除目标。" };
export const T_SAVE_FAIL: Bilingual = {
  en: "Could not save. Your target was not changed.",
  zh: "保存失败，你的目标未被修改。",
};

function fill(b: Bilingual, vars: Record<string, string>): Bilingual {
  const sub = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(v), s);
  return { en: sub(b.en), zh: sub(b.zh) };
}

function fmtPct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function driftValue(driftPct: number): Bilingual {
  const sign = driftPct > 0 ? "+" : driftPct < 0 ? "−" : "";
  const pct = fmtPct(Math.abs(driftPct));
  return fill(T_DRIFT_VALUE, { sign, pct });
}

function statusCopy(status: TargetStatus): Bilingual {
  if (status === "within_band") return T_WITHIN;
  if (status === "outside_band") return T_OUTSIDE;
  return T_UNWEIGHABLE;
}

export type TargetsCopyOptions = {
  /** Whether the cost-basis shape readout is itself rendered on this page. Defaults to `false`,
   *  so the basis note can never claim a cross-reference to a section that is absent (R6 e). */
  shapeReadoutVisible?: boolean;
};

export function targetsCopy(
  summary: PortfolioTargetsSummary,
  _lang: Lang,
  options: TargetsCopyOptions = {},
): {
  title: Bilingual; standing: Bilingual; basis: Bilingual;
  rows: { ticker: string; current: Bilingual | null; target: Bilingual; drift: Bilingual | null;
    band: Bilingual; status: Bilingual; unweighableNote: Bilingual | null }[];
  untargeted: { header: Bilingual; rows: { ticker: string; hint: Bilingual }[] } | null;
  orphaned: { header: Bilingual; explanation: Bilingual;
    rows: { ticker: string; targetWeightPct: number; bandPct: number;
      target: Bilingual; band: Bilingual }[] } | null;
  sumNote: Bilingual | null;
  emptyState: Bilingual | null;
} {
  const rows = summary.drifts.map((d) => ({
    ticker: d.ticker,
    current: d.currentWeightPct == null ? null : { en: `${fmtPct(d.currentWeightPct)}%`, zh: `${fmtPct(d.currentWeightPct)}%` },
    target: { en: `${fmtPct(d.targetWeightPct)}%`, zh: `${fmtPct(d.targetWeightPct)}%` },
    drift: d.driftPct == null ? null : driftValue(d.driftPct),
    band: { en: `±${fmtPct(d.bandPct)} pts`, zh: `±${fmtPct(d.bandPct)} 个百分点` },
    status: statusCopy(d.status),
    unweighableNote: d.status === "unweighable" ? T_UNWEIGHABLE : null,
  }));

  const untargeted = summary.untargeted.length
    ? {
      header: T_UNTARGETED_HEADER,
      rows: summary.untargeted.map((u) => ({
        ticker: u.ticker,
        hint: u.currentWeightPct == null
          ? fill(T_UNTARGETED_HINT_UNWEIGHABLE, { ticker: u.ticker })
          : fill(T_UNTARGETED_HINT, { ticker: u.ticker, pct: fmtPct(u.currentWeightPct) }),
      })),
    }
    : null;

  const orphaned = summary.orphaned.length
    ? {
      header: T_ORPHANED_HEADER,
      explanation: T_ORPHANED_EXPLAIN,
      rows: summary.orphaned.map((o) => ({
        ticker: o.ticker,
        targetWeightPct: o.targetWeightPct,
        bandPct: o.bandPct,
        // R6 (b): the renderer used to print the raw `bandPct`, so the user read "Your band ±5"
        // with no unit. These are the same unit-bearing strings the drift rows already use.
        target: { en: `${fmtPct(o.targetWeightPct)}%`, zh: `${fmtPct(o.targetWeightPct)}%` },
        band: { en: `±${fmtPct(o.bandPct)} pts`, zh: `±${fmtPct(o.bandPct)} 个百分点` },
      })),
    }
    : null;

  // R1 / R6 (a): the lead sentence. T_NO_TARGETS was unreachable because it was only consulted on
  // the branch where every list was empty. It now speaks for the real "you hold weighable
  // positions and have set no targets" state, while T_EMPTY_BOOK covers every case with nothing
  // weighable to measure against — including a book emptied down to orphaned targets alone.
  const hasWeighable = summary.drifts.some((d) => d.currentWeightPct != null)
    || summary.untargeted.some((u) => u.currentWeightPct != null);

  // R4: gate on the ROUNDED sum, and print that same rounded figure. The raw float sum of
  // 28.4 + 35.8 + 35.8 is 99.99999999999999, which is `!== 100` while fmtPct renders "100.0" —
  // the note then read "add up to 100.0%, not 100%" on the one surface whose whole promise is
  // fidelity to what the user typed.
  // Heal h3 REQUIRED 5: orphaned targets still enter `targetsSumPct`, so an emptied book would
  // print the sum note above T_EMPTY_BOOK. The note only speaks when a weighable holding exists.
  const roundedSum = summary.targetsSumPct == null ? null : round1(summary.targetsSumPct);
  const sumNote = hasWeighable && roundedSum != null && roundedSum !== 100
    ? fill(T_SUM_NOTE, { sum: fmtPct(roundedSum) })
    : null;

  const emptyState = !hasWeighable
    ? T_EMPTY_BOOK
    : (summary.drifts.length === 0 && summary.orphaned.length === 0 ? T_NO_TARGETS : null);

  return {
    title: T_TITLE,
    standing: T_STANDING,
    basis: options.shapeReadoutVisible ? T_BASIS : T_BASIS_SHORT,
    rows,
    untargeted,
    orphaned,
    sumNote,
    emptyState,
  };
}

/** Whether the targets section should render as ready, as a plain-word "try again" notice, or not
 *  at all. Round-2 ruling R1 (BLOCKER): this gate is the targets section's OWN, not the shape
 *  readout's. `riskAvailability` returns "hidden" whenever the open book is empty, which hid the
 *  whole section — and with it every saved target on a closed position — the moment a user closed
 *  their last holding. A target the user typed must never vanish without a word, so the section
 *  stays mounted whenever the summary still carries orphaned rows. `attempted` is true once a GET
 *  has resolved either way; before that a null summary only means "not loaded yet". */
export function targetsAvailability(
  hasOpenPositions: boolean,
  summary: PortfolioTargetsSummary | null,
  attempted: boolean,
): "hidden" | "ready" | "unavailable" {
  if (summary) return hasOpenPositions || summary.orphaned.length > 0 ? "ready" : "hidden";
  if (!hasOpenPositions) return "hidden";
  return attempted ? "unavailable" : "hidden";
}

export function driftBandFit(drift: TargetDrift): TargetStatus {
  return drift.status;
}

export function copyBandFit(
  row: { status: Bilingual },
  lang: Lang,
): string {
  return lang === "zh" ? row.status.zh : row.status.en;
}

export function apiErrorCopy(error: string): Bilingual {
  if (error === "invalid target") return T_ERR_INVALID_TARGET;
  if (error === "invalid band") return T_ERR_INVALID_BAND;
  if (error === "not a current holding") return T_ERR_NOT_HOLDING;
  if (error === "target not found") return T_ERR_NOT_FOUND;
  return T_SAVE_FAIL;
}
