/**
 * D2 — a supported symbol must never be permanently excluded from quote coverage because its
 * POSITION in the demand set is greater than the request cap.
 *
 * The old path built one flat symbol list and handed it whole to `/api/quote?syms=`, which enforced
 * its 200-symbol cap with a silent `slice(0, 200)`. Watchlist operations permit 500 symbols and a
 * composite row expands into several quote symbols, so overshooting was reachable — and everything
 * past the boundary sat on EOD fallback for as long as the list stayed that size.
 *
 * The invariant under test is coverage WITHOUT extra load: one request per poll, never larger than
 * the cap (so provider fan-out is exactly what it was), and every symbol reached within a bounded
 * number of polls.
 */
import { describe, it, expect } from "vitest";
import {
  planQuoteBatch, groupsFromSymbols, QUOTE_REQUEST_LIMIT,
  type QuoteDemandGroup,
} from "@/lib/quoteDemand";

const sym = (i: number) => `SYM${String(i).padStart(4, "0")}`;
const list = (n: number, from = 0) => Array.from({ length: n }, (_, i) => sym(from + i));

/** Drive `polls` consecutive polls the way the shell does, carrying the cursor forward. */
function sweep(
  priority: QuoteDemandGroup[],
  rotating: QuoteDemandGroup[],
  polls: number,
  limit = QUOTE_REQUEST_LIMIT,
) {
  const batches: string[][] = [];
  let cursor = 0;
  for (let i = 0; i < polls; i++) {
    const plan = planQuoteBatch({ priority, rotating, cursor, limit });
    cursor = plan.nextCursor;
    batches.push(plan.symbols);
  }
  return { batches, covered: new Set(batches.flat()) };
}

describe("D2 — a 300-symbol watchlist keeps every row covered", () => {
  const ACTIVE = "NVDA";
  const priority = [{ key: ACTIVE, symbols: [ACTIVE] }];
  const rotating = groupsFromSymbols(list(300));

  it("the row at position 1, 199, 201 and 275 are all reached — the four the handoff names", () => {
    const { covered } = sweep(priority, rotating, 4);
    for (const i of [0, 198, 200, 274]) {
      expect(covered.has(sym(i))).toBe(true);
    }
  });

  it("every one of the 300 is covered within ceil(300 / capacity) polls", () => {
    const { covered } = sweep(priority, rotating, 2);
    for (const s of list(300)) expect(covered.has(s)).toBe(true);
  });

  it("no request ever exceeds the cap, so provider fan-out is unchanged", () => {
    const { batches } = sweep(priority, rotating, 10);
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(QUOTE_REQUEST_LIMIT);
  });

  it("exactly one request per poll", () => {
    const { batches } = sweep(priority, rotating, 10);
    expect(batches).toHaveLength(10);
  });
});

describe("D2 — the active symbol is never rotated out", () => {
  it("it is in EVERY poll even when its prior list position was past the cap", () => {
    const ACTIVE = sym(275);                       // deliberately beyond the old 200 boundary
    const priority = [{ key: ACTIVE, symbols: [ACTIVE] }];
    const rotating = groupsFromSymbols(list(400));
    const { batches } = sweep(priority, rotating, 6);
    for (const b of batches) expect(b).toContain(ACTIVE);
  });

  it("a priority set larger than the whole budget still keeps the charted symbol", () => {
    const priority = groupsFromSymbols(list(500));  // pathological; active is first
    const plan = planQuoteBatch({ priority, rotating: [], limit: 200 });
    expect(plan.symbols).toContain(sym(0));
    expect(plan.symbols.length).toBeLessThanOrEqual(200);
  });
});

describe("D2 — composites are admitted whole, and do not starve unrelated rows", () => {
  it("a composite's legs never split across two polls", () => {
    const composite: QuoteDemandGroup = { key: "A+B+C", symbols: ["LEG_A", "LEG_B", "LEG_C"] };
    // Sit the composite in the middle of a set far larger than the cap so rotation must cross it.
    const rotating = [...groupsFromSymbols(list(150)), composite, ...groupsFromSymbols(list(150, 150))];
    const { batches } = sweep([], rotating, 8);
    for (const b of batches) {
      const legs = composite.symbols.filter((s) => b.includes(s)).length;
      // A poll carries all three legs or none — never a partial row summing fresh against stale.
      expect(legs === 0 || legs === composite.symbols.length).toBe(true);
    }
  });

  it("the rows after a composite still get their turn", () => {
    const composite: QuoteDemandGroup = { key: "X+Y", symbols: ["LEG_X", "LEG_Y"] };
    const rotating = [composite, ...groupsFromSymbols(list(400))];
    const { covered } = sweep([], rotating, 3);
    for (const s of list(400)) expect(covered.has(s)).toBe(true);
  });

  it("a single group bigger than the whole budget cannot stall the cursor", () => {
    const monster: QuoteDemandGroup = { key: "MONSTER", symbols: list(250, 9000) };
    const rotating = [monster, ...groupsFromSymbols(list(100))];
    const { covered } = sweep([], rotating, 4, 200);
    // The oversized group is served partially rather than forever-retried, and the ordinary rows
    // behind it are still reached — the starvation this guard exists to prevent.
    for (const s of list(100)) expect(covered.has(s)).toBe(true);
  });
});

describe("D2 — a demand set that already fits behaves exactly as it did before", () => {
  const rotating = groupsFromSymbols(list(40));

  it("is reported complete and carries every symbol on every poll", () => {
    const plan = planQuoteBatch({ rotating });
    expect(plan.complete).toBe(true);
    expect(plan.symbols).toHaveLength(40);
  });

  it("does not drift its cursor, so successive polls are identical", () => {
    const { batches } = sweep([], rotating, 5);
    for (const b of batches) expect(b).toEqual(batches[0]);
  });
});

describe("D2 — the measurement, on the shell's real demand shape", () => {
  // What TerminalShell actually asks for: the charted symbol, the 16-symbol movers strip, and the
  // watchlist. The OLD code flattened these into one array in exactly this order and let the route
  // slice it — so on a long list the movers, appended LAST, were the first thing discarded.
  const ACTIVE = "NVDA";
  const MOVERS = Array.from({ length: 16 }, (_, i) => `MOVER${i}`);
  const WATCHLIST = list(300);

  it("BEFORE: 117 of 317 demanded symbols were never requested at all", () => {
    const flat = Array.from(new Set([ACTIVE, ...WATCHLIST, ...MOVERS]));
    expect(flat).toHaveLength(317);
    const served = flat.slice(0, QUOTE_REQUEST_LIMIT);          // the silent slice
    expect(served).toHaveLength(200);
    const never = flat.filter((s) => !served.includes(s));
    expect(never).toHaveLength(117);
    // The movers strip lost its live plane ENTIRELY — it sat behind 300 watchlist rows.
    for (const m of MOVERS) expect(never).toContain(m);
  });

  it("AFTER: all 317 are covered in 2 polls, still one request of ≤200 per poll", () => {
    const priority = [
      { key: ACTIVE, symbols: [ACTIVE] },
      ...groupsFromSymbols(MOVERS),
    ];
    const rotating = groupsFromSymbols(WATCHLIST);
    const { batches, covered } = sweep(priority, rotating, 2);

    expect(batches).toHaveLength(2);                             // one request per poll, unchanged
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(QUOTE_REQUEST_LIMIT);
    expect(covered.size).toBe(317);                              // nothing left behind
    // Priority rides every poll: the chart and the movers strip never wait for their turn.
    for (const b of batches) {
      expect(b).toContain(ACTIVE);
      for (const m of MOVERS) expect(b).toContain(m);
    }
  });
});

describe("D2 — planner hygiene", () => {
  it("deduplicates a symbol that is both priority and rotating, without spending budget twice", () => {
    const priority = [{ key: "AAPL", symbols: ["AAPL"] }];
    const rotating = groupsFromSymbols(["AAPL", "MSFT"]);
    const plan = planQuoteBatch({ priority, rotating });
    expect(plan.symbols.filter((s) => s === "AAPL")).toHaveLength(1);
    expect(plan.symbols).toContain("MSFT");
  });

  it("normalizes an out-of-range or negative cursor rather than dropping a poll", () => {
    const rotating = groupsFromSymbols(list(300));
    for (const cursor of [-7, 0, 299, 5_000]) {
      const plan = planQuoteBatch({ rotating, cursor });
      expect(plan.symbols.length).toBeGreaterThan(0);
      expect(plan.symbols.length).toBeLessThanOrEqual(QUOTE_REQUEST_LIMIT);
    }
  });

  it("an empty demand set asks for nothing", () => {
    expect(planQuoteBatch({}).symbols).toEqual([]);
  });
});
