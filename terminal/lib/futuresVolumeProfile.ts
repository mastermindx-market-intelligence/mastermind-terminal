/** Observed executed-volume arithmetic over already-admitted replay frames. Not a new signal. */
import type { FuturesChartFrame } from "./futuresWorkspace";
export type FuturesProfileCell = { priceTicks: number; buy: number; sell: number; unknown: number; total: number };
export function observedFuturesProfile(frames: readonly FuturesChartFrame[]): {
  cells: FuturesProfileCell[]; pointOfControl: FuturesProfileCell | null;
  scope: "observed_capture_window"; tieBreak: "lower_price";
} {
  const byPrice = new Map<number, FuturesProfileCell>();
  for (const frame of frames) for (const cell of frame.bar.cells) {
    const prior = byPrice.get(cell.priceTicks) ?? { priceTicks: cell.priceTicks, buy: 0, sell: 0, unknown: 0, total: 0 };
    prior.buy += cell.buy; prior.sell += cell.sell; prior.unknown += cell.unknown; prior.total += cell.total;
    byPrice.set(cell.priceTicks, prior);
  }
  const cells = [...byPrice.values()].sort((a, b) => a.priceTicks - b.priceTicks);
  let pointOfControl: FuturesProfileCell | null = null;
  for (const cell of cells) if (cell.total > 0 && (!pointOfControl || cell.total > pointOfControl.total)) pointOfControl = cell;
  return { cells, pointOfControl, scope: "observed_capture_window", tieBreak: "lower_price" };
}
