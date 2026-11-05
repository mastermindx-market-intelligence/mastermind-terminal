import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  API_V1_MAX_LIMIT,
  API_V1_RATE_LIMIT_MINUTE,
  API_V1_VERSION,
  firstForbiddenField,
  newApiKeySalt,
} from "@/lib/apiV1";
import {
  EVENT_IMPACT_SCHEMA,
  joinEventImpactForBook,
  portfolioCtxPath,
  readPortfolioCtx,
  validatePositionRows,
} from "@/lib/apiV1EventImpact";
import { API_V1_READ_SCHEMA_VERSION } from "@/lib/apiV1Metadata";
import { GET } from "../../app/api/v1/event-impact/route";
import { handleEventImpactGet, type EventImpactDeps } from "@/lib/apiV1EventImpactServer";

const key = `mmx_${"A".repeat(40)}`;
const salt = newApiKeySalt();
const READ_FN = "api_v1_read_as_user";

const request = (search = "") =>
  new Request(`https://example.test/api/v1/event-impact${search}`, {
    headers: { authorization: `Bearer ${key}` },
  });

type RpcCall = { fn: string; args: Record<string, unknown> };

function service(opts: {
  rows?: unknown[];
  authData?: unknown;
  scopes?: string[];
  rateLimited?: boolean;
  readError?: boolean;
} = {}) {
  const calls: RpcCall[] = [];
  const svc = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "api_key_salt_for_prefix") return { data: { key_salt: salt }, error: null };
      if (fn === "api_key_authenticate") {
        if ("authData" in opts) return { data: opts.authData, error: null };
        return {
          data: {
            user_id: "owner-a",
            key_id: "key-a",
            scopes: opts.scopes ?? ["read"],
            limit: 60,
            remaining: opts.rateLimited ? 0 : 59,
            ...(opts.rateLimited ? { rate_limited: true, retry_after: 30 } : {}),
          },
          error: null,
        };
      }
      if (fn === READ_FN) {
        if (opts.readError) return { data: null, error: { message: "positions read failed" } };
        return { data: { ok: true, rows: opts.rows ?? [] }, error: null };
      }
      return { data: null, error: { message: "unexpected fn" } };
    },
  };
  return { calls, svc };
}

function deps(svc: unknown, reader?: EventImpactDeps["readContext"]): EventImpactDeps {
  return {
    service: svc as EventImpactDeps["service"],
    ...(reader ? { readContext: reader } : {}),
  };
}

function countingContext(ctx: unknown) {
  let reads = 0;
  return {
    reads: () => reads,
    reader: async (): Promise<{ ok: true; ctx: unknown }> => {
      reads += 1;
      return { ok: true, ctx };
    },
  };
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "p1",
  ticker: "AAPL",
  shares: 120,
  entry_price: null,
  entry_date: null,
  notes: null,
  status: "open",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

const baseCtx = (tickers: Record<string, unknown>, asof = "2026-09-05") => ({
  schema: "portfolio_ctx.v1",
  asof,
  tickers,
});

const earningsCtx = (asof?: string) =>
  baseCtx({ AAPL: { earnings: { next: "2026-10-30", days_to: 5 } } }, asof);

function readCalls(calls: RpcCall[]) {
  return calls.filter((c) => c.fn === READ_FN);
}

function expectCommonHeaders(res: Response, limit: string, remaining: string) {
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect((res.headers.get("vary") ?? "").includes("Authorization")).toBe(true);
  expect(res.headers.get("x-ratelimit-limit")).toBe(limit);
  expect(res.headers.get("x-ratelimit-remaining")).toBe(remaining);
}

describe("GET /api/v1/event-impact (actual handler, mocked RPC, injected local context)", () => {
  it("exported GET delegates to the handler and refuses anonymous callers", async () => {
    const res = await GET(new Request("https://example.test/api/v1/event-impact"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error.code).toBe("unauthorized");
    expectCommonHeaders(res, String(API_V1_RATE_LIMIT_MINUTE), "0");
  });

  it("unauthorized or revoked keys get no read and no calendar access", async () => {
    const ctx = countingContext(earningsCtx());
    const anonymous = service();
    const res401 = await handleEventImpactGet(
      new Request("https://example.test/api/v1/event-impact"),
      deps(anonymous.svc, ctx.reader),
    );
    expect(res401.status).toBe(401);
    expect(anonymous.calls).toEqual([]);
    expect(ctx.reads()).toBe(0);
    expectCommonHeaders(res401, String(API_V1_RATE_LIMIT_MINUTE), "0");

    const revoked = service({ authData: null });
    const resRevoked = await handleEventImpactGet(request(), deps(revoked.svc, ctx.reader));
    expect(resRevoked.status).toBe(401);
    expect(readCalls(revoked.calls)).toEqual([]);
    expect(ctx.reads()).toBe(0);
  });

  it("a rate limited key gets 429 before any read or calendar access", async () => {
    const ctx = countingContext(earningsCtx());
    const { calls, svc } = service({ rateLimited: true });
    const res = await handleEventImpactGet(request(), deps(svc, ctx.reader));
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBe("30");
    expectCommonHeaders(res, "60", "0");
    expect(readCalls(calls)).toEqual([]);
    expect(ctx.reads()).toBe(0);
  });

  it("a key without the read scope is forbidden before any read or calendar access", async () => {
    const ctx = countingContext(earningsCtx());
    const { calls, svc } = service({ scopes: [] });
    const res = await handleEventImpactGet(request(), deps(svc, ctx.reader));
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("forbidden");
    expect(readCalls(calls)).toEqual([]);
    expect(ctx.reads()).toBe(0);
    expectCommonHeaders(res, "60", "59");
  });

  it("refuses every query parameter — spoofed selectors included", async () => {
    const ctx = countingContext(earningsCtx());
    for (const search of [
      "?limit=10",
      "?user_id=someone-else",
      "?account=acme&tenant=t1",
      "?cursor=x",
    ]) {
      const { calls, svc } = service({ rows: [row()] });
      const res = await handleEventImpactGet(request(search), deps(svc, ctx.reader));
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe("invalid_request");
      expect(readCalls(calls)).toEqual([]);
    }
    expect(ctx.reads()).toBe(0);
  });

  it("binds the result to the key owner only and serves the joined result", async () => {
    const ctx = countingContext(
      baseCtx({
        AAPL: {
          earnings: {
            next: "2026-10-30",
            days_to: 5,
            direction: "Bullish setup, per source.",
            direction_zh: "来源称看涨。",
          },
        },
      }),
    );
    const { calls, svc } = service({ rows: [row(), row({ id: "p2", shares: null })] });
    const res = await handleEventImpactGet(request(), deps(svc, ctx.reader));
    expect(res.status).toBe(200);
    expectCommonHeaders(res, "60", "59");

    // The read is the auth-scoped RPC with exactly the pinned contract: only auth.userId, only
    // the positions resource, only the page limit — nothing from the request body/query.
    const read = readCalls(calls);
    expect(read).toHaveLength(1);
    expect(read[0].args.p_user_id).toBe("owner-a");
    expect(read[0].args.p_resource).toBe("positions");
    expect(read[0].args.p_args).toEqual({ limit: API_V1_MAX_LIMIT });
    expect(calls).toHaveLength(3); // salt + authenticate + one read, nothing else

    const body = (await res.json()) as any;
    expect(body.schema).toBe(EVENT_IMPACT_SCHEMA);
    expect(body.version).toBe(API_V1_VERSION);
    expect(body.schema_version).toBe(API_V1_READ_SCHEMA_VERSION);
    // Two clocks: the envelope asof is THIS response's observation time; the source asof is
    // carried through data verbatim and never overwritten.
    expect(body.asof).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(body.data.asof).toBe("2026-09-05");
    expect(body.asof).not.toBe(body.data.asof);

    expect(body.data.state).toBe("ok");
    expect(body.data.heldTickers).toBe(1);
    expect(body.data.heldPositions).toBe(2);
    expect(body.data.events).toHaveLength(1);
    const e = body.data.events[0];
    expect(e.eventId).toBe("earnings|AAPL|2026-10-30");
    expect(e.kind).toBe("earnings");
    expect(e.ticker).toBe("AAPL");
    expect(e.date).toBe("2026-10-30");
    expect(e.daysUntil).toBe(5); // verbatim days_to, never recomputed
    expect(e.sourcePath).toBe("/data/portfolio_ctx.json");
    // Duplicate positions preserved; unsized position stays unsized.
    expect(e.positions).toHaveLength(2);
    expect(e.positions[0]).toEqual({ id: "p1", ticker: "AAPL", shares: 120, status: "open" });
    expect(e.positions[1]).toEqual({ id: "p2", ticker: "AAPL", shares: null, status: "open" });
    // Source-only carried fields: stated when the artifact says, typed null when it does not.
    expect(e.direction).toEqual({
      state: "stated",
      text: "Bullish setup, per source.",
      textZh: "来源称看涨。",
    });
    expect(e.mechanism).toEqual({ state: "not_stated" });
    expect(e.timeframe).toEqual({ state: "not_stated" });
    expect(e.invalidation.condition_en).toBe("A last close has printed on the report date.");
    expect(e.invalidation.named_date).toBe("2026-10-30");
    // Unjoinable calendars still disclosed; unclassified metadata stays unclassified.
    expect(body.data.unjoinable).toHaveLength(2);
    expect(body.inference_metadata.unclassified_fields).toEqual(["/data"]);
    expect(body.inference_metadata.evidence_fields).toEqual([]);
    expect(body.inference_metadata.assertion_fields).toEqual([]);
    expect(body.page).toEqual({ next_cursor: null, limit: API_V1_MAX_LIMIT });
    expect(body.coverage.rows).toBe(2);
    expect(body.coverage.nulls).toEqual([
      { field: "shares", reason: "This field was empty on at least one row in the source." },
    ]);
    expect(firstForbiddenField(body)).toBeNull();
  });

  it("serves no cached artifact: each request re-reads the source", async () => {
    let n = 0;
    const reader = async (): Promise<{ ok: true; ctx: unknown }> => {
      n += 1;
      return { ok: true, ctx: earningsCtx(n === 1 ? "2026-09-05" : "2026-09-06") };
    };
    const { svc } = service({ rows: [row()] });
    const d = deps(svc, reader);
    const first = await handleEventImpactGet(request(), d);
    const second = await handleEventImpactGet(request(), d);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const b1 = (await first.json()) as any;
    const b2 = (await second.json()) as any;
    expect(b1.data.asof).toBe("2026-09-05");
    expect(b2.data.asof).toBe("2026-09-06");
    expect(b2.data.events[0].daysUntil).toBe(5);
    expect(n).toBe(2);
  });

  it("a page over the limit fails closed as holdings_unreadable with no calendar access", async () => {
    const ctx = countingContext(earningsCtx());
    const rows = Array.from({ length: API_V1_MAX_LIMIT + 1 }, (_, i) => row({ id: `p${i}` }));
    const { calls, svc } = service({ rows });
    const res = await handleEventImpactGet(request(), deps(svc, ctx.reader));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.schema).toBe(EVENT_IMPACT_SCHEMA);
    expect(body.data.state).toMatch(/unreadable/);
    expect(body.data.state).toBe("holdings_unreadable");
    expect(ctx.reads()).toBe(0);
    expectCommonHeaders(res, "60", "59");
  });

  it("a malformed row fails the whole read, never a partial book", async () => {
    const ctx = countingContext(earningsCtx());
    // Complete-book mode refuses invalid RPC rows before the legacy mapper can discard them.
    const cases = [
      [row(), row({ id: "p2", shares: "3O" })],
      [row(), row({ id: "p2", status: "OPEN" })],
      [row(), row({ id: "p2", ticker: "   " })],
      [row(), row({ id: "p2", shares: Number.POSITIVE_INFINITY })],
    ];
    for (const rows of cases) {
      const { svc } = service({ rows });
      const res = await handleEventImpactGet(request(), deps(svc, ctx.reader));
      expect(res.status).toBe(503);
      const body = (await res.json()) as any;
      expect(body.data.state).toBe("holdings_unreadable");
      expect(body.data.state).toMatch(/unreadable/);
      // No partial book and no join output leaks through a failed read.
      expect(body.data.events).toBeUndefined();
    }
    expect(ctx.reads()).toBe(0);
  });

  it("a failed positions RPC fails closed without touching the calendar", async () => {
    const ctx = countingContext(earningsCtx());
    const { svc } = service({ readError: true });
    const res = await handleEventImpactGet(request(), deps(svc, ctx.reader));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe("holdings_unreadable");
    expect(body.data.state).toMatch(/unreadable/);
    expect(JSON.stringify(body)).not.toContain("positions read failed");
    expect(ctx.reads()).toBe(0);
  });

  it("genuine empty and closed-only books are no_holdings with no calendar access", async () => {
    const ctx = countingContext(earningsCtx());
    const empty = service({ rows: [] });
    const resEmpty = await handleEventImpactGet(request(), deps(empty.svc, ctx.reader));
    expect(resEmpty.status).toBe(200);
    const emptyBody = (await resEmpty.json()) as any;
    expect(emptyBody.data.state).toBe("no_holdings");
    expect(emptyBody.coverage.rows).toBe(0);
    expect(emptyBody.data.events).toBeUndefined();
    expect(ctx.reads()).toBe(0);

    const closed = service({ rows: [row({ status: "closed" })] });
    const resClosed = await handleEventImpactGet(request(), deps(closed.svc, ctx.reader));
    expect(resClosed.status).toBe(200);
    const closedBody = (await resClosed.json()) as any;
    expect(closedBody.data.state).toBe("no_holdings");
    expect(closedBody.coverage.rows).toBe(1);
    expect(ctx.reads()).toBe(0);
  });

  it("a broken or absent calendar is calendar_unreadable with no detail leaked", async () => {
    const corrupt = async (): Promise<{ ok: false; reason: "corrupt" }> => ({
      ok: false,
      reason: "corrupt",
    });
    const { svc } = service({ rows: [row()] });
    const res = await handleEventImpactGet(request(), deps(svc, corrupt));
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.data.state).toBe("calendar_unreadable");
    expect(body.data.state).toMatch(/unreadable/);
    // The fixed reason token and any path-shaped detail stay server-side.
    expect(JSON.stringify(body)).not.toContain("corrupt");
    expect(JSON.stringify(body)).not.toContain("/opt/macro");

    const missing = async (): Promise<{ ok: false; reason: "missing" }> => ({
      ok: false,
      reason: "missing",
    });
    const resMissing = await handleEventImpactGet(request(), deps(svc, missing));
    expect(resMissing.status).toBe(503);
    expect(((await resMissing.json()) as any).data.state).toBe("calendar_unreadable");
    expectCommonHeaders(resMissing, "60", "59");
  });
});

describe("apiV1EventImpact pieces", () => {
  it("validatePositionRows maps strictly and fails closed instead of dropping", () => {
    expect(validatePositionRows([])).toEqual({ ok: true, positions: [] });
    expect(validatePositionRows([row()])).toEqual({
      ok: true,
      positions: [{ id: "p1", ticker: "AAPL", shares: 120, status: "open" }],
    });
    expect(validatePositionRows([row({ shares: 0 })])).toMatchObject({ ok: true });
    expect(
      validatePositionRows(Array.from({ length: API_V1_MAX_LIMIT + 1 }, (_, i) => row({ id: `p${i}` }))),
    ).toEqual({ ok: false, reason: "over_limit" });
    const bad = [
      null,
      "row",
      [],
      row({ id: "" }),
      row({ ticker: "" }),
      row({ ticker: 7 }),
      row({ status: "OPEN" }),
      row({ status: null }),
      row({ shares: "3O" }),
      row({ shares: Number.POSITIVE_INFINITY }),
    ];
    for (const badRow of bad) {
      expect(validatePositionRows([badRow])).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("joinEventImpactForBook skips the calendar for an empty/closed book and joins open ones", async () => {
    let reads = 0;
    const brokenReader = async (): Promise<{ ok: false; reason: "missing" }> => {
      reads += 1;
      return { ok: false, reason: "missing" };
    };
    const closed = await joinEventImpactForBook({
      positions: [{ id: "p1", ticker: "AAPL", shares: 1, status: "closed" }],
      readContext: brokenReader,
    });
    expect(closed.state).toBe("no_holdings");
    expect(reads).toBe(0);

    const broken = await joinEventImpactForBook({
      positions: [{ id: "p1", ticker: "AAPL", shares: 1, status: "open" }],
      readContext: brokenReader,
    });
    expect(broken.state).toBe("calendar_unreadable");
    expect(reads).toBe(1);

    const ok = await joinEventImpactForBook({
      positions: [{ id: "p1", ticker: "AAPL", shares: 1, status: "open" }],
      readContext: async () => ({ ok: true, ctx: earningsCtx() }),
    });
    expect(ok.state).toBe("ok");
  });

  it("readPortfolioCtx parses the canonical local artifact at MACRO_DATA_DIR", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "event-impact-ctx-"));
    try {
      const ctx = { schema: "portfolio_ctx.v1", asof: "2026-09-05", tickers: {} };
      writeFileSync(path.join(dir, "portfolio_ctx.json"), JSON.stringify(ctx));
      process.env.MACRO_DATA_DIR = dir;
      expect(portfolioCtxPath()).toBe(path.join(dir, "portfolio_ctx.json"));
      const read = await readPortfolioCtx();
      expect(read).toEqual({ ok: true, ctx });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readPortfolioCtx reports missing and corrupt as fixed reasons, never raw errors", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "event-impact-ctx-"));
    try {
      process.env.MACRO_DATA_DIR = dir;
      expect(await readPortfolioCtx()).toEqual({ ok: false, reason: "missing" });
      writeFileSync(path.join(dir, "portfolio_ctx.json"), "{not json");
      const broken = await readPortfolioCtx();
      expect(broken.ok).toBe(false);
      if (!broken.ok) expect(broken.reason).toBe("corrupt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const ORIGINAL_DIR = process.env.MACRO_DATA_DIR;
  afterEach(() => {
    if (ORIGINAL_DIR === undefined) delete process.env.MACRO_DATA_DIR;
    else process.env.MACRO_DATA_DIR = ORIGINAL_DIR;
  });
});
