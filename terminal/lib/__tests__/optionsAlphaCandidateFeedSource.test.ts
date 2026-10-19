// Options Alpha — candidate evidence transport (transport-only packet).
//
// What this packet does NOT do (and what guards its absence):
//   1. No UI. No consumer. No poller. No SSE contract. There is no formed
//      candidate data anywhere yet — the publisher is MACRO PR #8310,
//      options.alpha_candidate_feed/v1.
//   2. No backend. No fallthrough to options_prophet/shadow or any other feed.
//      A missing R2 object resolves to "feed unavailable" (503 no-store),
//      which is the same cold-upstream contract every other flow feed has.
//   3. No schema validator duplicated here. The forthcoming consumer
//      owns wrong-JSON validation against options.alpha_candidate_feed/v1.
//
// These tests pin the three routing pillars (gate, key, source-order) AND
// the two failure modes (R2 missing → null; R2 success → payload as-is,
// never decorated with backend data) so that no future refactor can quietly
// invent a fallback or a poller.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isValidF,
  r2Key,
  upstreamSourceOrder,
  fixtureFor,
  tryFetchUpstream,
  loadFlowFresh,
} from "@/lib/flowSource";

let realFetch: typeof globalThis.fetch;
const savedFixture = process.env.FLOW_FIXTURE;

beforeEach(() => {
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedFixture === undefined) delete process.env.FLOW_FIXTURE;
  else process.env.FLOW_FIXTURE = savedFixture;
  vi.restoreAllMocks();
});

const R2_BASE = "https://pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev";
const BACKEND = "http://127.0.0.1:8000";
const CANDIDATE_KEY = "options_alpha/candidate_feed.json";

describe("Options Alpha candidate-feed — gate", () => {
  it("accepts the new feed key", () => {
    expect(isValidF("options_alpha_candidate_feed")).toBe(true);
  });

  it("still rejects near-miss prefixes so a future typo can't slip in", () => {
    expect(isValidF("options_alpha_candidate_feed:SPY")).toBe(false);
    expect(isValidF("options_alpha")).toBe(false);
    expect(isValidF("options_alpha_candidate")).toBe(false);
    expect(isValidF("options_prophet_candidate_feed")).toBe(false);
  });
});

describe("Options Alpha candidate-feed — R2 key layout", () => {
  it("maps to the exact R2 object the macro publisher lands at", () => {
    expect(r2Key("options_alpha_candidate_feed")).toBe(CANDIDATE_KEY);
  });

  it("does not collide with the neighbouring Options Prophet key", () => {
    // options_prophet/index.json is the shadow feed's whole-file artifact; an
    // accidental shadow fallback would be a different policy entirely and the
    // two keys must remain visually disjoint.
    expect(r2Key("options_alpha_candidate_feed")).not.toBe(r2Key("options_prophet_idx"));
  });

  it("upstreamSourceOrder is R2-ONLY — no backend probe allowed", () => {
    expect(upstreamSourceOrder("options_alpha_candidate_feed")).toEqual(["r2"]);
  });

  it("upstreamSourceOrder does NOT inherit the prophet shadow order", () => {
    // prophet_idx probes R2 first then backend; this key must NEVER take that
    // path because there is no backend route and probing produces a misleading
    // attribution. The orders must be distinct so a copy/paste fix can't quietly
    // re-enable the backend probe.
    expect(upstreamSourceOrder("options_alpha_candidate_feed"))
      .not.toEqual(upstreamSourceOrder("options_prophet_idx"));
  });
});

describe("Options Alpha candidate-feed — upstream resolution", () => {
  it("reads the canonical R2 object verbatim on a 200, never touches backend or shadow", async () => {
    const payload = {
      schema: "options.alpha_candidate_feed/v1",
      active: true,
      as_of: "2026-10-03T13:30:00Z",
      candidates: [
        { id: "SPY_2026-10-09_580_C", root: "POG", confidence: 0.82, edge: 0.07 },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${R2_BASE}/${CANDIDATE_KEY}`) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Any call to the backend, to the Prophet R2 key, or to anything else
      // would mean a fallback has been wired in. The test must name the URL
      // that landed here so a future regression can't pass silently.
      throw new Error(`unexpected upstream call: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("options_alpha_candidate_feed");

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${R2_BASE}/${CANDIDATE_KEY}`);
  });

  it("returns null on a cold R2 404 — the /api/flow path turns this into a 503 no-store", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${R2_BASE}/${CANDIDATE_KEY}`) {
        return new Response("not found", { status: 404 });
      }
      if (url === `${BACKEND}/api/flow/options_alpha_candidate_feed`
          || url === `${BACKEND}/api/hub/options_prophet`) {
        throw new Error(
          `candidate-feed must not fall through to backend/shadow; saw ${url}`,
        );
      }
      throw new Error(`unexpected upstream call: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("options_alpha_candidate_feed");

    expect(result).toBeNull();
    // Exactly one attempt: the R2 read. No backend probe, no shadow probe, no
    // second R2 attempt against a different key.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${R2_BASE}/${CANDIDATE_KEY}`);
  });

  it("returns null on a cold R2 5xx with the same single-attempt discipline", async () => {
    // 503 from R2 means the publisher is unavailable (same shape as a 404 for
    // our purposes — no fallback, no fabrication). Pin the single-attempt
    // contract so a future "retry once on 5xx" can't quietly re-enable a
    // backend probe.
    const fetchMock = vi.fn(async () => new Response("upstream down", { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await tryFetchUpstream("options_alpha_candidate_feed");

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("loadFlowFresh, in non-fixture mode, surfaces the same null as tryFetchUpstream", async () => {
    delete process.env.FLOW_FIXTURE;
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const result = await loadFlowFresh("options_alpha_candidate_feed");

    expect(result).toBeNull();
  });
});

describe("Options Alpha candidate-feed — fixture mode seam", () => {
  it("returns the explicit inactive shape — does NOT read the legacy flow_fixture.json", async () => {
    // The legacy fixture file would resolve `all[f] ?? {}` to `{}` and serve
    // it under a candidate-feed schema header. Pin the early return so a
    // future refactor cannot quietly route the new key through the legacy
    // file (the empty-object path IS the misleading artifact this guard
    // refuses).
    process.env.FLOW_FIXTURE = "1";
    const result = await fixtureFor("options_alpha_candidate_feed");

    expect(result).toEqual({
      schema: "options.alpha_candidate_feed/v1",
      active: false,
      as_of: "",
      candidates: [],
      source: "fixture-empty",
    });
    // `active: false` + `candidates: []` is the contract: no formed candidates,
    // honest "publisher not shipping today" state. A future consumer reads
    // off these two fields, not off `result === {}`.
    expect((result as { active: boolean }).active).toBe(false);
    expect((result as { candidates: unknown[] }).candidates).toEqual([]);
  });

  it("loadFlowFresh, in fixture mode, returns that inactive shape (not null)", async () => {
    process.env.FLOW_FIXTURE = "1";
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fixture mode must not touch the network");
    }) as unknown as typeof globalThis.fetch;

    const result = await loadFlowFresh("options_alpha_candidate_feed");

    expect(result).toMatchObject({
      schema: "options.alpha_candidate_feed/v1",
      active: false,
    });
  });
});