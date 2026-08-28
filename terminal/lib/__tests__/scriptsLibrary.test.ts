import { beforeEach, describe, expect, it, vi } from "vitest";

// C6/C7 — the personal script library.
//
// C6 is a CONTRACT bug, not (yet) a live leak. `saved_scripts` carries two policies: owner-full-
// access AND "any caller may SELECT a row with is_public = true". The reads that describe
// themselves as "the signed-in user's scripts" did not filter by owner, so they returned "rows this
// user is allowed to see". The fixture below models exactly that policy, which is the only way to
// prove the fix: with an unfiltered query the foreign public row IS returned.
//
// C7: `listScripts` answered `[]` for a non-OK response and for a thrown fetch, so a storage outage
// was indistinguishable from an empty library.

type Row = { id: string; user_id: string; name: string; is_public: boolean; source: string; lang: string; params: Record<string, unknown>; updated_at: string };

const ROWS: Row[] = [
  { id: "a-private", user_id: "user-A", name: "A's MACD", is_public: false, source: "", lang: "pine", params: {}, updated_at: "2026-08-01" },
  { id: "a-public", user_id: "user-A", name: "A's SHARED Oracle", is_public: true, source: "", lang: "pine", params: {}, updated_at: "2026-08-02" },
  { id: "b-private", user_id: "user-B", name: "B's own script", is_public: false, source: "", lang: "pine", params: {}, updated_at: "2026-08-03" },
];

const H = vi.hoisted(() => ({ user: null as { id: string } | null, fail: false, filters: [] as [string, unknown][] }));

/** Applies the REAL RLS predicate for `saved_scripts`: owner OR is_public. */
const visibleTo = (userId: string) => ROWS.filter((r) => r.user_id === userId || r.is_public);

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
    from: vi.fn(() => {
      const q = {
        select: () => q,
        eq: (column: string, value: unknown) => { H.filters.push([column, value]); return q; },
        order: () => {
          if (H.fail) return Promise.resolve({ data: null, error: { message: "connection reset" } });
          let rows = visibleTo(H.user?.id ?? "");
          for (const [column, value] of H.filters) rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[column] === value);
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return q;
    }),
  })),
}));

import { GET } from "@/app/api/scripts/list/route";

beforeEach(() => { H.user = { id: "user-B" }; H.fail = false; H.filters = []; vi.clearAllMocks(); });

describe("C6 — My Scripts is the OWNER's library, not everything RLS allows", () => {
  it("returns only B's rows, never A's public one", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const { scripts } = await r.json();
    expect(scripts.map((s: Row) => s.id)).toEqual(["b-private"]);
  });

  it("asks the database for the owner explicitly", async () => {
    await GET();
    expect(H.filters).toContainEqual(["user_id", "user-B"]);
  });

  it("without the owner filter the foreign public row IS visible — the bug was real", () => {
    // The same fixture, queried the way the route used to: RLS alone hands B a row owned by A.
    expect(visibleTo("user-B").map((r) => r.id)).toEqual(["a-public", "b-private"]);
  });

  it("the owner of a public script still sees it in their own library", async () => {
    H.user = { id: "user-A" };
    const { scripts } = await (await GET()).json();
    expect(scripts.map((s: Row) => s.id).sort()).toEqual(["a-private", "a-public"]);
  });
});

describe("C7 — a storage failure is not an empty library", () => {
  it("answers 503 with a reason instead of 200 []", async () => {
    H.fail = true;
    const r = await GET();
    expect(r.status).toBe(503);
    await expect(r.json()).resolves.toEqual({ error: "scripts_unavailable" });
  });

  it("a guest is told to sign in rather than handed an empty library", async () => {
    H.user = null;
    const r = await GET();
    expect(r.status).toBe(401);
    await expect(r.json()).resolves.toEqual({ error: "unauthenticated" });
  });
});
