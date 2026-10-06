import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/billing/gateway", () => ({
  billingAuth: vi.fn(async () => ({ token: "session-token" })),
}));
vi.mock("@/lib/upstreams", () => ({ ISSUE_DESK_API_BASE: "https://macro.test" }));

import { fetchSnapshot } from "@/lib/server/tickerNews";
import { NewsContractError, parseSnapshot, TICKER_NEWS_SNAPSHOT_SCHEMA } from "@/lib/newsContract";

let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.clearAllMocks();
});

const validSnapshot = (ticker: string) => ({
  schema: TICKER_NEWS_SNAPSHOT_SCHEMA,
  ticker,
  security_id: `sec:${ticker}`,
  state: "quiet",
  rows: [],
  next_cursor: null,
  has_more: false,
  source_health: { state: "ok" },
});

describe("tickerNews client", () => {
  it("[T04 previous-symbol-late-response] valid MSFT snapshot for AAPL request becomes invalid_upstream_response", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify(validSnapshot("MSFT")),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    await expect(fetchSnapshot("AAPL", { limit: 50 }, "session-token")).rejects.toMatchObject({
      code: "invalid_upstream_response",
      status: 502,
    });
    expect(() => parseSnapshot(validSnapshot("MSFT"), "AAPL")).toThrow(NewsContractError);
  });

  it("[T10 aborted-client] caller abort aborts upstream fetch init.signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchSnapshot("AAPL", { limit: 50 }, "session-token", controller.signal))
      .rejects.toMatchObject({ code: "client_aborted", status: 499 });
  });

  it("[T14 oversize-payload] JSON body over 1 MiB maps to oversize_upstream_response", async () => {
    const huge = "x".repeat(1024 * 1024 + 1);
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ schema: TICKER_NEWS_SNAPSHOT_SCHEMA, junk: huge }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
    await expect(fetchSnapshot("AAPL", { limit: 50 }, "session-token")).rejects.toMatchObject({
      code: "oversize_upstream_response",
      status: 502,
    });
  });

  it("[T15 html-upstream] text/html snapshot response maps to invalid_upstream_response", async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      "<html>bad</html>",
      { status: 500, headers: { "content-type": "text/html" } },
    )) as unknown as typeof fetch;
    await expect(fetchSnapshot("AAPL", { limit: 50 }, "session-token")).rejects.toMatchObject({
      code: "invalid_upstream_response",
      status: 502,
    });
  });
});
