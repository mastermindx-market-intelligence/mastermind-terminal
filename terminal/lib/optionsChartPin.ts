import type { PriceLineSpec } from "./chart-engine";
import { validOptionsChartLevel, type OptionsChartLevel } from "./optionsCompanion";

// ChartPanel reads line.options(); the rest of the handle stays opaque in this file.
interface PinLine { options(): unknown }

interface PinHost<L extends PinLine = PinLine> {
  createPriceLine(options: PriceLineSpec): L;
  removePriceLine(line: L): void;
}
export interface OptionsPricePin<L extends PinLine = PinLine> { host: PinHost<L>; line: L; key: string }

export function removeOptionsPricePin<L extends PinLine = PinLine>(pin: OptionsPricePin<L> | null): null {
  if (pin) { try { pin.host.removePriceLine(pin.line); } catch { /* chart/series may already have been disposed */ } }
  return null;
}

/** Idempotent, native price-line update. Never mutates chart identity, OHLC, user drawings or saved workspaces. The host is the chart-engine price-line contract, so this file stays outside the G01 boundary. */
export function syncOptionsPricePin<L extends PinLine = PinLine>(current: OptionsPricePin<L> | null, host: PinHost<L> | null,
  level: OptionsChartLevel | null | undefined, root: string, allowed: boolean, color: string): OptionsPricePin<L> | null {
  if (!host || !allowed || !validOptionsChartLevel(level, root)) return removeOptionsPricePin(current);
  const key = JSON.stringify([root, level.price, level.session, level.label, color]);
  if (current?.host === host && current.key === key) return current;
  removeOptionsPricePin(current);
  try {
    const line = host.createPriceLine({ price: level.price, color, lineWidth: 1, lineStyle: 2 /* dashed */,
      axisLabelVisible: true, title: level.label.slice(0, 64) });
    return { host, line, key };
  } catch { return null; }
}
