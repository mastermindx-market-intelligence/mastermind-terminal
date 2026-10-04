import { LineStyle, type IPriceLine, type ISeriesApi } from "lightweight-charts";
import { validOptionsChartLevel, type OptionsChartLevel } from "./optionsCompanion";

type PinHost = Pick<ISeriesApi<"Candlestick">, "createPriceLine" | "removePriceLine">;
export interface OptionsPricePin { host: PinHost; line: IPriceLine; key: string }

export function removeOptionsPricePin(pin: OptionsPricePin | null): null {
  if (pin) { try { pin.host.removePriceLine(pin.line); } catch { /* chart/series may already have been disposed */ } }
  return null;
}

/** Idempotent, native price-line update. Never mutates chart identity, OHLC, user drawings or saved workspaces. */
export function syncOptionsPricePin(current: OptionsPricePin | null, host: PinHost | null,
  level: OptionsChartLevel | null | undefined, root: string, allowed: boolean, color: string): OptionsPricePin | null {
  if (!host || !allowed || !validOptionsChartLevel(level, root)) return removeOptionsPricePin(current);
  const key = JSON.stringify([root, level.price, level.session, level.label, color]);
  if (current?.host === host && current.key === key) return current;
  removeOptionsPricePin(current);
  try {
    const line = host.createPriceLine({ price: level.price, color, lineWidth: 1, lineStyle: LineStyle.Dashed,
      axisLabelVisible: true, title: level.label.slice(0, 64) });
    return { host, line, key };
  } catch { return null; }
}
