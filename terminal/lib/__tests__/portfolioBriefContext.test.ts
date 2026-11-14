import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  checkRowCompatible,
  composerNumericReading,
  composerTickerReading,
  decodeSnapshotBrief,
  PRODUCER_MAX_ROWS,
} from "@/lib/portfolioBriefContext.server";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { normalizeStatus, rowToPosition, type Position } from "@/lib/portfolio";

// ─────────────────────────────────────────────────────────────────────────────
// The canonical-context CONSUMER: the witness decoder, the compatibility gate and the
// canonical book binding (lib/portfolioBriefContext.server.ts).
//
// Four things are proved here, and they are four different claims:
//
//   1. CROSS-LANGUAGE PARITY. The shared producer fixture (a byte-identical copy of
//      macro@68adf1cf tests/fixtures/portfolio_brief_context/projection_cases.json) is
//      replayed through the ACTUAL readers: the Terminal's unchanged `rowToPosition` and
//      a model of the frozen composer's semantics. The fixture's own `compatible` verdict
//      is the EXPECTATION, never the authority — the Terminal recomputes both sides.
//
//   2. THE ADVERSARIAL ROWS. The cases that go beyond the shared file: the reader
//      divergences the producer's Python mirror gets wrong, and the harmless cases that
//      must still be accepted. Each one is judged by the WHOLE witness decoder, not by a
//      helper — the same path the exported proxy takes.
//
//   3. THE WITNESS. Shape, owner, population, count, range, unique ids, the selected ids,
//      the composer inputs, the brief's own population, and the canonical book key —
//      which must be the UNCHANGED Node `portfolioBookKey` over the unchanged Node
//      `rowToPosition`, never a re-derived hash.
//
//   4. THE COUNT DOMAINS. Raw rows before canonical filtering, open rows, selected lots,
//      and unique names — four different numbers that must never be substituted for one
//      another.
//
// LOCATION NOTE: vitest.config.ts includes ONLY "lib/__tests__/**/*.test.ts(x)".
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, "fixtures", "portfolio-brief-context");

/** The shared synthetic witness: the public brief plus the private witness. */
type FixtureWitness = {
  schema: string;
  owner_id: string;
  population: string;
  rows: Record<string, unknown>[];
  selected_position_ids: string[];
  composer_input_source: string;
  composer_inputs: Record<string, unknown>[];
  completeness: Record<string, unknown>;
};

type FixtureBody = {
  schema: string;
  asof: string;
  generated_at: string;
  stale: boolean;
  weighting: { mode: string; label_en: string; label_zh: string };
  book: { n: number; covered: number; uncovered: string[] };
  population?: {
    mode: string;
    label_en: string;
    label_zh: string;
    n: number;
    disclosure_en: string;
    disclosure_zh: string;
  };
  headline: { en: string; zh: string };
  sections: unknown[];
  portfolio_context: FixtureWitness;
};

type ProjectionCase = {
  name: string;
  why: string;
  row: Record<string, unknown>;
  terminal: Record<string, unknown> | null;
  composer: Record<string, unknown>;
  composer_input: Record<string, unknown>;
  compatible: boolean;
  reject_reason: string | null;
};

type ProjectionCases = {
  schema: string;
  note: string;
  cases: ProjectionCase[];
};

type AdversarialCase = {
  name: string;
  why: string;
  patch: Record<string, unknown>;
  expected: "accept" | "refuse";
};

type Adversarial = {
  schema: string;
  note: string;
  owner_id: string;
  base_row: Record<string, unknown>;
  cases: AdversarialCase[];
};

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

const OWNER = "3f0d4a5e-6c21-4f8a-9b77-2c9a1d5e7f30";

const witnessBook = loadFixture<FixtureBody>("witness_book.json");
const witnessEmpty = loadFixture<FixtureBody>("witness_empty.json");
const projectionCases = loadFixture<ProjectionCases>("projection_cases.json");
const adversarial = loadFixture<Adversarial>("adversarial_rows.json");

/** A deep clone, so a mutation in one case cannot leak into the next. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** The canonical Node book key for a set of RAW rows — the unchanged owners. */
function canonicalBookKey(rows: Record<string, unknown>[]): string {
  const positions: Position[] = [];
  for (const row of rows) {
    const position = rowToPosition(row);
    if (position) positions.push(position);
  }
  return portfolioBookKey(positions);
}

/**
 * A complete, synthetic one-row witness around one raw row.
 *
 * It is built the way the producer builds one, so the decoder judges the ROW and not the
 * bookkeeping around it: the row's own status decides the counts, and the composer input
 * is the row's raw ticker/shares/entry_price.
 */
function witnessFor(row: Record<string, unknown>): FixtureBody {
  const open = normalizeStatus(row.status) === "open";
  const position = rowToPosition(row);
  const selected = open && position ? 1 : 0;
  const names = selected;
  return {
    schema: "portfolio_brief.v2",
    asof: "2026-11-02",
    generated_at: "2026-11-02T09:30:00+00:00",
    stale: false,
    weighting: { mode: "equal", label_en: "Equal weighted", label_zh: "等权重" },
    book: { n: names, covered: 0, uncovered: [] },
    population: {
      mode: "positions",
      label_en: "Your holdings",
      label_zh: "你的持仓",
      n: names,
      disclosure_en: `This read describes the ${names} name you hold.`,
      disclosure_zh: `此判读描述你持有的 ${names} 只个股。`,
    },
    headline: { en: "Synthetic brief.", zh: "合成简报。" },
    sections: [],
    portfolio_context: {
      schema: "portfolio_snapshot_witness.v1",
      owner_id: OWNER,
      population: "positions",
      rows: [row],
      selected_position_ids: selected ? [position!.id] : [],
      composer_input_source: "positions",
      composer_inputs: selected
        ? [{ ticker: row.ticker, shares: row.shares, entry_price: row.entry_price }]
        : [],
      completeness: {
        source: "portfolio_positions",
        exact_count: 1,
        range_first: 0,
        range_last: 0,
        returned_count: 1,
        open_count: open ? 1 : 0,
        selected_count: selected,
        max_rows: 1000,
        positions_reads: 1,
        complete: true,
        watchlist: null,
      },
    },
  };
}

describe("shared cross-language fixture — the ACTUAL readers replay it", () => {
  it("ships the shared file byte-identically", () => {
    // The Terminal's copy must be the PRODUCER's file, not a restatement of it: this is
    // the sha256 of macro@68adf1cf's tests/fixtures/portfolio_brief_context/
    // projection_cases.json (git blob e1b5702357256ceaf0b53631379b18c98bf9c1cf).
    const shared = readFileSync(join(FIXTURE_DIR, "projection_cases.json"), "utf8");
    expect(createHash("sha256").update(shared).digest("hex")).toBe(
      "0dc420ae46edb02c83ce8f2dc0a82b36a4a7198a2d173bc0801537f3812d784e",
    );
    expect(projectionCases.schema).toBe("portfolio_brief_context.projection_cases.v1");
    expect(projectionCases.cases).toHaveLength(64);
  });

  it("the Terminal's own projection has not drifted from the fixture's terminal block", () => {
    for (const testCase of projectionCases.cases) {
      const live = rowToPosition(testCase.row);
      // JSON-normalised: the fixture is JSON, and JSON cannot tell -0 from 0. The
      // Terminal reads "-0" as -0; the fixture recorded it as 0 because JSON.stringify
      // writes -0 as 0. The book key stringifies the same way, so the two agree there.
      expect(live === null ? null : JSON.parse(JSON.stringify(live)), testCase.name).toEqual(
        testCase.terminal,
      );
    }
  });

  it("recomputes the verdict from both readers and matches the fixture", () => {
    const refused: string[] = [];
    for (const testCase of projectionCases.cases) {
      const gate = checkRowCompatible(testCase.row);
      expect(gate.ok, `${testCase.name} (${testCase.reject_reason ?? "compatible"})`).toBe(
        testCase.compatible,
      );
      if (!gate.ok) refused.push(testCase.name);
    }
    // The shared split, recomputed rather than declared.
    expect(refused).toHaveLength(18);
    expect(refused).toEqual(
      projectionCases.cases.filter((c) => !c.compatible).map((c) => c.name),
    );
  });
});

describe("the Terminal's own adversarial rows — judged by the whole witness", () => {
  const base = adversarial.base_row;

  for (const testCase of adversarial.cases) {
    it(`${testCase.name} — ${testCase.expected === "accept" ? "accepted" : "refused"}`, () => {
      const row = { ...clone(base), ...clone(testCase.patch) };
      const decoded = decodeSnapshotBrief(witnessFor(row), OWNER);
      expect(decoded.ok, testCase.why).toBe(testCase.expected === "accept");
    });
  }

  it("refuses a Unicode-digit share the producer's own mirror would certify", () => {
    // The mirror's `_JS_DECIMAL_LITERAL` uses `\d`, which in Python is Unicode-aware, so
    // it reads "١٢" as 12 and agrees with itself. JavaScript's Number() refuses it, so
    // the Terminal reads no shares and the two readers disagree.
    const row = { ...clone(base), shares: "\u0661\u0662" };
    expect(composerNumericReading(row.shares)).toEqual({ kind: "value", value: Number.NaN });
    expect(rowToPosition(row)!.shares).toBeNull();
    expect(checkRowCompatible(row).ok).toBe(false);
  });

  it("refuses a ticker Python and JavaScript cannot both read the same way", () => {
    // U+019B: Python's upper() and JavaScript's toUpperCase() disagree on it.
    expect(composerTickerReading("NVDA\u019b").kind).toBe("unsupported");
    // U+0085: Python strips it, JavaScript does not.
    expect(composerTickerReading("NVDA\u0085").kind).toBe("unsupported");
    // U+FEFF: JavaScript strips it, Python does not.
    expect(composerTickerReading("\ufeffNVDA").kind).toBe("unsupported");
    // An ordinary non-ASCII ticker is NOT ambiguous.
    expect(composerTickerReading("\u5e73\u5b89\u94f6\u884c")).toEqual({
      kind: "name",
      name: "\u5e73\u5b89\u94f6\u884c",
    });
  });
});

describe("the witness — a bound book qualifies and binds to the canonical Node key", () => {
  it("accepts a complete, owned, positions witness", () => {
    const decoded = decodeSnapshotBrief(clone(witnessBook), OWNER);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.context.version).toBe("snapshot-v1");
    expect(decoded.context.owner).toBe(OWNER);
    expect(decoded.context.population).toBe("positions");
    // The canonical key is the UNCHANGED Node key over the UNCHANGED Node projection.
    expect(decoded.context.bookKey).toBe(canonicalBookKey(witnessBook.portfolio_context.rows));
    expect(decoded.context.bookKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the count domains apart", () => {
    const decoded = decodeSnapshotBrief(clone(witnessBook), OWNER);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    // Three RAW rows (open AND closed), two of them open, two positionable, and ONE
    // unique name — two lots of NVDA are one name.
    expect(decoded.counts.rawRows).toBe(3);
    expect(decoded.counts.openCount).toBe(2);
    expect(decoded.counts.selectedCount).toBe(2);
    expect(decoded.counts.names).toBe(1);
    expect(decoded.counts.positions).toBe(2);
    expect(decoded.brief.book.n).toBe(1);
    expect(decoded.brief.population?.n).toBe(1);
  });

  it("accepts an empty book with null range endpoints", () => {
    const decoded = decodeSnapshotBrief(clone(witnessEmpty), OWNER);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.counts.rawRows).toBe(0);
    expect(decoded.counts.names).toBe(0);
    expect(decoded.context.bookKey).toBe(canonicalBookKey([]));
  });

  it("rebuilds the public brief from a whitelist and never carries the witness", () => {
    const decoded = decodeSnapshotBrief(clone(witnessBook), OWNER);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect((decoded.brief as { portfolio_context?: unknown }).portfolio_context).toBeUndefined();
    expect(JSON.stringify(decoded.brief)).not.toContain("11111111-1111-4111-8111");
    expect(JSON.stringify(decoded.brief)).not.toContain("entry_currency_basis");
    expect(decoded.brief.headline.en).toBe(witnessBook.headline.en);
  });
});

describe("the witness — every refusal path", () => {
  function refuse(reason: string, mutate: (body: FixtureBody) => void = () => {}) {
    const body = clone(witnessBook);
    mutate(body);
    const decoded = decodeSnapshotBrief(body, OWNER);
    expect(decoded.ok, `expected a refusal (${reason})`).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toBe(reason);
  }

  it("refuses a missing witness", () => {
    const body = clone(witnessBook) as Omit<FixtureBody, "portfolio_context"> & { portfolio_context?: FixtureWitness };
    delete body.portfolio_context;
    const decoded = decodeSnapshotBrief(body, OWNER);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toBe("witness_missing");
  });

  it("refuses an unsupported witness schema", () => {
    refuse("witness_schema", (body) => { body.portfolio_context.schema = "portfolio_snapshot_witness.v2"; });
  });

  it("refuses a witness owned by somebody else", () => {
    refuse("owner_mismatch", (body) => { body.portfolio_context.owner_id = "99999999-9999-4999-8999-999999999999"; });
  });

  it("refuses an email-shaped owner — it is never resolved or stamped", () => {
    refuse("owner_mismatch", (body) => { body.portfolio_context.owner_id = "user@example.com"; });
    // The producer's own documented example owner is a negative case.
    refuse("owner_mismatch", (body) => { body.portfolio_context.owner_id = "u-example"; });
  });

  it("refuses a watchlist_union population", () => {
    refuse("population_mismatch", (body) => { body.portfolio_context.population = "watchlist_union"; });
  });

  it("refuses a composer that was called with another population", () => {
    refuse("composer_source_mismatch", (body) => { body.portfolio_context.composer_input_source = "watchlist_union"; });
  });

  it("refuses a truncated capture", () => {
    refuse("count_mismatch", (body) => { body.portfolio_context.rows.pop(); });
    refuse("count_mismatch", (body) => { body.portfolio_context.completeness.exact_count = 9; });
    refuse("count_mismatch", (body) => { body.portfolio_context.completeness.returned_count = 9; });
  });

  it("refuses a range that does not describe the rows that came back", () => {
    refuse("range_invalid", (body) => { body.portfolio_context.completeness.range_last = 5; });
    refuse("range_invalid", (body) => { body.portfolio_context.completeness.range_first = 1; });
  });

  it("refuses an empty capture that claims a range", () => {
    const body = clone(witnessEmpty);
    body.portfolio_context.completeness.range_first = 0;
    const decoded = decodeSnapshotBrief(body, OWNER);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toBe("range_invalid");
  });

  it("refuses a completeness proof that is not this version's", () => {
    refuse("completeness_invalid", (body) => { body.portfolio_context.completeness.max_rows = 2000; });
    refuse("completeness_invalid", (body) => { body.portfolio_context.completeness.positions_reads = 2; });
    refuse("completeness_invalid", (body) => { body.portfolio_context.completeness.complete = false; });
    refuse("completeness_invalid", (body) => { body.portfolio_context.completeness.source = "watchlists"; });
    refuse("completeness_invalid", (body) => { body.portfolio_context.completeness.watchlist = { reads: 1 }; });
    refuse("completeness_invalid", (body) => { body.portfolio_context.completeness.open_count = 7; });
    refuse("completeness_invalid", (body) => { body.portfolio_context.completeness.selected_count = 7; });
  });

  it("refuses a book over the producer's cap — never paged, never partially witnessed", () => {
    const body = clone(witnessBook);
    const row = body.portfolio_context.rows[0];
    body.portfolio_context.rows = Array.from({ length: PRODUCER_MAX_ROWS + 1 }, (_, index) => ({
      ...row,
      id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    }));
    body.portfolio_context.completeness.exact_count = PRODUCER_MAX_ROWS + 1;
    body.portfolio_context.completeness.returned_count = PRODUCER_MAX_ROWS + 1;
    body.portfolio_context.completeness.range_last = PRODUCER_MAX_ROWS;
    body.portfolio_context.completeness.open_count = PRODUCER_MAX_ROWS + 1;
    body.portfolio_context.completeness.selected_count = PRODUCER_MAX_ROWS + 1;
    body.portfolio_context.selected_position_ids = body.portfolio_context.rows.map((r) => String(r.id));
    body.portfolio_context.composer_inputs = body.portfolio_context.rows.map((r) => ({
      ticker: r.ticker, shares: r.shares, entry_price: r.entry_price,
    }));
    const decoded = decodeSnapshotBrief(body, OWNER);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toBe("over_limit");
  });

  it("refuses duplicate ids", () => {
    refuse("duplicate_ids", (body) => {
      body.portfolio_context.rows[1].id = body.portfolio_context.rows[0].id;
    });
  });

  it("refuses a selection the witness does not describe", () => {
    refuse("selected_mismatch", (body) => { body.portfolio_context.selected_position_ids.pop(); });
    refuse("selected_mismatch", (body) => {
      body.portfolio_context.selected_position_ids[0] = "55555555-5555-4555-8555-555555555555";
    });
  });

  it("refuses composer inputs that are not the selected rows", () => {
    refuse("composer_input_mismatch", (body) => { body.portfolio_context.composer_inputs.pop(); });
    refuse("composer_input_mismatch", (body) => { body.portfolio_context.composer_inputs.push({ ticker: "AMD", shares: 20, entry_price: 70 }); });
    refuse("composer_input_mismatch", (body) => { body.portfolio_context.composer_inputs[0].shares = 11; });
    refuse("composer_input_mismatch", (body) => { body.portfolio_context.composer_inputs[0].ticker = "AMD"; });
    refuse("composer_input_mismatch", (body) => { body.portfolio_context.composer_inputs[0].entry_price = 101; });
  });

  it("refuses a brief whose own population disagrees with the witness", () => {
    refuse("population_count_mismatch", (body) => { body.book.n = 2; });
    refuse("population_count_mismatch", (body) => { body.population!.n = 2; });
    refuse("population_mismatch", (body) => { body.population!.mode = "watchlist_union"; });
  });

  it("refuses a brief that is not the v2 contract", () => {
    refuse("brief_invalid", (body) => { body.schema = "portfolio_brief.v1"; });
    refuse("brief_invalid", (body) => { delete body.population; });
  });

  it("refuses a malformed body without ever throwing", () => {
    for (const body of [null, undefined, 42, "text", [], { portfolio_context: 7 }]) {
      const decoded = decodeSnapshotBrief(body, OWNER);
      expect(decoded.ok).toBe(false);
    }
  });
});

describe("the raw count is proved BEFORE canonical filtering", () => {
  it("a dropped row still counts as a raw row", () => {
    // A closed row with no usable id: the Terminal drops it, so the POSITION count is 2
    // while the RAW row count is 4. The completeness proof is about the raw capture.
    const body = clone(witnessBook);
    body.portfolio_context.rows.push({
      id: "",
      ticker: "",
      shares: null,
      entry_price: null,
      entry_currency: null,
      entry_currency_basis: null,
      entry_date: null,
      notes: null,
      status: "closed",
      created_at: null,
    });
    body.portfolio_context.completeness.exact_count = 4;
    body.portfolio_context.completeness.returned_count = 4;
    body.portfolio_context.completeness.range_last = 3;
    body.portfolio_context.completeness.open_count = 2;
    body.portfolio_context.completeness.selected_count = 2;
    const decoded = decodeSnapshotBrief(body, OWNER);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.counts.rawRows).toBe(4);
    expect(decoded.counts.selectedCount).toBe(2);
    expect(decoded.counts.names).toBe(1);
  });

  it("a count that only the normalized rows would produce is refused", () => {
    const body = clone(witnessBook);
    body.portfolio_context.rows.push({
      id: "",
      ticker: "",
      shares: null,
      entry_price: null,
      entry_currency: null,
      entry_currency_basis: null,
      entry_date: null,
      notes: null,
      status: "closed",
      created_at: null,
    });
    // exact_count still says 3 — the number of rows that SURVIVE normalization, not the
    // number that were captured. That is exactly the masquerade the contract forbids.
    body.portfolio_context.completeness.range_last = 3;
    const decoded = decodeSnapshotBrief(body, OWNER);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.reason).toBe("count_mismatch");
  });
});
