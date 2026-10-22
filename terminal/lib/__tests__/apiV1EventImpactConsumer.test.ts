import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { newApiKeySalt } from "@/lib/apiV1";
import { openApiDocument } from "@/lib/apiV1Openapi";
import { readEventImpact } from "../../scripts/read_event_impact.mjs";

const state = vi.hoisted(() => ({
  salt: "", revoked: false, scopes: ["read"] as string[] | undefined, limited: false,
  rows: null as unknown, reads: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    if (fn === "api_key_salt_for_prefix") return { data: { key_salt: state.salt }, error: null };
    if (fn === "api_key_authenticate") return { data: state.revoked ? null : {
      user_id: args.p_key_prefix === "BBBBBBBB" ? "owner-b" : "owner-a", key_id: "test-key",
      scopes: state.scopes, limit: 60, remaining: state.limited ? 0 : 59,
      rate_limited: state.limited, retry_after: state.limited ? 60 : null,
    }, error: null };
    if (fn === "api_v1_read_as_user") {
      state.reads.push(args);
      return { data: state.rows ?? { ok: true, rows: [{ id: `${args.p_user_id}-position`, ticker: args.p_user_id === "owner-b" ? "MSFT" : "AAPL", shares: 2, status: "open" }] }, error: null };
    }
    throw new Error(`Unexpected test RPC ${fn}`);
  },
}) }));

const KEY_A = `mmx_${"A".repeat(40)}`;
const KEY_B = `mmx_${"B".repeat(40)}`;
const context = { schema: "portfolio_ctx.v1", asof: "2026-09-05", tickers: {
  AAPL: { earnings: { next: "2026-10-30", days_to: 5, direction: "Published source assertion" } },
  MSFT: { earnings: { next: "2026-11-01", days_to: 7 } },
} };
let server: Server;
let origin: string;
let sourceDir: string;
let previousSourceDir: string | undefined;
let get: (request: Request) => Promise<Response>;

async function raw(query = "", key = KEY_A) {
  return fetch(`${origin}/api/v1/event-impact${query}`, { headers: { authorization: `Bearer ${key}` } });
}
function cachePrivate(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("vary")?.toLowerCase()).toContain("authorization");
}

beforeAll(async () => {
  state.salt = newApiKeySalt();
  previousSourceDir = process.env.MACRO_DATA_DIR;
  sourceDir = await mkdtemp(path.join(tmpdir(), "event-impact-api-"));
  process.env.MACRO_DATA_DIR = sourceDir;
  get = (await import("@/app/api/v1/event-impact/route")).GET;
  server = createServer(async (request, response) => {
    try {
      const result = await get(new Request(new URL(request.url!, origin), { headers: request.headers as HeadersInit }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch {
      response.writeHead(500); response.end("Unexpected route failure");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local HTTP address");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => {
  state.revoked = false; state.scopes = ["read"]; state.limited = false; state.rows = null; state.reads = [];
  await writeFile(path.join(sourceDir, "portfolio_ctx.json"), JSON.stringify(context));
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(sourceDir, { recursive: true, force: true });
  if (previousSourceDir === undefined) delete process.env.MACRO_DATA_DIR; else process.env.MACRO_DATA_DIR = previousSourceDir;
});

describe("real event-impact route -> external HTTP client (controlled local data only)", () => {
  it("binds two personal keys to their own holdings and keeps snapshot clocks explicit", async () => {
    const a = await readEventImpact({ origin, apiKey: KEY_A });
    const b = await readEventImpact({ origin, apiKey: KEY_B });
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body.data.events[0].positions[0].id).toBe("owner-a-position");
    expect(b.body.data.events[0].positions[0].id).toBe("owner-b-position");
    expect(a.body.data.events[0].ticker).toBe("AAPL");
    expect(b.body.data.events[0].ticker).toBe("MSFT");
    expect(a.body.data.asof).toBe(context.asof);
    expect(a.body.data.events[0].daysUntil).toBe(5);
    expect(a.body.asof).not.toBe(context.asof);
    expect(a.body.snapshot).toMatchObject({ countdown_basis: "source_snapshot", freshness: "not_evaluated" });
    expect(a.body.inference_metadata.generated_by_api).toBe(false);
    expect(a.body.inference_metadata.evidence_fields).toEqual([]);
    expect(a.body.inference_metadata.unclassified_fields).toContain("/data");
    expect(state.reads.map((r) => r.p_user_id)).toEqual(["owner-a", "owner-b"]);
  });
  it("is discoverable with a schema and no unsupported query or cache contract", () => {
    const api = openApiDocument(origin);
    expect(api["x-resources"]).toContainEqual(expect.objectContaining({ path: "/api/v1/event-impact", schema: "mm.api.v1.event_impact" }));
    const endpoint = api.paths["/api/v1/event-impact"].get;
    expect(endpoint.parameters).toEqual([]);
    expect(endpoint.responses).toHaveProperty("503");
    expect(endpoint.responses).not.toHaveProperty("304");
  });
  it.each(["?user_id=owner-b", "?ticker=MSFT", "?limit=1", "?cursor=x"])("rejects identity/partial selectors %s", async (query) => {
    const response = await raw(query); cachePrivate(response);
    expect(response.status).toBe(400); expect(state.reads).toEqual([]);
  });
  it.each(["revoked", "scope", "missing_scope", "quota", "malformed"])("keeps %s failures private and makes no holdings read", async (mode) => {
    state.revoked = mode === "revoked"; state.scopes = mode === "scope" ? [] : mode === "missing_scope" ? undefined : ["read"]; state.limited = mode === "quota";
    const response = await raw("", mode === "malformed" ? "bad-key" : KEY_A); cachePrivate(response);
    expect(response.status).toBe(["scope", "missing_scope"].includes(mode) ? 403 : mode === "quota" ? 429 : 401);
    if (mode === "quota") expect(response.headers.get("retry-after")).toBe("60");
    expect(state.reads).toEqual([]);
  });
  it("does not confuse a complete empty book with an unreadable source", async () => {
    state.rows = { ok: true, rows: [] }; await rm(path.join(sourceDir, "portfolio_ctx.json"));
    const empty = await readEventImpact({ origin, apiKey: KEY_A });
    expect(empty).toMatchObject({ status: 200, body: { data: { state: "no_holdings" } } });
    state.rows = null;
    const unavailable = await readEventImpact({ origin, apiKey: KEY_A });
    expect(unavailable).toMatchObject({ status: 503, body: { data: { state: "calendar_unreadable" } } });
    expect(JSON.stringify(unavailable.body)).not.toContain(sourceDir);
  });
  it.each([{ ok: true, rows: [null] }, { ok: true, rows: "damaged" }, { ok: true }, { ok: false }, { ok: true, rows: [{ id: "x", ticker: "AAPL", shares: 1, status: "broken" }] }])("refuses malformed complete-book read %j", async (rows) => {
    state.rows = rows;
    const response = await raw(); cachePrivate(response);
    expect(response.status).toBe(503);
    expect((await response.json()).data.state).toBe("holdings_unreadable");
  });
  it("refuses a limit+1 response rather than joining an incomplete portfolio", async () => {
    state.rows = { ok: true, rows: Array.from({ length: 201 }, (_, i) => ({ id: `p${i}`, ticker: "AAPL", shares: 1, status: "open" })) };
    const result = await readEventImpact({ origin, apiKey: KEY_A });
    expect(result).toMatchObject({ status: 503, body: { data: { state: "holdings_unreadable" } } });
  });
  it("refuses to send a key to another destination", async () => {
    await expect(readEventImpact({ origin: "https://example.test", apiKey: KEY_A })).rejects.toThrow("Terminal HTTPS origin");
  });
});
