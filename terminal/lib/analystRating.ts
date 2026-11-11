import type { AnalystDist } from "@/lib/fund";

export type AnalystArcState = "bull" | "bear" | "neutral";

/**
 * analystReading — rating distribution → gauge reading in [-1, 1] (weighted mean
 * of buckets). SINGLE SOURCE OF TRUTH: the rail AnalystGauge (StockAnalysisImpl.tsx)
 * imports this so both surfaces compute the identical reading.
 */
export function analystReading(dist: AnalystDist): number | null {
  const w = dist.strongBuy * 1 + dist.buy * 0.5 + dist.hold * 0 + dist.sell * -0.5 + dist.strongSell * -1;
  const n = dist.strongBuy + dist.buy + dist.hold + dist.sell + dist.strongSell;
  return n > 0 ? w / n : null;
}

/**
 * readingToArc — the SINGLE mapping from a [-1, +1] rating/consensus reading to
 * an ArcGauge {value 0–100, state}. Every gauge across ForecastPage,
 * TechnicalsPage and the StockAnalysis rail routes through this so they never
 * disagree on where "buy" ends and "hold"/"sell" begin. Thresholds match
 * zoneWord: ≥0.15 leans buy (bull), ≤−0.15 leans sell (bear), the ±0.15 band is
 * hold (neutral → grey, so a flat consensus reads as no signal, not red).
 * value maps −1→0, 0→50, +1→100 (50 = neutral centre).
 */
export function readingToArc(reading: number | null): { value: number; state: AnalystArcState } {
  if (reading == null || !Number.isFinite(reading)) return { value: 50, state: "neutral" };
  const r = Math.max(-1, Math.min(1, reading));
  const state: AnalystArcState = r >= 0.15 ? "bull" : r <= -0.15 ? "bear" : "neutral";
  return { value: Math.round(((r + 1) / 2) * 100), state };
}

/** Zone word for a reading — the fallback when no engine rating_label is given. */
function zoneWord(reading: number | null, zh: boolean): string {
  if (reading == null) return "";
  if (reading >= 0.5) return (zh ? "强烈买入" : "Strong buy");
  if (reading >= 0.15) return (zh ? "买入" : "Buy");
  if (reading > -0.15) return (zh ? "持有" : "Hold");
  if (reading > -0.5) return (zh ? "卖出" : "Sell");
  return (zh ? "强烈卖出" : "Strong sell");
}

/**
 * ratingVerdict — the ONE verdict word shared by the rail AnalystGauge and the
 * ForecastPage gauge. Prefers the engine's `rating_label` (translated when zh);
 * falls back to the reading's zone word so it is NEVER empty (the old rail
 * gauge showed a word while the pane showed none — this reconciles them).
 */
export function ratingVerdict(label: string | null, reading: number | null, zh: boolean): string {
  if (label) {
    if (!zh) return label;
    const map: Record<string, string> = {
      "Strong buy": "强烈买入",
      Buy: "买入",
      Hold: "持有",
      Neutral: "中性",
      Sell: "卖出",
      "Strong sell": "强烈卖出",
    };
    return map[label] ?? label;
  }
  return zoneWord(reading, zh);
}
