import { describe, expect, it } from "vitest";
import {
  deleteLayout, listLayouts, nextLayoutName, normalizeLayoutName, saveLayout,
  type LayoutDb, type LayoutDbResult, type LayoutQuery, type LayoutRow,
} from "@/lib/layouts";
import { createLayoutFixtureDb, fixtureLayoutUserId } from "@/lib/layoutsFixtureDb";

const USER = "user-1";

type Call = { op: string; args: unknown[] };

/** Scripted transport: hands back queued results in order and records what was asked of it, so a
 *  test can assert BOTH the answer the service returned and the statement it actually issued. */
function scriptedDb(results: LayoutDbResult[]): LayoutDb & { calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const next = (): LayoutDbResult => results[index++] ?? { data: [] };
  const build = (): LayoutQuery => {
    const q = {
      select: (...args: unknown[]) => { calls.push({ op: "select", args }); return q; },
      eq: (...args: unknown[]) => { calls.push({ op: "eq", args }); return q; },
      order: (...args: unknown[]) => { calls.push({ op: "order", args }); return q; },
      insert: (...args: unknown[]) => { calls.push({ op: "insert", args }); return q; },
      update: (...args: unknown[]) => { calls.push({ op: "update", args }); return q; },
      upsert: (...args: unknown[]) => { calls.push({ op: "upsert", args }); return q; },
      delete: (...args: unknown[]) => { calls.push({ op: "delete", args }); return q; },
      maybeSingle: async () => { const r = next(); return r.error ? r : { data: (r.data as LayoutRow[] | undefined)?.[0] ?? null }; },
      then: (resolve: (v: LayoutDbResult) => unknown) => Promise.resolve(next()).then(resolve),
    } as unknown as LayoutQuery;
    return q;
  };
  return { from: () => build(), calls };
}

const OUTAGE: LayoutDbResult = { error: { code: "XX000", message: "connection reset" } };
const NO_CONFLICT_TARGET: LayoutDbResult = { error: { code: "42P10", message: "no unique or exclusion constraint matching the ON CONFLICT specification" } };
const UNIQUE_VIOLATION: LayoutDbResult = { error: { code: "23505", message: "duplicate key value" } };

describe("nextLayoutName — C3: a counter is not a name", () => {
  it("skips names that are taken", () => {
    expect(nextLayoutName([])).toBe("Layout 1");
    expect(nextLayoutName(["Layout 1"])).toBe("Layout 2");
    expect(nextLayoutName(["Layout 1", "Layout 2", "Layout 3"])).toBe("Layout 4");
  });

  it("reuses the gap a deletion left instead of colliding with a survivor", () => {
    // The exact reported sequence: save 1/2/3, delete "Layout 2", then blank-save. The old
    // generator computed `layouts.length + 1` = 3 and the server's upsert-by-name OVERWROTE the
    // surviving "Layout 3".
    const surviving = ["Layout 1", "Layout 3"];
    expect(nextLayoutName(surviving)).toBe("Layout 2");
    expect(nextLayoutName(surviving)).not.toBe("Layout 3");
    // Mutation check against the implementation this replaces — it must NOT agree here.
    const oldImplementation = `Layout ${surviving.length + 1}`;
    expect(oldImplementation).toBe("Layout 3");
    expect(nextLayoutName(surviving)).not.toBe(oldImplementation);
  });

  it("ignores unrelated and malformed names", () => {
    expect(nextLayoutName(["Scalping", null, 7, "Layout 1"])).toBe("Layout 2");
  });
});

describe("normalizeLayoutName", () => {
  it("trims, caps length, and rejects blank input", () => {
    expect(normalizeLayoutName("  Swing  ")).toBe("Swing");
    expect(normalizeLayoutName("   ")).toBeNull();
    expect(normalizeLayoutName(42)).toBeNull();
    expect(normalizeLayoutName("x".repeat(200))).toHaveLength(60);
  });

  it("collapses internal whitespace runs to a single space (reviewer ruling M8)", () => {
    expect(normalizeLayoutName("My   Workspace")).toBe("My Workspace");
    expect(normalizeLayoutName("  My   Workspace  ")).toBe("My Workspace");
    expect(normalizeLayoutName("a\t\tb\n\nc")).toBe("a b c");
  });

  it("a 75-char name normalizes to 60 and round-trips export->import cleanly", () => {
    const raw = "x".repeat(75);
    const normalized = normalizeLayoutName(raw);
    expect(normalized).toHaveLength(60);
    // "export" = the wire-mode projection a workspace envelope's name would carry; "import" = the
    // SAME normalization applied again. A name already normalized is a fixed point — re-normalizing
    // an already-normalized name must reproduce it byte-for-byte, never drift further.
    expect(normalizeLayoutName(normalized)).toBe(normalized);
  });
});

describe("listLayouts — C2: unavailable is not empty", () => {
  it("reports a query failure as unavailable", async () => {
    const result = await listLayouts(scriptedDb([OUTAGE]), USER);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns rows on success and stays owner-scoped", async () => {
    const db = scriptedDb([{ data: [{ id: "a", name: "Swing", config: { schemaVersion: 2 }, updated_at: "2026-08-19T00:00:00Z" }] }]);
    const result = await listLayouts(db, USER);
    expect(result).toEqual({ ok: true, layouts: [{ id: "a", name: "Swing", config: { schemaVersion: 2 }, updated_at: "2026-08-19T00:00:00Z" }] });
    expect(db.calls).toContainEqual({ op: "eq", args: ["user_id", USER] });
  });

  it("an authoritative zero-row read IS empty", async () => {
    expect(await listLayouts(scriptedDb([{ data: [] }]), USER)).toEqual({ ok: true, layouts: [] });
  });
});

describe("saveLayout — C2/C4: only an authoritative write is success", () => {
  it("overwrite uses one atomic upsert on (user_id, name)", async () => {
    const db = scriptedDb([{ data: [{ id: "L1" }] }]);
    const result = await saveLayout(db, USER, { name: "Swing", config: { a: 1 } });
    expect(result).toEqual({ ok: true, id: "L1", created: false });
    const upsert = db.calls.find((c) => c.op === "upsert");
    expect(upsert?.args[1]).toEqual({ onConflict: "user_id,name" });
  });

  it("falls back to select-then-write when the unique index is not applied yet (42P10)", async () => {
    const db = scriptedDb([NO_CONFLICT_TARGET, { data: [{ id: "L9" }] }, { data: [{ id: "L9" }] }]);
    expect(await saveLayout(db, USER, { name: "Swing", config: {} })).toEqual({ ok: true, id: "L9", created: false });
    expect(db.calls.some((c) => c.op === "update")).toBe(true);
  });

  it("a failed upsert is NOT reported as saved", async () => {
    expect(await saveLayout(scriptedDb([OUTAGE]), USER, { name: "Swing", config: {} }))
      .toEqual({ ok: false, reason: "unavailable" });
  });

  it("a failed UPDATE in the fallback path is NOT reported as saved", async () => {
    // The exact shape of the old bug: `.update(...)` errored and the route returned {ok:true}.
    const db = scriptedDb([NO_CONFLICT_TARGET, { data: [{ id: "L9" }] }, OUTAGE]);
    expect(await saveLayout(db, USER, { name: "Swing", config: {} })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("an UPDATE that matched no row is not success either", async () => {
    const db = scriptedDb([NO_CONFLICT_TARGET, { data: [{ id: "L9" }] }, { data: [] }]);
    expect(await saveLayout(db, USER, { name: "Swing", config: {} })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("create mode refuses a taken name instead of overwriting it", async () => {
    const db = scriptedDb([{ data: [{ id: "existing" }] }]);
    expect(await saveLayout(db, USER, { name: "Layout 3", config: {}, mode: "create" }))
      .toEqual({ ok: false, reason: "name_taken" });
    expect(db.calls.some((c) => c.op === "insert" || c.op === "update" || c.op === "upsert")).toBe(false);
  });

  it("create mode maps a unique violation (the lost race) to name_taken", async () => {
    const db = scriptedDb([{ data: [] }, UNIQUE_VIOLATION]);
    expect(await saveLayout(db, USER, { name: "Layout 3", config: {}, mode: "create" }))
      .toEqual({ ok: false, reason: "name_taken" });
  });

  it("rejects an unusable name", async () => {
    expect(await saveLayout(scriptedDb([]), USER, { name: "   ", config: {} }))
      .toEqual({ ok: false, reason: "invalid_name" });
  });
});

describe("deleteLayout — C2: a failed delete is not a delete", () => {
  it("reports a transport failure as unavailable", async () => {
    expect(await deleteLayout(scriptedDb([OUTAGE]), USER, "L1")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("distinguishes 'deleted nothing' from 'deleted'", async () => {
    expect(await deleteLayout(scriptedDb([{ data: [] }]), USER, "L1")).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteLayout(scriptedDb([{ data: [{ id: "L1" }] }]), USER, "L1")).toEqual({ ok: true });
  });

  it("stays owner-scoped", async () => {
    const db = scriptedDb([{ data: [{ id: "L1" }] }]);
    await deleteLayout(db, USER, "L1");
    expect(db.calls).toContainEqual({ op: "eq", args: ["user_id", USER] });
    expect(db.calls).toContainEqual({ op: "eq", args: ["id", "L1"] });
  });
});

describe("C4: concurrency against a store that enforces unique (user_id, name)", () => {
  it("two simultaneous saves of the same name leave exactly one layout", async () => {
    const key = "concurrency";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const [a, b] = await Promise.all([
      saveLayout(db, user, { name: "Swing", config: { from: "tab-a" } }),
      saveLayout(db, user, { name: "Swing", config: { from: "tab-b" } }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts).toHaveLength(1);
  });

  it("two simultaneous blank-name creates cannot both take the same name", async () => {
    const key = "concurrency-create";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    const [a, b] = await Promise.all([
      saveLayout(db, user, { name: "Layout 1", config: {}, mode: "create" }),
      saveLayout(db, user, { name: "Layout 1", config: {}, mode: "create" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ reason: "name_taken" });
    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts).toHaveLength(1);
  });

  it("an overwrite replaces the config of the one row rather than adding a second", async () => {
    const key = "overwrite";
    const db = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveLayout(db, user, { name: "Swing", config: { v: 1 } });
    await saveLayout(db, user, { name: "Swing", config: { v: 2 } });
    const listed = await listLayouts(db, user);
    expect(listed.ok && listed.layouts).toHaveLength(1);
    expect(listed.ok && listed.layouts[0].config).toEqual({ v: 2 });
  });

  it("fixture fault injection surfaces as unavailable, never as an empty library", async () => {
    const key = "fault";
    const seeded = createLayoutFixtureDb(key);
    const user = fixtureLayoutUserId(key);
    await saveLayout(seeded, user, { name: "Swing", config: {} });
    expect(await listLayouts(createLayoutFixtureDb(key, "list"), user)).toEqual({ ok: false, reason: "unavailable" });
    expect(await saveLayout(createLayoutFixtureDb(key, "save"), user, { name: "New", config: {} })).toEqual({ ok: false, reason: "unavailable" });
    expect(await deleteLayout(createLayoutFixtureDb(key, "delete"), user, "layout-fault-1")).toEqual({ ok: false, reason: "unavailable" });
    // The rows are still there — a fault is an outage, not a deletion.
    const healed = await listLayouts(createLayoutFixtureDb(key), user);
    expect(healed.ok && healed.layouts).toHaveLength(1);
  });
});
