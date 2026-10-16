/** Display-only scale over the admitted visible prefix; never recalculates exposure. */
import type { FuturesChartFrame } from "./futuresWorkspace";

export function futuresGexInView(price: number, low: number, high: number): boolean {
  return Number.isFinite(price) && price >= low && price <= high;
}

/** 1/2/5 upper scale. A billion-dollar exposure is not silently clipped at 400M. */
export function futuresGexVisualScale(
  frames: readonly Pick<FuturesChartFrame, "gex">[], low: number, high: number,
): { maximumMn: number; limitMn: number; knownPoints: number } {
  let maximumMn = 0, knownPoints = 0;
  for (const frame of frames) {
    if (frame.gex.status !== "ok") continue;
    for (const row of frame.gex.projection.mapped) {
      if (row.gammaNetMn === null || !Number.isFinite(row.gammaNetMn) || !futuresGexInView(row.futuresPrice, low, high)) continue;
      maximumMn = Math.max(maximumMn, Math.abs(row.gammaNetMn)); knownPoints++;
    }
  }
  if (maximumMn === 0) return { maximumMn, limitMn: 1, knownPoints };
  const power = Math.pow(10, Math.floor(Math.log10(maximumMn)));
  const candidate = [1, 2, 5, 10].map(n => n * power).find(n => n >= maximumMn && Number.isFinite(n));
  return { maximumMn, limitMn: candidate ?? maximumMn, knownPoints };
}

export function futuresGexScaleLabel(valueMn: number): string {
  const magnitude = Math.abs(valueMn), sign = valueMn < 0 ? "-" : "";
  if (magnitude >= 1e9) return `${valueMn.toExponential(2)}M`;
  if (magnitude >= 1000) return `${sign}${(magnitude / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })}B`;
  return `${sign}${magnitude.toLocaleString("en-US", { maximumSignificantDigits: 3 })}M`;
}
