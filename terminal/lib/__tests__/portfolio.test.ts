import { beforeEach, describe, expect, it } from "vitest";
import {
  bookTotals,
  costBasis,
  createPosition,
  deletePosition,
  getOwnedPosition,
  listPositions,
  marketValue,
  normalizeEntryDate,
  normalizeNotes,
  normalizeNumeric,
  normalizeStatus,
  normalizeTicker,
  quoteSymbols,
  resolveLast,
  rowToPosition,
  sinceEntryPct,
  sinceEntryValue,
  updatePosition,
  MAX_NOTES_LEN,
  type Position,
} from "@/lib/portfolio";
import { addSymbols, listWatchlists } from "@/lib/watchlists";
import {
  createFixtureDb,
  FAULT_POSITIONS_MUTATION_NOOP,
  fixtureUserId,
  resetFixtureStores,
} from "@/lib/watchlistsFixtureDb";

// The service is exercised against the same in-memory transport the Playwright dev server and the
// route tests use, so these assertions are about RESULTING STATE rather than call shapes.
const db = () => createFixtureDb("portfolio-unit");
const owner = fixtureUserId("portfolio-unit");
const other = fixtureUserId("portfolio-other");
const book = () => listPositions(db(), owner);

beforeEach(() => resetFixtureStores());

describe("normalizers", () => {
  it("upper-cases a ticker and refuses the unusable", () => {
    expect(normalizeTicker(" nvda ")).toBe("NVDA");
    expect(normalizeTicker("brk.b")).toBe("BRK.B");
    expect(normalizeTicker("")).toBeNull();
    expect(normalizeTicker("   ")).toBeNull();
    expect(normalizeTicker(42)).toBeNull();
    expect(normalizeTicker("A".repeat(129))).toBeNull();
    expect(normalizeTicker("NV\u0000DA")).toBeNull();
  });

  it("separates ABSENT from explicit NULL from a real number", () => {
    expect(normalizeNumeric(undefined)).toEqual({ kind: "absent" });
    expect(normalizeNumeric(null)).toEqual({ kind: "value", value: null });
    expect(normalizeNumeric("")).toEqual({ kind: "value", value: null });
    expect(normalizeNumeric("  ")).toEqual({ kind: "value", value: null });
    expect(normalizeNumeric(12.5)).toEqual({ kind: "value", value: 12.5 });
    expect(normalizeNumeric("12.5")).toEqual({ kind: "value", value: 12.5 });
    // A short is legitimate; no sign constraint is invented that the DDL does not carry.
    expect(normalizeNumeric(-40)).toEqual({ kind: "value", value: -40 });
  });

  it("refuses a fat-fingered number instead of silently writing NULL", () => {
    // The whole point of `invalid`: "3O" must not become an unsized position that reads deliberate.
    expect(normalizeNumeric("3O")).toEqual({ kind: "invalid" });
    expect(normalizeNumeric("abc")).toEqual({ kind: "invalid" });
    expect(normalizeNumeric(Number.NaN)).toEqual({ kind: "invalid" });
    expect(normalizeNumeric(Number.POSITIVE_INFINITY)).toEqual({ kind: "invalid" });
    expect(normalizeNumeric({})).toEqual({ kind: "invalid" });
  });

  it("accepts only a real calendar day for entry_date", () => {
    expect(normalizeEntryDate("2026-08-12")).toEqual({ kind: "value", value: "2026-08-12" });
    expect(normalizeEntryDate("")).toEqual({ kind: "value", value: null });
    expect(normalizeEntryDate(undefined)).toEqual({ kind: "absent" });
    expect(normalizeEntryDate("12/08/2026")).toEqual({ kind: "invalid" });
    expect(normalizeEntryDate("2026-8-1")).toEqual({ kind: "invalid" });
    // Parses as a string, is not a day — refused here rather than 500ing in Postgres.
    expect(normalizeEntryDate("2026-02-31")).toEqual({ kind: "invalid" });
    expect(normalizeEntryDate("2026-13-01")).toEqual({ kind: "invalid" });
  });

  it("keeps newlines in notes, refuses over-length rather than truncating", () => {
    expect(normalizeNotes("held for the cycle")).toEqual({ kind: "value", value: "held for the cycle" });
    expect(normalizeNotes("one\ntwo")).toEqual({ kind: "value", value: "one\ntwo" });
    expect(normalizeNotes("   ")).toEqual({ kind: "value", value: null });
    expect(normalizeNotes("x".repeat(MAX_NOTES_LEN + 1))).toEqual({ kind: "invalid" });
    expect(normalizeNotes("bad\u0007bell")).toEqual({ kind: "invalid" });
  });

  it("coerces status to the estate's two values instead of trusting the column", () => {
    expect(normalizeStatus("closed")).toBe("closed");
    expect(normalizeStatus(" CLOSED ")).toBe("closed");
    expect(normalizeStatus("open")).toBe("open");
    expect(normalizeStatus("archived")).toBe("open");
    expect(normalizeStatus(undefined)).toBe("open");
    expect(normalizeStatus(null)).toBe("open");
  });

  it("drops a row that cannot be a position rather than rendering half of one", () => {
    expect(rowToPosition({ id: "p1", ticker: "NVDA" })?.ticker).toBe("NVDA");
    expect(rowToPosition({ ticker: "NVDA" })).toBeNull();
    expect(rowToPosition({ id: "p1" })).toBeNull();
    // PostgREST can hand numerics back as strings depending on the driver.
    expect(rowToPosition({ id: "p1", ticker: "NVDA", shares: "10", entry_price: "100.5" }))
      .toMatchObject({ shares: 10, entryPrice: 100.5 });
  });
});

describe("CRUD", () => {
  it("creates a position from a ticker alone — an unsized position is legal", async () => {
    const result = await createPosition(db(), owner, { ticker: "nvda" });
    expect(result.ok).toBe(true);
    expect(result.position).toMatchObject({ ticker: "NVDA", shares: null, entryPrice: null, status: "open" });
    expect(result.position?.createdAt).toBeTruthy();
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });

  it("refuses a create with no usable ticker, and writes nothing", async () => {
    expect(await createPosition(db(), owner, { ticker: "  " })).toMatchObject({ ok: false, status: 400 });
    expect(await createPosition(db(), owner, { ticker: "NVDA", shares: "3O" }))
      .toMatchObject({ ok: false, status: 400, error: "invalid shares" });
    expect(await createPosition(db(), owner, { ticker: "NVDA", entryDate: "2026-02-31" }))
      .toMatchObject({ ok: false, status: 400, error: "invalid entry date" });
    expect(await book()).toEqual([]);
  });

  it("patches only the keys it was given", async () => {
    const created = await createPosition(db(), owner, {
      ticker: "AAPL", shares: 10, entryPrice: 200, entryDate: "2026-01-05", notes: "core",
    });
    const id = created.position!.id;

    // A close is a status-only patch: everything else must survive it (gate D's local half).
    expect(await updatePosition(db(), owner, id, { status: "closed" })).toMatchObject({ ok: true });
    const closed = (await book())[0];
    expect(closed).toMatchObject({
      status: "closed", shares: 10, entryPrice: 200, entryDate: "2026-01-05", notes: "core",
    });

    // An explicit empty string CLEARS; an absent key does not.
    await updatePosition(db(), owner, id, { shares: "" });
    const cleared = (await book())[0];
    expect(cleared.shares).toBeNull();
    expect(cleared.entryPrice).toBe(200);
  });

  it("is a no-op for a patch that names nothing editable", async () => {
    const created = await createPosition(db(), owner, { ticker: "AAPL", shares: 10 });
    const before = (await book())[0];
    const result = await updatePosition(db(), owner, created.position!.id, {});
    expect(result.ok).toBe(true);
    expect((await book())[0]).toEqual(before);
  });

  it("fails closed when UPDATE/DELETE returns no affected row and preserves canonical state", async () => {
    const created = await createPosition(db(), owner, {
      ticker: "NVDA", shares: 10, entryPrice: 100, entryDate: "2026-01-05", notes: "core",
    });
    const id = created.position!.id;
    const noopDb = createFixtureDb("portfolio-unit", [FAULT_POSITIONS_MUTATION_NOOP]);
    const original = await book();

    for (const patch of [{ shares: 25 }, { status: "closed" }] as const) {
      expect(await updatePosition(noopDb, owner, id, patch)).toEqual({
        ok: false,
        error: "position mutation not confirmed",
        status: 500,
      });
      expect(await book()).toEqual(original);
    }

    expect(await deletePosition(noopDb, owner, id)).toEqual({
      ok: false,
      error: "position mutation not confirmed",
      status: 500,
    });
    expect(await book()).toEqual(original);

    // Reopen is the same repaired update mechanism, exercised from a genuinely closed baseline.
    expect((await updatePosition(db(), owner, id, { status: "closed" })).ok).toBe(true);
    const closed = await book();
    expect(await updatePosition(noopDb, owner, id, { status: "open" })).toEqual({
      ok: false,
      error: "position mutation not confirmed",
      status: 500,
    });
    expect(await book()).toEqual(closed);
  });

  it("deletes only the named position", async () => {
    const keep = await createPosition(db(), owner, { ticker: "AAPL" });
    const drop = await createPosition(db(), owner, { ticker: "NVDA" });
    expect(await deletePosition(db(), owner, drop.position!.id)).toMatchObject({ ok: true });
    expect((await book()).map((p) => p.id)).toEqual([keep.position!.id]);
  });
});

describe("owner scoping", () => {
  it("never reads, patches or deletes another user's position", async () => {
    const mine = await createPosition(db(), owner, { ticker: "NVDA", shares: 10 });
    const theirs = await createPosition(db(), other, { ticker: "TSLA", shares: 99 });
    const id = theirs.position!.id;

    // The store genuinely holds both — this is not passing because the row is absent.
    expect((await listPositions(db(), other)).map((p) => p.ticker)).toEqual(["TSLA"]);
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);

    expect(await getOwnedPosition(db(), owner, id)).toBeNull();
    expect(await updatePosition(db(), owner, id, { shares: 1 })).toMatchObject({ ok: false, status: 404 });
    expect(await deletePosition(db(), owner, id)).toMatchObject({ ok: false, status: 404 });

    // …and their row is untouched by the attempts.
    expect((await listPositions(db(), other))[0]).toMatchObject({ ticker: "TSLA", shares: 99 });
    expect((await book())[0].id).toBe(mine.position!.id);
  });

  it("files a create under the SESSION user, never a user_id in the payload", async () => {
    await createPosition(db(), owner, { ticker: "NVDA", user_id: other } as never);
    expect((await listPositions(db(), other))).toEqual([]);
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });
});

describe("semantic invariants A-D (packet section 0) at the store level", () => {
  const listsOf = () => listWatchlists(db(), owner);

  it("A: adding to a watchlist leaves portfolio_positions unchanged", async () => {
    await createPosition(db(), owner, { ticker: "NVDA", shares: 5 });
    const before = await book();
    const list = (await listsOf())[0];
    await addSymbols(db(), list.id, ["AAPL"], "Equities");
    expect(await book()).toEqual(before);
  });

  it("B: adding a position leaves every watchlist row unchanged", async () => {
    const before = await listsOf();
    await createPosition(db(), owner, { ticker: "AAPL", shares: 3 });
    expect(await listsOf()).toEqual(before);
  });

  it("C: removing a watchlist symbol keeps the position", async () => {
    await createPosition(db(), owner, { ticker: "NVDA", shares: 5 });
    const list = (await listsOf())[0];
    await db().from("watchlist_symbols").delete().eq("watchlist_id", list.id).eq("symbol", "NVDA");
    expect((await listsOf())[0].symbols.map((s) => s.symbol)).not.toContain("NVDA");
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });

  it("D: closing a position keeps watchlist membership", async () => {
    const created = await createPosition(db(), owner, { ticker: "NVDA", shares: 5 });
    await updatePosition(db(), owner, created.position!.id, { status: "closed" });
    expect((await listsOf())[0].symbols.map((s) => s.symbol)).toContain("NVDA");
    expect((await book())[0].status).toBe("closed");
  });

  it("deleting a watchlist cascades its symbols and NOTHING else", async () => {
    await createPosition(db(), owner, { ticker: "NVDA", shares: 5 });
    const list = (await listsOf())[0];
    await db().from("watchlists").delete().eq("user_id", owner).eq("id", list.id);
    expect(await listsOf()).toEqual([]);
    expect((await book()).map((p) => p.ticker)).toEqual(["NVDA"]);
  });
});

describe("display math — honest nulls, never a fabricated number", () => {
  const position = (over: Partial<Position> = {}): Position => ({
    id: "p", ticker: "NVDA", shares: 10, entryPrice: 100, entryDate: null,
    notes: null, status: "open", createdAt: null, ...over,
  });

  it("has no value without shares, and no since-entry without an entry price", () => {
    expect(marketValue(position({ shares: null }), 120)).toBeNull();
    expect(marketValue(position(), null)).toBeNull();
    expect(marketValue(position(), 120)).toBe(1200);
    expect(costBasis(position({ entryPrice: null }))).toBeNull();
    expect(sinceEntryPct(position({ entryPrice: null }), 120)).toBeNull();
    expect(sinceEntryPct(position(), null)).toBeNull();
    expect(sinceEntryPct(position(), 120)).toBeCloseTo(20);
    expect(sinceEntryValue(position(), 120)).toBe(200);
    // A zero entry price has no defined percentage — null, not Infinity.
    expect(sinceEntryPct(position({ entryPrice: 0 }), 120)).toBeNull();
  });

  it("prefers a live quote over the nightly manifest and dashes when neither resolves", () => {
    expect(resolveLast("NVDA", { NVDA: { last: 181 } }, { NVDA: { last: 175 } })).toBe(181);
    expect(resolveLast("NVDA", { NVDA: null }, { NVDA: { last: 175 } })).toBe(175);
    expect(resolveLast("NVDA", {}, {})).toBeNull();
    expect(resolveLast("NVDA", { NVDA: { last: "181" } }, {})).toBeNull();
  });

  it("reports NULL totals — not zero — when nothing can be valued", () => {
    const totals = bookTotals([position({ shares: null })], {}, {});
    expect(totals.marketValue).toBeNull();
    expect(totals.sinceEntry).toBeNull();
    expect(totals.sinceEntryPct).toBeNull();
    expect(totals.dayChange).toBeNull();
    expect(totals.openCount).toBe(1);
    expect(totals.valued).toBe(0);
  });

  // ── round-2 review MAJOR: two populations, never mixed ────────────────────────────────────
  it("REGRESSION: an entry-price-less position's market value is not booked as profit", () => {
    // The reviewer's exact probe. Before the fix `value` summed the WIDE population (every valued
    // position) while `basis` summed the NARROW one (those with an entry price), and subtracting
    // them reported BBB's entire 50,000 market value as profit: +52,000 / +260%.
    const positions = [
      position({ id: "a", ticker: "AAA", shares: 100, entryPrice: 200 }),
      position({ id: "b", ticker: "BBB", shares: 100, entryPrice: null }),
    ];
    const totals = bookTotals(positions, { AAA: { last: 220 }, BBB: { last: 500 } }, {});

    // What the book is WORTH still covers everything held — that population is not restricted.
    expect(totals.marketValue).toBe(72000);
    expect(totals.valued).toBe(2);

    // What it has MADE covers only the position that can answer the question.
    expect(totals.sinceEntry).toBe(2000);
    expect(totals.sinceEntryPct).toBeCloseTo(10);
    expect(totals.costBasis).toBe(20000);
    expect(totals.based).toBe(1);

    // …and the exclusion is DISCLOSED. `unpriced` cannot carry this: BBB has a price.
    expect(totals.noBasis).toEqual(["BBB"]);
    expect(totals.unpriced).toEqual([]);
  });

  it("separates 'no price' from 'no entry price' — they are different silences", () => {
    const totals = bookTotals(
      [
        position({ id: "a", ticker: "AAA", shares: 10, entryPrice: 100 }),
        position({ id: "b", ticker: "BBB", shares: 10, entryPrice: null }),   // priced, no basis
        position({ id: "c", ticker: "CCC", shares: 10, entryPrice: 100 }),    // no price at all
        position({ id: "d", ticker: "DDD", shares: null, entryPrice: 100 }),  // unsized
      ],
      { AAA: { last: 120 }, BBB: { last: 50 }, DDD: { last: 10 } },
      {},
    );
    expect(totals.openCount).toBe(4);
    expect(totals.valued).toBe(2);          // AAA + BBB
    expect(totals.based).toBe(1);           // AAA only
    expect(totals.unpriced).toEqual(["CCC"]);
    expect(totals.noBasis).toEqual(["BBB"]);
    expect(totals.sinceEntry).toBe(200);    // (10 x 120) - (10 x 100), BBB excluded entirely
  });

  it("reports no P&L at all when nothing carries a basis, rather than a number built from none", () => {
    const totals = bookTotals(
      [position({ shares: 100, entryPrice: null })],
      { NVDA: { last: 500 } },
      {},
    );
    expect(totals.marketValue).toBe(50000);
    expect(totals.sinceEntry).toBeNull();
    expect(totals.sinceEntryPct).toBeNull();
    expect(totals.costBasis).toBeNull();
    expect(totals.based).toBe(0);
    expect(totals.noBasis).toEqual(["NVDA"]);
  });

  it("names the unpriced rather than quietly dropping them from a confident total", () => {
    const totals = bookTotals(
      [position({ id: "a", ticker: "NVDA" }), position({ id: "b", ticker: "0700.HK" })],
      { NVDA: { last: 120, chg: 2 } },
      {},
    );
    expect(totals.openCount).toBe(2);
    expect(totals.valued).toBe(1);
    expect(totals.marketValue).toBe(1200);
    expect(totals.unpriced).toEqual(["0700.HK"]);
    // An unsized name is NOT "unpriced" — it has a price, just no size to apply it to.
    const unsized = bookTotals([position({ shares: null })], { NVDA: { last: 120 } }, {});
    expect(unsized.unpriced).toEqual([]);
    expect(unsized.valued).toBe(0);
  });

  it("counts closed positions apart and keeps them out of the totals", () => {
    const totals = bookTotals(
      [position({ id: "a" }), position({ id: "b", status: "closed", shares: 500 })],
      { NVDA: { last: 120 } },
      {},
    );
    expect(totals.openCount).toBe(1);
    expect(totals.closedCount).toBe(1);
    expect(totals.marketValue).toBe(1200);
  });

  it("derives day change from each name's own percent move", () => {
    const totals = bookTotals([position()], { NVDA: { last: 110, chg: 10 } }, {});
    expect(totals.marketValue).toBe(1100);
    expect(totals.dayChange).toBeCloseTo(100);      // 1100 - (1100 / 1.1)
    expect(totals.sinceEntry).toBeCloseTo(100);
    expect(totals.sinceEntryPct).toBeCloseTo(10);
  });

  it("asks the quote hub for each ticker once, closed rows included", () => {
    expect(quoteSymbols([
      position({ id: "a", ticker: "NVDA" }),
      position({ id: "b", ticker: "NVDA" }),
      position({ id: "c", ticker: "AAPL", status: "closed" }),
    ])).toEqual(["NVDA", "AAPL"]);
  });
});
