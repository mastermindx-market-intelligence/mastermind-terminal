// @vitest-environment jsdom
// Synthetic, contract-focused regressions. No natural evidence hunt, fitting or probability.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeOptionsAlphaMeasuredFeed as parse } from "@/components/prophet/optionsAlphaMeasuredEvidence";
import { OptionsAlphaView } from "@/components/prophet/OptionsAlphaView";
import candidateFeedJson from "@/lib/__tests__/fixtures/candidate_feed.json";
import candidateReceiptJson from "@/lib/__tests__/fixtures/candidate_feed.receipt.json";
const transport = vi.hoisted(() => ({ shadow: null as unknown, feed: null as unknown, failed: false, lang: "en" as "en" | "zh" }));
vi.mock("@/lib/flowClientCache", () => ({
  flowGet: vi.fn(async () => transport.shadow),
  flowGetFresh: vi.fn(async () => { if (transport.failed) throw new Error("synthetic transport failure"); return transport.feed; }),
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: transport.lang }) }));
function micro(overrides: Record<string, unknown> = {}) { return {
  schema: "options.trade_nbbo_microstructure/v1", source_print_count: 4, nbbo_valid_print_count: 3,
  source_premium_usd: 1000, nbbo_covered_premium_usd: 900, nbbo_print_coverage: .75, nbbo_premium_coverage: .9,
  at_ask_share: .444444, at_bid_share: .222222, inside_share: .333334, outside_share: 0,
  aggression_share: .666666, aggression_balance: .222222,
  spread_median_usd: .2, spread_median_pct: .05, quote_age_median_ms: 100, quote_age_max_ms: 250,
  bid_size_median: 12, ask_size_median: 14, ...overrides,
}; }
function event(overrides: Record<string, unknown> = {}) { return {
  id: "synthetic-A", root: "NVDA", right: "C", exp: "2026-09-25", strike: 200,
  observed_at: "2026-09-19T14:00:00.000000Z", decision_at: "2026-09-19T14:00:01.000000Z",
  available_at: "2026-09-19T14:00:02.000000Z", vol_gt_oi_ratio: 1.25, microstructure: micro(), ...overrides,
}; }
function feed(events: unknown[]) { return {
  schema: "live_flow.feed/v1", asof: "2026-09-19T14:00:05Z", source_asof: "2026-09-19T14:00:04Z", session_date: "2026-09-19", events,
}; }
function zero(overrides: Record<string, unknown> = {}) { return micro({
  nbbo_valid_print_count: 0, nbbo_covered_premium_usd: 0, nbbo_print_coverage: 0, nbbo_premium_coverage: 0,
  at_ask_share: null, at_bid_share: null, inside_share: null, outside_share: null, aggression_share: null, aggression_balance: null,
  spread_median_usd: null, spread_median_pct: null, quote_age_median_ms: null, quote_age_max_ms: null, bid_size_median: null, ask_size_median: null, ...overrides,
}); }
const ids = (rows: unknown[]) => parse(feed(rows))?.events.map(row => row.id);

describe("exact event identity and fractional availability", () => {
  it("collapses a repeated identical event instead of counting it twice", () => expect(ids([event(), event()])).toEqual(["synthetic-A"]));
  it("withholds conflicting records for one identity but preserves unrelated events", () => {
    expect(ids([event(), event({ strike: 201 }), event({ id: "unrelated" })])).toEqual(["unrelated"]);
  });
  it("treats equivalent offset/precision clocks as the same instant for duplicate comparison", () => {
    expect(ids([event(), event({ observed_at: "2026-09-19T10:00:00-04:00", decision_at: "2026-09-19T10:00:01-04:00", available_at: "2026-09-19T10:00:02-04:00" })])).toEqual(["synthetic-A"]);
  });
  it("does not merge distinct event IDs just because the contracts match", () => expect(ids([event(), event({ id: "synthetic-B" })])).toHaveLength(2));
  it.each(["000001", "000000001"])("rejects decision after availability at fractional precision %s", fraction => {
    expect(ids([event({ decision_at: `2026-09-19T14:00:02.${fraction}Z`, available_at: "2026-09-19T14:00:02.000000000Z" })])).toEqual([]);
  });
  it("rejects observation after decision within one millisecond", () => {
    expect(ids([event({ observed_at: "2026-09-19T14:00:01.000002Z", decision_at: "2026-09-19T14:00:01.000001Z" })])).toEqual([]);
  });
  it("sorts exact availability before the ID tie breaker", () => {
    expect(ids([event({ id: "z-older", available_at: "2026-09-19T14:00:02.000001Z" }), event({ id: "a-newer", available_at: "2026-09-19T14:00:02.000002Z" })])).toEqual(["a-newer", "z-older"]);
  });
  it("rejects normalized-but-impossible calendar days in event clocks", () => {
    expect(ids([event({ observed_at: "2026-02-30T14:00:00Z", decision_at: "2026-02-30T14:00:01Z", available_at: "2026-02-30T14:00:02Z" })])).toEqual([]);
  });
  it("rejects an impossible envelope timestamp", () => expect(parse({ ...feed([]), asof: "2026-02-30T14:00:05Z" })).toBeNull());
  it("retains valid timezone offsets and original precision without rewriting receipts", () => {
    const raw = event({ observed_at: "2026-09-19T10:00:00.123456-04:00", decision_at: "2026-09-19T14:00:01Z", available_at: "2026-09-19T14:00:02.123456Z" });
    expect(parse(feed([raw]))?.events[0]?.observed_at).toBe(raw.observed_at);
  });
});

describe("measured-set consistency", () => {
  it("cannot report covered premium with no valid-NBBO prints", () => {
    expect(ids([event({ microstructure: micro({ nbbo_valid_print_count: 0, nbbo_print_coverage: 0 }) }), event({ id: "healthy" })])).toEqual(["healthy"]);
  });
  it("cannot report NBBO-only quote statistics when no quote was valid", () => {
    expect(ids([event({ microstructure: zero({ quote_age_median_ms: 100, quote_age_max_ms: 200 }) })])).toEqual([]);
  });
  it("does not reject a tiny valid premium merely because money rounded to zero", () => {
    // Producer-shaped: count>0 with coveredPremium on a 2-decimal wire that displays 0.00
    // must keep its non-null location shares and pass the strict arithmetic checks.
    expect(ids([event({ microstructure: zero({
      nbbo_valid_print_count: 1, nbbo_print_coverage: .25,
      at_ask_share: 1, at_bid_share: 0, inside_share: 0, outside_share: 0,
      aggression_share: 1, aggression_balance: 1,
      spread_median_usd: .000001, quote_age_median_ms: 0, quote_age_max_ms: 0,
    }) })])).toHaveLength(1);
  });
  it("rejects positive count when producer omitted location shares", () => {
    // Genuine rounded-zero premium cannot ride without producer-shaped shares.
    expect(ids([event({ microstructure: zero({ nbbo_valid_print_count: 1, nbbo_print_coverage: .25 }) })])).toEqual([]);
  });
  it("rejects zero-valid count with non-null producer-shaped shares", () => {
    // Genuine empty set must still enforce null share shape even if the producer
    // emitted non-null location statistics alongside zero valid prints.
    expect(ids([event({ microstructure: micro({
      nbbo_valid_print_count: 0, nbbo_covered_premium_usd: 0,
      nbbo_print_coverage: 0, nbbo_premium_coverage: 0,
    }) })])).toEqual([]);
  });
  it("rejects counts that cannot be represented as exact safe integers", () => {
    expect(ids([event({ microstructure: micro({ source_print_count: 9007199254740992, nbbo_valid_print_count: 9007199254740992, nbbo_print_coverage: 1 }) })])).toEqual([]);
  });
  it("preserves genuine zero coverage, null shares and independent legacy rows", () => {
    const result = parse(feed([{ id: "legacy", root: "SPY" }, event({ microstructure: zero() })]));
    expect(result?.events).toHaveLength(1); expect(result?.events[0].microstructure.at_ask_share).toBeNull();
    expect(result?.events[0].microstructure.nbbo_print_coverage).toBe(0);
  });
  it("projects no score, side, customer identity or directional probability", () => {
    const row = parse(feed([event({ score: 99, side: "buy", direction: "bullish", probability: .9 })]))?.events[0];
    for (const key of ["score", "side", "direction", "probability"]) expect(row).not.toHaveProperty(key);
  });
});

let node: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  transport.shadow = JSON.parse(readFileSync(resolve(process.cwd(), "public/data/options_prophet_fixture.json"), "utf8"));
  transport.feed = feed([event()]); transport.failed = false; transport.lang = "en";
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("last-known measured evidence after refresh failure", () => {
  it.each(["en", "zh"] as const)("retains useful evidence, discloses failure and recovers in %s", async lang => {
    transport.lang = lang; await act(async () => root.render(<OptionsAlphaView />));
    expect(node.querySelectorAll('[data-testid="options-alpha-measured-event"]')).toHaveLength(1);
    transport.failed = true; await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(node.querySelectorAll('[data-testid="options-alpha-measured-event"]')).toHaveLength(1);
    expect(node.querySelector('[data-testid="options-alpha-fires-section"]')).not.toBeNull();
    const warning = node.querySelector('[data-testid="options-alpha-measured-refresh-failed"]');
    expect(warning).not.toBeNull(); expect(warning?.getAttribute("role")).toBe("status");
    expect(warning?.textContent).toMatch(lang === "en" ? /stored measured snapshot/i : /先前保存的实测快照/);
    transport.failed = false; transport.feed = feed([event({ id: "recovered", root: "SPY" })]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(node.querySelector('[data-testid="options-alpha-measured-refresh-failed"]')).toBeNull();
    expect(node.querySelector('[data-testid="options-alpha-measured-event"]')?.textContent).toContain("SPY");
  });
  it("preserves initial-failure behavior without fabricating a retained snapshot", async () => {
    transport.failed = true; await act(async () => root.render(<OptionsAlphaView />));
    expect(node.querySelectorAll('[data-testid="options-alpha-measured-event"]')).toHaveLength(0);
    expect(node.querySelector('[data-testid="options-alpha-measured-evidence"]')?.textContent).toContain("Measured-flow source is unavailable");
    expect(node.querySelector('[data-testid="options-alpha-fires-section"]')).not.toBeNull();
  });
});

const CANDIDATE_FEED_URL = "/api/flow?f=options_alpha_candidate_feed";
const CANDIDATE_A_ID = "oacnd_82923f78ab4fef535efedb64";

function boundCandidatePair() {
  return {
    feed: candidateFeedJson,
    receipt: candidateReceiptJson,
    metadata: {
      payload_etag: "synthetic-test-only",
      payload_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      receipt_etag: "synthetic-test-only",
      receipt_last_modified: "Thu, 13 Aug 2026 14:30:02 GMT",
      served_at: "2026-08-13T14:30:05Z",
    },
  };
}

function candidateHttp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
    statusText: status < 300 ? "OK" : "ERR",
  });
}

describe("candidate panel identity across shadow recovery", () => {
  it("keeps candidate A when shadow Retry recovers, then the 60s cadence retains it as stale and the next poll purges it", async () => {
    const recoveredShadow = transport.shadow;
    transport.shadow = null;
    transport.failed = false;
    const queued = [
      candidateHttp(200, boundCandidatePair()),
      candidateHttp(503, { error: "feed unavailable" }),
      candidateHttp(403, { error: "pro_required" }),
    ];
    const candidateCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("f=options_alpha_candidate_feed")) return originalFetch(input, init);
      candidateCalls.push(url);
      const next = queued.shift();
      if (!next) throw new Error(`unexpected candidate fetch: ${url}`);
      return next;
    }) as typeof fetch;
    try {
      await act(async () => root.render(<OptionsAlphaView />));
      expect(node.querySelectorAll('[data-testid="options-alpha-measured-event"]')).toHaveLength(1);
      expect(node.querySelector('[data-testid="options-alpha-fires-section"]')).toBeNull();
      const retry = node.querySelector('[data-testid="options-alpha-shadow-unavailable"] button');
      expect(retry?.textContent).toBe("Retry");
      const candidateA = node.querySelector('[data-testid="options-alpha-candidate-item"]');
      expect(candidateA?.textContent).toContain(CANDIDATE_A_ID);
      expect(candidateA?.querySelector('[data-testid="options-alpha-candidate-heading"]')?.textContent).toBe("Contract details unavailable");
      expect(candidateCalls).toEqual([CANDIDATE_FEED_URL]);

      transport.shadow = recoveredShadow;
      await act(async () => { (retry as HTMLButtonElement).click(); });

      expect(node.querySelector('[data-testid="options-alpha-shadow-unavailable"]')).toBeNull();
      expect(node.querySelector('[data-testid="options-alpha-fires-section"]')).not.toBeNull();
      expect(node.querySelector('[data-testid="options-alpha-measured-event"]')).not.toBeNull();
      expect(node.querySelector('[data-testid="options-alpha-candidate-item"]')).toBe(candidateA);
      expect(candidateA?.isConnected).toBe(true);
      expect(candidateCalls).toHaveLength(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(candidateCalls).toHaveLength(2);
      expect(node.querySelector('[data-testid="options-alpha-candidate-item"]')).toBe(candidateA);
      expect(node.querySelector('[data-testid="options-alpha-candidate-stale"]')?.textContent).toMatch(/last verified pair/i);

      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(candidateCalls).toHaveLength(3);
      expect(node.querySelector('[data-testid="options-alpha-candidate-item"]')).toBeNull();
      expect(node.querySelector('[data-testid="options-alpha-candidate-purge"]')).not.toBeNull();
      expect(candidateA?.isConnected).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
