import { validateLargeTradesEnvelope } from "./engine";
import type { LargeTradesEnvelope } from "./types";

export type LargeTradesUnavailableState =
  | "unavailable" | "signed_out" | "denied" | "invalid" | "error" | "rate_limited";

export type LargeTradesRead =
  | { state: "ready"; envelope: LargeTradesEnvelope; artifactSha256: string | null; servedAtNs: string }
  | { state: LargeTradesUnavailableState; reason: string };

export async function fetchLargeTrades(
  symbol: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<LargeTradesRead> {
  const response = await fetcher(`/api/large-trades?sym=${encodeURIComponent(symbol)}`, {
    cache: "no-store", credentials: "same-origin", signal,
  });
  if (response.status === 401) return { state: "signed_out", reason: "authentication_required" };
  if (response.status === 403) return { state: "denied", reason: "access_denied" };
  if (response.status === 429) return { state: "rate_limited", reason: "request_limit" };
  let value: unknown;
  try { value = await response.json(); }
  catch { return { state: "invalid", reason: "invalid_response" }; }
  if (!response.ok) return { state: "error", reason: "source_read_failed" };
  if (!value || typeof value !== "object") return { state: "invalid", reason: "invalid_response" };
  const body = value as Record<string, unknown>;
  if (body.state !== "ready") {
    const state = body.state === "unavailable" || body.state === "invalid" ? body.state : "error";
    return { state, reason: typeof body.reason === "string" ? body.reason : "source_unavailable" };
  }
  if (!validateLargeTradesEnvelope(body.envelope)
      || body.envelope.instrument.symbol.toUpperCase() !== symbol.toUpperCase()
      || typeof body.servedAtNs !== "string" || !/^\d+$/.test(body.servedAtNs)) {
    return { state: "invalid", reason: "source_contract_mismatch" };
  }
  return {
    state: "ready", envelope: body.envelope, servedAtNs: body.servedAtNs,
    artifactSha256: typeof body.artifactSha256 === "string" && /^[a-f0-9]{64}$/.test(body.artifactSha256)
      ? body.artifactSha256 : null,
  };
}
