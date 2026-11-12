/**
 * READ-ONLY view of the screener's device presets (`mm.scrPresets`, owned by ScreenerView and
 * #884) for explicit "Add to account" adoption (E04).
 *
 * This module never writes, renames, migrates or deletes that key: the device presets stay
 * exactly where their owner keeps them, and adopting one copies it into the account as a new
 * smart screen only when the user asks. A preset whose fields are not exactly the filter bar's
 * vocabulary is skipped rather than coerced — a coerced preset would save a different screen
 * from the one the user named.
 */

import { ALL_MARKETS, type MarketId } from "@/lib/markets";
import { isPlainObject, type StoragePort } from "@/lib/ownerStorage";
import { ASSET_VALUES, DEFAULT_SCREENER_FILTERS, type ScreenerFilters } from "./predicate";
import { normalizeScreenName } from "./record";

export const DEVICE_PRESETS_KEY = "mm.scrPresets";
const MAX_DEVICE_PRESETS = 12;

export type DevicePreset = { id: string; name: string; filters: ScreenerFilters };

const SIGNALS = ["any", "buy", "sell", "tracked"] as const;
const W52 = ["any", "nearHigh", "within15", "dd30", "nearLow"] as const;
const MOVES = ["any", "up3", "down3", "abs5"] as const;

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);
const floor = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e15;

/** Strictly parse one preset's filter object; missing fields take the bar's defaults (the
 *  same merge the screener applies when it reads the preset). */
export function parsePresetFilters(input: unknown): ScreenerFilters | null {
  if (!isPlainObject(input)) return null;
  const f: ScreenerFilters = { ...DEFAULT_SCREENER_FILTERS };
  const has = (key: string) => input[key] !== undefined;
  if (has("market")) {
    if (input.market !== "all" && !oneOf(ALL_MARKETS as readonly MarketId[], input.market)) return null;
    f.market = input.market as ScreenerFilters["market"];
  }
  if (has("asset")) {
    if (input.asset !== "all" && !oneOf(ASSET_VALUES, input.asset)) return null;
    f.asset = input.asset as string;
  }
  if (has("sector")) {
    if (typeof input.sector !== "string" || !input.sector || input.sector.length > 64) return null;
    f.sector = input.sector;
  }
  if (has("signal")) { if (!oneOf(SIGNALS, input.signal)) return null; f.signal = input.signal; }
  if (has("uptrend")) { if (typeof input.uptrend !== "boolean") return null; f.uptrend = input.uptrend; }
  if (has("liq")) { if (!floor(input.liq)) return null; f.liq = input.liq; }
  if (has("mcap")) { if (!floor(input.mcap)) return null; f.mcap = input.mcap; }
  if (has("w52")) { if (!oneOf(W52, input.w52)) return null; f.w52 = input.w52; }
  if (has("move")) { if (!oneOf(MOVES, input.move)) return null; f.move = input.move; }
  if (has("unpriced")) { if (typeof input.unpriced !== "boolean") return null; f.unpriced = input.unpriced; }
  return f;
}

export function readDevicePresets(storage: StoragePort | null): DevicePreset[] {
  if (!storage) return [];
  let parsed: unknown;
  try {
    const raw = storage.getItem(DEVICE_PRESETS_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed) || parsed.v !== 1 || !Array.isArray(parsed.items)) return [];
  const out: DevicePreset[] = [];
  for (const item of parsed.items.slice(0, MAX_DEVICE_PRESETS)) {
    if (!isPlainObject(item) || typeof item.id !== "string") continue;
    const name = normalizeScreenName(item.name);
    const filters = parsePresetFilters(item.f);
    if (name && filters) out.push({ id: item.id, name, filters });
  }
  return out;
}
