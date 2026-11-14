# portfolio-brief-context fixtures

Synthetic fixtures for the Terminal's canonical-context consumer of the Portfolio brief
snapshot witness (`portfolio_snapshot_witness.v1`).

**Every value here is invented.** There is no live account, no real holding, no real owner
id and no database behind any of it.

## `projection_cases.json` — the SHARED cross-language cases

A **byte-identical copy** of the producer's shared fixture
(`macro` @ `68adf1cf47af278efc09fa0692d4066d2182f697`,
`tests/fixtures/portfolio_brief_context/projection_cases.json`, git blob
`e1b5702357256ceaf0b53631379b18c98bf9c1cf`).

Its `terminal` block is the Terminal's real `rowToPosition` output and its `composer`
block is the producer's reading of the same row, so the file is a contract between two
independent authorities rather than a restatement of one implementation.

**The Terminal suite does NOT read the file's `compatible` / `reject_reason` verdicts as
authority.** It re-computes both readers itself — the Terminal's from the unchanged
`rowToPosition`, the composer's from the frozen `engine/portfolio_brief.py` semantics — and
asserts that its own verdict matches the file's. That is the point: a consumer that
trusted the file's verdict would be trusting a declared expectation instead of the
functions, and the file's `composer` block is the producer's MIRROR reading, not the
frozen composer's (see the divergence note below).

## `adversarial_rows.json` — the Terminal's own adversaries

Rows that go beyond the shared file:

* the reader divergences the producer's Python mirror gets wrong (Unicode decimal digits,
  which the mirror's `\d` accepts and JavaScript's `Number()` refuses);
* the Unicode code points where Python's `str.strip()` / `str.upper()` and JavaScript's
  `trim()` / `toUpperCase()` disagree;
* the cases that must still be ACCEPTED because they are harmless (Unicode notes, a
  non-ASCII ticker, a verbatim currency receipt, a closed row — which never reaches the
  composer and is therefore not gated).

## `witness_book.json` / `witness_empty.json` — whole bound responses

A complete upstream body (the public brief plus the private witness) as the producer
would send it. `witness_book.json` is deliberately a TWO-LOT / ONE-NAME book: the brief's
`book.n` and `population.n` count unique NAMES (1), while the page renders two open
POSITION records. That difference is legal, and the strict panel labels both counts
instead of calling the book different.

The owner id is a synthetic UUID; the producer's own documentation example uses
`u-example`, which is a NEGATIVE case — an email-shaped owner never qualifies.

## The divergence this consumer exists to catch

The producer computes its witness with a Python mirror of Terminal's normalizer. Two
shortcuts in that mirror disagree with the real readers:

1. **Unicode digits.** The mirror's `_JS_DECIMAL_LITERAL` uses `\d`, which in Python is
   Unicode-aware, so it reads `"١٢"` as 12 — and JavaScript's `Number("١٢")` is `NaN`.
   The mirror therefore certifies a row the Terminal reads as having no shares.
2. **Coupled numeric parsing.** The frozen composer parses `shares` and `entry_price`
   inside ONE `try/except`, so one unparseable field nulls BOTH; the mirror parses them
   independently. The brief's observable output is the same either way (the cost guard
   needs both fields), but the two readings of a single field are not.

This consumer uses the unchanged Node `rowToPosition` as the Terminal's authority and
models the composer from the frozen source, refusing any row the two readers do not
describe identically. It never repairs a value and never trusts a mirror.
