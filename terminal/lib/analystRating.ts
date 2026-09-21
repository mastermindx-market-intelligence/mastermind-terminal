import type { AnalystDist } from "@/lib/fund";

export type AnalystArcState = "bull" | "bear" | "neutral";

/** Rating distribution → normalized consensus reading in [-1, 1]. */
export function analystReading(dist: AnalystDist): number | null {
  const weighted = dist.strongBuy + dist.buy * 0.5 - dist.sell * 0.5 - dist.strongSell;
  const count = dist.strongBuy + dist.buy + dist.hold + dist.sell + dist.strongSell;
  return count > 0 ? weighted / count : null;
}

/** Shared consensus mapping: -1 → 0, neutral → 50, +1 → 100. */
export function readingToArc(reading: number | null): { value: number; state: AnalystArcState } {
  if (reading == null || !Number.isFinite(reading)) return { value: 50, state: "neutral" };
  const normalized = Math.max(-1, Math.min(1, reading));
  const state: AnalystArcState = normalized >= 0.15 ? "bull" : normalized <= -0.15 ? "bear" : "neutral";
  return { value: Math.round(((normalized + 1) / 2) * 100), state };
}

function zoneWord(reading: number | null, zh: boolean): string {
  if (reading == null) return "";
  if (reading >= 0.5) return zh ? "强烈买入" : "Strong buy";
  if (reading >= 0.15) return zh ? "买入" : "Buy";
  if (reading > -0.15) return zh ? "持有" : "Hold";
  if (reading > -0.5) return zh ? "卖出" : "Sell";
  return zh ? "强烈卖出" : "Strong sell";
}

const ZH_RATING_LABELS: Record<string, string> = {
  "Strong buy": "强烈买入",
  Buy: "买入",
  Hold: "持有",
  Neutral: "中性",
  Sell: "卖出",
  "Strong sell": "强烈卖出",
};

/** One verdict convention shared by Forecast, Technicals and the Terminal rail. */
export function ratingVerdict(label: string | null, reading: number | null, zh: boolean): string {
  if (label) return zh ? (ZH_RATING_LABELS[label] ?? label) : label;
  return zoneWord(reading, zh);
}
