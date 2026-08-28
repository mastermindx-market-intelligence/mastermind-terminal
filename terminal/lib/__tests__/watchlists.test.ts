import { beforeEach, describe, expect, it } from "vitest";
import {
  addSymbols,
  createList,
  deleteList,
  adoptServerSymbols,
  chunkSymbols,
  listWatchlists,
  moveSymbols,
  normalizeListName,
  normalizeSection,
  normalizeSymbols,
  planWatchlistMigration,
  removeSymbols,
  renameList,
  resolveTargetList,
  type LocalWatchlist,
  type ServerWatchlist,
} from "@/lib/watchlists";
import { createFixtureDb, fixtureStore, fixtureUserId, resetFixtureStores } from "@/lib/watchlistsFixtureDb";

// The fixture transport is the same in-memory store the Playwright dev server uses, so these unit
// tests and the e2e migration spec exercise ONE implementation of the service.
const db = () => createFixtureDb("unit");
const owner = fixtureUserId("unit");

beforeEach(() => resetFixtureStores());

describe("input normalization", () => {
  it("uppercases, trims, de-duplicates and refuses oversized batches", () => {
    expect(normalizeSymbols([" aapl ", "MSFT", "AAPL"])).toEqual(["AAPL", "MSFT"]);
    expect(normalizeSymbols("nem")).toEqual(["NEM"]);
    expect(normalizeSymbols(Array.from({ length: 501 }, (_, i) => `SYM${i}`))).toEqual([]);
    expect(normalizeSymbols(["\u0000bad"])).toEqual([]);
  });

  it("rejects control characters and over-long labels, and keeps name matching EXACT", () => {
    expect(normalizeSection(" China Bottoms ")).toBe("China Bottoms");
    expect(normalizeSection("\u0000bad")).toBeNull();
    expect(normalizeSection(undefined)).toBe("Watchlist");
    // master #409: "" is the unsectioned root run — a legal VALUE, distinct from null/unusable.
    // Callers must test `=== null`, never truthiness, or every unsectioned row 400s.
    expect(normalizeSection("")).toBe("");
    expect(normalizeSection("   ")).toBe("");
    expect(normalizeSection("x".repeat(81))).toBeNull();
    expect(normalizeListName("  Gold Miners ")).toBe("Gold Miners");
    expect(normalizeListName("x".repeat(81))).toBeNull();
    // The schema's unique (user_id,name) is case-sensitive — no case folding may creep in.
    expect(normalizeListName("ai")).not.toBe(normalizeListName("AI"));
  });
});

describe("list CRUD (the paths that did not exist before W1b)", () => {
  it("creates at max(position)+1, and a second create of the same name returns the same row", async () => {
    const first = await createList(db(), owner, "Gold Miners");
    expect(first.created).toBe(true);
    const second = await createList(db(), owner, "Gold Miners");
    expect(second.created).toBe(false);
    expect(second.list?.id).toBe(first.list?.id);

    const third = await createList(db(), owner, "Space");
    const lists = await listWatchlists(db(), owner);
    expect(lists.map((list) => list.name)).toEqual(["Default", "Gold Miners", "Space"]);
    expect(lists.map((list) => list.position)).toEqual([0, 1, 2]);
    expect(third.list?.id).toBe(lists[2].id);
  });

  it("deletes and renames by EXACT NAME too, for a client that does not know the id yet (F4)", async () => {
    const { list } = await createList(db(), owner, "Swing");
    await addSymbols(db(), list!.id, ["TSLA"], "Tactical");

    const byName = await resolveTargetList(db(), owner, { listName: "Swing" });
    expect(byName?.id).toBe(list!.id);
    expect(await renameList(db(), owner, byName!.id, "Tactical")).toEqual({ ok: true });

    const renamed = await resolveTargetList(db(), owner, { listName: "Tactical" });
    expect(await deleteList(db(), owner, renamed!.id)).toEqual({ ok: true });
    expect((await listWatchlists(db(), owner)).map((row) => row.name)).toEqual(["Default"]);
    // A name that no longer exists resolves to null rather than to Default.
    expect(await resolveTargetList(db(), owner, { listName: "Tactical" })).toBeNull();
  });

  it("renames, refuses a name clash, and 404s a list the caller does not own", async () => {
    const { list } = await createList(db(), owner, "Swing");
    expect(await renameList(db(), owner, list!.id, "Tactical")).toEqual({ ok: true });
    expect((await listWatchlists(db(), owner)).map((row) => row.name)).toEqual(["Default", "Tactical"]);

    expect(await renameList(db(), owner, list!.id, "Default")).toMatchObject({ ok: false, status: 409 });
    expect(await renameList(db(), owner, "someone-elses-list", "Mine")).toMatchObject({ ok: false, status: 404 });
    // Owner scoping: the same id under a different user is not reachable.
    expect(await renameList(db(), "another-user", list!.id, "Mine")).toMatchObject({ ok: false, status: 404 });
  });

  it("deletes a list and cascades its symbols, and refuses a list the caller does not own", async () => {
    const { list } = await createList(db(), owner, "Swing");
    await addSymbols(db(), list!.id, ["TSLA", "RIVN"], "Tactical");
    expect((await listWatchlists(db(), owner))[1].symbols).toHaveLength(2);

    expect(await deleteList(db(), "another-user", list!.id)).toMatchObject({ ok: false, status: 404 });
    expect(await deleteList(db(), owner, list!.id)).toEqual({ ok: true });
    const remaining = await listWatchlists(db(), owner);
    expect(remaining.map((row) => row.name)).toEqual(["Default"]);
    expect(remaining[0].symbols.map((row) => row.symbol)).not.toContain("TSLA");
  });
});

describe("symbol ops target a LIST, not 'the first row'", () => {
  it("adds a batch to the named list and leaves every sibling untouched", async () => {
    const { list } = await createList(db(), owner, "Gold Miners");
    const added = await addSymbols(db(), list!.id, ["NEM", "AEM", "GOLD"], "Miners");
    expect(added).toEqual({ ok: true, added: ["NEM", "AEM", "GOLD"] });

    const lists = await listWatchlists(db(), owner);
    expect(lists[0].name).toBe("Default");
    expect(lists[0].symbols.map((row) => row.symbol)).toEqual(["BTC-USD", "ETH-USD", "NVDA", "AAPL", "MSFT", "QQQ"]);
    expect(lists[1].symbols.map((row) => row.symbol)).toEqual(["NEM", "AEM", "GOLD"]);
    expect(lists[1].symbols.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("re-adding an existing batch is a no-op, and a partial batch appends only what is missing", async () => {
    const { list } = await createList(db(), owner, "Gold Miners");
    await addSymbols(db(), list!.id, ["NEM", "AEM"], "Miners");
    expect(await addSymbols(db(), list!.id, ["NEM", "AEM"], "Miners")).toEqual({ ok: true, added: [] });
    expect(await addSymbols(db(), list!.id, ["AEM", "GOLD"], "Miners")).toEqual({ ok: true, added: ["GOLD"] });
    const symbols = (await listWatchlists(db(), owner))[1].symbols;
    expect(symbols.map((row) => row.symbol)).toEqual(["NEM", "AEM", "GOLD"]);
    expect(symbols.map((row) => row.position)).toEqual([0, 1, 2]);
  });

  it("carries a per-symbol section so one request preserves a list's grouping", async () => {
    const { list } = await createList(db(), owner, "Mixed");
    await addSymbols(db(), list!.id, ["NEM", "BTC-USD"], "Miners", { "BTC-USD": "Crypto" });
    expect((await listWatchlists(db(), owner))[1].symbols).toEqual([
      { symbol: "NEM", section: "Miners", position: 0 },
      { symbol: "BTC-USD", section: "Crypto", position: 1 },
    ]);
  });

  it("removes and moves only within the targeted list", async () => {
    const { list } = await createList(db(), owner, "Swing");
    await addSymbols(db(), list!.id, ["NVDA", "AAPL"], "Tactical");
    await removeSymbols(db(), list!.id, ["NVDA"]);
    await moveSymbols(db(), list!.id, ["AAPL"], "Core");

    const lists = await listWatchlists(db(), owner);
    // Default still carries its own NVDA/AAPL rows — the sibling write did not reach them.
    expect(lists[0].symbols.map((row) => row.symbol)).toContain("NVDA");
    expect(lists[0].symbols.find((row) => row.symbol === "AAPL")?.section).toBe("Equities");
    expect(lists[1].symbols).toEqual([{ symbol: "AAPL", section: "Core", position: 1 }]);
  });

  it("resolves the target by id, by exact name, and falls back to the first list for pre-W1b calls", async () => {
    const { list } = await createList(db(), owner, "Swing");
    expect(await resolveTargetList(db(), owner, { listId: list!.id })).toMatchObject({ name: "Swing" });
    expect(await resolveTargetList(db(), owner, { listName: "Swing" })).toMatchObject({ id: list!.id });
    expect(await resolveTargetList(db(), owner, {})).toMatchObject({ name: "Default" });
    // Case-sensitive, and never silently redirected to another list.
    expect(await resolveTargetList(db(), owner, { listName: "swing" })).toBeNull();
    expect(await resolveTargetList(db(), "another-user", { listId: list!.id })).toBeNull();
    // NIT: a target that WAS supplied but is unusable resolves to null — never to the first list.
    // Falling back there would silently reinstate the first-list soloism this wave retires.
    for (const input of [
      { listName: "" }, { listName: "   " }, { listName: "\u0000bad" }, { listName: "x".repeat(81) },
      { listName: 42 }, { listId: "" }, { listId: "   " }, { listId: 7 },
      // An explicit null was SENT, so it is a supplied-but-unusable target, not the legacy shape.
      { listName: null }, { listId: null },
    ]) {
      expect(await resolveTargetList(db(), owner, input)).toBeNull();
    }
    // Only the genuinely legacy shape — no target key at all — still resolves the first list.
    expect(await resolveTargetList(db(), owner, {})).toMatchObject({ name: "Default" });
  });
});

describe("planWatchlistMigration", () => {
  const local: LocalWatchlist[] = [
    { name: "Default", rows: [{ symbol: "AAPL", section: "Core" }] },
    { name: "Gold Miners", rows: [{ symbol: "NEM", section: "Miners" }, { symbol: "AEM", section: "Miners" }] },
    { name: "Space", rows: [{ symbol: "RKLB", section: "Growth" }] },
  ];
  const server: ServerWatchlist[] = [
    { id: "wl-default", name: "Default", position: 0, symbols: [{ symbol: "NVDA", section: "Equities", position: 0 }] },
    { id: "wl-gold", name: "Gold Miners", position: 1, symbols: [{ symbol: "NEM", section: "Miners", position: 0 }] },
  ];

  it("never plans Default, merges by exact name, creates what is missing at max+1", () => {
    const plan = planWatchlistMigration(local, server);
    expect(plan.skipped).toEqual(["Default"]);
    expect(plan.lists).toEqual([
      { name: "Gold Miners", createAtPosition: null, serverListId: "wl-gold", insert: [{ symbol: "AEM", section: "Miners" }] },
      { name: "Space", createAtPosition: 2, serverListId: null, insert: [{ symbol: "RKLB", section: "Growth" }] },
    ]);
  });

  it("is a NO-OP over the state it just produced (run-twice idempotency, marker ignored)", () => {
    const migrated: ServerWatchlist[] = [
      ...server.map((list) => list.name === "Gold Miners"
        ? { ...list, symbols: [...list.symbols, { symbol: "AEM", section: "Miners", position: 1 }] }
        : list),
      { id: "wl-space", name: "Space", position: 2, symbols: [{ symbol: "RKLB", section: "Growth", position: 0 }] },
    ];
    const plan = planWatchlistMigration(local, migrated, {});
    expect(plan.lists.every((item) => item.createAtPosition === null && item.insert.length === 0)).toBe(true);
    expect(plan.lists.map((item) => item.serverListId)).toEqual(["wl-gold", "wl-space"]);
  });

  it("retries ONLY the lists the marker did not record as successful", () => {
    const plan = planWatchlistMigration(local, server, { "Gold Miners": true, Space: false });
    expect(plan.skipped).toEqual(["Default", "Gold Miners"]);
    expect(plan.lists.map((item) => item.name)).toEqual(["Space"]);
  });

  it("keeps a server-only list out of the plan entirely — nothing deletes or renames it", () => {
    const withServerOnly: ServerWatchlist[] = [
      ...server,
      { id: "wl-other-device", name: "From Phone", position: 5, symbols: [] },
    ];
    const plan = planWatchlistMigration(local, withServerOnly);
    expect(plan.lists.map((item) => item.name)).not.toContain("From Phone");
    // The next created list still lands after the highest existing position.
    expect(plan.lists.find((item) => item.name === "Space")?.createAtPosition).toBe(6);
  });

  it("de-duplicates a local list against itself and against the server", () => {
    const plan = planWatchlistMigration(
      [{ name: "Gold Miners", rows: [{ symbol: "nem", section: "Miners" }, { symbol: "AEM", section: "Miners" }, { symbol: "AEM", section: "Other" }] }],
      server,
    );
    expect(plan.lists[0].insert).toEqual([{ symbol: "AEM", section: "Miners" }]);
  });
});

describe("adoptServerSymbols — the ORDER-SEMANTICS RULING", () => {
  const local = [{ symbol: "AEM", section: "Local" }, { symbol: "GOLD", section: "Pending" }];
  const server = [{ symbol: "NEM", section: "Miners" }, { symbol: "AEM", section: "Miners" }];

  it("keeps local order, keeps local sections, drops nothing, and appends server-only rows", () => {
    expect(adoptServerSymbols(local, server)).toEqual([
      { symbol: "AEM", section: "Local" },      // local section SURVIVES a differing server section
      { symbol: "GOLD", section: "Pending" },   // local-only row is never dropped
      { symbol: "NEM", section: "Miners" },     // genuinely server-only, appended last
    ]);
  });

  it("never reorders local rows to match the server", () => {
    const reordered = [{ symbol: "GOLD", section: "P" }, { symbol: "AEM", section: "P" }];
    expect(adoptServerSymbols(reordered, [{ symbol: "AEM", section: "M" }, { symbol: "GOLD", section: "M" }]))
      .toEqual(reordered);
  });

  it("F1 PROBE: a row removed while the read was in flight is NOT replayed back", () => {
    // The user deleted AEM after the GET went out. `alreadyLocal` is the pre-read membership, so
    // the stale response cannot resurrect it — while a truly new server row still arrives.
    const afterDelete = [{ symbol: "GOLD", section: "Pending" }];
    const beforeRead = new Set(["AEM", "GOLD"]);
    expect(adoptServerSymbols(afterDelete, server, beforeRead)).toEqual([
      { symbol: "GOLD", section: "Pending" },
      { symbol: "NEM", section: "Miners" },
    ]);
  });

  it("A3: a delete made BEFORE the read no longer resurrects — the intent outranks stale state", () => {
    // W1b accepted this as a tradeoff ("a delete made BEFORE the read can still resurrect"):
    // absent from the pre-read snapshot, AEM was indistinguishable from a row another device
    // added, so an offline delete reversed itself on the next mount. A durable deletion intent
    // (lib/watchlistOwner.ts) is what tells the two apart, and it is passed in here.
    const afterOfflineDelete = [{ symbol: "GOLD", section: "P" }];
    const deletedLocally = new Set(["AEM"]);
    expect(adoptServerSymbols(afterOfflineDelete, server, new Set(["GOLD"]), deletedLocally))
      .toEqual([
        { symbol: "GOLD", section: "P" },
        { symbol: "NEM", section: "Miners" },   // a genuine other-device add still arrives
      ]);
  });

  it("A3: once the delete converges the tombstone clears and the symbol can return", () => {
    // "server addition after the deletion has truly completed" must read as a NEW addition.
    expect(adoptServerSymbols([{ symbol: "GOLD", section: "P" }], server, new Set(["GOLD"]), new Set()))
      .toEqual([
        { symbol: "GOLD", section: "P" },
        { symbol: "NEM", section: "Miners" },
        { symbol: "AEM", section: "Miners" },
      ]);
  });
});

describe("A2 — concurrent adds converge on ONE row per symbol", () => {
  const listId = async () => (await listWatchlists(db(), owner))[0].id;
  // Counted from the RAW table, never through `listWatchlists`. That read de-dupes by symbol as it
  // builds its result (see its loop), which is exactly what hid this defect: the rail looked
  // correct while the table held two rows, and every later remove/move fanned out across rows the
  // user could not see. An assertion routed through the read would have passed on the bug.
  const rawRows = (ticker: string) =>
    fixtureStore("unit").symbols.filter((row) => row.symbol === ticker);

  it("two writers that both read 'NVDA absent' still produce a single NVDA row", async () => {
    const id = await listId();
    await removeSymbols(db(), id, ["NVDA"]);
    // Interleaved exactly as two tabs do it: BOTH read before EITHER writes. Before migration
    // 0008 the dedupe lived only in `addSymbols`'s in-memory `present` set, so both inserted.
    const [first, second] = await Promise.all([
      addSymbols(db(), id, ["NVDA"], "Equities"),
      addSymbols(db(), id, ["NVDA"], "Equities"),
    ]);
    expect(first.ok && second.ok).toBe(true);
    expect(rawRows("NVDA")).toHaveLength(1);
  });

  it("two concurrent initial provisions leave exactly six unique Default members", async () => {
    // The post-signup race `app/terminal/page.tsx` documents: `router.refresh` and the page load
    // both find the list empty and both seed it. Twelve rows, six of them duplicates.
    const id = await listId();
    const seed = ["BTC-USD", "ETH-USD", "NVDA", "AAPL", "MSFT", "QQQ"];
    await removeSymbols(db(), id, seed);
    await Promise.all([
      addSymbols(db(), id, seed, "Watchlist"),
      addSymbols(db(), id, seed, "Watchlist"),
    ]);
    expect(fixtureStore("unit").symbols.filter((row) => row.watchlist_id === id)).toHaveLength(6);
    for (const ticker of seed) expect(rawRows(ticker)).toHaveLength(1);
  });

  it("overlapping batches leave one row per ticker and keep each row's section", async () => {
    const id = await listId();
    await Promise.all([
      addSymbols(db(), id, ["PLTR", "SMCI"], "Growth"),
      addSymbols(db(), id, ["SMCI", "ARM"], "Semis"),
      addSymbols(db(), id, ["PLTR", "ARM"], "Growth"),
    ]);
    for (const ticker of ["PLTR", "SMCI", "ARM"]) expect(rawRows(ticker)).toHaveLength(1);
    // The first writer's section is the one that survives; the losers are no-ops, not overwrites.
    expect(rawRows("PLTR")[0].section).toBe("Growth");
    expect(rawRows("SMCI")[0].section).toBe("Growth");
  });

  it("a retried add is idempotent rather than duplicating", async () => {
    const id = await listId();
    await addSymbols(db(), id, ["TSLA"], "Equities");
    const retry = await addSymbols(db(), id, ["TSLA"], "Equities");
    expect(retry).toEqual({ ok: true, added: [] });
    expect(rawRows("TSLA")).toHaveLength(1);
  });

  it("leaves an existing non-duplicate list exactly as it was", async () => {
    const id = await listId();
    const before = fixtureStore("unit").symbols.map((row) => ({ ...row }));
    await addSymbols(db(), id, ["NVDA", "AAPL"], "Equities");
    expect(fixtureStore("unit").symbols).toEqual(before);
  });

  // `supabase/` is explicitly NOT deployed (DEPLOY.md), so the schema change and the code deploy
  // are separate operations. An upsert whose conflict target has no matching unique index does not
  // degrade — Postgres refuses the statement (42P10) — so without a fallback, shipping this code
  // to a database that has not had 0008 applied would break EVERY watchlist add.
  it("still adds the symbol on a database where migration 0008 has not landed yet", async () => {
    const id = await listId();
    const real = createFixtureDb("unit");
    let upsertAttempts = 0;
    let insertFallbacks = 0;
    const preMigration = {
      from: (table: string) => {
        const query = real.from(table);
        return {
          ...query,
          select: (...args: [string?]) => query.select(...args),
          eq: (...args: [string, unknown]) => query.eq(...args),
          insert: (values: unknown) => { insertFallbacks += 1; return query.insert(values as never); },
          upsert: () => {
            upsertAttempts += 1;
            return Object.assign(Promise.resolve({
              data: null,
              error: { message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' },
            }), query);
          },
        } as unknown as ReturnType<typeof real.from>;
      },
    };
    const result = await addSymbols(preMigration, id, ["RBLX"], "Growth");
    expect(result).toEqual({ ok: true, added: ["RBLX"] });
    expect(upsertAttempts).toBe(1);
    expect(insertFallbacks).toBe(1);
    expect(fixtureStore("unit").symbols.filter((row) => row.symbol === "RBLX")).toHaveLength(1);
  });

  it("does NOT fall back when the write failed for any other reason", async () => {
    const id = await listId();
    const real = createFixtureDb("unit");
    let insertFallbacks = 0;
    const brokenDb = {
      from: (table: string) => {
        const query = real.from(table);
        return {
          ...query,
          select: (...args: [string?]) => query.select(...args),
          eq: (...args: [string, unknown]) => query.eq(...args),
          insert: (values: unknown) => { insertFallbacks += 1; return query.insert(values as never); },
          upsert: () => Object.assign(Promise.resolve({ data: null, error: { message: "permission denied for table watchlist_symbols" } }), query),
        } as unknown as ReturnType<typeof real.from>;
      },
    };
    const result = await addSymbols(brokenDb, id, ["RBLX"], "Growth");
    expect(result.ok).toBe(false);
    expect(insertFallbacks).toBe(0);
  });
});

describe("chunkSymbols (F6)", () => {
  it("passes a sub-cap batch through whole and splits anything larger at the cap", () => {
    expect(chunkSymbols([])).toEqual([]);
    expect(chunkSymbols(["A", "B"])).toEqual([["A", "B"]]);
    const big = Array.from({ length: 1201 }, (_, i) => `S${i}`);
    const chunks = chunkSymbols(big);
    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 201]);
    expect(chunks.flat()).toEqual(big);       // nothing dropped, order preserved
  });
});

describe("end-to-end service run-twice", () => {
  // The gate row in its most direct form: run the whole plan+apply loop twice over the same local
  // state and assert the server is byte-identical the second time.
  const local: LocalWatchlist[] = [
    { name: "Default", rows: [{ symbol: "AAPL", section: "Core" }] },
    { name: "Gold Miners", rows: [{ symbol: "NEM", section: "Miners" }, { symbol: "AEM", section: "Miners" }] },
  ];

  const migrate = async () => {
    const plan = planWatchlistMigration(local, await listWatchlists(db(), owner));
    for (const item of plan.lists) {
      let listId = item.serverListId;
      if (!listId) listId = (await createList(db(), owner, item.name)).list?.id ?? null;
      if (!listId) continue;
      await addSymbols(
        db(),
        listId,
        item.insert.map((row) => row.symbol),
        item.insert[0]?.section ?? "Watchlist",
        Object.fromEntries(item.insert.map((row) => [row.symbol, row.section])),
      );
    }
  };

  it("yields identical server state on the second run and never touches Default", async () => {
    await migrate();
    const first = await listWatchlists(db(), owner);
    await migrate();
    const second = await listWatchlists(db(), owner);
    expect(second).toEqual(first);
    expect(first.map((list) => list.name)).toEqual(["Default", "Gold Miners"]);
    // Default is the seeded server list, unchanged — the local Default's AAPL was never pushed
    // here, because TRAP-1 owns that list.
    expect(first[0].symbols.map((row) => row.symbol)).toEqual(["BTC-USD", "ETH-USD", "NVDA", "AAPL", "MSFT", "QQQ"]);
    expect(first[1].symbols).toEqual([
      { symbol: "NEM", section: "Miners", position: 0 },
      { symbol: "AEM", section: "Miners", position: 1 },
    ]);
  });
});
