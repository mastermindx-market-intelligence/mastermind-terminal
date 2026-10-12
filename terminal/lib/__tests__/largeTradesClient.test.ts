import { describe, expect, it, vi } from "vitest";
import { fetchLargeTrades } from "@/lib/largeTrades/client";
import type { LargeTradesEnvelope } from "@/lib/largeTrades/types";

// The real engine validator is intentional: these tests fail if a malformed
// transaction envelope, synthetic-live assertion, or candle record is admitted.
const AT = "1791705600000000000";
const HASH = "a".repeat(64);
function fixture(): LargeTradesEnvelope {
  return {
    schema: "mastermind.large_trades.v1",
    instrument: {
      symbol: "AAPL", instrumentId: "test:AAPL", assetClass: "equity",
      quantityUnit: "shares", priceScale: 100, tickSizeInt: 1, timezone: "America/New_York",
    },
    provenance: {
      provider: "deterministic_test", dataset: "synthetic_execution_records", venue: "TEST",
      scope: "venue", dataMode: "fixture", evidenceMode: "FIXTURE", sourceId: "client-test",
      sourceSha256: null, sourceRef: "test:client", generatedAtNs: AT, acquiredAtNs: null,
      receiptBasis: "fixture", coverage: "complete", sequenceGaps: 0, delayMs: null,
      conditionPolicy: "synthetic executions only", attribution: "Deterministic test fixture",
      termsUrl: null,
    },
    range: { startNs: AT, endNs: AT },
    prints: [{
      id: "print-1", kind: "trade", eventNs: AT, availableNs: AT,
      sourceSequence: "1", session: "2026-10-11", priceInt: 21_375, quantity: 1301,
      side: "unknown", sideMethod: "unknown", eligible: true, conditions: [],
      sourceRecordType: "MASSIVE_T",
    }],
    responses: [], responseCoverage: "unavailable", responseKnownAtNs: null,
  };
}
const ready = (envelope: LargeTradesEnvelope = fixture()) => ({
  state: "ready", envelope, artifactSha256: HASH, servedAtNs: AT,
});
function response(status: number, body: unknown) {
  const json = vi.fn(async () => body);
  return { status, ok: status >= 200 && status < 300, json } as unknown as Response;
}
function reader(status: number, body: unknown) {
  const result = response(status, body);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(result);
  return { result, fetcher, signal: new AbortController().signal };
}

describe("large-trades source client", () => {
  it("passes a validated envelope and immutable artifact identity through unchanged", async () => {
    const body = ready();
    const { fetcher, signal } = reader(200, body);
    const result = await fetchLargeTrades("AAPL", signal, fetcher);
    expect(result).toEqual(body);
    if (result.state !== "ready") throw new Error("expected validated response");
    expect(result.envelope).toBe(body.envelope);
    expect(result.envelope.prints[0].quantity).toBe(1301);
    expect(result.envelope.prints[0].side).toBe("unknown");
    expect(result.envelope.provenance.dataMode).toBe("fixture");
  });

  it("accepts case-insensitive identity without mutating the provider symbol", async () => {
    const { fetcher, signal } = reader(200, ready());
    const result = await fetchLargeTrades("aapl", signal, fetcher);
    expect(result.state).toBe("ready");
    if (result.state === "ready") expect(result.envelope.instrument.symbol).toBe("AAPL");
  });

  it("uses the supplied AbortSignal and a same-origin, no-store request with an encoded symbol", async () => {
    const { fetcher, signal } = reader(403, null);
    await fetchLargeTrades("CME:MNQ Z6?venue=A&B", signal, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/large-trades?sym=CME%3AMNQ%20Z6%3Fvenue%3DA%26B",
      { cache: "no-store", credentials: "same-origin", signal },
    );
  });

  it.each([
    [401, "signed_out", "authentication_required"],
    [403, "denied", "access_denied"],
    [429, "rate_limited", "request_limit"],
  ])("returns HTTP %s distinctly before parsing any source body", async (status, state, reason) => {
    const { result, fetcher, signal } = reader(status as number, ready());
    expect(await fetchLargeTrades("AAPL", signal, fetcher)).toEqual({ state, reason });
    expect(result.json).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses an invalid JSON body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      status: 200, ok: true, json: vi.fn().mockRejectedValue(new SyntaxError("bad JSON")),
    } as unknown as Response);
    expect(await fetchLargeTrades("AAPL", new AbortController().signal, fetcher))
      .toEqual({ state: "invalid", reason: "invalid_response" });
  });

  it.each([null, 4, "not-an-envelope"])("refuses a non-object response (%j)", async (body) => {
    const { fetcher, signal } = reader(200, body);
    expect(await fetchLargeTrades("AAPL", signal, fetcher))
      .toEqual({ state: "invalid", reason: "invalid_response" });
  });

  it.each(["missing envelope", "wrong schema", "wrong symbol", "missing transaction array"])(
    "refuses %s at the real schema and identity boundary", async (problem) => {
      const body: Record<string, unknown> = ready();
      if (problem === "missing envelope") body.envelope = undefined;
      if (problem === "wrong schema") body.envelope = { ...fixture(), schema: "other.v1" };
      if (problem === "wrong symbol") body.envelope = {
        ...fixture(), instrument: { ...fixture().instrument, symbol: "MSFT" },
      };
      if (problem === "missing transaction array") body.envelope = { ...fixture(), prints: undefined };
      const { fetcher, signal } = reader(200, body);
      expect(await fetchLargeTrades("AAPL", signal, fetcher))
        .toEqual({ state: "invalid", reason: "source_contract_mismatch" });
    },
  );

  it("refuses candle-volume records presented as executed transactions", async () => {
    const source = fixture();
    source.prints[0].sourceRecordType = "OHLC_BAR";
    const { fetcher, signal } = reader(200, ready(source));
    expect(await fetchLargeTrades("AAPL", signal, fetcher))
      .toEqual({ state: "invalid", reason: "source_contract_mismatch" });
  });

  it("refuses fixture evidence relabeled as live", async () => {
    const source = fixture();
    source.provenance.dataMode = "live";
    const { fetcher, signal } = reader(200, ready(source));
    expect(await fetchLargeTrades("AAPL", signal, fetcher))
      .toEqual({ state: "invalid", reason: "source_contract_mismatch" });
  });

  it.each(["", "-1", "1e18", "NaN", 123, null, undefined])(
    "refuses a missing or nondecimal served-at clock (%j)", async (servedAtNs) => {
      const { fetcher, signal } = reader(200, { ...ready(), servedAtNs });
      expect(await fetchLargeTrades("AAPL", signal, fetcher))
        .toEqual({ state: "invalid", reason: "source_contract_mismatch" });
    },
  );

  it.each(["short", "A".repeat(64), "", null, 5])(
    "does not invent an artifact hash for malformed identity (%j)", async (artifactSha256) => {
      const { fetcher, signal } = reader(200, { ...ready(), artifactSha256 });
      const result = await fetchLargeTrades("AAPL", signal, fetcher);
      expect(result.state).toBe("ready");
      if (result.state === "ready") expect(result.artifactSha256).toBeNull();
    },
  );

  it("distinguishes an authoritative empty transaction set from an unread source", async () => {
    const source = fixture();
    source.prints = [];
    const { fetcher, signal } = reader(200, ready(source));
    const result = await fetchLargeTrades("AAPL", signal, fetcher);
    expect(result.state).toBe("ready");
    if (result.state === "ready") expect(result.envelope.prints).toEqual([]);
  });

  it("does not fall back to the previous snapshot or synthesize data after a failed refresh", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, ready()))
      .mockResolvedValueOnce(response(503, { state: "ready", envelope: fixture() }))
      .mockResolvedValueOnce(response(200, { state: "unavailable", reason: "feed_not_configured", envelope: fixture() }))
      .mockResolvedValueOnce(response(200, { state: "invalid", reason: "source_integrity_failed" }))
      .mockResolvedValueOnce(response(200, { state: "unrecognized" }));
    const signal = new AbortController().signal;
    expect((await fetchLargeTrades("AAPL", signal, fetcher)).state).toBe("ready");
    expect(await fetchLargeTrades("AAPL", signal, fetcher))
      .toEqual({ state: "error", reason: "source_read_failed" });
    expect(await fetchLargeTrades("AAPL", signal, fetcher))
      .toEqual({ state: "unavailable", reason: "feed_not_configured" });
    expect(await fetchLargeTrades("AAPL", signal, fetcher))
      .toEqual({ state: "invalid", reason: "source_integrity_failed" });
    expect(await fetchLargeTrades("AAPL", signal, fetcher))
      .toEqual({ state: "error", reason: "source_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it.each(["network", "abort"])("propagates a %s failure without data or a retry", async (kind) => {
    const failure = kind === "abort"
      ? new DOMException("Request aborted", "AbortError") : new Error("offline");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure);
    await expect(fetchLargeTrades("AAPL", new AbortController().signal, fetcher)).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
