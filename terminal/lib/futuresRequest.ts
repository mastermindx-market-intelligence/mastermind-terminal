/** Closed request vocabulary shared by the production page, API and client. No URLs or paths. */
import type { ExpiryLens } from "./gexLadder";
export type FuturesRequest = {
  pair: "ES" | "NQ"; intervalMinutes: 1 | 5; priceStepTicks: 1 | 4 | 8;
  expiry: "all" | "zero" | "ex-zero" | string; method: "ratio" | "basis"; cutoffMs: number | null;
};
export const DEFAULT_FUTURES_REQUEST: FuturesRequest = {
  pair: "ES", intervalMinutes: 1, priceStepTicks: 1, expiry: "all", method: "ratio", cutoffMs: null,
};
export function isSessionDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}
export function parseFuturesRequest(params: URLSearchParams): FuturesRequest | null {
  const allowed = new Set(["pair", "interval", "rows", "expiry", "mapping", "at"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) return null;
  const pair = params.get("pair") ?? "ES", interval = params.get("interval") ?? "1";
  const rows = params.get("rows") ?? "1", expiry = params.get("expiry") ?? "all";
  const method = params.get("mapping") ?? "ratio", at = params.get("at");
  if (!["ES", "NQ"].includes(pair) || !["1", "5"].includes(interval) || !["1", "4", "8"].includes(rows) ||
      !(["all", "zero", "ex-zero"].includes(expiry) || isSessionDate(expiry)) || !["ratio", "basis"].includes(method)) return null;
  if (at !== null && (!/^[1-9]\d{0,15}$/.test(at) || !Number.isSafeInteger(Number(at)) || Number(at) > 8640000000000000)) return null;
  return { pair: pair as "ES" | "NQ", intervalMinutes: Number(interval) as 1 | 5,
    priceStepTicks: Number(rows) as 1 | 4 | 8, expiry, method: method as "ratio" | "basis", cutoffMs: at === null ? null : Number(at) };
}
export function futuresQuery(request: FuturesRequest): string {
  const p = new URLSearchParams({ pair: request.pair, interval: String(request.intervalMinutes),
    rows: String(request.priceStepTicks), expiry: request.expiry, mapping: request.method });
  if (request.cutoffMs !== null) p.set("at", String(request.cutoffMs));
  return p.toString();
}
export function requestExpiryLens(request: FuturesRequest): ExpiryLens {
  return ["all", "zero", "ex-zero"].includes(request.expiry)
    ? { kind: request.expiry as "all" | "zero" | "ex-zero" } : { kind: "one", exp: request.expiry };
}
