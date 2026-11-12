/**
 * sectorPopulationRoute.test.ts — permanent BFF gates for the population
 * branch of /api/sector-intelligence (review 14:21Z: N1 + S3), converted from
 * the independent reviewer's probe (l3probes/bff.test.tsx).
 *
 * Laws pinned here:
 *   - N1: an unauthenticated caller makes ZERO upstream calls. The session is
 *     proven in the gateway (cookie → getUser/getSession → re-read cookie)
 *     before the owner origin is ever contacted; entitlement stays enforced
 *     upstream (macro-api is the authority), so one authenticated call IS the
 *     design — but no session, no flight.
 *   - N1: an upstream denial reaches the caller as the owner's status + code
 *     (FORBIDDEN → 403 denied), never as an empty table or a silent 200.
 *   - S3: the ONLY refusal body relayed upstream→browser is
 *     {schema, code, reason?} with a closed code set and a reason that is a
 *     snake_case token (^[a-z][a-z0-9_]{0,63}$, itself bounded to 160 chars).
 *     Upstream hostnames, paths, stacks, tokens and field names
 *     ({"error":"upstream http://10.0.0.5:8000 failed","trace":…}) collapse
 *     to the generic UPSTREAM_UNAVAILABLE code, and a free-text or
 *     credential-shaped `reason` is DROPPED, never shortened (r2 SF-1).
 *   - An oversize (>4 MiB) owner body is a 502 PAYLOAD_INVALID gateway
 *     verdict; a valid page is passed through for the shared decoder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { getUser, getSession } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, getSession } }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [{ name: "sb-abc-auth-token", value: "test-session" }] }),
}));

import { GET } from "@/app/api/sector-intelligence/route";

const fixture = JSON.parse(readFileSync(
  join(__dirname, "fixtures", "sector_population.captured.v11_page1.json"), "utf8")) as unknown;

const upstreamUrls: string[] = [];
const upstreamHeaders: Record<string, string>[] = [];
let upstream: (() => Response) | null = null;

/** One authenticated population request from a fresh rate-limit identity. */
let caller = 0;
const call = (query: string, cookie = "sb-abc-auth-token=test-session"): Promise<Response> => {
  caller += 1;
  return GET(new Request(`https://terminal.test/api/sector-intelligence?${query}`, {
    headers: { cookie, "x-forwarded-for": `10.42.0.${caller}` },
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  upstreamUrls.length = 0;
  upstreamHeaders.length = 0;
  upstream = null;
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  getSession.mockResolvedValue({ data: { session: { access_token: "t", user: { id: "u1" } } } });
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
    upstreamUrls.push(String(input));
    upstreamHeaders.push(init?.headers ?? {});
    return upstream!();
  }));
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("population BFF — authentication frontier (N1)", () => {
  it("makes ZERO upstream calls without a session cookie", async () => {
    const response = await call("source=population", "");
    expect(response.status).toBe(401);
    expect(upstreamUrls).toHaveLength(0);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("makes ZERO upstream calls when the session cannot be proven", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await call("source=population");
    expect(response.status).toBe(401);
    expect(upstreamUrls).toHaveLength(0);
  });

  it("refuses a caller-supplied audience before any upstream call", async () => {
    const response = await call("source=population&audience=preview");
    expect(response.status).toBe(400);
    expect(upstreamUrls).toHaveLength(0);
  });

  it("forwards only the filtered session cookie and forces audience=entitled", async () => {
    upstream = () => json(200, fixture);
    const response = await call("source=population&group=housing");
    expect(response.status).toBe(200);
    expect(upstreamUrls).toHaveLength(1);
    const sent = new URL(upstreamUrls[0]);
    expect(sent.searchParams.getAll("audience")).toEqual(["entitled"]);
    expect(sent.searchParams.get("group")).toBe("housing");
    expect(upstreamHeaders[0].Cookie).toBe("sb-abc-auth-token=test-session");
  });
});

describe("population BFF — refusal relay is trimmed to {schema, code, reason} (S3)", () => {
  it("relays an upstream denial as the owner's status + code, never an empty table", async () => {
    upstream = () => json(403, { schema: "sector_generation.error/v1", code: "FORBIDDEN", reason: "not_entitled" });
    const response = await call("source=population");
    // The client classifier maps exactly this to `denied` — an empty 200 table
    // would hide the refusal from the reader.
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ schema: "sector_generation.error/v1", code: "FORBIDDEN", reason: "not_entitled" });
  });

  it("collapses a leaky upstream 502 body to the generic unavailable code", async () => {
    upstream = () => json(502, { error: "upstream http://10.0.0.5:8000 failed", trace: "File /opt/macro/app.py" });
    const response = await call("source=population");
    expect(response.status).toBe(502);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ schema: "sector_generation.error/v1", code: "UPSTREAM_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    expect(JSON.stringify(body)).not.toContain("app.py");
  });

  it("keeps a closed-set code but drops an over-long reason", async () => {
    upstream = () => json(409, { code: "CURSOR_RESET", reason: "x".repeat(161) });
    const response = await call("source=population");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ schema: "sector_generation.error/v1", code: "CURSOR_RESET" });
  });

  it("relays a documented 5xx refusal code and its bounded reason", async () => {
    upstream = () => json(503, { code: "SERVICE_UNAVAILABLE", reason: "identity_not_verified" }, { "retry-after": "3" });
    const response = await call("source=population");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      schema: "sector_generation.error/v1", code: "SERVICE_UNAVAILABLE", reason: "identity_not_verified" });
    expect(response.headers.get("retry-after")).toBe("3");
  });

  it("collapses an unknown upstream code and a non-JSON owner body", async () => {
    upstream = () => new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } });
    const response = await call("source=population");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ schema: "sector_generation.error/v1", code: "UPSTREAM_UNAVAILABLE" });
  });

  // r2 SF-1: the unknown-code collapse is pinned on a JSON body too — the
  // first review only proved it on non-JSON, so the mutation that admits any
  // code passed 417/417.
  it("collapses an UNKNOWN JSON code to UPSTREAM_UNAVAILABLE even with a token-shaped reason", async () => {
    upstream = () => json(500, { code: "INTERNAL_TRACEBACK", reason: "still_a_snake_token" });
    const response = await call("source=population");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ schema: "sector_generation.error/v1", code: "UPSTREAM_UNAVAILABLE" });
  });

  it("drops a reason carrying a URL or path — a closed-set code never launders free text", async () => {
    upstream = () => json(503, { code: "SERVICE_UNAVAILABLE",
      reason: "upstream http://10.0.0.5:8000 failed at /opt/macro/app.py line 88" });
    const response = await call("source=population");
    expect(response.status).toBe(503);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ schema: "sector_generation.error/v1", code: "SERVICE_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    expect(JSON.stringify(body)).not.toContain("app.py");
  });

  it("drops a credential-shaped reason instead of relaying it verbatim", async () => {
    upstream = () => json(403, { code: "FORBIDDEN", reason: "sb-abc-auth-token=eyJhbGciOiJIUzI1NiJ9.secret" });
    const response = await call("source=population");
    expect(response.status).toBe(403);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ schema: "sector_generation.error/v1", code: "FORBIDDEN" });
    expect(JSON.stringify(body)).not.toContain("eyJ");
  });

  it("still relays the wire's own snake_case reason tokens (binding_changed)", async () => {
    upstream = () => json(409, { code: "CURSOR_RESET", reason: "binding_changed" });
    const response = await call("source=population");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ schema: "sector_generation.error/v1", code: "CURSOR_RESET", reason: "binding_changed" });
  });

  it("refuses an oversize owner body as a gateway payload verdict", async () => {
    const huge = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(5 * 1024 * 1024))); controller.close(); },
    });
    upstream = () => new Response(huge, { status: 200, headers: { "content-type": "application/json" } });
    const response = await call("source=population");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "PAYLOAD_INVALID" });
  });

  it("passes a valid owner page through for the shared decoder", async () => {
    upstream = () => json(200, fixture);
    const response = await call("source=population");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixture);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
