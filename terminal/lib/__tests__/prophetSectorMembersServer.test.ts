/**
 * prophetSectorMembersServer.test.ts — BFF gates for
 * GET /api/prophet/sector-members (lib/prophetSectorMembersServer.ts).
 *
 * Laws pinned here:
 *   - No session, no upstream flight: the Supabase verifier runs before Macro is
 *     ever contacted, and a verifier outage is distinct from a denied session.
 *   - Query admission is closed: only the frozen parameter set, single
 *     occurrence, grammar-checked; malformed answers 422 without an upstream call.
 *   - The owner's transport answer is relayed truthfully: 401/403/422 pass
 *     through, its private refusal body is never re-hosted, the unknown_group 404
 *     is forwarded, and an undeployed/404-without-code source reads unavailable.
 *   - Wire bytes are re-served only after the shared contract decoder admits
 *     them; HTML, malformed JSON, oversize bodies and non-contract JSON are 502.
 *   - Fixture mode (FLOW_FIXTURE/TERMINAL_E2E_FIXTURE) answers from the committed
 *     captures with the same query admission, without billing or network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: "ok" as "ok" | "denied" | "unavailable",
  token: "verified-test-token",
  limited: false,
}));
vi.mock("@/app/api/billing/gateway", () => ({
  BILLING_BASE: "https://macro.test",
  billingAuthResult: vi.fn(async () => state.auth === "ok"
    ? { status: "ok", token: state.token }
    : { status: state.auth }),
}));
vi.mock("@/lib/rateLimit", () => ({
  rateLimit: () => ({ ok: !state.limited, remaining: state.limited ? 0 : 59, retryAfterSec: 30 }),
}));

import { GET } from "@/app/api/prophet/sector-members/route";

const FIXTURE_DIR = path.join(process.cwd(), "public/data/prophet_sector_members_fixture");
const fixture = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as unknown;
const industrials = (): Record<string, unknown> =>
  fixture("group_us_sector_industrials.json") as Record<string, unknown>;

const request = (query = "group=us_sector_industrials", signal?: AbortSignal) =>
  new Request(`https://terminal.test/api/prophet/sector-members${query ? `?${query}` : ""}`, { signal });
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { FLOW_FIXTURE: process.env.FLOW_FIXTURE, TERMINAL_E2E_FIXTURE: process.env.TERMINAL_E2E_FIXTURE };
  delete process.env.FLOW_FIXTURE;
  delete process.env.TERMINAL_E2E_FIXTURE;
  state.auth = "ok";
  state.limited = false;
  vi.stubGlobal("fetch", vi.fn(async () => json(industrials())));
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Prophet sector-members BFF: authentication boundary", () => {
  it("verifies the session before any upstream call and answers private", async () => {
    state.auth = "denied";
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "authentication_required" });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toContain("Cookie");
  });

  it("keeps verifier unavailability distinct from a denied session", async () => {
    state.auth = "unavailable";
    expect((await GET(request())).status).toBe(502);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Prophet sector-members BFF: closed query admission", () => {
  it.each([
    ["unknown param", "group=us_sector_industrials&upstream=https://bad.test"],
    ["duplicate param", "group=us_sector_industrials&group=defensives"],
    ["group and symbol together", "group=us_sector_industrials&symbol=CARR"],
    ["group outside the id grammar", "group=US_SECTOR_INDUSTRIALS"],
    ["lowercase symbol", "symbol=carr"],
    ["limit above the contract maximum", "group=us_sector_industrials&limit=201"],
    ["non-numeric limit", "group=us_sector_industrials&limit=abc"],
    ["negative offset", "group=us_sector_industrials&offset=-1"],
  ])("rejects %s with 422 and no upstream call", async (_label, query) => {
    const result = await GET(request(query));
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ error: "invalid_query" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Prophet sector-members BFF: upstream transport", () => {
  it("forwards the admitted group query once, with the verified token", async () => {
    await GET(request("group=us_sector_industrials&state=open_plan"));
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://macro.test/api/prophet/sector-members/v1?group=us_sector_industrials&state=open_plan");
    expect(init).toMatchObject({
      cache: "no-store",
      redirect: "error",
      headers: { Authorization: `Bearer ${state.token}` },
    });
  });

  it("re-serves a contract body after the decode gate", async () => {
    const result = await GET(request("group=us_sector_industrials&state=open_plan"));
    expect(result.status).toBe(200);
    const body = await result.json() as Record<string, unknown>;
    expect(body.schema).toBe("prophet.sector_members/v1");
    expect(body.mode).toBe("group");
    expect((body.group as Record<string, unknown>).id).toBe("us_sector_industrials");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
  });

  it("relays an entitlement denial without re-hosting the owner's refusal text", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ detail: "private operator or billing data" }, 403));
    const result = await GET(request());
    expect(result.status).toBe(403);
    const text = await result.text();
    expect(JSON.parse(text)).toEqual({ error: "entitlement_required" });
    expect(text).not.toContain("private operator");
  });

  it("forwards the owner's unknown_group 404 as the contract's not-found answer", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ code: "unknown_group", reason: "nope" }, 404));
    const result = await GET(request());
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "unknown_group", code: "unknown_group" });
  });

  it("reads a 404 without the contract code as an absent source, never a wrong-group error", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ detail: "no route" }, 404));
    const result = await GET(request());
    expect(result.status).toBe(503);
    const text = await result.text();
    expect(JSON.parse(text)).toEqual({ error: "source_unavailable" });
    expect(text).not.toContain("no route");
  });

  it("maps upstream 502 and 503 to the unavailable reading", async () => {
    for (const [upstream, expected] of [[503, 503], [502, 502]] as const) {
      vi.mocked(fetch).mockResolvedValue(json({ detail: "gateway down" }, upstream));
      const result = await GET(request());
      expect(result.status).toBe(expected);
      expect(await result.json()).toEqual({ error: "source_unavailable" });
    }
  });

  it("refuses HTML, malformed JSON, oversize bytes and non-contract JSON with 502", async () => {
    const bodies: Response[] = [
      new Response("<script>secret()</script>", { headers: { "Content-Type": "text/html" } }),
      new Response("not json", { headers: { "Content-Type": "application/json" } }),
      new Response(" ".repeat(128 * 1024 + 1), { headers: { "Content-Type": "application/json" } }),
      json({ schema: "something/else", rows: [] }),
    ];
    for (const body of bodies) {
      vi.mocked(fetch).mockResolvedValue(body);
      const result = await GET(request());
      expect(result.status).toBe(502);
      const text = await result.text();
      expect(text).not.toContain("secret");
      if (!text.includes("invalid_source")) expect(JSON.parse(text)).toEqual({ error: "source_unavailable" });
    }
  });

  it("names a non-contract 200 body invalid_source", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ schema: "prophet.sector_members/v1", mode: "group" }));
    const result = await GET(request());
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: "invalid_source" });
  });

  it("bounds a hanging owner request within one deadline", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await pending).status).toBe(503);
  });

  it("honors caller cancellation without contacting the owner", async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await GET(request("group=us_sector_industrials", controller.signal))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rate-limits after verification and before the owner call", async () => {
    state.limited = true;
    const result = await GET(request());
    expect(result.status).toBe(429);
    expect(await result.json()).toEqual({ error: "rate_limited" });
    expect(result.headers.get("retry-after")).toBe("30");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Prophet sector-members BFF: fixture mode", () => {
  it("serves the committed capture from disk with the fixture marker", async () => {
    process.env.FLOW_FIXTURE = "1";
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("x-flow-source")).toBe("fixture");
    expect(fetch).not.toHaveBeenCalled();
    const body = await result.json() as Record<string, unknown>;
    expect(body.schema).toBe("prophet.sector_members/v1");
    expect(body.mode).toBe("group");
    expect((body.group as Record<string, unknown>).id).toBe("us_sector_industrials");
    expect((body.members as unknown[]).length).toBe(83);
    expect(body.page).toMatchObject({ offset: 0, limit: 100, total_matching: 83, next_offset: null });
  });

  it("answers an unknown group as the owner's 404 contract code", async () => {
    process.env.FLOW_FIXTURE = "1";
    const result = await GET(request("group=no_such_group"));
    expect(result.status).toBe(404);
    const body = await result.json() as Record<string, unknown>;
    expect(body.code).toBe("unknown_group");
    expect(body.reason).toBe("no_such_group");
  });

  it("still enforces query admission before any fixture read", async () => {
    process.env.FLOW_FIXTURE = "1";
    const result = await GET(request("group=us_sector_industrials&group=defensives"));
    expect(result.status).toBe(422);
    expect(await result.json()).toEqual({ error: "invalid_query" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is enabled by TERMINAL_E2E_FIXTURE alone", async () => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("x-flow-source")).toBe("fixture");
    expect(fetch).not.toHaveBeenCalled();
  });
});
