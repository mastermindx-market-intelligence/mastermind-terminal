# Portfolio brief canonical-context consumer — verification

Owner: Sol / WS:MARKET-OS. Date: 2026-11-02.
Application base: `ff7d28228aa13e9ee9dc6248bba685c678f1edcc` (Terminal1212).
Branch: `sol/web-portfolio-brief-context-20261102`.
Design of record: `terminal/docs/verification/portfolio-brief-context-20261102/PLAN.md`.
Producer candidate under review: macro `68adf1cf47af278efc09fa0692d4066d2182f697`
(tree `d1c28ff10d252777260c6b7669fe6d3dd7aa4c50`) — **not accepted**; this consumer is
implemented and proved against an exact candidate, and its acceptance remains a release
dependency.

This directory records WHAT WAS PROVED, HOW, and WHAT WAS FOUND. It does not claim
acceptance: the producer is not accepted, the branch is a Draft, and the parent retains
independent review, custody, release and deploy.

---

## 1. What was built

The Portfolio page now renders the desk's brief only for the canonical book it is showing.

| Path | Change |
| --- | --- |
| `terminal/app/api/portfolio-brief/route.ts` | The bound branch: the opt-in is forwarded, the answer is REBUILT, the witness never crosses |
| `terminal/lib/portfolioBriefContext.server.ts` | **NEW** — the witness decoder, the compatibility gate, the canonical book binding |
| `terminal/lib/portfolioBrief.ts` | Additive: the public context type, the binding type, the strict population disclosure |
| `terminal/components/PortfolioView.tsx` | The canonical-read binding lifecycle and the panel props |
| `terminal/components/PortfolioBriefPanel.tsx` | The bound request, the committed request lifetime, the strict render |
| `terminal/lib/__tests__/portfolioBriefContext.test.ts` | **NEW** — the shared cross-language fixture, the adversarial rows, every refusal path |
| `terminal/lib/__tests__/portfolioBriefSnapshotLifecycle.test.tsx` | **NEW** — the binding lifecycle on the real mounted PortfolioView |
| `terminal/lib/__tests__/portfolioBriefProxy.test.ts` | The bound contract of the exported proxy |
| `terminal/lib/__tests__/portfolioBriefPanelRetry.test.tsx` | The panel's bound request, entitlement and lifetime |
| `terminal/lib/__tests__/fixtures/portfolio-brief-context/**` | **NEW** — the shared synthetic producer fixtures (a byte-identical copy of the producer's, plus the Terminal's own adversaries) |
| `terminal/e2e/portfolio-brief-context.spec.ts` | **NEW** — the browser proof |
| `terminal/docs/verification/portfolio-brief-context-20261102/**` | This directory |

Frozen and untouched: `lib/portfolio.ts`, `lib/portfolioSnapshot.server.ts`, the portfolio
routes and mutations, `components/EventImpactPanel.tsx`,
`components/workspaces/TodaySinceLastVisit.tsx`, the shared shell and style owners, the
auth/DDL/dependency surface, and every foreign lane's paths.

---

## 2. The count domains, kept apart

| Domain | Where it is proved | Meaning |
| --- | --- | --- |
| raw rows | `decodeSnapshotBrief` → `counts.rawRows` | Every captured row, open and closed, BEFORE normalization |
| open rows | `counts.openCount` | Raw rows the canonical status rule classifies open |
| selected lots | `counts.selectedCount` | Open rows that are also positionable — the composer's inputs |
| names | `counts.names`, `brief.book.n`, `brief.population.n` | Unique normalized ticker names |
| page positions | `PortfolioView` → `population.count` | The canonical open position records the page renders |

The RAW count is proved against the raw rows, never against the normalized ones: a witness
whose `exact_count` named only the rows that survive `rowToPosition` is refused
(`count_mismatch`). The unit suite proves both directions
(`the raw count is proved BEFORE canonical filtering`).

Two lots in one name are the SAME book. `witness_book.json` is exactly that case — two open
NVDA lots and one closed AMD row — and the panel states the desk's one name beside the
page's two position records, without claiming they are equal.

---

## 3. The compatibility gate — and the two producer defects it exists to catch

The producer proves its witness with a PYTHON MIRROR of Terminal's normalizer. That mirror is
not authority here. This consumer compares two readings computed from the actual sources:

* the Terminal's reading — the **unchanged** `rowToPosition` (`lib/portfolio.ts`);
* the composer's reading — modelled from the **frozen**
  `engine/portfolio_brief.py::_normalize_holdings`.

A row is refused unless both readers describe the same holding. Nothing is repaired, no value
is coerced, no unit is guessed, and the canonical book key is never re-derived: it is
`portfolioBookKey` over the unchanged `rowToPosition` projection.

### 3.1 FINDING 1 — the mirror accepts Unicode digits the Terminal refuses (MATERIAL)

`app/portfolio_brief_context.py`'s `_JS_DECIMAL_LITERAL` uses `\d`, which in CPython is
**Unicode-aware**. Its `_js_number` therefore reads `"١٢"` as 12 — and its own
`terminal_numeric` mirror agrees with it, so the mirror CERTIFIES the row. JavaScript's
`Number("١٢")` is `NaN`, so the Terminal's real `rowToPosition` reads **no shares at all**.

The producer would emit a witness claiming `shares: 12` for a row the Terminal reads as
unsized. The consumer refuses it (`row_incompatible`).

*Reproduction:* `lib/__tests__/fixtures/portfolio-brief-context/adversarial_rows.json`
→ `unicode_arabic_digit_shares`, `unicode_fullwidth_digit_shares`,
`unicode_decimal_point_shares`; proved in `portfolioBriefContext.test.ts` → "refuses a
Unicode-digit share the producer's own mirror would certify".

### 3.2 FINDING 2 — the mirror parses the numeric fields independently; the composer does not (MATERIAL)

The frozen composer parses `shares` and `entry_price` inside ONE `try/except`:

```python
try:
    sh = float(shares) if shares is not None else None
    ep = float(entry) if entry is not None else None
except (TypeError, ValueError):
    sh = ep = None
```

One unparseable field nulls **BOTH**. The producer's `composer_numeric` parses them
independently, so it reports `entry_price: 100.0` for a row the composer reads as
`entry_price: None`. The shared fixture's own `composer` block carries the MIRROR's reading,
not the frozen composer's — for `non_numeric_string` it states `entry_price: 100.0` where the
frozen composer reads `None`.

**The brief's observable output is identical either way**, and this consumer proves it rather
than asserting it: the composer's cost guard needs BOTH fields to be non-null and positive, so
a row whose two readers parse a field differently contributes ZERO cost under either reading.
Name order, weights, weighting mode and `book.n` are therefore the same. The consumer
compares the fields PER FIELD — which matches the producer's own gate, so no genuine witness
is refused — and the coupling is recorded here so the parent can see that the difference is
observable in the WIRE and not in the brief.

*Reproduction:* `projection_cases.json` → `non_numeric_string`, `hex_numeric_string`,
`binary_numeric_string`, `octal_numeric_string`.

### 3.3 The reader divergences, enumerated rather than guessed

Python's `str.strip()` and JavaScript's `trim()` remove different characters, and Python's
`str.upper()` and JavaScript's `toUpperCase()` differ on 55 code points. Both sets were
derived by comparing every Unicode code point (0..0x10FFFF) between CPython 3.12 and Node
22, and both are encoded as explicit sets in `lib/portfolioBriefContext.server.ts`:

* Python strips `U+001C..U+001F` and `U+0085` that JavaScript does not; JavaScript strips
  `U+FEFF` that Python does not.
* Python's `upper()` differs from JavaScript's `toUpperCase()` on 55 code points:
  `U+019B, U+0264, U+1C8A, U+A7CD..U+A7DB`, `U+10D70..U+10D85` and `U+16EBB..U+16ED3`.

A raw value containing one of them has no single reading, so it is REFUSED — never resolved in
either language's favour. `UPPER_DIVERGENT_CODEPOINTS` holds exactly 55 entries plus the two
ranges (the suite asserts the size through the behaviour it produces).

*Reproduction:* `adversarial_rows.json` → `upper_divergent_ticker` (`U+019B`),
`strip_divergent_ticker` (`U+0085`), `bom_prefixed_ticker` (`U+FEFF`); and
`unicode_ticker_ordinary` — a non-ASCII ticker that both readers read identically is
ACCEPTED.

### 3.4 The gate covers the OPEN rows, exactly as the producer's does

A closed row never reaches the composer, so the two readers cannot disagree about the BRIEF
about it. The consumer therefore gates the open rows only, and lets a closed row into the
book key through the unchanged `rowToPosition` — the same reading the Terminal's own
canonical read gives it. Gating closed rows as well would refuse witnesses the producer is
entitled to emit (`adversarial_rows.json` → `closed_row_is_not_gated`).

---

## 4. The shared cross-language fixture — parity recomputed, not declared

`terminal/lib/__tests__/fixtures/portfolio-brief-context/projection_cases.json` is a
**byte-identical copy** of the producer's shared fixture
(macro `68adf1cf`: `tests/fixtures/portfolio_brief_context/projection_cases.json`, git blob
`e1b5702357256ceaf0b53631379b18c98bf9c1cf`; sha256
`0dc420ae46edb02c83ce8f2dc0a82b36a4a7198a2d173bc0801537f3812d784e`).

The Terminal suite does **not** read the file's `compatible` / `reject_reason` verdicts as
authority. It recomputes both readers and then asserts that its own verdict matches the
file's:

* the Terminal's live `rowToPosition` matches the file's `terminal` block for all 64 cases
  (no drift since the producer generated it);
* the recomputed split is **46 compatible / 18 refused**, the same 18 case names.

The suite also proves the producer's own mirror's verdict is NOT the authority: the
adversarial rows in §3.1 are cases the producer would certify and the consumer refuses.

---

## 5. The proof — exact commands, counts and exits

Run from `terminal/` in the admitted isolated worktree
`/home/ubuntu0/lanes/wt/portfolio-brief-context-20261102-c2-001`.

| Command | Result |
| --- | --- |
| `npx vitest run` | **17645 passed**, 47 skipped, 4 todo, 0 failed (1036 files passed, 5 skipped) — exit 0 |
| `npx vitest run lib/__tests__/portfolioBriefContext.test.ts lib/__tests__/portfolioBriefSnapshotLifecycle.test.tsx lib/__tests__/portfolioBriefPanelRetry.test.tsx lib/__tests__/portfolioBriefProxy.test.ts` | **109 passed**, 0 failed — exit 0 |
| `npx next typegen && npx tsc --noEmit` | no output — exit 0 |
| `npx eslint <every changed file>` | **3 findings, all pre-existing and unchanged by this work**: `components/PortfolioBriefPanel.tsx` carries the same `react-hooks/set-state-in-effect` finding the base head's own panel already carried (its `void load()`), and `lib/__tests__/portfolioBriefProxy.test.ts:51` carries the base head's own two `any` annotations. This change **removed** the base head's third finding (`app/api/portfolio-brief/route.ts`'s `catch (e: any)`). **Net lint delta: −1.** |
| `npx playwright test e2e/portfolio-brief-context.spec.ts` | **9 passed** (desktop/tablet/mobile × EN/ZH, plus the context-free payload case) — exit 0 |
| `npx playwright test e2e/portfolio-brief-context.spec.ts --project=desktop` (on the BASE head `ff7d28228`) | **3 failed** — the baseline falsifier, §6 |

### The focused suites, and what each one discriminates

* `portfolioBriefContext.test.ts` (44) — the shared fixture recomputed (46/18), the Terminal's
  own projection not drifted, the sixteen adversarial rows, the whole-witness acceptance and
  EVERY refusal path (missing/unsupported witness, wrong owner, an email owner, a
  `watchlist_union` population, a wrong composer source, a truncated capture, a wrong range,
  every completeness field, over the 1000-row cap, duplicate ids, a wrong selection, wrong
  composer inputs, a wrong population count, a non-v2 brief, a malformed body), and the raw
  count proved before canonical filtering.
* `portfolioBriefSnapshotLifecycle.test.tsx` (5) — the REAL mounted `PortfolioView`: the
  binding is published from the same acceptance that sets the positions, a reread that lands
  another book retires the old facts, a late answer for the previous book cannot paint, a
  failed canonical read is unavailable rather than a perpetual checking state, a committed
  owner change retires the binding, and the deliberate retry uses the page's own canonical
  reload.
* `portfolioBriefPanelRetry.test.tsx` (29) — the opt-in is unconditional, the facts render
  only for a matching context, a payload with no context / another book / another owner is
  refused, 401 and 403 stay observable with NO canonical binding, a failed canonical read
  never becomes a false entitlement result, the retry is the page's reload and a double click
  starts one reload, and the late fetch/body/error/finally, unmount and StrictMode fences.
* `portfolioBriefProxy.test.ts` (31) — the bound branch of the EXPORTED proxy: the header is
  forwarded, the answer is rebuilt from a whitelist, the witness never crosses, 401/403 are
  classified first, an unsupported version is told locally, and every failure is one fixed
  safe body (including a thrown error and a malformed body carrying a sentinel).

---

## 6. The baseline falsifier (RED first)

The browser proof was run against the **pre-change head** `ff7d28228` in a separate worktree
(`/home/ubuntu0/lanes/wt/pbb-context-baseline-20261102-c2-001`, removed afterwards; recreate
it with `git worktree add <path> ff7d28228`). All three proofs FAIL there:

```
✘ a payload with no context is never presented as the brief
✘ en: a committed edit retires the previous brief and only the new book's brief renders
✘ zh: a committed edit retires the previous brief and only the new book's brief renders
3 failed
```

The observed pre-change behaviour, captured in this directory:

* `baseline/baseline-ff7d-context-free-brief-accepted.png` — the base renders a brief that
  names NO canonical book: "BOUND BRIEF." is presented as the current book's brief.
* `baseline/baseline-ff7d-stale-brief-still-shown.png` — after a committed edit, the base
  still shows the PREVIOUS book's brief.
* `baseline/baseline-ff7d-playwright.txt` — the full run output (sha256
  `24ef53fb15c17764229772050ca1c6859caaa8c7c2350d42f37f9739d240e754`).

---

## 7. The browser evidence

`browser/` holds 18 screenshots: `{desktop,tablet,mobile} × {en,zh} ×
{bound,unavailable,rebound}`. The Terminal is dark-only (`app/globals.css` has no
`[data-theme]` branch), so the retained theme coverage is the dark palette this bounded
change does not restyle.

| File | sha256 |
| --- | --- |
| `browser/desktop-en-bound.png` | `e5d54bf6b5f29acf7bd79540b801815956340ce9e4c4019d262a587146ec126b` |
| `browser/desktop-en-unavailable.png` | `e5b3ea8c2564ce229da2a553ec95ff93cc67482805ebae16f25ebed93af67306` |
| `browser/desktop-en-rebound.png` | `844d7105a5213074ff8feecb941fbec46ff84cedf2e9d29d3761f104abf46f55` |
| `browser/desktop-zh-bound.png` | `ff343f6cf7ae12d54c983536af71073da6d9fdeed8551c42bff7ca2aeb3eeef7` |
| `browser/desktop-zh-unavailable.png` | `74232e5d3790bc84491176b6720152a40dd7ae3707e7f70022fefc43693f23d0` |
| `browser/desktop-zh-rebound.png` | `3a158f7d950da447f9e506b6bec58564a7ee363ae46ff2542c0c99200a8a5be2` |
| `browser/mobile-en-bound.png` | `e23ca7bdb6bf79e60eede0501764571f54f0f285047e5de221e1b59195f46d3b` |
| `browser/mobile-en-unavailable.png` | `14827b528edc3356b115d594446a0dac60e82b80218b50cf45782c1a557184ab` |
| `browser/mobile-en-rebound.png` | `acf9a38d5c2b9d59a3ef1ec3dfcbce7ccff4e15fb251e544a55aef625f4c9302` |
| `browser/mobile-zh-bound.png` | `4b6533ac0007ed849413b8e1ba033a5d95794505ccddcf7da9fd49edc217bab1` |
| `browser/mobile-zh-unavailable.png` | `6f948c6c205e5e85bb9ccfddfb6bad6e0ac1562bae3659e9b21935a91c007c9e` |
| `browser/mobile-zh-rebound.png` | `b896eaaa4a5fed11dfa839180f14e8ddb15694dc4a4bfb2d1ebc94af9591a874` |
| `browser/tablet-en-bound.png` | `8fa5ea2a43a1017fd8dee449513427643db5c35f95e8f3719a7beb37aa7ddf1c` |
| `browser/tablet-en-unavailable.png` | `327a1e9ef25d9225c4688315e27dfce396057e756e0f5c79a2553180f6849475` |
| `browser/tablet-en-rebound.png` | `cec3119722b1c9b8b3ffe5b9d2ff9666ab07af176b53f08b46490fa7aeca4a70` |
| `browser/tablet-zh-bound.png` | `93a88e79f01c65081bf159a1810bbe1d52130cea574fd2b9d9ce17eb9f9cb008` |
| `browser/tablet-zh-unavailable.png` | `0e20e1d6064ac16ade38d9e050bb9200728bf21c24c13d99e334ab69a7abca55` |
| `browser/tablet-zh-rebound.png` | `a600a56210ec461824e01c41950f9b07c46bae52328a0f7e2ed58a852ec5ef3a` |

What the browser proof shows: the bound brief renders with the desk's NAME count and the
page's POSITION count side by side; a committed same-count edit (10 → 25 shares, through the
workspace's own record inspector and position modal) retires the previous brief and the panel
says the brief is unavailable rather than showing the old facts; the deliberate retry goes
through the page's own canonical reload and the brief for the NEW book renders; a payload with
no context is never presented as the brief; and the brief adds no horizontal document
overflow at any of the three viewports.

The served brief payload is a **fixture**, labelled as one in the spec's header: the producer
is not deployed on this host, so the desk endpoint cannot be reached. The witness decoder, the
compatibility gate and the canonical key are proved in the unit suites, which exercise the
real exported proxy and the real Node key.

---

## 8. Material collisions and adjudications

### 8.1 The foreign Terminal866 head — PRESERVED, NOT TOUCHED

Foreign head `60fd6d997df52d2d8331de85ab63014446e16ef9` ("qualify whole cost cohorts and
native currency receipts", unreleased) touches
**`terminal/components/PortfolioView.tsx`** — one of this change's owned paths — at the
`money`/`signed` helpers (it makes a null currency render as a dash instead of a bare
number). Its hunks are **preserved**: this change did not adopt them, did not revert them and
did not edit that region. It is a prospective collision only (the foreign head is not on
`master`), and it is reported here so the parent's composition can adjudicate it.

### 8.2 The shared owner-panels suite — a MINIMAL, INTENT-PRESERVING update (REPORTED)

`terminal/lib/__tests__/portfolioWorkspaceOwnerPanels.test.tsx` is **not** in the PLAN's owned
list, but the accepted design necessarily changes what it asserts: it served a brief payload
with NO context and asserted that the panel presents it — which is exactly the "old producer"
case the PLAN says must be an explicit unavailable state ("Old producer behavior is an
explicit unavailable state, never a silently accepted legacy payload").

The change is ONE block: the served brief payload now carries the canonical context (the
owner and the canonical book key the page is showing), so the suite keeps testing exactly what
it always tested — the OWNER-SCOPED LIFETIME of the panel — under the contract that binds a
brief to a book. Its request-count assertions (one read per mount, a live read preserved
through a same-owner seed and email refresh, two reads across an A→B→A cycle) all still hold
and still pass, which is itself evidence that the new read targeting preserves the accepted
per-mount read contract.

**The alternative — leaving the file untouched — would require the panel to accept a
context-free payload, which the PLAN forbids.** The parent should confirm this adjudication.

### 8.3 The current base — COMPOSITION QUALIFIED SEPARATELY, NOT MERGED

| Tree | Head | Content |
| --- | --- | --- |
| This branch | `7902f5bb00d889e88e258872e00ec5230343f0c1` | `ff7d28228` (Terminal1212) + the three PLAN commits + this change |
| `master` (current) | `8a56d612377af3d7fcb5099e2dd9d33de55435a7` | `ff7d28228` + Terminal1213 (the event repair), tree `e4214e2fe46a5ce9165f5acce77b91f0d43141d1` |

Terminal1213's paths (`components/EventImpactPanel.tsx`, its two suites,
`e2e/portfolio-event-refresh.spec.ts`, `docs/verification/portfolio-event-refresh-20261102/**`)
are **disjoint** from this change's owned paths, so the two compose without conflict and
neither touches the other's files. No ancestry-only update was performed: the branch still
starts at the accepted `ff7d` application base, and the integrated composition remains the
parent's.

---

## 9. Do the new tests EXECUTE in hosted CI?

**Yes — both of them, with no CI manifest change.**

* The unit suites: `.github/workflows/ci.yml`'s `terminal-unit` job runs `npm test` (=
  `vitest run`) in `terminal/`, and `terminal/vitest.config.ts` includes
  `lib/__tests__/**/*.test.ts` and `lib/__tests__/**/*.test.tsx`. The two new files
  (`lib/__tests__/portfolioBriefContext.test.ts` and
  `lib/__tests__/portfolioBriefSnapshotLifecycle.test.tsx`) are therefore **collected and
  executed** by the existing job. The two edited files are already collected.
* The browser spec: `terminal/playwright.config.ts` sets `testDir: "./e2e"` and the
  `desktop`, `tablet` and `mobile` projects carry no `testMatch`, so they collect every
  `e2e/*.spec.ts`. The new `e2e/portfolio-brief-context.spec.ts` is therefore executed by the
  existing `terminal-e2e` shard matrix (desktop 1/5…5/5, tablet 1/3…3/3, mobile 1/3…3/3).

**No CI manifest line is required, and none is proposed.** (This is the Terminal-side answer
to the macro-side question in the parallel brief: there, a NEW test file is owned but never
executed until a job's pytest command names it. Here, `vitest run` and Playwright's `testDir`
both collect by glob, so a new file executes.)

---

## 10. Known limitations, honestly

1. **The producer is not accepted.** The consumer is proved against the exact Macro10551
   candidate, but the final qualified wire remains a release dependency, and the producer's
   new suite is still not wired into hosted CI (the parent commissions that repair, outside
   this scope).
2. **The producer's two mirror defects (§3.1, §3.2) are reported, not fixed here.** The
   Macro side is the parent's to repair. Until it is repaired, a witness that carries a
   Unicode-digit share can be CERTIFIED by the producer and is REFUSED by this consumer — a
   fail-closed disagreement, not a silent acceptance.
3. **The browser proof serves a fixture brief.** The producer is not reachable from this host,
   so the desk's own witness is not exercised in a browser. The unit suites exercise the real
   exported proxy and the real Node key against the shared producer fixture.
4. **The producer's `owner_id` falls back to the session EMAIL.** The consumer refuses an
   email owner (`owner_mismatch`) and never resolves or stamps one with the uuid, so an
   email-owner producer would make every bound brief unavailable rather than mis-bind it.
5. **The compatibility gate refuses the closed rows' oddities only when they reach the
   composer.** A closed row's raw values still enter the canonical book key through the
   unchanged `rowToPosition`, exactly as the Terminal's own canonical read reads them.
6. **The `read` counter in the binding is a client-side accepted-read counter.** It is not a
   server authority: it exists so the panel can tell that a NEW canonical read was accepted.
