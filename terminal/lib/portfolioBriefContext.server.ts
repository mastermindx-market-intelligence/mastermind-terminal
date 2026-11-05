// Portfolio brief snapshot context — the CONSUMER half of the `snapshot-v1` witness contract.
//
// The desk (macro-api) composes the brief upstream and, for a request that opts into the
// snapshot contract, attaches a PRIVATE witness (`portfolio_snapshot_witness.v1`) that
// describes the exact book it read. This module is where that witness is decoded, proved,
// and bound to a canonical book identity — and it is the ONLY place the witness exists.
//
// WHAT IT OWNS
//   * the witness's shape, count, range, owner and population proofs;
//   * the compatibility gate between the frozen Python composer and the Terminal's OWN
//     unchanged `rowToPosition` / `portfolioBookKey`;
//   * the minimal PUBLIC context the browser is allowed to see.
//
// WHAT IT DOES NOT OWN
//   * the book identity itself — that is `portfolioBookKey` over the unchanged
//     `rowToPosition` projection, imported from the existing owners, never re-derived;
//   * the public brief's words — those are the desk's, relayed as composed;
//   * any authentication decision — the caller supplies the server-verified owner.
//
// THE COMPATIBILITY GATE IS A COMPARISON, NOT A SECOND NORMALIZER
//   The producer computes its witness with a Python mirror of Terminal's normalizer. That
//   mirror is NOT authority here: it is a re-implementation, and two of its shortcuts are
//   known to disagree with the real readers. So this module computes the composer's
//   reading from the raw values (Python semantics) and compares it with the Terminal's
//   real reading (the unchanged `rowToPosition`). Where they disagree — or where either
//   side cannot be read without ambiguity — the row is REFUSED. Nothing is repaired, no
//   value is coerced, and no unit is guessed.
//
//   Two properties of the frozen composer make the comparison exact:
//     (1) `float(shares)` and `float(entry_price)` are parsed TOGETHER inside one
//         try/except, so one unparseable field nulls BOTH. The cost guard needs both to
//         be non-null and positive, so a row whose two readers parse a field differently
//         contributes ZERO cost under either reading. The brief's observable output
//         (name order, weights, mode, book.n) is therefore identical; the per-field
//         comparison below is observationally equivalent to the coupled one.
//     (2) `str(raw or "").strip().upper()` is the composer's ticker reading. Python's
//         `strip()` and JavaScript's `trim()` remove different characters, and Python's
//         `upper()` and JavaScript's `toUpperCase()` differ on 55 code points; both
//         differences are enumerated below and REFUSED rather than guessed.
//
// THE STRIP / UPPER DIVERGENCE SETS
//   Derived by comparing every Unicode code point (0..0x10FFFF) between CPython's
//   `str.strip()`/`str.upper()` and JavaScript's `String.prototype.trim()`/
//   `String.prototype.toUpperCase()`. The derivation script and its output are recorded
//   in `docs/verification/portfolio-brief-context-20261102/`.
//
//   Python strips U+001C..U+001F and U+0085 that JavaScript does not; JavaScript strips
//   U+FEFF that Python does not. Python's `upper()` differs from JavaScript's
//   `toUpperCase()` on 55 code points (U+019B, U+0264, U+1C8A, U+A7CD..U+A7DB, the
//   U+10D70..U+10D85 Garay block and U+16EBB..U+16ED3). A raw value containing any of
//   them is refused as ambiguous.

import "server-only";

import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { MAX_POSITIONS, normalizeStatus, rowToPosition, type Position } from "@/lib/portfolio";
import { isPortfolioBrief, type BriefPopulation, type PortfolioBrief } from "@/lib/portfolioBrief";

// ── the wire contract ─────────────────────────────────────────────────────────

/** The opt-in header. Its presence selects a RESPONSE CONTRACT; it grants no authority. */
export const SNAPSHOT_CONTEXT_HEADER = "X-Mastermind-Portfolio-Context";
/** The only supported contract version. */
export const SNAPSHOT_CONTEXT_VERSION = "snapshot-v1";
/** The witness schema this consumer understands. */
export const WITNESS_SCHEMA = "portfolio_snapshot_witness.v1";
/**
 * The producer's hard cap on ONE snapshot read. A book larger than this cannot be read
 * completely, so it is refused — never paged, never partially witnessed.
 */
export const PRODUCER_MAX_ROWS = 1000;

/** The minimal context the browser may see. Nothing else crosses this boundary. */
export type SnapshotContext = {
  version: string;
  owner: string;
  bookKey: string;
  population: "positions";
};

/** The count domains proved by the witness, kept separate exactly as the plan states. */
export type SnapshotCounts = {
  /** Raw captured rows — open AND closed — before any normalization. */
  rawRows: number;
  /** Raw rows the canonical status rule classifies as open. */
  openCount: number;
  /** Open rows that are also positionable: the lots the composer was called with. */
  selectedCount: number;
  /** Unique normalized ticker names — the brief's `book.n` / `population.n`. */
  names: number;
  /** Canonical open position records (lots) — what the page renders. */
  positions: number;
};

export type SnapshotReason =
  | "witness_missing"
  | "witness_shape"
  | "witness_schema"
  | "owner_mismatch"
  | "population_mismatch"
  | "composer_source_mismatch"
  | "completeness_invalid"
  | "count_mismatch"
  | "range_invalid"
  | "over_limit"
  | "duplicate_ids"
  | "selected_mismatch"
  | "composer_input_mismatch"
  | "row_incompatible"
  | "brief_invalid"
  | "population_count_mismatch";

export type SnapshotDecode =
  | { ok: true; brief: PortfolioBrief; context: SnapshotContext; counts: SnapshotCounts }
  | { ok: false; reason: SnapshotReason };

// ── the two readers ───────────────────────────────────────────────────────────

/** Python's `str.isspace()` set — the characters `str.strip()` removes. */
const PY_WHITESPACE =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u001c\u001d\u001e\u001f\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";
/** ECMAScript's WhiteSpace + LineTerminator set — the characters `String.prototype.trim()` removes. */
const JS_WHITESPACE =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

/**
 * The code points where Python's `str.upper()` and JavaScript's
 * `String.prototype.toUpperCase()` produce DIFFERENT strings — the enumeration of every
 * Unicode code point compared between the two. A raw value containing one of them has no
 * single reading, so it is refused rather than resolved in either language's favour.
 *
 * An explicit set, not a character class: the set states exactly which code points are
 * divergent, its size is assertable (55), and it cannot be re-interpreted by a
 * transform that lowers a regular expression's syntax.
 */
const UPPER_DIVERGENT_CODEPOINTS: ReadonlySet<number> = new Set([
  0x019b, 0x0264, 0x1c8a, 0xa7cd, 0xa7cf, 0xa7d3, 0xa7d5, 0xa7db,
  ...codePointRange(0x10d70, 0x10d85),
  ...codePointRange(0x16ebb, 0x16ed3),
]);

/** The code points from `first` to `last`, inclusive. */
function codePointRange(first: number, last: number): number[] {
  const out: number[] = [];
  for (let cp = first; cp <= last; cp += 1) out.push(cp);
  return out;
}

/** True when any character of the text is one of the divergent code points. */
function hasUpperDivergent(text: string): boolean {
  for (const character of text) {
    if (UPPER_DIVERGENT_CODEPOINTS.has(character.codePointAt(0)!)) return true;
  }
  return false;
}

/**
 * Python's `float()` literal grammar: decimal digits (Unicode Nd, as CPython's `\d` is
 * Unicode-aware) with PEP 515 underscores between digits, an optional fraction and an
 * optional exponent.
 */
const PY_FLOAT_LITERAL =
  /^[+-]?(?:(?:\p{Nd}(?:_?\p{Nd})*)(?:\.(?:\p{Nd}(?:_?\p{Nd})*)?)?|\.(?:\p{Nd}(?:_?\p{Nd})*))(?:[eE][+-]?\p{Nd}(?:_?\p{Nd})*)?$/u;
/** Python's `float()` also accepts these words, case-insensitively, with a sign. */
const PY_INF_NAN = /^[+-]?(?:inf|infinity|nan)$/i;
/**
 * The literal forms JavaScript's `Number()` accepts AND Python's `float()` accepts with
 * the same value: plain ASCII decimals. Both readers round a decimal literal to the
 * nearest IEEE-754 double, so their values are identical.
 */
const SHARED_DECIMAL_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const finiteInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/** Strip with Python's whitespace set. */
function pythonStrip(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && PY_WHITESPACE.includes(text[start])) start += 1;
  while (end > start && PY_WHITESPACE.includes(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

/** Strip with JavaScript's whitespace set. */
function javascriptTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && JS_WHITESPACE.includes(text[start])) start += 1;
  while (end > start && JS_WHITESPACE.includes(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

/**
 * The composer's reading of one raw ticker field: `str(raw or "").strip().upper()`.
 *
 * `unsupported` means the two readers cannot be shown to agree — the raw text strips
 * differently in the two languages, or it upper-cases differently. That is refused; it is
 * never resolved in favour of one language.
 */
export type TickerReading =
  | { kind: "name"; name: string }
  | { kind: "none" }
  | { kind: "unsupported" };

export function composerTickerReading(raw: unknown): TickerReading {
  if (typeof raw !== "string") {
    // Python's `raw or ""` turns every FALSY value into the empty string: None, "", 0,
    // False and NaN. A truthy non-string keeps a name the Terminal cannot see.
    if (!raw) return { kind: "none" };
    return { kind: "name", name: String(raw) };
  }
  const py = pythonStrip(raw);
  const js = javascriptTrim(raw);
  if (py !== js) return { kind: "unsupported" };
  if (hasUpperDivergent(py)) return { kind: "unsupported" };
  const name = py.toUpperCase();
  return name ? { kind: "name", name } : { kind: "none" };
}

/**
 * The composer's reading of one raw numeric field: `float(value) if value is not None
 * else None`, with the frozen composer's `except (TypeError, ValueError)` turning an
 * unparseable value into None.
 */
export type NumericReading =
  | { kind: "value"; value: number }
  | { kind: "none" }
  | { kind: "nonfinite" }
  | { kind: "unsupported" };

export function composerNumericReading(raw: unknown): NumericReading {
  if (raw === null || raw === undefined) return { kind: "none" };
  if (typeof raw === "boolean") {
    // Python's `float(True)` is 1.0 and `float(False)` is 0.0. JavaScript's Number()
    // refuses a boolean outright, so the two readers disagree about this row.
    return { kind: "value", value: raw ? 1 : 0 };
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { kind: "value", value: raw } : { kind: "nonfinite" };
  }
  if (typeof raw !== "string") return { kind: "unsupported" };
  const py = pythonStrip(raw);
  const js = javascriptTrim(raw);
  if (py !== js) return { kind: "unsupported" };
  if (js === "") return { kind: "none" };
  if (SHARED_DECIMAL_LITERAL.test(js)) {
    const value = Number(js);
    return Number.isFinite(value) ? { kind: "value", value } : { kind: "nonfinite" };
  }
  if (PY_INF_NAN.test(js)) return { kind: "nonfinite" };
  if (PY_FLOAT_LITERAL.test(js)) {
    // Python parses it (Unicode digits, PEP 515 underscores); JavaScript does not.
    return { kind: "value", value: Number.NaN };
  }
  return { kind: "none" };
}

/**
 * Compare one raw numeric field across the two readers.
 *
 * The Terminal's reading is the unchanged `normalizeNumeric` result collapsed the way
 * `rowToPosition` collapses it (anything that is not a `value` becomes null). The
 * composer's reading is modelled above. They must be the SAME value — including both
 * being absent — or the row is refused.
 */
export function compareNumericField(
  raw: unknown,
  terminal: number | null,
): { ok: true } | { ok: false; reason: "numeric_mismatch" | "numeric_unsupported" } {
  const reading = composerNumericReading(raw);
  if (reading.kind === "unsupported") return { ok: false, reason: "numeric_unsupported" };
  if (reading.kind === "nonfinite") return { ok: false, reason: "numeric_mismatch" };
  if (reading.kind === "value") {
    if (!Number.isNaN(reading.value)) {
      // Python read a finite number. The Terminal must read the SAME number.
      if (terminal === null || terminal !== reading.value) {
        return { ok: false, reason: "numeric_mismatch" };
      }
      return { ok: true };
    }
    // Python parsed it into a number JavaScript cannot represent (Unicode digits,
    // underscores). The Terminal read nothing, so the two readers disagree.
    return { ok: false, reason: "numeric_mismatch" };
  }
  // The composer read nothing. The Terminal must read nothing either.
  if (terminal !== null) return { ok: false, reason: "numeric_mismatch" };
  return { ok: true };
}

/**
 * The compatibility gate for ONE raw row.
 *
 * The Terminal's side is the unchanged `rowToPosition`. The composer's side is modelled
 * from the frozen `engine/portfolio_brief.py::_normalize_holdings`. The row is compatible
 * only when both readers describe the SAME holding from it.
 */
export function checkRowCompatible(
  row: Record<string, unknown>,
): { ok: true; position: Position | null } | { ok: false; reason: SnapshotReason } {
  return compareRow(row, rowToPosition(row));
}

/** The gate, with the Terminal's projection already computed. */
function compareRow(
  row: Record<string, unknown>,
  position: Position | null,
): { ok: true; position: Position | null } | { ok: false; reason: SnapshotReason } {
  const name = composerTickerReading(row.ticker);
  if (name.kind === "unsupported") return { ok: false, reason: "row_incompatible" };
  const composerName = name.kind === "name" ? name.name : "";
  if (!position) {
    // Terminal drops the row (no usable id or ticker). The composer must not claim a
    // name for it, or the two surfaces describe different books from one row.
    if (composerName) return { ok: false, reason: "row_incompatible" };
    return { ok: true, position: null };
  }
  if (composerName !== position.ticker) return { ok: false, reason: "row_incompatible" };
  const shares = compareNumericField(row.shares, position.shares);
  if (!shares.ok) return { ok: false, reason: "row_incompatible" };
  const price = compareNumericField(row.entry_price, position.entryPrice);
  if (!price.ok) return { ok: false, reason: "row_incompatible" };
  return { ok: true, position };
}

// ── the witness ───────────────────────────────────────────────────────────────

/** One raw captured `portfolio_positions` row, exactly as the producer carried it. */
type RawRow = Record<string, unknown>;

/** The public brief plus the population block the bound contract requires. */
type BoundBrief = PortfolioBrief & { population: BriefPopulation };

const refuse = (reason: SnapshotReason): { ok: false; reason: SnapshotReason } => ({ ok: false, reason });

/**
 * Rebuild the PUBLIC brief from the validated upstream object.
 *
 * A whitelist, not a deletion: the upstream body is untrusted, so only the fields this
 * contract defines are copied out, and the result is a fresh object. The witness itself
 * is never copied — it does not exist on this side of the boundary.
 */
function reconstructBrief(brief: PortfolioBrief & { population: BriefPopulation }): BoundBrief {
  return {
    schema: brief.schema,
    asof: brief.asof,
    generated_at: brief.generated_at,
    stale: brief.stale,
    weighting: {
      mode: brief.weighting.mode,
      label_en: brief.weighting.label_en,
      label_zh: brief.weighting.label_zh,
    },
    book: {
      n: brief.book.n,
      covered: brief.book.covered,
      uncovered: [...brief.book.uncovered],
    },
    population: {
      mode: brief.population.mode,
      label_en: brief.population.label_en,
      label_zh: brief.population.label_zh,
      n: brief.population.n,
      disclosure_en: brief.population.disclosure_en,
      disclosure_zh: brief.population.disclosure_zh,
    },
    headline: { en: brief.headline.en, zh: brief.headline.zh },
    sections: brief.sections.map((section) => ({
      key: section.key,
      title_en: section.title_en,
      title_zh: section.title_zh,
      lines: section.lines.map((line) => ({ en: line.en, zh: line.zh })),
    })),
  };
}

/**
 * Decode, prove and bind the snapshot witness.
 *
 * `owner` is the SERVER-VERIFIED authenticated user id. The witness's `owner_id` must
 * equal it exactly: the producer falls back to the session EMAIL when it has no session
 * id, and an email is never resolved, rewritten or stamped with the uuid.
 */
export function decodeSnapshotBrief(body: unknown, owner: string): SnapshotDecode {
  if (!isRecord(body)) return refuse("witness_shape");
  const witness = body.portfolio_context;
  if (witness === undefined || witness === null) return refuse("witness_missing");
  if (!isRecord(witness)) return refuse("witness_shape");
  if (witness.schema !== WITNESS_SCHEMA) return refuse("witness_schema");

  // ── owner ──
  if (typeof witness.owner_id !== "string" || !witness.owner_id) return refuse("witness_shape");
  if (!owner || witness.owner_id !== owner) return refuse("owner_mismatch");

  // ── population ──
  if (witness.population !== "positions") return refuse("population_mismatch");
  if (witness.composer_input_source !== "positions") return refuse("composer_source_mismatch");

  // ── the raw capture ──
  if (!Array.isArray(witness.rows)) return refuse("witness_shape");
  const rows = witness.rows as RawRow[];
  if (rows.length > PRODUCER_MAX_ROWS || rows.length > MAX_POSITIONS) return refuse("over_limit");
  for (const row of rows) if (!isRecord(row)) return refuse("witness_shape");

  // ── completeness: the count and range are proved BEFORE normalization ──
  //
  // `rowToPosition` drops unusable rows, so a per-row count can never stand in for the
  // raw row count: a truncated capture that dropped rows would still normalize to the
  // same number of positions. The raw count and range are checked against the RAW rows.
  const completeness = witness.completeness;
  if (!isRecord(completeness)) return refuse("completeness_invalid");
  if (completeness.source !== "portfolio_positions") return refuse("completeness_invalid");
  if (completeness.complete !== true) return refuse("completeness_invalid");
  if (completeness.max_rows !== PRODUCER_MAX_ROWS) return refuse("completeness_invalid");
  if (completeness.positions_reads !== 1) return refuse("completeness_invalid");
  if (completeness.watchlist !== null) return refuse("completeness_invalid");
  if (!finiteInteger(completeness.exact_count)) return refuse("completeness_invalid");
  if (!finiteInteger(completeness.returned_count)) return refuse("completeness_invalid");
  if (!finiteInteger(completeness.open_count)) return refuse("completeness_invalid");
  if (!finiteInteger(completeness.selected_count)) return refuse("completeness_invalid");
  if (completeness.exact_count !== rows.length) return refuse("count_mismatch");
  if (completeness.returned_count !== rows.length) return refuse("count_mismatch");
  if (rows.length === 0) {
    // An empty capture states null range endpoints, never a fabricated range.
    if (completeness.range_first !== null || completeness.range_last !== null) {
      return refuse("range_invalid");
    }
  } else {
    if (completeness.range_first !== 0) return refuse("range_invalid");
    if (completeness.range_last !== rows.length - 1) return refuse("range_invalid");
  }

  // ── unique ids ──
  const seenIds = new Set<string>();
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== "string" || !id) continue; // a row with no usable id is dropped by both readers
    if (seenIds.has(id)) return refuse("duplicate_ids");
    seenIds.add(id);
  }

  // ── the canonical projection of the captured rows ──
  //
  // `rowToPosition` and `portfolioBookKey` are the OWNERS and are used unchanged. This
  // module never re-implements them and never repairs a value to make them agree.
  const positions: Position[] = [];
  const selectedRows: RawRow[] = [];
  const selectedPositions: Position[] = [];
  let openCount = 0;
  for (const row of rows) {
    const status = normalizeStatus(row.status);
    if (status === "open") openCount += 1;
    const position = rowToPosition(row);
    // The compatibility gate covers the OPEN rows — the rows the composer is called
    // with. A closed row never reaches the composer, so the two readers cannot
    // disagree ABOUT THE BRIEF about it; it is carried verbatim and enters the book key
    // through the unchanged `rowToPosition`, exactly as the Terminal's own canonical read
    // reads it. Gating closed rows as well would refuse witnesses the producer is
    // entitled to emit.
    if (status === "open") {
      const gate = compareRow(row, position);
      if (!gate.ok) return refuse(gate.reason);
    }
    if (!position) continue; // dropped by BOTH readers — no holding, no name
    positions.push(position);
    if (status === "open") {
      selectedRows.push(row);
      selectedPositions.push(position);
    }
  }
  if (openCount !== completeness.open_count) return refuse("completeness_invalid");
  if (selectedPositions.length !== completeness.selected_count) return refuse("completeness_invalid");

  // ── the witnessed selection ──
  if (!Array.isArray(witness.selected_position_ids)) return refuse("witness_shape");
  const witnessedIds = witness.selected_position_ids;
  const selectedIds = selectedPositions.map((position) => position.id);
  if (witnessedIds.length !== selectedIds.length) return refuse("selected_mismatch");
  for (let i = 0; i < selectedIds.length; i += 1) {
    if (witnessedIds[i] !== selectedIds[i]) return refuse("selected_mismatch");
  }

  // ── the witnessed composer inputs ──
  //
  // The producer hands the composer the RAW `ticker`/`shares`/`entry_price` of exactly
  // the selected rows, in the order it selected them, and it builds that list and
  // `selected_position_ids` from the same one — so the pairing is established by the
  // producer's own source. It is checked BOTH ways: index-for-index, and as a multiset,
  // so a reordered or substituted input cannot pass.
  if (!Array.isArray(witness.composer_inputs)) return refuse("witness_shape");
  const composerInputs = witness.composer_inputs;
  if (composerInputs.length !== selectedRows.length) return refuse("composer_input_mismatch");
  const projected: string[] = [];
  for (let i = 0; i < selectedRows.length; i += 1) {
    const input = composerInputs[i];
    if (!isRecord(input)) return refuse("composer_input_mismatch");
    const row = selectedRows[i];
    if (!sameJsonValue(input.ticker, row.ticker)) return refuse("composer_input_mismatch");
    if (!sameJsonValue(input.shares, row.shares)) return refuse("composer_input_mismatch");
    if (!sameJsonValue(input.entry_price, row.entry_price)) return refuse("composer_input_mismatch");
    projected.push(canonicalComposerInput(input));
  }
  const observed = composerInputs.map((input) =>
    canonicalComposerInput(isRecord(input) ? input : {}),
  );
  if (canonicalSorted(projected).join(" ") !== canonicalSorted(observed).join(" ")) {
    return refuse("composer_input_mismatch");
  }

  // ── the canonical book identity ──
  //
  // The book key covers the WHOLE captured book (open and closed), exactly as the
  // Terminal's own `/api/portfolio?view=positions` read computes it — so the browser can
  // compare the two without either side supplying a key.
  const bookKey = portfolioBookKey(positions);

  // ── the brief's own population ──
  //
  // All three declarations must agree: the witness's population, the composer's input
  // source, and the brief's own population block. The brief's name count is the number
  // of UNIQUE normalized tickers the composer used — which is NOT the number of lots.
  if (!isPortfolioBrief(body)) return refuse("brief_invalid");
  const brief = body as PortfolioBrief;
  if (brief.schema !== "portfolio_brief.v2") return refuse("brief_invalid");
  if (!isRecord(brief.population)) return refuse("brief_invalid");
  const population = brief.population as BriefPopulation;
  if (population.mode !== "positions") return refuse("population_mismatch");
  const uniqueNames = new Set(selectedPositions.map((position) => position.ticker));
  if (uniqueNames.size !== population.n) return refuse("population_count_mismatch");
  if (uniqueNames.size !== brief.book.n) return refuse("population_count_mismatch");

  const context: SnapshotContext = {
    version: SNAPSHOT_CONTEXT_VERSION,
    owner,
    bookKey,
    population: "positions",
  };
  return {
    ok: true,
    brief: reconstructBrief(brief as PortfolioBrief & { population: BriefPopulation }),
    context,
    counts: {
      rawRows: rows.length,
      openCount,
      selectedCount: selectedIds.length,
      names: uniqueNames.size,
      positions: selectedIds.length,
    },
  };
}

/** Two JSON values are the same when they are the same primitive, or equal numbers. */
function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  return false;
}

/** A stable textual form of one composer input, for the multiset comparison. */
function canonicalComposerInput(input: Record<string, unknown>): string {
  return JSON.stringify([
    input.ticker === undefined ? null : input.ticker,
    input.shares === undefined ? null : input.shares,
    input.entry_price === undefined ? null : input.entry_price,
  ]);
}

function canonicalSorted(values: string[]): string[] {
  return [...values].sort();
}
