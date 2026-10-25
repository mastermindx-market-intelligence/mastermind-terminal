/** Shared presentation/transport contract. PostgreSQL remains the write authority. */
export const FOREX_WATCH_TYPE = "forex_price_close";
const PAIRS = new Set(["EURUSD", "USDJPY", "AUDUSD", "GBPUSD", "USDCAD", "USDCHF", "USDMXN", "USDBRL", "USDCNH"]);
const RULE_KEYS = new Set(["kind", "pair", "quote_basis", "interval", "calendar", "operator", "threshold", "consecutive", "expires_at", "feed", "origin_snapshot_id"]);
const ENVELOPE_KEYS = new Set(["type", "schema_version", "condition_id", "revision"]);
export const isWatchUuid = (x: unknown): x is string =>
  typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

export function isForexWatch(condition: unknown): condition is Record<string, unknown> & { type: typeof FOREX_WATCH_TYPE } {
  return object(condition) && condition.type === FOREX_WATCH_TYPE;
}
export function forexRuleInput(condition: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(condition).filter(([key]) => !ENVELOPE_KEYS.has(key)));
}
export function canonicalForexRule(input: unknown): Record<string, unknown> | null {
  if (!object(input) || Object.keys(input).some((key) => !RULE_KEYS.has(key))) return null;
  if (input.kind !== "price_close" || typeof input.pair !== "string" || !PAIRS.has(input.pair) ||
      input.quote_basis !== "literal" || input.interval !== "4H" || input.calendar !== "fx-utc-4h/v1" ||
      typeof input.operator !== "string" || !["lt", "lte", "gt", "gte"].includes(input.operator) ||
      typeof input.threshold !== "number" || !Number.isFinite(input.threshold) || input.threshold <= 0 ||
      typeof input.consecutive !== "number" || !Number.isInteger(input.consecutive) || input.consecutive < 1 || input.consecutive > 10 ||
      typeof input.expires_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(input.expires_at) ||
      !Number.isFinite(Date.parse(input.expires_at)) || input.feed !== null) return null;
  if (input.origin_snapshot_id !== undefined && input.origin_snapshot_id !== null &&
      (typeof input.origin_snapshot_id !== "string" || !input.origin_snapshot_id.trim() || input.origin_snapshot_id.length > 256)) return null;
  const expiry = new Date(input.expires_at).toISOString();
  if (expiry.slice(0, 19) !== input.expires_at.slice(0, 19)) return null;
  return { ...input, expires_at: expiry };
}
export type ForexWatchRow = {
  id: string; user_id: string; symbol: string; active: false; created_at: string;
  condition: Record<string, unknown> & { type: typeof FOREX_WATCH_TYPE; revision: number };
};
export function forexWatchRow(input: unknown): ForexWatchRow | null {
  const row = Array.isArray(input) && input.length === 1 ? input[0] : input;
  if (!object(row) || !isWatchUuid(row.id) || !isWatchUuid(row.user_id) ||
      row.active !== false || !isForexWatch(row.condition) ||
      row.condition.schema_version !== 1 || row.condition.condition_id !== row.id ||
      typeof row.condition.revision !== "number" || !Number.isInteger(row.condition.revision) ||
      row.condition.revision < 1 || row.condition.revision > 2147483647 ||
      typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) return null;
  const rule = canonicalForexRule(forexRuleInput(row.condition));
  if (!rule || rule.pair !== row.symbol) return null;
  return row as ForexWatchRow;
}
export function sameForexRule(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const left = canonicalForexRule(a), right = canonicalForexRule(b);
  if (!left || !right) return false;
  return [...RULE_KEYS].every((key) => (left[key] ?? null) === (right[key] ?? null));
}
export function forexConditionText(condition: unknown, lang: "en" | "zh" = "en"): string {
  const rule = isForexWatch(condition) ? canonicalForexRule(forexRuleInput(condition)) : null;
  if (!rule) return lang === "zh" ? "外汇条件不可用" : "Forex condition unavailable";
  const operators: Record<string, string> = { lt: "<", lte: "≤", gt: ">", gte: "≥" };
  const operator = operators[String(rule.operator)];
  return lang === "zh"
    ? `4小时收盘价 ${operator} ${rule.threshold} · 连续${rule.consecutive}次`
    : `4H close ${operator} ${rule.threshold} · ${rule.consecutive} consecutive closes`;
}
export const FOREX_INACTIVE_COPY = {
  en: "Saved · inactive",
  zh: "已保存 · 未启用",
} as const;
export const FOREX_UNAVAILABLE_COPY = {
  en: "Finalized 4H monitoring and notifications are not available yet.",
  zh: "目前尚不支持最终4小时监测与通知。",
} as const;
