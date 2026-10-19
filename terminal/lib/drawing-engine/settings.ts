import type { Drawing, Pt } from "@/lib/drawings";
import { DEFAULT_FIBONACCI_LEVELS, FIBONACCI_LEVEL_SLOTS } from "@/lib/drawing-engine/geometry";

export type FibonacciLabelMode = "ratio" | "price" | "both";
export type FibonacciLevelStyle = { value: number; visible: boolean; color: string };
export type FibonacciSettings = {
  levels: FibonacciLevelStyle[];
  reverse: boolean;
  labels: FibonacciLabelMode;
};

const FIB_COLORS = [
  "#748ffc", "#845ef7", "#be4bdb", "#f06595", "#f0566b", "#ff8787",
  "#7c879a", "#f03e5f", "#f59f00", "#2fb344", "#12b886", "#15aabf",
  "#8490a3", "#20c997", "#51cf66", "#fcc419", "#4d82ff", "#5c7cfa",
  "#748ffc", "#9775fa", "#845ef7", "#cc5de8", "#e64980", "#ff6b6b",
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function validColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function validFibValue(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  // Wide enough for custom projection ratios while keeping corrupted payloads
  // from producing unusable coordinates or labels.
  return +Math.max(-100, Math.min(100, value)).toFixed(6);
}

export function fibonacciSettings(meta: Drawing["meta"]): FibonacciSettings {
  const source = record(meta);
  const legacyVisible = new Set(
    Array.isArray(source?.fibLevels)
      ? source!.fibLevels.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      : DEFAULT_FIBONACCI_LEVELS,
  );
  const savedStyles = Array.isArray(source?.fibLevelStyles) ? source!.fibLevelStyles : [];
  const levels = FIBONACCI_LEVEL_SLOTS.map((slot, index) => {
    const saved = record(savedStyles[index]);
    return {
      value: validFibValue(saved?.value, slot),
      visible: typeof saved?.visible === "boolean" ? saved.visible : legacyVisible.has(slot),
      color: validColor(saved?.color, FIB_COLORS[index]),
    };
  });
  const labels = source?.fibLabels === "ratio" || source?.fibLabels === "price" || source?.fibLabels === "both"
    ? source.fibLabels
    : "both";
  return { levels, reverse: source?.fibReverse === true, labels };
}

/** Raw-price arithmetic is independent of the chart's linear/log display projection.
 * A trend extension uses A→B as its move and C as its zero level; a retracement uses A/B.
 */
export function fibonacciPriceLevels(kind: "fib" | "fibtrend", points: readonly Pt[], settings: FibonacciSettings) {
  const [a, b, c] = points;
  if (!a || !b || (kind === "fibtrend" && !c)) return [];
  const start = kind === "fibtrend" ? c.p : settings.reverse ? b.p : a.p;
  const move = (b.p - a.p) * (settings.reverse ? -1 : 1);
  return settings.levels.filter(level => level.visible).map(level => ({
    ratio: level.value, color: level.color, price: start + move * level.value,
  }));
}

export type PositionRiskMode = "percent" | "money";
export type PositionSettings = {
  accountSize: number;
  riskMode: PositionRiskMode;
  riskPercent: number;
  riskAmount: number;
};
export type PositionMetrics = PositionSettings & {
  entry: number;
  target: number;
  stop: number;
  riskBudget: number;
  quantity: number;
  positionValue: number;
  targetProfit: number;
  rewardRisk: number;
};

export function positionSettings(meta: Drawing["meta"]): PositionSettings {
  const source = record(meta);
  const accountSize = finite(source?.accountSize, 10_000, 1, 1_000_000_000_000);
  const riskMode: PositionRiskMode = source?.riskMode === "money" ? "money" : "percent";
  const riskPercent = finite(source?.riskPercent, 1, .01, 100);
  const riskAmount = finite(source?.riskAmount, accountSize * riskPercent / 100, .01, accountSize);
  return {
    accountSize,
    riskMode,
    riskPercent,
    riskAmount,
  };
}

/** Standard fixed-risk sizing: account risk divided by entry-to-stop distance. */
export function calculatePositionMetrics(
  points: readonly Pt[],
  meta?: Drawing["meta"],
): PositionMetrics | null {
  const entry = points[0]?.p;
  const target = points[1]?.p;
  const stop = points[2]?.p;
  if (![entry, target, stop].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const settings = positionSettings(meta);
  const riskBudget = settings.riskMode === "money"
    ? settings.riskAmount
    : settings.accountSize * settings.riskPercent / 100;
  const stopDistance = Math.abs(stop! - entry!);
  const rewardDistance = Math.abs(target! - entry!);
  const quantity = stopDistance > 0 ? riskBudget / stopDistance : 0;
  return {
    ...settings,
    entry: entry!, target: target!, stop: stop!, riskBudget,
    quantity,
    positionValue: quantity * Math.abs(entry!),
    targetProfit: quantity * rewardDistance,
    rewardRisk: stopDistance > 0 ? rewardDistance / stopDistance : 0,
  };
}
