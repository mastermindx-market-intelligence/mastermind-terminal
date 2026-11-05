import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeTranscript } from "../fund";
import { ARCHIVE_REQUEST_TIMEOUT_MS, getTickerTranscriptIndex, normalizeTickerTranscriptIndex } from "../transcripts";

const call = (id: string) => ({
  id,
  period: `Q${id.slice(5)} FY${id.slice(0, 4)}`,
  date: "2026-07-31",
  title: "AAPL Earnings Call",
  url: `/data/tx/AAPL/${id}.json.gz`,
  bytes: 123,
  segment_count: 42,
  speaker_count: 8,
  speakers: ["Jane Doe", "Alex Smith"],
  word_count: 1200,
  qa_start: 20,
  has_qa: true,
  source: "DefeatBeta",
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ticker transcript index", () => {
  it("validates enriched metadata, sorts, and drops unsafe rows", () => {
    const out = normalizeTickerTranscriptIndex({
      schema: "mastermind.tx-symbol-index/v1",
      generated_at: "2026-08-01T00:00:00Z",
      ticker: "AAPL",
      calls: [
        call("2026Q2"),
        { id: "bad", period: "bad", url: "https://evil.example/x", bytes: 2 },
        call("2026Q3"),
      ],
    }, "AAPL");

    expect(out?.n).toBe(2);
    expect(out?.calls.map((item) => item.id)).toEqual(["2026Q3", "2026Q2"]);
    expect(out?.calls[0]).toMatchObject({ segment_count: 42, has_qa: true, qa_start: 20 });
  });

  it("rejects unknown envelopes and ticker mismatches", () => {
    expect(normalizeTickerTranscriptIndex({ schema: "other", calls: [] }, "AAPL")).toBeNull();
    expect(normalizeTickerTranscriptIndex({
      schema: "mastermind.tx-symbol-index/v1", ticker: "NVDA", calls: [],
    }, "AAPL")).toBeNull();
    expect(normalizeTickerTranscriptIndex(null, "AAPL")).toBeNull();
  });

  it("uses the global commit marker to prove genuine no coverage", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema: "mastermind.tx-index/v1", generated_at: "2026-08-01T00:00:00Z", symbols: { NVDA: ["2026Q3"] },
      }), { status: 200 }));

    await expect(getTickerTranscriptIndex("AAPL")).resolves.toEqual({ status: "not_found" });
  });

  it("accepts ticker metadata only when it matches the global commit generation", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema: "mastermind.tx-symbol-index/v1",
        generated_at: "2026-08-01T00:00:00Z",
        ticker: "AAPL",
        calls: [call("2026Q3")],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema: "mastermind.tx-index/v1",
        generated_at: "2026-08-01T00:00:00Z",
        symbols: { AAPL: ["2026Q3"] },
      }), { status: 200 }));

    const result = await getTickerTranscriptIndex("AAPL");
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.source).toBe("symbol");
  });

  it("falls back to global IDs when ticker metadata is rebuilding", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schema: "mastermind.tx-index/v1", generated_at: "2026-08-01T00:00:00Z", symbols: { AAPL: ["2026Q2", "2026Q3"] },
      }), { status: 200 }));

    const result = await getTickerTranscriptIndex("AAPL");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("global");
      expect(result.index.calls.map((item) => item.id)).toEqual(["2026Q3", "2026Q2"]);
      expect(result.warning).toContain("rebuilding");
      expect(result.warningCode).toBe("rebuilding");
    }
  });

  it("reports an archive error instead of converting a missing commit marker to empty", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));

    const result = await getTickerTranscriptIndex("AAPL", { retryNonce: 7 });
    expect(result).toEqual({ status: "error", message: "Archive commit marker is missing" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("?retry=7");
  });
});

describe("archive request deadline", () => {
  const GENERATED = "2026-08-01T00:00:00Z";
  const marker = () => new Response(JSON.stringify({
    schema: "mastermind.tx-index/v1", generated_at: GENERATED, symbols: { AAPL: ["2026Q2", "2026Q3"] },
  }), { status: 200 });
  const symbolIndex = () => new Response(JSON.stringify({
    schema: "mastermind.tx-symbol-index/v1", generated_at: GENERATED, ticker: "AAPL", calls: [call("2026Q2"), call("2026Q3")],
  }), { status: 200 });
  const never = () => new Promise<Response>(() => undefined);
  const after = (ms: number, make: () => Response) => new Promise<Response>((resolve) => {
    setTimeout(() => resolve(make()), ms);
  });
  /** A response whose headers arrive but whose JSON body never finishes. */
  const stalledBody = () => ({ status: 200, ok: true, json: never } as unknown as Response);

  type Route = () => Promise<Response>;
  function route(symbol: Route, global: Route) {
    return vi.spyOn(globalThis, "fetch").mockImplementation((input) => (
      String(input).startsWith("/data/tx/index.json") ? global() : symbol()
    ));
  }
  const signalOf = (url: string) => {
    const hit = vi.mocked(fetch).mock.calls.find(([input]) => String(input).startsWith(url));
    return (hit?.[1] as RequestInit | undefined)?.signal ?? null;
  };

  /** Resolve the load under fake time, failing if it is still pending after `ms`. */
  async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
    let settled = false;
    const tracked = promise.finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(ms);
    expect(settled).toBe(true);
    return tracked;
  }

  it("falls back to the committed global index when ticker metadata headers stall", async () => {
    vi.useFakeTimers();
    route(never, async () => marker());
    const result = await settleWithin(getTickerTranscriptIndex("AAPL"), ARCHIVE_REQUEST_TIMEOUT_MS);
    expect(result).toMatchObject({ status: "ok", source: "global", warningCode: "timeout" });
    if (result.status === "ok") {
      expect(result.index.calls.map((item) => item.id)).toEqual(["2026Q3", "2026Q2"]);
      expect(result.warning).toContain("timed out");
    }
    expect(signalOf("/data/tx/AAPL/index.json")?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds the JSON body, not only the headers", async () => {
    vi.useFakeTimers();
    route(async () => stalledBody(), async () => marker());
    const result = await settleWithin(getTickerTranscriptIndex("AAPL"), ARCHIVE_REQUEST_TIMEOUT_MS);
    expect(result).toMatchObject({ status: "ok", source: "global", warningCode: "timeout" });
  });

  it("does not settle a stall before the deadline", async () => {
    vi.useFakeTimers();
    route(never, async () => marker());
    let settled = false;
    const load = getTickerTranscriptIndex("AAPL").finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(ARCHIVE_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(load).resolves.toMatchObject({ warningCode: "timeout" });
  });

  it("reports a stalled commit marker as a timed-out archive error, never as ready ticker data", async () => {
    vi.useFakeTimers();
    route(async () => symbolIndex(), never);
    const result = await settleWithin(getTickerTranscriptIndex("AAPL"), ARCHIVE_REQUEST_TIMEOUT_MS);
    expect(result).toEqual({ status: "error", message: "Archive commit marker request timed out", timedOut: true });
  });

  it("keeps ticker metadata that arrives before the deadline", async () => {
    vi.useFakeTimers();
    route(() => after(ARCHIVE_REQUEST_TIMEOUT_MS - 100, symbolIndex), async () => marker());
    const result = await settleWithin(getTickerTranscriptIndex("AAPL"), ARCHIVE_REQUEST_TIMEOUT_MS);
    expect(result).toMatchObject({ status: "ok", source: "symbol" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores ticker metadata that arrives after the deadline", async () => {
    vi.useFakeTimers();
    route(() => after(ARCHIVE_REQUEST_TIMEOUT_MS + 1_000, symbolIndex), async () => marker());
    const result = await settleWithin(getTickerTranscriptIndex("AAPL"), ARCHIVE_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(result).toMatchObject({ status: "ok", source: "global", warningCode: "timeout" });
  });

  it("drops a stalled ticker request as soon as the commit marker fails", async () => {
    vi.useFakeTimers();
    route(never, async () => new Response("unavailable", { status: 503 }));
    const result = await settleWithin(getTickerTranscriptIndex("AAPL"), 0);
    expect(result).toEqual({ status: "error", message: "Archive request failed (503)" });
    expect(signalOf("/data/tx/AAPL/index.json")?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels both requests when the caller aborts", async () => {
    vi.useFakeTimers();
    route(never, never);
    const controller = new AbortController();
    const load = getTickerTranscriptIndex("AAPL", { signal: controller.signal });
    controller.abort();
    const result = await settleWithin(load, 0);
    expect(result.status).toBe("error");
    expect(signalOf("/data/tx/AAPL/index.json")?.aborted).toBe(true);
    expect(signalOf("/data/tx/index.json")?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("names a ticker index that disagrees with the commit generation as invalid", async () => {
    route(async () => new Response(JSON.stringify({
      schema: "mastermind.tx-symbol-index/v1", generated_at: "2026-07-01T00:00:00Z", ticker: "AAPL", calls: [call("2026Q2"), call("2026Q3")],
    }), { status: 200 }), async () => marker());
    const result = await getTickerTranscriptIndex("AAPL");
    expect(result).toMatchObject({ status: "ok", source: "global", warningCode: "invalid" });
  });
});

describe("transcript body validation", () => {
  const body = {
    schema: "mastermind.tx/v1",
    ticker: "AAPL",
    id: "2026Q3",
    period: "Q3 FY2026",
    date: null,
    title: "AAPL Earnings Call",
    segments: [{ speaker: "Jane Doe", role: "CEO", text: "Prepared remarks." }],
  };

  it("accepts the exact envelope and nullable date", () => {
    expect(normalizeTranscript(body, "AAPL", "2026Q3")).toEqual(body);
  });

  it("rejects a mismatched ticker or malformed segment before rendering", () => {
    expect(normalizeTranscript({ ...body, ticker: "NVDA" }, "AAPL", "2026Q3")).toBeNull();
    expect(normalizeTranscript({ ...body, segments: [{ speaker: "Jane", text: "Hi" }] }, "AAPL", "2026Q3")).toBeNull();
  });
});
