import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  adoptLegacyWatchlistState,
  clearWatchlistTombstones,
  forgetListTombstones,
  GUEST_OWNER,
  MAX_TOMBSTONES,
  readOwnerMigrationMarker,
  readOwnerStringMap,
  readOwnerWatchlists,
  readWatchlistTombstones,
  recordWatchlistTombstones,
  TOMBSTONE_TTL_MS,
  tombstonedSymbols,
  watchlistOwnerKey,
  writeOwnerMigrationMarker,
  writeOwnerStringMap,
  writeOwnerWatchlists,
  WL_FLAGS_KEY,
  WL_NOTES_KEY,
  WLS_KEY,
  type StoragePort,
} from "../watchlistOwner";

function fakeStorage(seed: Record<string, string> = {}): StoragePort & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    dump: () => Object.fromEntries(map),
  };
}

const ALICE = watchlistOwnerKey("11111111-1111-1111-1111-111111111111");
const BOB = watchlistOwnerKey("22222222-2222-2222-2222-222222222222");

const state = (lists: Record<string, string[]>, active = Object.keys(lists)[0]) => ({
  lists: Object.fromEntries(Object.entries(lists)
    .map(([name, symbols]) => [name, symbols.map((symbol) => ({ symbol, section: "Equities" }))])),
  active,
  meta: {},
});

describe("A1 — watchlist local state is owner-scoped", () => {
  it("keys on the immutable auth id, and keeps guest disjoint from every account", () => {
    expect(watchlistOwnerKey(undefined)).toBe(GUEST_OWNER);
    expect(watchlistOwnerKey("")).toBe(GUEST_OWNER);
    expect(watchlistOwnerKey("   ")).toBe(GUEST_OWNER);
    expect(ALICE).not.toBe(BOB);
    expect(ALICE).not.toBe(GUEST_OWNER);
    // An id that literally spelled "guest" must still land in the account space.
    expect(watchlistOwnerKey("guest")).not.toBe(GUEST_OWNER);
  });

  it("never serves one owner's lists, flags, notes or receipts to another", () => {
    const storage = fakeStorage();
    writeOwnerWatchlists(storage, ALICE, state({ Default: ["NVDA"], "Gold Miners": ["GDX", "NEM"] }, "Gold Miners"));
    writeOwnerStringMap(storage, WL_FLAGS_KEY, ALICE, { NVDA: "red" });
    writeOwnerStringMap(storage, WL_NOTES_KEY, ALICE, { NVDA: "alice's thesis" });
    writeOwnerMigrationMarker(storage, ALICE, { "Gold Miners": true });

    expect(readOwnerWatchlists(storage, BOB)).toBeNull();
    expect(readOwnerStringMap(storage, WL_FLAGS_KEY, BOB)).toEqual({});
    expect(readOwnerStringMap(storage, WL_NOTES_KEY, BOB)).toEqual({});
    expect(readOwnerMigrationMarker(storage, BOB)).toEqual({});
    expect(readOwnerWatchlists(storage, GUEST_OWNER)).toBeNull();

    // …and Alice is still intact after Bob has been read and has written his own.
    writeOwnerWatchlists(storage, BOB, state({ Default: ["TSLA"] }));
    const alice = readOwnerWatchlists(storage, ALICE);
    expect(Object.keys(alice!.lists)).toEqual(["Default", "Gold Miners"]);
    expect(alice!.lists["Gold Miners"].map((row) => row.symbol)).toEqual(["GDX", "NEM"]);
    expect(readOwnerWatchlists(storage, BOB)!.lists.Default.map((row) => row.symbol)).toEqual(["TSLA"]);
  });

  it("MUTATION GUARD: dropping the owner key from the read makes the isolation claim fail", () => {
    // The discriminating property. If `readSlot` ever went back to reading the payload directly
    // (the pre-A1 unscoped shape), this envelope would resolve to Alice's lists for Bob too.
    const storage = fakeStorage();
    writeOwnerWatchlists(storage, ALICE, state({ Default: ["NVDA"] }));
    const envelope = JSON.parse(storage.getItem(WLS_KEY)!);
    expect(Object.keys(envelope)).toEqual([ALICE]);
    // An owner-blind read — what the bug did — would see Alice's rows here.
    const ownerBlind = Object.values(envelope)[0] as { lists: Record<string, unknown[]> };
    expect(ownerBlind.lists.Default).toHaveLength(1);
    expect(readOwnerWatchlists(storage, BOB)).toBeNull();
  });

  it("a sign-out does not turn an account's cache into guest data", () => {
    const storage = fakeStorage();
    writeOwnerWatchlists(storage, ALICE, state({ Default: ["NVDA"], Semis: ["AMD"] }));
    // Nothing in the module copies an account slot into the guest slot.
    expect(readOwnerWatchlists(storage, GUEST_OWNER)).toBeNull();
    writeOwnerWatchlists(storage, GUEST_OWNER, state({ Default: ["BTC-USD"] }));
    expect(readOwnerWatchlists(storage, GUEST_OWNER)!.lists.Default.map((r) => r.symbol)).toEqual(["BTC-USD"]);
    expect(readOwnerWatchlists(storage, ALICE)!.lists.Semis.map((r) => r.symbol)).toEqual(["AMD"]);
  });

  it("rejects a malformed or foreign-shaped payload instead of half-loading it", () => {
    const storage = fakeStorage({ [WLS_KEY]: JSON.stringify({ [ALICE]: { lists: "nope" } }) });
    expect(readOwnerWatchlists(storage, ALICE)).toBeNull();
    const partial = fakeStorage({
      [WLS_KEY]: JSON.stringify({ [ALICE]: { lists: { Default: [{ symbol: "NVDA" }, { nope: 1 }, "junk"] } } }),
    });
    expect(readOwnerWatchlists(partial, ALICE)!.lists.Default).toEqual([{ symbol: "NVDA", section: "" }]);
  });
});

describe("A1 — legacy unscoped state is adopted by policy, not by whoever logs in first", () => {
  const legacy = {
    "mm.wls": JSON.stringify({ lists: { Default: [{ symbol: "NVDA", section: "Equities" }], Alpha: [{ symbol: "PLTR", section: "Equities" }] }, active: "Alpha" }),
    "mm.flags": JSON.stringify({ NVDA: "red" }),
    "mm.symbolNotes": JSON.stringify({ NVDA: "legacy note" }),
    "mm.wls.migrated.v1": JSON.stringify({ Alpha: true }),
  };

  it("lands in guest, never in an account, and drops the unscoped migration receipt", () => {
    const storage = fakeStorage({ ...legacy });
    expect(adoptLegacyWatchlistState(storage)).toBe(true);

    const guest = readOwnerWatchlists(storage, GUEST_OWNER);
    expect(Object.keys(guest!.lists)).toEqual(["Default", "Alpha"]);
    expect(guest!.active).toBe("Alpha");
    expect(readOwnerStringMap(storage, WL_FLAGS_KEY, GUEST_OWNER)).toEqual({ NVDA: "red" });
    expect(readOwnerStringMap(storage, WL_NOTES_KEY, GUEST_OWNER)).toEqual({ NVDA: "legacy note" });

    // The account that happens to sign in next inherits NOTHING — this is the A1 defect.
    expect(readOwnerWatchlists(storage, ALICE)).toBeNull();
    expect(readOwnerStringMap(storage, WL_FLAGS_KEY, ALICE)).toEqual({});
    // An unscoped "already migrated" receipt must not suppress a real per-account migration.
    expect(readOwnerMigrationMarker(storage, ALICE)).toEqual({});
    expect(readOwnerMigrationMarker(storage, GUEST_OWNER)).toEqual({});
  });

  it("runs exactly once and never re-overwrites a guest who has since edited", () => {
    const storage = fakeStorage({ ...legacy });
    adoptLegacyWatchlistState(storage);
    for (const key of Object.keys(legacy)) expect(storage.getItem(key)).toBeNull();

    writeOwnerWatchlists(storage, GUEST_OWNER, state({ Default: ["ETH-USD"] }));
    expect(adoptLegacyWatchlistState(storage)).toBe(false);
    expect(readOwnerWatchlists(storage, GUEST_OWNER)!.lists.Default.map((r) => r.symbol)).toEqual(["ETH-USD"]);
  });

  it("does not clobber a guest namespace that already exists", () => {
    const storage = fakeStorage({ ...legacy });
    writeOwnerWatchlists(storage, GUEST_OWNER, state({ Default: ["SPY"] }));
    adoptLegacyWatchlistState(storage);
    expect(readOwnerWatchlists(storage, GUEST_OWNER)!.lists.Default.map((r) => r.symbol)).toEqual(["SPY"]);
  });
});

describe("A3 — a deletion survives a failed write", () => {
  const NOW = 1_760_000_000_000;

  it("records before the request and clears only on confirmation", () => {
    const storage = fakeStorage();
    recordWatchlistTombstones(storage, ALICE, "Default", ["AAPL"], NOW);
    expect(tombstonedSymbols(readWatchlistTombstones(storage, ALICE, NOW), "Default")).toEqual(new Set(["AAPL"]));

    // A failed DELETE clears nothing: the row must stay deleted and stay retryable.
    expect(tombstonedSymbols(readWatchlistTombstones(storage, ALICE, NOW + 5_000), "Default").has("AAPL")).toBe(true);

    clearWatchlistTombstones(storage, ALICE, "Default", ["AAPL"], NOW);
    expect(readWatchlistTombstones(storage, ALICE, NOW)).toEqual({});
  });

  it("scopes intents to the owner that made them", () => {
    const storage = fakeStorage();
    recordWatchlistTombstones(storage, ALICE, "Default", ["AAPL"], NOW);
    expect(readWatchlistTombstones(storage, BOB, NOW)).toEqual({});
    expect(readWatchlistTombstones(storage, GUEST_OWNER, NOW)).toEqual({});
    // Bob deleting his own AAPL must not clear Alice's outstanding intent.
    recordWatchlistTombstones(storage, BOB, "Default", ["AAPL"], NOW);
    clearWatchlistTombstones(storage, BOB, "Default", ["AAPL"], NOW);
    expect(tombstonedSymbols(readWatchlistTombstones(storage, ALICE, NOW), "Default").has("AAPL")).toBe(true);
  });

  it("keeps lists apart and forgets a deleted list wholesale", () => {
    const storage = fakeStorage();
    recordWatchlistTombstones(storage, ALICE, "Default", ["AAPL"], NOW);
    recordWatchlistTombstones(storage, ALICE, "Semis", ["AMD"], NOW);
    expect(tombstonedSymbols(readWatchlistTombstones(storage, ALICE, NOW), "Default")).toEqual(new Set(["AAPL"]));
    forgetListTombstones(storage, ALICE, "Semis", NOW);
    const book = readWatchlistTombstones(storage, ALICE, NOW);
    expect(Object.keys(book)).toEqual(["Default"]);
  });

  it("is bounded — ages out and caps, so a stuck client cannot grow storage forever", () => {
    const storage = fakeStorage();
    recordWatchlistTombstones(storage, ALICE, "Default", ["AAPL"], NOW);
    expect(readWatchlistTombstones(storage, ALICE, NOW + TOMBSTONE_TTL_MS + 1)).toEqual({});

    const many = Array.from({ length: MAX_TOMBSTONES + 25 }, (_, i) => `SYM${i}`);
    recordWatchlistTombstones(storage, BOB, "Default", many, NOW);
    const kept = Object.keys(readWatchlistTombstones(storage, BOB, NOW).Default ?? {});
    expect(kept.length).toBe(MAX_TOMBSTONES);
  });
});

describe("A2 — membership uniqueness is enforced by the database, not by application code", () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), "..", "supabase", "migrations", "0009_watchlist_symbol_unique.sql"),
    "utf8",
  );

  it("declares the unique index the writers now conflict-target", () => {
    expect(sql).toMatch(/create unique index if not exists wls_watchlist_symbol\s+on public\.watchlist_symbols\(watchlist_id, symbol\)/);
  });

  it("reconciles pre-existing duplicates deterministically BEFORE the constraint lands", () => {
    // A unique index cannot be created over duplicates, so the reconcile is a hard precondition,
    // and the survivor must be chosen by a total order — never arbitrarily.
    expect(sql).toContain("row_number() over (");
    expect(sql).toContain("partition by watchlist_id, symbol");
    expect(sql).toMatch(/order by position asc, created_at asc, id asc/);
    // Compare the EXECUTABLE statements: the rationale comment names both operations too.
    const statements = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(statements.indexOf("delete from public.watchlist_symbols"))
      .toBeLessThan(statements.indexOf("create unique index"));
  });

  it("keeps the writers pointed at that exact conflict target", () => {
    const service = readFileSync(path.resolve(process.cwd(), "lib", "watchlists.ts"), "utf8");
    const route = readFileSync(path.resolve(process.cwd(), "app", "terminal", "page.tsx"), "utf8");
    expect(service).toContain('.upsert(inserts, { onConflict: "watchlist_id,symbol", ignoreDuplicates: true })');
    // Both writers — the batched add and the first-login seed — go through the one helper.
    expect(service).toContain("async function writeMembership(");
    expect(route).toContain("seedMembership(supabase as never,");
    // An unknown count is not an empty count: a failed read must not read as permission to seed.
    expect(route).toContain("if (!countError && !count)");
  });
});
