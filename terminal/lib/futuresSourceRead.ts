import "server-only";
/** Thin adapter over the EXISTING Quote Hub. No vendor key, source URL, or client-controlled file. */
import { createHash } from "node:crypto";
import { FUTURES_MAX_BYTES, readFuturesJson } from "./futuresTransport";
import { joinFuturesSource, type FuturesSourceResult } from "./futuresSourceJoin";
import type { FuturesRequest } from "./futuresRequest";

export async function readFuturesSource(request: FuturesRequest, nowMs?: number): Promise<FuturesSourceResult> {
  const unavailable = { status: "unavailable" as const, reason: "source_unavailable" as const };
  const port = process.env.HUB_PORT ?? "3100";
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return unavailable;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/futures?pair=${request.pair}&interval=${request.intervalMinutes}&rows=${request.priceStepTicks}`, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      try {
        const error = await readFuturesJson(response, 8192);
        if (error && typeof error === "object" && "error" in error &&
            (error.error === "source_restricted" || error.error === "source_invalid"))
          return { status: "unavailable", reason: error.error };
      } catch { /* Only the closed upstream reason vocabulary is exposed. */ }
      return unavailable;
    }
    if (!response.body) return unavailable;
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > FUTURES_MAX_BYTES)) {
      await response.body.cancel(); return unavailable;
    }
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > FUTURES_MAX_BYTES) { await reader.cancel(); return unavailable; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (createHash("sha256").update(bytes).digest("hex") !== response.headers.get("x-futures-source-sha256"))
      return { status: "unavailable", reason: "source_invalid" };
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return joinFuturesSource(JSON.parse(text), request, nowMs ?? Date.now());
  } catch { return unavailable; }
}
