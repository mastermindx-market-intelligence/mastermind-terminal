import "server-only";

import type { Bar6 } from "./intradayShared";

export type OvernightHistoryResult = {
  bars: Bar6[];
  source: "alpaca-boats";
  status: "available" | "empty" | "not_configured" | "unavailable";
  note?: string;
};

const HUB_PORT = process.env.HUB_PORT ?? "3100";
const HUB_TIMEOUT_MS = 5_000;
const STATUS = new Set<OvernightHistoryResult["status"]>([
  "available",
  "empty",
  "not_configured",
  "unavailable",
]);

function unavailable(note: string): OvernightHistoryResult {
  return { bars: [], source: "alpaca-boats", status: "unavailable", note };
}

function bar6(value: unknown): value is Bar6 {
  return Array.isArray(value)
    && value.length >= 6
    && value.slice(0, 6).every((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * Thin server-side client for Quote Hub's historical BOATS owner.
 *
 * Quote Hub already owns Alpaca credentials and all extended-hours source selection.
 * Terminal intentionally sends only symbol/date/timeframe over loopback.
 */
export async function fetchHubOvernightWallDate(
  symbol: string,
  tf: string,
  date: string,
): Promise<OvernightHistoryResult> {
  const params = new URLSearchParams({ symbol, tf, date });
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${HUB_PORT}/overnight-bars?${params.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    return unavailable(error instanceof Error ? `quote hub overnight: ${error.message}` : "quote hub overnight unavailable");
  }

  if (!response.ok) return unavailable(`quote hub overnight ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return unavailable("quote hub overnight invalid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return unavailable("quote hub overnight invalid payload");
  }

  const data = payload as Record<string, unknown>;
  const status = typeof data.status === "string" && STATUS.has(data.status as OvernightHistoryResult["status"])
    ? data.status as OvernightHistoryResult["status"]
    : "unavailable";
  const bars = Array.isArray(data.bars) ? data.bars.filter(bar6) : [];
  return {
    bars,
    source: "alpaca-boats",
    status,
    ...(typeof data.note === "string" && data.note ? { note: data.note } : {}),
  };
}
