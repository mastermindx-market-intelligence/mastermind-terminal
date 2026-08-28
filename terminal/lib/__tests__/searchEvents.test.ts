import { describe, expect, it } from "vitest";
import {
  listSearchEvents,
  recordSearchEvent,
  searchStats,
  type SearchEventInput,
} from "@/lib/searchEvents";

// Force the in-memory dev ring: createServiceClient() memoises on FIRST CALL, and this
// runs before any record/list below, so the whole file exercises the dev backend.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

// The ring is module state shared across this file, so every test uses its own
// symbols/sources/visitors and asserts only over its own slice (or deltas, for stats).
const base: SearchEventInput = {
  symbol: "BASE",
  query: null,
  source: "test",
  user_id: null,
  anon_id: null,
  ip: null,
  ua: null,
};
const rec = (over: Partial<SearchEventInput>) => recordSearchEvent({ ...base, ...over });

// The dev ring cannot fail, so every read here is expected to be `ok`. Unwrapping through these
// helpers keeps that expectation explicit: if a reader ever starts returning a failure on the
// in-memory backend, these tests say so instead of throwing an opaque undefined-property error.
const unwrap = (r: Awaited<ReturnType<typeof listSearchEvents>>) => {
  if (!r.ok) throw new Error(`expected an ok events read, got: ${r.error}`);
  return r.events;
};
const unwrapStats = (r: Awaited<ReturnType<typeof searchStats>>) => {
  if (!r.ok) throw new Error(`expected an ok stats read, got: ${r.error}`);
  return r.stats;
};


describe("dev ring: record → list", () => {
  it("lists newest first", async () => {
    await rec({ symbol: "ORD1", source: "ord" });
    await rec({ symbol: "ORD2", source: "ord" });
    await rec({ symbol: "ORD3", source: "ord" });
    const rows = unwrap(await listSearchEvents({ limit: 10, source: "ord" }));
    expect(rows.map((r) => r.symbol)).toEqual(["ORD3", "ORD2", "ORD1"]);
    expect(rows[0].id).toBeGreaterThan(rows[1].id);
    expect(rows[0].created_at).toBeTruthy();
  });

  it("pages with the beforeId cursor", async () => {
    for (let i = 1; i <= 5; i++) await rec({ symbol: `CUR${i}`, source: "cur" });
    const page1 = unwrap(await listSearchEvents({ limit: 2, source: "cur" }));
    expect(page1.map((r) => r.symbol)).toEqual(["CUR5", "CUR4"]);
    const page2 = unwrap(await listSearchEvents({ limit: 2, source: "cur", beforeId: page1[1].id }));
    expect(page2.map((r) => r.symbol)).toEqual(["CUR3", "CUR2"]);
    const page3 = unwrap(await listSearchEvents({ limit: 2, source: "cur", beforeId: page2[1].id }));
    expect(page3.map((r) => r.symbol)).toEqual(["CUR1"]);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 4; i++) await rec({ symbol: "LIM", source: "lim" });
    expect(unwrap(await listSearchEvents({ limit: 2, source: "lim" }))).toHaveLength(2);
  });
});

describe("dev ring: filters", () => {
  it("filters by exact symbol", async () => {
    await rec({ symbol: "FILTA", source: "fil" });
    await rec({ symbol: "FILTB", source: "fil" });
    await rec({ symbol: "FILTA", source: "fil" });
    const rows = unwrap(await listSearchEvents({ limit: 10, symbol: "FILTA" }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.symbol === "FILTA")).toBe(true);
  });

  it("filters by source", async () => {
    await rec({ symbol: "SRC", source: "src-a" });
    await rec({ symbol: "SRC", source: "src-b" });
    const rows = unwrap(await listSearchEvents({ limit: 10, source: "src-b" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("src-b");
  });

  it("visitor matches user_id OR anon_id OR ip", async () => {
    await rec({ symbol: "VISU", source: "vis", user_id: "vis-user-1" });
    await rec({ symbol: "VISA", source: "vis", anon_id: "vis-anon-1" });
    await rec({ symbol: "VISI", source: "vis", ip: "203.0.113.77" });
    const byUser = unwrap(await listSearchEvents({ limit: 10, visitor: "vis-user-1" }));
    expect(byUser.map((r) => r.symbol)).toEqual(["VISU"]);
    const byAnon = unwrap(await listSearchEvents({ limit: 10, visitor: "vis-anon-1" }));
    expect(byAnon.map((r) => r.symbol)).toEqual(["VISA"]);
    const byIp = unwrap(await listSearchEvents({ limit: 10, visitor: "203.0.113.77" }));
    expect(byIp.map((r) => r.symbol)).toEqual(["VISI"]);
    expect(unwrap(await listSearchEvents({ limit: 10, visitor: "vis-nobody" }))).toHaveLength(0);
  });
});

describe("dev ring: searchStats", () => {
  it("aggregates total/today/visitors7d/topSymbols7d over synthetic events", async () => {
    const before = unwrapStats(await searchStats());
    // 4 distinct visitor keys: two anon (one repeated), one user, one ip-only.
    await rec({ symbol: "STATA", source: "sta", anon_id: "sta-v1" });
    await rec({ symbol: "STATA", source: "sta", anon_id: "sta-v1" });
    await rec({ symbol: "STATA", source: "sta", anon_id: "sta-v2" });
    await rec({ symbol: "STATB", source: "sta", user_id: "sta-v3" });
    await rec({ symbol: "STATB", source: "sta", ip: "203.0.113.99" });
    const after = unwrapStats(await searchStats());

    expect(after.total - before.total).toBe(5);
    expect(after.today - before.today).toBe(5); // dev ring stamps created_at = now
    expect(after.visitors7d - before.visitors7d).toBe(4);

    const a = after.topSymbols7d.find((s) => s.symbol === "STATA");
    const b = after.topSymbols7d.find((s) => s.symbol === "STATB");
    expect(a?.count).toBe(3);
    expect(b?.count).toBe(2);
    // ties break alphabetically, so STATA (3) ranks above STATB (2) above any 1-count symbol
    expect(after.topSymbols7d.indexOf(a!)).toBeLessThan(after.topSymbols7d.indexOf(b!));

    expect(after.perDay14d).toHaveLength(14);
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayBucket = after.perDay14d[13];
    expect(todayBucket.day).toBe(todayKey);
    expect(todayBucket.count).toBe(after.total); // everything in the ring was recorded "now"
  });
});
