import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserClaim } from "@/lib/personalAccuracy";

const H = vi.hoisted(() => ({
  user: { id: "user-A" } as { id: string } | null,
  rows: [] as UserClaim[],
  error: null as { message: string } | null,
  eqCalls: [] as Array<[string, unknown]>,
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
    from: vi.fn((table: string) => {
      const q: Record<string, unknown> = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn((col: string, val: unknown) => {
        H.eqCalls.push([col, val]);
        return q;
      });
      q.order = vi.fn(() => q);
      q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (table !== "user_claims") {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
        if (H.error) return Promise.resolve({ data: null, error: H.error }).then(resolve, reject);
        const filtered = H.rows.filter((row) =>
          H.eqCalls.every(([col, val]) => col !== "user_id" || row.user_id === val),
        );
        return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
      };
      return q;
    }),
  })),
}));

import * as route from "@/app/api/accuracy/route";

const BANNED_KEYS = ["rank", "percentile", "leaderboard", "team", "peer", "cohort", "composite"];
const ALLOWED_KEYS = [
  "episodeCount",
  "resolvedEpisodes",
  "resolvedHits",
  "hitRate",
  "brierPairs",
  "brierMean",
  "claimCount",
  "unscorableCount",
  "stance",
  "openEpisodes",
  "claims",
];

const own: UserClaim = {
  claim_id: "aaaaaaaaaaaaaaaa",
  user_id: "user-A",
  subject: { kind: "security", id: "SPX" },
  stated_at: "2026-01-01T00:00:00.000Z",
  resolves_at: "2026-02-01T00:00:00.000Z",
  claim_text: "SPX at or above 6000",
  condition: { metric: "last_close", comparator: ">=", threshold: 6000, owner: "quotes.last_close" },
  stated_probability: 0.7,
  evidence: [],
  status: "open",
  resolution: null,
  supersedes: null,
};
const other: UserClaim = { ...own, claim_id: "bbbbbbbbbbbbbbbb", user_id: "user-B", claim_text: "other user's call" };

beforeEach(() => {
  H.user = { id: "user-A" };
  H.rows = [own, other];
  H.error = null;
  H.eqCalls = [];
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.clearAllMocks();
});

describe("GET /api/accuracy", () => {
  it("returns 401 for an anonymous request", async () => {
    H.user = null;
    const res = await route.GET(new Request("https://x.test/api/accuracy"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns only the caller's own claims", async () => {
    const res = await route.GET(new Request("https://x.test/api/accuracy"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(H.eqCalls).toContainEqual(["user_id", "user-A"]);
    expect(body.claimCount).toBe(1);
    const texts = (body.claims as Array<{ claimText: string }>).map((row) => row.claimText);
    expect(texts).toEqual(["SPX at or above 6000"]);
    expect(texts.join(" ")).not.toContain("other user's call");
  });

  it("returns 503 with no partial payload when the store is unavailable", async () => {
    H.error = { message: "connection reset" };
    const res = await route.GET(new Request("https://x.test/api/accuracy"));
    expect(res.status).toBe(503);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toEqual({ error: "accuracy_store_unavailable" });
    expect(body).not.toHaveProperty("claims");
    expect(body).not.toHaveProperty("episodeCount");
  });

  it("response carries no rank, percentile, leaderboard, team or cohort field", async () => {
    const res = await route.GET(new Request("https://x.test/api/accuracy"));
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...ALLOWED_KEYS].sort());
    for (const key of BANNED_KEYS) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("response exposes no other user's id", async () => {
    const res = await route.GET(new Request("https://x.test/api/accuracy"));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("user-B");
    expect(raw).not.toMatch(/user_id|userId/);
  });

  it("rejects POST, PATCH and DELETE", () => {
    expect(route).not.toHaveProperty("POST");
    expect(route).not.toHaveProperty("PATCH");
    expect(route).not.toHaveProperty("DELETE");
  });

  it("GET accepts a Request the way theses/route.ts does", () => {
    expect(route.GET.length).toBe(1);
  });
});
