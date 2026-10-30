import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  key: "smart-screens-route",
  user: { id: "e2e-user-smart-screens-route" } as { id: string } | null,
  faults: [] as string[],
  /** Runs once, just before the next UPDATE executes — a second writer landing in the gap. */
  beforeUpdate: null as null | (() => void),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/supabase/server", async () => {
  const { createFixtureDb } = await import("@/lib/watchlistsFixtureDb");
  return {
    createClient: vi.fn(async () => {
      const db = createFixtureDb(H.key, H.faults);
      return {
        auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
        ...db,
        from: (table: string) => {
          const query = db.from(table);
          const update = query.update.bind(query);
          query.update = (values) => {
            const hook = H.beforeUpdate;
            H.beforeUpdate = null;
            hook?.();
            return update(values);
          };
          return query;
        },
      };
    }),
  };
});

import { GET, PUT } from "@/app/api/smart-screens/route";
import { fixtureStore, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";
import { normalizeDefinition } from "@/lib/smartScreen/predicate";
import { MAX_SCREENS, screenKey } from "@/lib/smartScreen/record";
import { buildReview } from "@/lib/smartScreen/review";

const URL_ = "https://x.test/api/smart-screens";
const responses: Response[] = [];
const track = (response: Response) => { responses.push(response); return response; };

const get = async () => track(await GET(new Request(URL_)));
const put = async (body: unknown, raw?: string) => track(await PUT(new Request(URL_, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: raw ?? JSON.stringify(body),
})));

const id = (n: number) => n.toString(16).padStart(32, "0");
/** Deliberately NOT in canonical order — the server stores the canonical form. */
const DEF = {
  grammar: 1,
  scope: { markets: ["us", "hk"], asset: "Equities", unpriced: false },
  where: { all: [{ f: "dv", op: "gte", v: 5e6 }, { f: "chg", op: "gte", v: 3 }] },
};
const CANON = (() => {
  const result = normalizeDefinition(DEF);
  if (!result.ok) throw new Error("bad DEF");
  return result;
})();
const OTHER_DEF = { grammar: 1, scope: { markets: "all", asset: null, unpriced: false }, where: { all: [{ f: "chg", op: "lte", v: -3 }] } };

const create = (n: number, extra: Record<string, unknown> = {}) =>
  put({ action: "create", id: id(n), name: `Screen ${n}`, def: DEF, review: null, ...extra });

/** A stored row exactly as another (newer) Terminal would have written it. */
function seedRow(n: number, value: Record<string, unknown>, userId = fixtureUserId(H.key)) {
  fixtureStore(H.key).workspaceSettings.push({
    id: `seed-${n}`, scope: "user", user_id: userId, owner_id: userId, key: screenKey(id(n)), value,
    updated_at: "2026-10-01T00:00:00.000Z",
  });
}

beforeEach(() => {
  resetFixtureStores();
  H.key = "smart-screens-route";
  H.user = { id: fixtureUserId(H.key) };
  H.faults = [];
  H.beforeUpdate = null;
  responses.length = 0;
  delete process.env.TERMINAL_E2E_FIXTURE;
  vi.clearAllMocks();
});

describe("every answer is per-account and uncacheable", () => {
  it("sends Cache-Control: private, no-store on success, failure and auth errors", async () => {
    await get();
    await create(1);
    await put({ action: "update", id: id(1), expectedRev: 9, name: "x", def: DEF });
    await put({ action: "nope" });
    H.faults = ["saved_views_read"];
    await get();
    H.user = null;
    await get();
    await put({ action: "create" });
    expect(responses.map((response) => response.status)).toEqual([200, 201, 409, 400, 503, 401, 401]);
    for (const response of responses) expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("GET /api/smart-screens", () => {
  it("requires a signed-in account", async () => {
    H.user = null;
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("answers an empty account with an empty list — never 404", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ screens: [], readOnly: [], invalid: 0 });
  });

  it("answers an unreadable store with 503 — never an empty list", async () => {
    await create(1);
    H.faults = ["saved_views_read"];
    const response = await get();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: "smart_screens_unavailable" });
    expect(body).not.toHaveProperty("screens");
  });

  it("shows a newer Terminal's record read-only and counts a corrupt one, without dropping either", async () => {
    await create(1);
    seedRow(2, { schema: 2, id: id(2), rev: 4, name: "From the future", def: { grammar: 2, anything: true } });
    seedRow(3, { schema: 1, id: id(3), rev: 1, name: "Broken", def: DEF, hash: "not-the-hash", createdAt: "x", updatedAt: "y" });
    const body = await (await get()).json();
    expect(body.screens.map((screen: { id: string }) => screen.id)).toEqual([id(1)]);
    expect(body.readOnly).toEqual([{ id: id(2), rev: 4, name: "From the future", schema: 2 }]);
    expect(body.invalid).toBe(1);
    expect(fixtureStore(H.key).workspaceSettings).toHaveLength(3);
  });
});

describe("PUT create", () => {
  it("stores the canonical definition at rev 1 and lists it", async () => {
    const response = await create(1);
    expect(response.status).toBe(201);
    const { record, replay } = await response.json();
    expect(replay).toBe(false);
    expect(record).toMatchObject({ schema: 1, id: id(1), rev: 1, name: "Screen 1", def: CANON.def, hash: CANON.hash, review: null });
    const listed = await (await get()).json();
    expect(listed.screens).toEqual([record]);
  });

  it("acknowledges a retried create that already landed instead of duplicating it", async () => {
    const first = await (await create(1)).json();
    const again = await create(1);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ record: first.record, replay: true });
    expect((await (await get()).json()).screens).toHaveLength(1);
  });

  it("answers a reused id with different content as a conflict carrying the current record", async () => {
    const first = await (await create(1)).json();
    const clash = await create(1, { name: "Something else" });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({ error: "conflict", current: first.record, readOnly: null });
  });

  it("rejects malformed input with a reason, never storing a partial record", async () => {
    const cases: [unknown, number, Record<string, unknown>][] = [
      [{ action: "create", id: "short", name: "x", def: DEF }, 400, { error: "invalid_id" }],
      [{ action: "create", id: id(1), name: "   ", def: DEF }, 400, { error: "invalid_name" }],
      [{ action: "create", id: id(1), name: "x".repeat(41), def: DEF }, 400, { error: "invalid_name" }],
      [{ action: "create", id: id(1), name: "x", def: { ...DEF, where: { all: [{ f: "pe", op: "gte", v: 1 }] } } }, 400,
        { error: "invalid_definition", detail: "unknown_field", path: "where.all[0].f" }],
      [{ action: "create", id: id(1), name: "x", def: { ...DEF, grammar: 3 } }, 400, { error: "invalid_definition", detail: "grammar_newer" }],
      [{ action: "create", id: id(1), name: "x", def: DEF, review: { v: 1 } }, 400, { error: "invalid_review" }],
      [{ action: "create", id: id(1), name: "x", def: DEF, scope: "workspace" }, 400, { error: "invalid_scope" }],
      [{ action: "create", id: id(1), name: "x", def: DEF, team_id: "t1" }, 400, { error: "invalid_scope" }],
      [{ action: "create", id: id(1), name: "x", def: DEF, user_id: "someone-else" }, 400, { error: "invalid_scope" }],
      [{ action: "rename", id: id(1) }, 400, { error: "unsupported_action" }],
    ];
    for (const [body, status, error] of cases) {
      const response = await put(body);
      expect(response.status, JSON.stringify(body)).toBe(status);
      expect(await response.json()).toMatchObject(error);
    }
    expect((await put(null, "{not json")).status).toBe(400);
    expect((await put(null, "[1,2]")).status).toBe(400);
    expect((await put(null, JSON.stringify({ action: "create", pad: "x".repeat(70 * 1024) }))).status).toBe(413);
    expect(fixtureStore(H.key).workspaceSettings).toHaveLength(0);
  });

  it(`caps an account at ${MAX_SCREENS} screens, counting records it cannot read`, async () => {
    seedRow(99, { schema: 2, id: id(99), rev: 1, name: "Newer" });
    for (let n = 1; n < MAX_SCREENS; n++) expect((await create(n)).status).toBe(201);
    const over = await create(MAX_SCREENS);
    expect(over.status).toBe(409);
    expect(await over.json()).toEqual({ error: "limit_reached" });
  });

  it("refuses a record over the size bound", async () => {
    const syms = Array.from({ length: 600 }, (_, i) => `SYMBOL${String(i).padStart(4, "0")}${"X".repeat(18)}`);
    const review = { v: 1, hash: CANON.hash, u: "terminal.manifest", asOf: "2026-10-10", at: "2026-10-10T00:00:00.000Z", pop: 600, m: syms.join(","), d: "0".repeat(1024) };
    const response = await create(1, { review });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "record_too_large" });
  });

  it("stores a review only when it names the definition it was evaluated under", async () => {
    const rows = [{ sym: "AAA", sec: "Equities", mktId: "us" as const, last: 10, chg: 5, dv: 6e6, mcap: 1e9, offHi: -1, offLo: 9, verdict: "BUY", gics: "Energy", regimeBull: true }];
    const built = buildReview(CANON.def, CANON.hash, rows, { asOf: "2026-10-10", at: "2026-10-10T01:00:00.000Z" });
    if (!built.ok) throw new Error(built.error);
    expect((await create(1, { review: built.review })).status).toBe(201);
    const other = normalizeDefinition(OTHER_DEF);
    if (!other.ok) throw new Error("bad OTHER_DEF");
    const mismatched = await create(2, { def: OTHER_DEF, review: built.review });
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toEqual({ error: "invalid_review", detail: "hash_mismatch" });
  });

  it("stores a screen with E02 fundamental conditions (grammar 2) and returns it whole, but never a review for it", async () => {
    const FUND_DEF = { ...DEF, grammar: 2, fund: [{ op: "range", gte: 0.15, field: "fund.net_margin_fy" }] };
    const fund = normalizeDefinition(FUND_DEF);
    if (!fund.ok) throw new Error("bad FUND_DEF");
    const created = await create(1, { def: FUND_DEF });
    expect(created.status).toBe(201);
    const listed = (await (await get()).json()).screens;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ hash: fund.hash, def: { grammar: 2, fund: [{ field: "fund.net_margin_fy", op: "range", gte: 0.15 }] } });
    expect(fund.hash).not.toBe(CANON.hash);

    const rows = [{ sym: "AAA", sec: "Equities", mktId: "us" as const, last: 10, chg: 5, dv: 6e6, mcap: 1e9, offHi: -1, offLo: 9, verdict: "BUY", gics: "Energy", regimeBull: true }];
    const built = buildReview(CANON.def, CANON.hash, rows, { asOf: "2026-10-10", at: "2026-10-10T01:00:00.000Z" });
    if (!built.ok) throw new Error(built.error);
    const reviewed = await create(2, { def: FUND_DEF, review: { ...built.review, hash: fund.hash } });
    expect(reviewed.status).toBe(400);
    expect(await reviewed.json()).toEqual({ error: "invalid_review", detail: "fundamental_conditions" });

    const empty = await create(3, { def: { ...DEF, grammar: 2, fund: [] } });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: "invalid_definition", detail: "bad_value", path: "fund" });
    const stray = await create(4, { def: { ...DEF, fund: FUND_DEF.fund } });
    expect(stray.status).toBe(400);
    expect(await stray.json()).toMatchObject({ error: "invalid_definition", detail: "unknown_key" });
  });
});

// ── AC-E04-03: two devices, one account — a stale write is a conflict, never an overwrite ──

describe("PUT update — version conflicts between devices", () => {
  it("lets the second device see the first device's write and decide", async () => {
    await create(1);
    // Device A and device B both last saw rev 1.
    const a = await put({ action: "update", id: id(1), expectedRev: 1, name: "Renamed on A", def: DEF, review: null });
    expect(a.status).toBe(200);
    const fromA = (await a.json()).record;
    expect(fromA).toMatchObject({ rev: 2, name: "Renamed on A" });

    const b = await put({ action: "update", id: id(1), expectedRev: 1, name: "Edited on B", def: OTHER_DEF, review: null });
    expect(b.status).toBe(409);
    expect(await b.json()).toEqual({ error: "conflict", current: fromA, readOnly: null });
    // Nothing of B's landed.
    expect((await (await get()).json()).screens[0]).toEqual(fromA);

    // B chooses to overwrite, now naming the rev it has seen.
    const overwrite = await put({ action: "update", id: id(1), expectedRev: 2, name: "Edited on B", def: OTHER_DEF, review: null });
    expect(overwrite.status).toBe(200);
    expect((await overwrite.json()).record).toMatchObject({ rev: 3, name: "Edited on B", createdAt: fromA.createdAt });
  });

  it("detects a second writer that lands between the rev check and the write", async () => {
    await create(1);
    H.beforeUpdate = () => {
      const row = fixtureStore(H.key).workspaceSettings[0];
      row.value = { ...(row.value as Record<string, unknown>), rev: 2, name: "Won the race" };
      row.updated_at = "2099-01-01T00:00:00.000Z";
    };
    const loser = await put({ action: "update", id: id(1), expectedRev: 1, name: "Lost the race", def: DEF, review: null });
    expect(loser.status).toBe(409);
    expect(await loser.json()).toMatchObject({ error: "conflict", current: { rev: 2, name: "Won the race" } });
    expect((fixtureStore(H.key).workspaceSettings[0].value as { name: string }).name).toBe("Won the race");
  });

  it("acknowledges a retried update that already landed", async () => {
    await create(1);
    const first = await (await put({ action: "update", id: id(1), expectedRev: 1, name: "Two", def: DEF })).json();
    // The retry still names rev 1 → the current rev is 2 → a conflict whose current IS the
    // intent; the client recognises that (see smartScreenClient.test.ts). Naming rev 2 with the
    // same content is a replay.
    const replay = await put({ action: "update", id: id(1), expectedRev: 2, name: "Two", def: DEF });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ record: first.record, replay: true });
  });

  it("answers an unknown screen with 404 and a bad rev with 400", async () => {
    expect((await put({ action: "update", id: id(5), expectedRev: 1, name: "x", def: DEF })).status).toBe(404);
    await create(1);
    expect(await (await put({ action: "update", id: id(1), expectedRev: 0, name: "x", def: DEF })).json()).toEqual({ error: "invalid_rev" });
  });

  it("never rewrites a newer Terminal's record (downgrade protection)", async () => {
    const future = { schema: 2, id: id(7), rev: 3, name: "Future", def: { grammar: 2 }, extra: { keep: true } };
    seedRow(7, future);
    const response = await put({ action: "update", id: id(7), expectedRev: 3, name: "Older client", def: DEF });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "newer_schema", readOnly: { id: id(7), rev: 3, name: "Future", schema: 2 } });
    expect(fixtureStore(H.key).workspaceSettings[0].value).toEqual(future);
    // It can still be deleted, under the same rev check.
    expect((await put({ action: "delete", id: id(7), expectedRev: 2 })).status).toBe(409);
    expect(await (await put({ action: "delete", id: id(7), expectedRev: 3 })).json()).toEqual({ deleted: id(7), alreadyGone: false });
  });
});

describe("PUT delete", () => {
  it("deletes under the rev check and acknowledges an already-gone screen", async () => {
    await create(1);
    await put({ action: "update", id: id(1), expectedRev: 1, name: "Two", def: DEF });
    const stale = await put({ action: "delete", id: id(1), expectedRev: 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).current).toMatchObject({ rev: 2 });
    expect(await (await put({ action: "delete", id: id(1), expectedRev: 2 })).json()).toEqual({ deleted: id(1), alreadyGone: false });
    expect(await (await put({ action: "delete", id: id(1), expectedRev: 2 })).json()).toEqual({ deleted: id(1), alreadyGone: true });
    expect((await (await get()).json()).screens).toEqual([]);
  });

  it("answers a write while the store is unavailable with 503, not success", async () => {
    await create(1);
    H.faults = ["saved_views_read"];
    expect((await put({ action: "delete", id: id(1), expectedRev: 1 })).status).toBe(503);
    expect((await create(2)).status).toBe(503);
    H.faults = [];
    expect((await (await get()).json()).screens).toHaveLength(1);
  });
});

// ── AC-E04-03: account isolation ────────────────────────────────────────────────────────

describe("account isolation", () => {
  it("never shows, rewrites or removes another account's screen", async () => {
    await create(1);
    const owner = H.user;
    H.user = { id: "e2e-user-somebody-else" };
    expect(await (await get()).json()).toEqual({ screens: [], readOnly: [], invalid: 0 });
    expect((await put({ action: "update", id: id(1), expectedRev: 1, name: "Hijack", def: DEF })).status).toBe(404);
    // From this account the screen does not exist, so "delete" is already satisfied — and the
    // owner's row is untouched.
    expect(await (await put({ action: "delete", id: id(1), expectedRev: 1 })).json()).toEqual({ deleted: id(1), alreadyGone: true });
    // The same id is a separate row for a separate owner.
    expect((await create(1, { name: "Mine" })).status).toBe(201);
    H.user = owner;
    const mine = await (await get()).json();
    expect(mine.screens).toHaveLength(1);
    expect(mine.screens[0]).toMatchObject({ name: "Screen 1", rev: 1 });
    expect(fixtureStore(H.key).workspaceSettings.map((row) => row.user_id).sort())
      .toEqual(["e2e-user-somebody-else", fixtureUserId(H.key)].sort());
  });
});
