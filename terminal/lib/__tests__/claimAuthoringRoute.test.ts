import { beforeEach, describe, expect, it, vi } from "vitest";
import { addUtcDays, CLAIM_NOT_RECORDED_MESSAGE, CLAIM_OWNERS, composeClaimText, toResolvesAtIso } from "@/lib/claimAuthoring";

const H = vi.hoisted(() => ({
  user: { id: "user-A" } as { id: string } | null,
  inserted: null as Record<string, unknown> | null,
  insertError: null as { message: string } | null,
  throwInsert: false,
  createdAt: "2026-09-09T12:00:00.111Z" as string | undefined,
  omitCreatedAt: false,
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
    from: vi.fn((table: string) => {
      const q: Record<string, unknown> = {};
      q.insert = vi.fn((row: Record<string, unknown>) => {
        H.inserted = { table, ...row };
        return q;
      });
      q.select = vi.fn(() => q);
      q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (H.throwInsert) return Promise.reject(new Error("socket hang up")).then(resolve, reject);
        if (H.insertError) return Promise.resolve({ data: null, error: H.insertError }).then(resolve, reject);
        if (!H.inserted || H.inserted.table !== "user_claims") {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
        const row: Record<string, unknown> = {
          claim_id: H.inserted.claim_id,
          subject: H.inserted.subject,
          condition: H.inserted.condition,
          resolves_at: H.inserted.resolves_at,
          claim_text: H.inserted.claim_text,
          stated_probability: H.inserted.stated_probability ?? null,
          status: H.inserted.status,
        };
        if (!H.omitCreatedAt) row.created_at = H.createdAt;
        return Promise.resolve({ data: [row], error: null }).then(resolve, reject);
      };
      return q;
    }),
  })),
}));

import * as route from "@/app/api/accuracy/claims/route";

const OWNER = CLAIM_OWNERS[0].owner;
const TOMORROW = addUtcDays(new Date(), 1);
const TOMORROW_ISO = toResolvesAtIso(TOMORROW);

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: { kind: "security", id: "NVDA" },
    condition: { metric: "close", comparator: ">=", threshold: 150, owner: OWNER },
    resolves_at: TOMORROW_ISO,
    claim_text: composeClaimText({
      symbol: "NVDA",
      comparator: ">=",
      threshold: 150,
      date: TOMORROW,
      lang: "en",
    }),
    evidence: [],
    ...overrides,
  };
}

function post(body: unknown, init: RequestInit = {}): Promise<Response> {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return route.POST(new Request("https://x.test/api/accuracy/claims", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    body: payload,
    ...init,
  }));
}

beforeEach(() => {
  H.user = { id: "user-A" };
  H.inserted = null;
  H.insertError = null;
  H.throwInsert = false;
  H.omitCreatedAt = false;
  H.createdAt = "2026-09-09T12:00:00.111Z";
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.clearAllMocks();
});

describe("POST /api/accuracy/claims", () => {
  it("returns 401 for an anonymous request", async () => {
    H.user = null;
    const res = await post(validBody());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 201 and the inserted row for a valid claim", async () => {
    const res = await post(validBody());
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; claim: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.claim.claim_id).toMatch(/^[0-9a-f]{16}$/);
    expect(body.claim.status).toBe("open");
    expect(body.claim.claim_text).toBe(`NVDA closing price at or above 150 on ${TOMORROW}.`);
    expect(H.inserted?.user_id).toBe("user-A");
    expect(H.inserted?.status).toBe("open");
    expect(H.inserted?.resolution).toBeNull();
  });

  it("ignores any status or resolution field present in the request body and inserts open/null anyway", async () => {
    const res = await post(validBody({
      status: "resolved",
      resolution: { outcome: 1 },
      claim_id: "ffffffffffff0001",
      user_id: "someone-else",
      stated_at: "1999-01-01T00:00:00.000Z",
    }));
    expect(res.status).toBe(201);
    expect(H.inserted?.status).toBe("open");
    expect(H.inserted?.resolution).toBeNull();
    expect(H.inserted?.user_id).toBe("user-A");
    expect(H.inserted?.claim_id).not.toBe("ffffffffffff0001");
    expect(H.inserted?.stated_at).not.toBe("1999-01-01T00:00:00.000Z");
    const body = await res.json() as { claim: { status: string } };
    expect(body.claim.status).toBe("open");
  });

  it("returns 503 with the honest not-recorded message when the store write fails, no partial body", async () => {
    H.insertError = { message: "connection reset" };
    const res = await post(validBody());
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({
      ok: false,
      error: "claim_not_recorded",
      message: [...CLAIM_NOT_RECORDED_MESSAGE],
    });
    expect(body).not.toHaveProperty("claim");
    expect(body).not.toHaveProperty("claim_id");
  });

  it("response carries exactly the eight named keys, no user_id, no supersedes", async () => {
    const res = await post(validBody());
    const body = await res.json() as { claim: Record<string, unknown> };
    expect(Object.keys(body.claim).sort()).toEqual([
      "claim_id",
      "claim_text",
      "condition",
      "created_at",
      "resolves_at",
      "stated_probability",
      "status",
      "subject",
    ].sort());
    expect(body.claim).not.toHaveProperty("user_id");
    expect(body.claim).not.toHaveProperty("supersedes");
    expect(body.claim).not.toHaveProperty("resolution");
  });

  it("rejects a request body over 64KB", async () => {
    const res = await post({
      ...validBody(),
      padding: "x".repeat(70_000),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "request_too_large" });
  });

  it("rejects GET, PATCH and DELETE", () => {
    expect(route).not.toHaveProperty("GET");
    expect(route).not.toHaveProperty("PATCH");
    expect(route).not.toHaveProperty("DELETE");
  });

  it("rejects an empty claim_text with claim_text_empty", async () => {
    const res = await post(validBody({ claim_text: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "claim_text_empty" });
  });

  it("maps an over-ceiling threshold onto threshold_too_high", async () => {
    const res = await post(validBody({
      condition: { metric: "close", comparator: ">=", threshold: 1_000_001, owner: OWNER },
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "threshold_too_high" });
  });

  it("response carries all eight keys with explicit null for a missing column", async () => {
    H.omitCreatedAt = true;
    const res = await post(validBody());
    expect(res.status).toBe(201);
    const body = await res.json() as { claim: Record<string, unknown> };
    expect(Object.keys(body.claim).sort()).toEqual([
      "claim_id",
      "claim_text",
      "condition",
      "created_at",
      "resolves_at",
      "stated_probability",
      "status",
      "subject",
    ].sort());
    expect(body.claim.created_at).toBeNull();
  });
});
