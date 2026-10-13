import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E05 — `/api/watchlist/annotations`, both session paths: the e2e fixture (cookie-keyed actors over
// one row set) and the Supabase path (getUser + the RLS'd client, here a fixture transport).

const H = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  user: null as { id: string } | null,
  fromCalls: 0,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (name in H.cookies ? { name, value: H.cookies[name] } : undefined) })),
}));

vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureAnnotationDb } = await import("@/lib/watchlistAnnotationsFixtureDb");
  return {
    createClient: vi.fn(async () => {
      const db = createFixtureAnnotationDb("supabase-path");
      return {
        auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
        from: (table: string) => {
          H.fromCalls++;
          return db.from(table);
        },
      };
    }),
  };
});

import { GET, POST } from "@/app/api/watchlist/annotations/route";
import { ANNOTATION_OWNER_HEADER } from "@/lib/watchlistAnnotations";
import {
  fixtureAnnotationRows,
  resetFixtureAnnotationStores,
  FAULT_ANNOTATIONS_READ,
  FAULT_ANNOTATIONS_UNAVAILABLE,
  FAULT_ANNOTATIONS_WRITE,
} from "@/lib/watchlistAnnotationsFixtureDb";

const URL_ = "https://app.test/api/watchlist/annotations";
let ip = 0;

function request(method: "GET" | "POST", owner: string | null, body?: unknown, extraHeaders: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.${Math.floor(ip / 250)}.${ip++ % 250}`, ...extraHeaders };
  if (owner !== null) headers[ANNOTATION_OWNER_HEADER] = owner;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(URL_, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}

const as = (key: string, faults?: string) => {
  H.cookies = { mm_e2e_wl: key, ...(faults ? { mm_e2e_fault: faults } : {}) };
  return `e2e-user-${key}`;
};

const write = (symbol: string, field: "note" | "flag", value: string | null, baseRevision: number) => ({ symbol, field, value, baseRevision });

describe("fixture session", () => {
  beforeEach(() => {
    process.env.TERMINAL_E2E_FIXTURE = "1";
    resetFixtureAnnotationStores();
    H.cookies = {};
  });
  afterEach(() => {
    delete process.env.TERMINAL_E2E_FIXTURE;
  });

  it("writes then reads back the caller's note and flag with no-store", async () => {
    const owner = as("db::alice");
    const posted = await POST(request("POST", owner, { writes: [write("0700.hk", "note", "腾讯：等财报", 0), write("0700.HK", "flag", "#F8B500", 0)] }));
    expect(posted.status).toBe(200);
    expect(posted.headers.get("cache-control")).toBe("no-store");
    expect((await posted.json()).results.map((result: { status: string }) => result.status)).toEqual(["ok", "ok"]);

    const read = await GET(request("GET", owner));
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(await read.json()).toEqual({
      schemaVersion: 1,
      complete: true,
      annotations: [expect.objectContaining({ symbol: "0700.HK", note: "腾讯：等财报", noteRevision: 1, flag: "#f8b500", flagRevision: 1 })],
    });
  });

  it("serves each actor only its own rows (AC-E05-01)", async () => {
    await POST(request("POST", as("db::alice"), { writes: [write("AAPL", "note", "alice only", 0)] }));
    const bob = as("db::bob");
    const read = await GET(request("GET", bob));
    expect((await read.json()).annotations).toEqual([]);
    const posted = await POST(request("POST", bob, { writes: [write("AAPL", "note", "bob's", 1)] }));
    expect((await posted.json()).results[0]).toMatchObject({ status: "conflict", value: null });
    expect(fixtureAnnotationRows("db").map((row) => [row.user_id, row.note])).toEqual([["e2e-user-db::alice", "alice only"]]);
  });

  it("refuses a request whose owner header is not the session's account (409), reading and writing nothing", async () => {
    await POST(request("POST", as("db::alice"), { writes: [write("AAPL", "note", "alice only", 0)] }));
    // A tab rendered for alice, now carrying bob's cookie.
    as("db::bob");
    const read = await GET(request("GET", "e2e-user-db::alice"));
    expect(read.status).toBe(409);
    expect(await read.json()).toEqual({ error: "owner_mismatch" });
    const posted = await POST(request("POST", "e2e-user-db::alice", { writes: [write("AAPL", "note", "alice's text into bob", 0)] }));
    expect(posted.status).toBe(409);
    expect(await GET(request("GET", null))).toHaveProperty("status", 409);
    expect(fixtureAnnotationRows("db")).toHaveLength(1);
  });

  it("is 401 for the fixture guest shell", async () => {
    H.cookies = { mm_e2e_wl: "db::alice", mm_e2e_guest: "1" };
    expect((await GET(request("GET", "e2e-user-db::alice"))).status).toBe(401);
    expect((await POST(request("POST", "e2e-user-db::alice", { writes: [write("AAPL", "note", "x", 0)] }))).status).toBe(401);
  });

  it("is 503 when the table is missing and 500 when the read fails — never an empty 200", async () => {
    let owner = as("db::alice", FAULT_ANNOTATIONS_UNAVAILABLE);
    expect(await (await GET(request("GET", owner))).json()).toEqual({ error: "annotations_unavailable" });
    expect((await GET(request("GET", owner))).status).toBe(503);
    expect((await POST(request("POST", owner, { writes: [write("AAPL", "note", "x", 0)] }))).status).toBe(503);

    owner = as("db::alice", FAULT_ANNOTATIONS_READ);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await GET(request("GET", owner));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "annotations_read_failed" });
    errors.mockRestore();
  });

  it("answers a fully failed write batch with 500 and per-write errors", async () => {
    const owner = as("db::alice", FAULT_ANNOTATIONS_WRITE);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const posted = await POST(request("POST", owner, { writes: [write("AAPL", "note", "x", 0)] }));
    errors.mockRestore();
    expect(posted.status).toBe(500);
    expect(await posted.json()).toMatchObject({ error: "annotations_write_failed", results: [{ status: "error" }] });
  });

  it("validates the body: 400 for malformed JSON/batches, 413 for an oversized request, per-item invalid", async () => {
    const owner = as("db::alice");
    expect((await POST(request("POST", owner, "{not json"))).status).toBe(400);
    expect((await POST(request("POST", owner, { writes: [] }))).status).toBe(400);
    expect((await POST(request("POST", owner, { writes: [write("A", "note", "x", 0), write("a", "note", "y", 0)] }))).status).toBe(400);
    expect((await POST(request("POST", owner, { writes: [write("A", "note", "x".repeat(300 * 1024), 0)] }))).status).toBe(413);
    const mixed = await POST(request("POST", owner, { writes: [write("A", "flag", "magenta", 0), write("B", "note", "fine", 0)] }));
    expect(mixed.status).toBe(200);
    expect((await mixed.json()).results.map((result: { symbol: string; status: string }) => `${result.symbol}:${result.status}`)).toEqual(["A:invalid", "B:ok"]);
  });
});

describe("supabase session", () => {
  beforeEach(() => {
    delete process.env.TERMINAL_E2E_FIXTURE;
    resetFixtureAnnotationStores();
    H.user = null;
    H.fromCalls = 0;
  });

  it("is 401 without a user and never touches the table", async () => {
    expect((await GET(request("GET", "anyone"))).status).toBe(401);
    expect((await POST(request("POST", "anyone", { writes: [write("AAPL", "note", "x", 0)] }))).status).toBe(401);
    expect(H.fromCalls).toBe(0);
  });

  it("uses the session's user id for ownership and checks the owner header against it", async () => {
    H.user = { id: "8f2c0d4e-uuid-alice" };
    expect((await GET(request("GET", "8f2c0d4e-uuid-bob"))).status).toBe(409);
    expect(H.fromCalls).toBe(0);
    const posted = await POST(request("POST", "8f2c0d4e-uuid-alice", { writes: [write("AAPL", "flag", "#2962ff", 0)] }));
    expect(posted.status).toBe(200);
    expect(fixtureAnnotationRows("supabase-path")).toEqual([expect.objectContaining({ user_id: "8f2c0d4e-uuid-alice", symbol: "AAPL", flag: "#2962ff" })]);
  });
});
