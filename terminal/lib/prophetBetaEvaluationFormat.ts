/**
 * prophetBetaEvaluationFormat.ts — pure display formatters for the Strategy
 * Evaluation surface. NO recomputation: every value arrives from the decoded
 * artifact; these helpers only convert wire fractions to display strings.
 *
 * ASCII hyphen only (never U+2212) so Playwright text matching and copy/paste
 * stay byte-stable. "-0.0"-style values collapse to "0.0".
 */
import type { ReleaseCriterion } from "./prophetBetaEvaluation";

function fixed(value: number, dp: number): string {
  const out = value.toFixed(dp);
  return out === "-0.0" || out === "-0.00" || out === `-${(0).toFixed(dp)}` ? (0).toFixed(dp) : out;
}

function signed(value: number, dp: number): string {
  const base = fixed(value, dp);
  return value > 0 && !base.startsWith("+") ? `+${base}` : base;
}

/** Fraction → percent, unsigned: 0.27123 → "27.1%". */
export function fmtPercent(value: number, dp = 1): string {
  return `${fixed(value * 100, dp)}%`;
}

/** Fraction → signed percent: 0.0203 → "+2.0%"; -0.0312 → "-3.1%". */
export function fmtSignedPercent(value: number, dp = 1): string {
  return `${signed(value * 100, dp)}%`;
}

/** Fraction → signed percentage points: 0.0461 → "+4.6 pp". */
export function fmtSignedPp(value: number, dp = 1): string {
  return `${signed(value * 100, dp)} pp`;
}

/** Unitless ratio: 0.7213 → "0.72". */
export function fmtRatio(value: number, dp = 2): string {
  return fixed(value, dp);
}

export function fmtCount(value: number): string {
  return fixed(value, 0);
}

/** Interval as "[lo, hi]" in the given unit: [-0.104, 0.231] → "[-10.4, +23.1] pp";
 * [0.484, 0.570] as "%" → "[+48.4%, +57.0%]". Unit "x" (beta/capture ratios)
 * renders unsigned — ratio bounds carry no sign. */
export function fmtCi95(lo: number, hi: number, unit: "pp" | "%" | "x", dp = 1): string {
  const each = (v: number) => {
    const base = unit === "x" ? fixed(v, dp) : signed(v * 100, dp);
    return unit === "%" ? `${base}%` : base;
  };
  return `[${each(lo)}, ${each(hi)}]${unit === "pp" ? " pp" : ""}`;
}

/** p-value: 1.0 → "1.00"; 0.5846 → "0.585"; 0.0032 → "0.003".
 * Three decimals below 1 keeps small corrected p-values informative. */
export function fmtP(value: number): string {
  return value.toFixed(value < 1 ? 3 : 2);
}

/** Date already ISO on the wire; rendered verbatim. */
export function fmtDate(value: string): string {
  return value;
}

/** Release-criterion observed value, classified by the criterion's own id.
 * Null is unobserved ("—"), never 0. The wire basis is fractions
 * (0.01 = 1 pp), so fraction-valued criteria render as ratios matching their
 * required strings ("0.18" for "> -0.03"); p-values keep their decimals;
 * sessions/positions/turnover/stale-day counts render as counts. */
export function fmtCriterionObserved(id: string, observed: ReleaseCriterion["observed"]): string {
  if (observed === null || observed === undefined) return "—";
  if (typeof observed === "boolean") return observed ? "true" : "false";
  if (typeof observed === "string") return observed;
  if (/holm_p/.test(id)) return fmtP(observed);
  if (/drawdown|share/.test(id)) return fmtSignedPercent(observed);
  if (/sessions|positions|turnover|stale|no_fill|entry_periods/.test(id)) return fmtCount(observed);
  return fmtRatio(observed);
}
