# Terminal plain-language guard

Packet `B-PL-5` (wave B4). Owns
`terminal/scripts/check_plain_language.mjs`,
`terminal/lib/__tests__/plainLanguageGuard.test.ts`, and this doc.
Packet `B-PLAT-B5-1` added the CI wiring (§14) and
`terminal/lib/__tests__/plainLanguageGuardCi.test.ts`.

## 1. What law this enforces

The Chairman frontend plain-language directive (2026-09-06) and the standing
Macro `CLAUDE.md` § Design banned-vocabulary rule: internal state/study names,
untranslated raw statistics, and raw slugs must never reach the screen. This
guard is the Terminal-side enforcement mechanism for that rule, mirroring the
macro-side `scripts/check_design_system.py`.

## 2. Blocking vs reporting (forward-only)

Every run is a **full census**: every `.tsx` file under `terminal/app`,
`terminal/components`, and `terminal/lib/i18n.tsx` is opened and scanned,
whether or not the current diff touches it — the diff is consulted only to
decide which *lines* count as added, never which *files* get opened. The
guard only **blocks** on a finding whose line was added by the current diff
against `origin/master` (or the diff supplied via `--diff-file`). Any other
finding — including one in a file the diff never touches at all — is still
surfaced, under the header `legacy (pre-existing, not blocking)`, but never
fails the run. This mirrors the macro precedent's `--mode enforce-added`: an
untouched legacy file can never turn a PR red just because the checker
learned a new rule, but its pre-existing violation is still visible in the
report. `--mode report` always exits 0 and prints the same full census
regardless of diff status.

## 3. Vocabulary

`PLAIN_VOCABULARY` at the top of `check_plain_language.mjs` is the single
declared source: `stateEnums` (token → `[en, zh]` phrase pairs), `studySlugs`,
`slugFields`, `statTokens`, `plainHelpers`, and `allowTokens`. Extend it there.

**Optional overlay:** if `terminal/lib/plainLabels.ts` exists in the scanned
tree, the guard reads it as text (never imports it — it is TypeScript and, as
of this writing, lives only on open PR #519, unmerged) and harvests
additional label keys/helper names into the working vocabulary; those
harvested names are then actually threaded into every "is this line already
routed through a plain-language helper" check (R3/R4/R5b), not merely counted
in the JSON `overlayTerms` field. If absent — the current state of this
tree, since #519 is unmerged — the guard prints a disclosed null (`vocabulary
overlay ABSENT: ...`) and every check runs on `PLAIN_VOCABULARY` alone, which
is a fresh, hardcoded, 74-term literal declared in this file rather than a
reuse of #519's vocabulary. "Reuse #519's vocabulary" is therefore a
forward-compatible design, not a completed integration: it activates
automatically the moment #519 merges, with no code change to this guard, but
does not hold today.

Note also that `hasPlainHelperOnLine` matches whole call names
(`\bregimeLabel\(`, `\bt\(`, …), never a bare substring — a substring match on
`"t("` would also match `.sort(`, `.at(`, `useEffect(`, `format(`, defeating
the "already routed" check on any line that happens to contain one of those.

### 3a. `isUserVisiblePosition` is AST-based, not a substring heuristic

Per the binding review ruling on this PR's round 1, "user-visible position"
is decided by parsing every scanned `.tsx` file with the repo's existing
`typescript` devDependency (`ts.createSourceFile`, zero new npm dependency)
and walking the AST. A position counts as visible **only** when it is one of:

- a `JsxText` node (non-whitespace) — plain text between JSX tags;
- a string literal that is a direct JSX child via `{"..."}` (its parent is a
  `JsxExpression` whose own parent is a `JsxElement`/`JsxFragment` — never an
  argument buried inside a call, so `t("marketCalm")`'s `"marketCalm"` key is
  correctly excluded: it is a lookup key, not the rendered text);
- a string literal that is the value of a `title` / `aria-label` /
  `placeholder` / `alt` JSX attribute, in either form (`alt="..."` or
  `alt={"..."}`);
- any string literal **value** (never a property key, never an import/
  export module specifier) inside a bilingual copy dictionary — either a
  path matching `lib/**/*copy*.ts(x)` (the whole file is the region) or a
  top-level exported declaration whose name ends in `_COPY` (only that
  declaration's own initializer is the region, not the rest of the file);
  see §9 round 3 for the fix that scoped this from "every string literal in
  the file" down to this.

Everything else the AST walk touches — a bare identifier used as a
style/prop value (`style={{ color: LEGEND_ITEM }}`), an arrow function or a
`<=`/`>=` comparison in ordinary code, a string literal passed as a
translation *key* rather than rendered as text — produces no span and can
never be treated as visible. **R1 (`raw_state_enum`) is token-precise**: it
scans only the text *inside* these AST-derived spans, never a whole raw
line, so an UPPER_SNAKE identifier used as code on the same physical line as
real JSX text can no longer be mistaken for the visible text itself. This
replaced the prior `>[^<>]*<` substring check, which matched `=>`/`<=`
operators and any bare identifier sharing a line with markup — measured on
the real terminal tree (`node terminal/scripts/check_plain_language.mjs
--root . --diff-file empty.patch --json`, repo root as `--root`): the prior
heuristic produced 435 `raw_state_enum` findings tree-wide, almost all of
them style/prop identifiers (`LEGEND_ITEM`, `TH_STYLE`, `PAD_L`, `CALL_COLOR`,
…), never a declared state enum in a genuinely visible position; the
AST-based rewrite produces **0** `raw_state_enum` findings on the same tree
(no genuine visible-position state-enum usage exists there today — see
`terminal/lib/__tests__/plainLanguageGuard.test.ts` tests 11/12 for the
regression fixtures: false positives on `=>`/`<=`/an enum comparison in
code no longer fire, and a true JsxText positive still does).

R2 (`internal_study_slug`), R4 (`untranslated_stat_token`), and R5b
(`missing_zh` on a bare English literal) are span-precise like R1 (see §11):
each iterates only the narrow `textSpans` subset and tests each span's own
sliced text, never a whole raw line. R3 (`raw_slug_interpolation`) is the one
rule whose target — a bare property-access interpolation like `{row.regime}`
— is never itself string-literal text, so it cannot be made span-precise the
same way; per §12 it instead requires the specific `{...field}` match's OWN
character range to be CONTAINED in a span (necessarily a `kind: "expr"`
span), never a whole-line visibility test.

## 4. CLI, exit codes, JSON contract

```
node terminal/scripts/check_plain_language.mjs                 # default: enforce-added vs origin/master
node terminal/scripts/check_plain_language.mjs --mode report   # full census, always exit 0
node terminal/scripts/check_plain_language.mjs --self-check    # prove each rule detects its own violation
node terminal/scripts/check_plain_language.mjs --json          # machine contract
```

| code | meaning |
|---|---|
| 0 | no blocking findings, or a disclosed fail-open (base ref unresolvable / no diff) |
| 1 | ≥1 blocking finding on a line the diff added |
| 2 | infrastructure fault: `--diff-file` supplied but unreadable, `--root` unreadable, or `--self-check` found a rule that no longer detects its own violation (fails CLOSED, loud `::error`) |

`--json` prints `{version, mode, base, baseResolved, vocabulary, scannedFiles,
findings[], legacy[], counts, nulls[]}`. Keys are the contract; additive
changes only. `findings[]` carries only entries that count for the CURRENT
run — blocking + explicitly waived; `legacy[]` is the separate bucket for
pre-existing, non-blocking defects, which never counts toward `counts.blocking`
and must never be read as something this diff introduced (see §12). Each
finding (in either array) carries `path`, `line`, `rule`, `token`, `blocking`,
`waived`, `waiverReason`, `detail`, and a `suggestion` — never a bare boolean
— and is deduplicated at the `(path, line, rule, token)` key, so a token
repeated multiple times inside one visible span produces one finding, not
one per occurrence.

## 5. Waiver

A trailing `// plain-language-ok: <reason>` clears a finding's `blocking`
status **only when `<reason>` is non-empty**. The finding is still emitted
with `waived: true` and its `waiverReason` populated — a waiver is visible in
the report, never silent, so a reviewer can read and question it.

## 6. Running it

**Locally**, from the repo root: `node terminal/scripts/check_plain_language.mjs`.

**In CI**: the guard runs twice in the `terminal-unit` job of
`.github/workflows/ci.yml` — a self-check, then a forward-only enforce run
against the pull request's base. Both are described in §14. That job is what
the required "Terminal typecheck + tests" check aggregates, so a blocking
finding turns the required check red.

Two suites ride along on the same job's `npm test` step, because
`terminal/vitest.config.ts` includes `lib/__tests__/**/*.test.ts`:
`terminal/lib/__tests__/plainLanguageGuard.test.ts` (the rules) and
`terminal/lib/__tests__/plainLanguageGuardCi.test.ts` (the wiring in §14).
Both spawn the checker against in-memory fixtures; neither reads real git
history.

## 7. `--self-check`

`--self-check` feeds one fixture line per rule (R1–R5b) through the guard's
real `scanLines()` — the identical function `scanFile()` calls against real
files — with that line marked as added, and reports `<rule> detected` only
when the rule's own logic produced a matching blocking finding against it.
It is a real invocation of the production code path, not a re-typed proxy
regex, so it can only pass by the rule actually firing.

Since packet `B-PLAT-B5-1` it is a gate rather than a printout: if any rule
comes back `NOT detected`, the run prints a `::error` naming the dead rules
and exits 2. A self-check that always exited 0 could not protect anything —
the CI step would have stayed green with every rule dead, and the enforce run
straight after it would have reported a clean tree for a pull request full of
violations. Exit 2 (not 1) is deliberate: a dead rule is a fault in the guard,
not a finding about the diff.

## 8. Known gaps (printed, not hidden)

- **Visibility detection is AST-based (§3a); the token/slug matching layered
  on top of it is still regex.** `isUserVisiblePosition` — and R1's
  token-precise span scan — use the real TS AST (`ts.createSourceFile`), so
  the `=>`/`<=`/bare-identifier false-positive class measured in review
  round 1 is fixed. What is still regex: R2/R4/R5b's own token/slug matching
  runs `RegExp.test` over the raw line text once that line is judged
  visible, and a multi-line `JsxText` node or a line-spanning template
  literal is a false negative for the line-based rules (R1 itself, being
  span-based rather than line-based, does not share this specific gap for
  its own rule, but a JsxText span that happens to straddle multiple lines
  is still walked as one node whose interior offsets are correctly mapped
  back to the right line via `sourceFile.getLineAndCharacterOfPosition`).
- **False positives on ordinary code remain possible.** `slugFields` includes
  generic names (`type`, `status`, `code`, `kind`) that also occur as
  legitimate non-slug fields (e.g. React's `.type`, an instrument's quote
  `.status`); `statTokens` includes short tokens (`oi`, `dte`) that can appear
  inside unrelated identifiers despite the `\b` word-boundary guard. A line
  that trips one of these on merit gets a real false positive, not a defect
  in the rule's mechanism — the intended escape hatch is a trailing
  `// plain-language-ok: <reason>` waiver (§5), which still surfaces the
  finding (never silent) but clears `blocking`. This tradeoff is inherited,
  not newly introduced by this fix pass, and narrowing `slugFields`/
  `statTokens` further is future work, not something this packet's owned
  files can resolve without either weakening real detection or adding a type-
  aware (AST) pass.
- **The zero-finding null is honest but still coarse.** A file with zero
  findings and zero user-visible ADDED lines gets `not evaluable — no new
  user-visible strings added` (accurate: there was nothing on the diff's
  side of this file to check). A file with visible added lines and zero
  findings is NOT given that null (it correctly has no `nulls` entry at
  all) — but the guard still cannot distinguish "genuinely compliant" from
  "missed by a rule gap" beyond the rules R1–R5b actually implement. That is
  a detection-coverage limit, not a misreported null.
- **CI wiring is live, and it does not use the repo-wide `--since` path.**
  Packet `B-PLAT-B5-1` wired the guard into `.github/workflows/ci.yml` (§14):
  it runs in the `terminal-unit` job, as the job's last two steps, after
  "Disclose quarantined e2e journeys" — first a self-check that exits 2 if
  any rule (R1–R5b) can no longer detect its own violation, then a
  forward-only enforce run fed an explicit `--diff-file`. On `pull_request`
  that diff's base is `HEAD^1`, the merge commit's first parent, which
  `terminal-unit`'s `fetch-depth: 2` checkout makes resolvable and which
  cannot drift while the job runs; off `pull_request` the base branch tip is
  fetched explicitly at step time instead. Because the CI step always
  supplies `--diff-file`, the repo-wide `origin/master`-guessing `--since`
  path described in §4's exit-code table (row 0) is a local-development
  convenience only — it is not what CI exercises, so `actions/checkout@v4`'s
  default depth in other jobs is irrelevant to this guard. §14 has the full
  wiring detail, including the one still-disclosed residual: a
  `workflow_dispatch` run whose branch is behind its base at dispatch time
  can see a legacy line as newly added — a false red only, never a false
  green. That includes merge-on-green's own dispatches: it issues the branch
  refresh and dispatches this workflow immediately after, without waiting for
  the (async) refresh to land, so the same window is open there too.

## 9. Review fixes (round 2, PR #530)

The following blockers/majors from the review of head `6aaeb6f3` were fixed
in a follow-up commit and are each locked in by a regression test in
`plainLanguageGuard.test.ts`:

- **BLOCKER — overlay bare label KEYS were substring-matched.**
  `hasPlainHelperOnLine` matched every helper ending in `(` or `[` by whole
  name (`\bNAME\(`), but a bare identifier harvested from the `#519` overlay
  (e.g. a `TRUST_TIER_LABEL` key like `pro`) still fell through to
  `line.includes(h)` — an unbounded substring match. MEASURED: with the
  overlay present, `<div className="profile-card">{row.regime}</div>`
  stopped being flagged as `raw_slug_interpolation`, purely because `"pro"`
  is a substring of `"profile"`. Fixed: every bare (non-call, non-`LEX[`)
  overlay term is now matched with `\bTERM\b`. Test 13.
- **MAJOR — `R2 internal_study_slug` was a bare substring match.**
  `line.includes(slug)` fired on any English word containing a slug as a
  substring, e.g. `"lobe"` inside `"Globe"`. Fixed: `R2` now matches
  `\bslug\b`. Test 14.
- **BLOCKER — the i18n.tsx `LEX` arity check was comma-naive and
  single-line-only.** The old per-line regex captured everything between
  `[` and the first `]` and split it on every comma, so
  `commaEn: ["Hello, world"]` misread the comma inside the English string as
  a tuple-element boundary (miscounting arity), and required the whole
  `key: [...]` on one physical line, so a LEX entry whose array spans
  multiple lines was never matched at all — a silent miss, not a pass. Fixed
  with `findLexEntries()` (a quote-aware bracket-matching scan of the whole
  file, so a comma/`]` inside a string literal never splits or truncates an
  entry) and `splitTopLevelCommas()` (splits only on commas outside quotes).
  A newly-added multi-line or comma-containing LEX entry with a missing zh
  translation is now also counted toward `visibleAddedCount`, so the
  `zh_translation` null is never printed for a file whose added lines ARE
  new English LEX strings. Test 15.
- **MAJOR — the receipt printer replayed raw `::error`/`::warning` lines
  into a passing test's stdout**, which GitHub parses as run-level
  annotations regardless of the step's own exit code (this repo's own
  convention: "GitHub annotations must START the line"). Fixed:
  `plainLanguageGuard.test.ts` now indents each such line
  (`redactAnnotations()`) before printing the receipt in test 8, so the
  characters stay legible in the log without minting a phantom annotation.
- **MAJOR — `isUserVisiblePosition` false-positive class
  (`MAX_RETRY_COUNT`-in-a-comparison) was already fixed by the AST rewrite
  in §3a** (this doc, unchanged) at the time of this review pass — verified
  by direct reproduction against `6aaeb6f3`: a line with no JSX/string
  literal produces no visible span, so `R1` cannot fire on it. No further
  code change was needed for this item; it is recorded here because the
  review flagged it against the same head.
- **Not fixed in this pass (out of the owned paths for this packet):** the
  required check `Terminal typecheck + tests` was independently red on
  `terminal/e2e/marker-tooltip.spec.ts` (an unrelated, un-owned file) at
  head `6aaeb6f3`. Re-establishing a fresh, non-inherited CI proof for this
  PR's own head requires either a fix to that e2e spec (out of this
  packet's owned paths) or a fresh CI run demonstrating the red is
  base-inherited; neither can be completed by editing
  `check_plain_language.mjs` / `plainLanguageGuard.test.ts` / this doc alone.
  See the PR's "Review fixes" section for the current status of that item.
- **Not a code change:** the "single declared source" vs "#519 reuse"
  framing in §3 is unchanged by this pass — `PLAIN_VOCABULARY` remains the
  base declared source, with the `#519` overlay merged in additively once
  present, exactly as documented above (and now correctly enforced with
  whole-word matching per the first bullet). Re-litigating that design
  choice is out of scope for a review-fix pass.

## 10. Review fixes (round 3, PR #530) — META-CEO B ruling 2026-09-07 00:20Z

The ruling text for this round: *"isUserVisiblePosition must use the
TypeScript compiler API ... and treat as user-visible ONLY: JsxText nodes,
string literals that are direct JSX children or inside JsxExpression
children, string literals in title/aria-label/placeholder/alt attributes,
and string values inside the bilingual copy dictionaries (files matching
lib/\*\*/\*copy\*.ts or exporting \*\_COPY)."*

- **BLOCKER 1 fixed — copy-dict spans covered every string literal in the
  file, not "string values".** `isCopyDictFile` was a file-level boolean;
  once true, `computeVisibleSpans`'s `else if (copyDict) addSpan(node)`
  branch added a span for **any** string literal anywhere in the file —
  object-literal KEYS, import/export module specifiers, anything. MEASURED
  (reviewer's exact probe, `MARKET_COPY = { "BOTTOM_WATCH": "Watching for a
  bottom", "chart_url": "https://cdn.example.com/ASSET_MAP/v1.png" }`): the
  key `"BOTTOM_WATCH"` fired `raw_state_enum` — the guard blocking its own
  prescribed remediation, since the key is the raw enum being mapped
  *from*, never display text. Fixed: `isCopyDictFile` is replaced by
  `findCopyRegions`, which returns either `wholeFile: true` (a path matching
  `lib/**/*copy*.ts(x)`) or a list of the exact source ranges of each
  top-level exported `*_COPY` declaration's own initializer — no longer the
  whole file for that case. `isCopyDictValueNode` then excludes a string
  literal that is a property-assignment KEY or an import/export module
  specifier, and only counts a node as a visible copy VALUE when it falls
  inside a qualifying region. Test 16 locks in the exact probe: the key
  `"BOTTOM_WATCH"` produces zero findings and the import specifier's own
  line produces zero findings. **Ruling-authorized remainder, not a defect:**
  the reviewer's second probe value — `"chart_url":
  "https://cdn.example.com/ASSET_MAP/v1.png"` — still fires `raw_state_enum`
  on `ASSET_MAP` after this fix, because it genuinely IS a copy-dict VALUE
  (not a key, not an import specifier) and the ruling's own text scopes
  visibility to "string values inside the bilingual copy dictionaries"
  without a further carve-out for non-prose values (URLs, paths). R1 firing
  on any UPPER_SNAKE token inside a qualifying visible position, with no
  content-shape exception, is exactly what the ruling specifies ("R1 ...
  fires only on UPPER_SNAKE tokens inside those positions"). Narrowing this
  further (e.g. by property-key naming heuristics such as `*_url`/`*_href`)
  is not authorized by the ruling's text and was not invented here.
- **BLOCKER 2 fixed — `lib/**/*copy*.ts` was unreachable dead code.**
  `SCAN_GLOBS`'s `walk()` only ever pushed `.tsx` files (line filter
  `/\.tsx$/`), and `EXTRA_FILES` named only `terminal/lib/i18n.tsx` — so no
  `.ts` file anywhere, and no `terminal/lib/**` file other than `i18n.tsx`,
  was ever opened. `isCopyDictFile`'s own path-match branch
  (`/(^|\/)lib\/.*copy.*\.tsx?$/i`) could therefore never match a scanned
  file. MEASURED (reviewer's exact fixture, `terminal/lib/marketCopy.ts`
  exporting `MARKET_COPY = { a: "BOTTOM_WATCH" }`): `scannedFiles` never
  included it, 0 findings. Fixed: `listLibCopyFiles()` walks
  `terminal/lib/` recursively (both `.ts` and `.tsx`) and keeps files whose
  basename contains "copy"; `listScanFiles()` now includes these. The git
  diff pathspec used to compute `addedLines` (`resolveDiff`) was widened
  from `terminal/lib/i18n.tsx` to `terminal/lib` so an added violation
  inside a new lib copy file is captured as `blocking`, not only ever
  `legacy`. Test 17 locks in the exact probe: the file is now scanned and
  its `BOTTOM_WATCH` value fires as a blocking `raw_state_enum` finding.
  The one file this newly reaches on the real tree today,
  `terminal/lib/__tests__/markerTooltipCopy.test.ts`, is still excluded by
  `EXCLUDE_RE` (`__tests__`/`.test.`) — `scannedFiles` is unchanged at 231.
- **Real-tree measurement** (`node terminal/scripts/check_plain_language.mjs
  --root . --diff-file empty.patch --json`, same invocation shape as prior
  rounds): `scannedFiles: 231`, `raw_state_enum` survivors: **0** (ruling's
  gate: "total findings must be <= 5" read as R1-scoped, since R1 is the
  rule the ruling's BLOCKER-1 text is about). Full disclosure of every rule
  (not just R1), since the round-2 review's MINOR flagged non-disclosure of
  the total: `byRule {"missing_zh": 27, "raw_slug_interpolation": 32,
  "untranslated_stat_token": 8}` — 67 total findings, all `legacy` (0
  `blocking`), all pre-existing and un-added by this PR. `R2
  internal_study_slug` now measures 0 on the real tree (was 1,
  `ChartPanel.tsx`'s `GOLDEN ORACLE` JsxText — case-sensitive whole-word
  match: `\boracle\b` does not match uppercase `ORACLE`; not a fix made in
  this round, an incidental consequence of round-2's whole-word change,
  observed while re-measuring).
- Full suite: 18/18 passing (`npx vitest run
  lib/__tests__/plainLanguageGuard.test.ts`); `npx tsc --noEmit` clean.

## 11. Review fixes (round 4, PR #530) — META-CEO B ruling 2026-09-07 01:40Z

The ruling text for this round restated the acceptance so it could not be
re-scoped: *"EVERY rule (R1-R5) decides visibility from the SAME AST span set
computed by computeVisibleSpans (JsxText; string literals that are JSX
children, including inside conditional/logical/ternary JsxExpressions;
title/aria-label/placeholder/alt attribute literals; values in copy
dictionaries lib/\*\*/\*copy\*.ts or exporting \*\_COPY); no rule may test rawLine
with a regex for visibility; delete enLitRe and every `>…<` shape. R3 ... and
R4 ... fire ONLY inside visible spans and R4 matches rendered text tokens,
never property/identifier names."*

- **Ternary/logical-and literals were invisible to every rule.** A string
  literal nested behind a ternary or `&&` as a JSX child — `{cond ?
  "BOTTOM_WATCH" : "ok"}`, `{show && "iv_rank"}`, or the same behind
  `title={...}` — has its own AST `.parent` set to the
  `ConditionalExpression`/`BinaryExpression`, never the `JsxExpression`
  itself, so the round-3 direct-parent-only check could never see it as a
  visible span; the literal was silently invisible to R1/R4/R5b. Fixed:
  `computeVisibleSpans` now recurses through `ConditionalExpression` (both
  branches), `&&` (right operand only — the left is the non-rendered guard),
  `||` (either operand), and parenthesized wrapping (`collectStringLeaves`)
  to find every string-literal LEAF reachable this way, and adds each as a
  `kind: "literal"` text span. Tests 18-20 lock in the three idioms the
  ruling named (ternary, logical-and, attribute-literal), each now flagged.
- **R3 (`raw_slug_interpolation`) had NO visibility gate at all.** Unlike
  every other rule, R3's loop tested only `interpRe.test(line) &&
  !hasPlainHelperOnLine(...)` — it could fire on a `.regime`/`.state`/etc.
  interpolation pattern anywhere in the file, including inside a comment, a
  type definition, or ordinary non-JSX code, since the `visible` AST check
  was simply never consulted. Fixed (this round): R3 now requires
  `lineIsVisible(spans, ...)` too, using the FULL span set (not just text
  spans) — because its target, a bare property access like `{row.regime}`,
  is never itself string-literal text, `computeVisibleSpans` also tags the
  outer range of ANY JSX-child/visible-attribute expression as a
  `kind: "expr"` span regardless of its inner node type, and R3 is the only
  rule that consults those. R1/R2/R4/R5b never do (see next bullet), so
  this widening cannot reintroduce a property-access false positive into
  any of them.
  **SUPERSEDED by §12 below**: `lineIsVisible` (whole-line overlap) turned
  out to be too coarse for R3 specifically — a sibling visible span sharing
  the physical line could flip it true for an interpolation that had no
  span of its own. §12 replaces R3's visibility test with span-RANGE
  containment on the interpolation's own match; `lineIsVisible` itself
  remains, narrowed to the `visibleAddedCount` null-gating heuristic only
  (see the function's own doc comment in the source).
- **R4 (`untranslated_stat_token`) matched the whole raw line, not the
  visible text itself.** `tokRe.test(line) && visible && ...` could match a
  stat token appearing ANYWHERE on a visible line — including inside a
  property access like `item.dte` sharing a line with unrelated visible
  text. Fixed: R4 (and, for the same reason, R1 and R2) now iterate ONLY
  `textSpans` — the narrow, literal-content subset of the span set (JsxText
  / a JSX-child or attribute string literal / a copy-dict value; "expr"
  spans are filtered out) — and test each span's own sliced text, the same
  token-precise shape R1 already used. A bare property access is never a
  text span, so it can never satisfy R1/R2/R4/R5b regardless of what else
  shares its line. Test 22 locks in the exact case the ruling named
  (`{trade.dte}` produces zero findings); test 21 locks in that `className`
  — not a visible attribute — stays unflagged even behind the identical
  ternary; test 23 locks in that a template literal inside a `throw` (no
  JSX position at all) produces zero findings.
- **`enLitRe` (the `[">]...[<"]` rawLine regex) deleted.** R5b
  (`missing_zh`) is rewritten to iterate `textSpans` exactly like R1/R2/R4:
  for each literal span, decode its content (strip the delimiting quote
  characters for a string-literal span; trim for a JsxText span), then apply
  the same 2-plus-Latin-word / 6-plus-character test as before. This is not
  merely a different way to find the same lines — the old regex required
  the `>`/`<`/`"` boundary characters to sit on the SAME PHYSICAL LINE as the
  text, which silently missed the (very common) case of a multi-line JsxText
  node or a literal reached only via the new ternary/logical leaf
  collection; the span-based rewrite catches both.
- **`.ts` files were always parsed as TSX regardless of extension.**
  `ts.createSourceFile` was hardcoded to `ts.ScriptKind.TSX`. Fixed: a
  `.tsx` path parses as TSX, every other extension (`.ts`) parses as TS.
- **`nulls` was emitted for every scanned file, not files a rule could not
  run on.** The old gate (`visibleAddedCount === 0`) is trivially true for
  the ~230 of ~231 scanned files a typical PR's diff never touches at all —
  every one of them got the same "not evaluable" null as a genuinely
  limited check. Fixed: a null is now emitted only when the file is BOTH
  touched by the diff (`added.size > 0` for that path) AND produced zero
  findings and zero visible added lines — i.e. reserved for files the diff
  changed but that gave the guard nothing checkable, never the majority of
  files the diff never opened at all. Real-tree measurement below: `nulls:
  []` (0), against 231 scanned files.
- **`--json` no longer leaks notices onto stdout.** The overlay-absent
  disclosure, the `--root`/`--diff-file` hard-error lines, and the
  unresolvable-base warning were all written to stdout unconditionally,
  ahead of the JSON document itself — a `--json` consumer had to
  `.split("\n").pop()` to find the JSON line among them. Fixed: a `notice()`
  helper routes every one of these to stderr when `--json` is set (stdout
  is untouched, unchanged, for the human-readable non-JSON invocations).
  `plainLanguageGuard.test.ts`'s harness now uses `spawnSync` (not
  `execFileSync`, whose success-path return value carries no stderr at all)
  so it can capture stdout and stderr separately on every run; every test
  that parses the JSON result now calls a shared `parseJson(res)` that does
  `JSON.parse(res.stdout.trim())` directly — no more line-scavenging. Test
  24 locks this in: `JSON.parse(res.stdout.trim())` never throws, and
  `res.stderr` carries the overlay-absent notice on that same successful
  run.

### Real-tree measurement (this round)

`node terminal/scripts/check_plain_language.mjs --root . --diff-file
<(empty patch) --json | jq` and, separately, `--since origin/master` (this
PR's own actual diff) — both give the identical count, since this PR's own
changes touch only `terminal/scripts/`, `terminal/lib/__tests__/`, and
`docs/`, none of which fall under `SCAN_GLOBS`:

```
scannedFiles: 231
counts: { blocking: 0, legacyReported: 264, waived: 0 }
nulls: []
byRule: { missing_zh: 224, raw_slug_interpolation: 22, untranslated_stat_token: 18 }
raw_state_enum: 0, internal_study_slug: 0
```

**Blocking (this PR's own gate) is 0 — the "total findings must be <= 5"
gate, read as the blocking count on this PR's own diff, is satisfied.** The
264 legacy findings are real, pre-existing product debt now surfaced far
more completely than round 3's `enLitRe`-based scan (which measured 67
`missing_zh`/`raw_slug_interpolation`/`untranslated_stat_token` legacy
findings on the same tree) — the old rawLine regex required the JSX
tag/quote boundary to sit on the exact same physical line as the text and
silently missed the common multi-line-JsxText case; the new span-based scan
does not. None of the 264 are blocking (`blocking: 0` — this PR adds no new
violation), so per the ruling's own carve-out ("if genuine legacy defects
exceed 5, they are emitted under a separate `legacy` bucket that does NOT
count") they are disclosed here for the F-owners rather than remediated by
this packet, which owns the checker/tests/doc only, not app copy:

- `missing_zh` (224): overwhelmingly genuine, previously-invisible
  hardcoded English UI copy with no zh routing — e.g.
  `terminal/app/login/LoginFormLegacy.tsx:46` ("Sign in to Mastermind"),
  `terminal/app/global-error.tsx:59` ("Something went wrong"),
  `terminal/components/GuidePanel.tsx` (multiple long descriptive strings),
  `terminal/components/ChartConductor.tsx:236` ("Mastermind AI"). Full list
  reproducible via the command above.
- `raw_slug_interpolation` (22): bare `.tier`/`.kind`/`.verdict`/`.state`/
  `.status`/`.regime`/`.type` interpolations across
  `GuidePanel.tsx`/`ScreenerView.tsx`/`SearchModal.tsx`/`StockAnalysis.tsx`/
  `TerminalShell.tsx`/`fin/*.tsx`/`flowdesk/FlowDeskView.tsx`/
  `gexdesk/ExposureMatrix.tsx`/`workspaces/ThesisWorkspace.tsx` — genuine
  pre-existing instances of exactly the pattern this rule targets.
- `untranslated_stat_token` (18): mostly `oi` inside
  `terminal/components/OptionsHubView.tsx` (and a few sibling flow/options
  views) — **one disclosed limitation, not a guard bug**: several of these
  sit inside an already-hand-rolled `lang === "zh" ? "…" : "vol>OI"`
  ternary — a real, working zh/en branch that simply isn't spelled through
  the designated `t()`/`tPlain()`/`pick()`/`LEX[` helpers `hasPlainHelperOnLine`
  recognizes as "already routed". These are true findings under the rule's
  own stated criterion (no recognized helper on the line) but are lower
  priority than an un-routed literal, since the code is already manually
  bilingual; noted here rather than special-cased, since the ruling does
  not authorize a new helper-recognition carve-out.

Full suite: 25/25 passing (`npx vitest run
lib/__tests__/plainLanguageGuard.test.ts`); `npx tsc --noEmit` clean.

## 12. Review fixes (round 3, PR #530) — META-CEO B ruling 2026-09-07 05:20Z

Binding MAJOR ruling text: *"a raw_slug_interpolation finding fires only
when the interpolation token's own column range lies inside a visible span
(visible attribute value or JSX text), never because an unrelated visible
span shares the physical line; implement span-range containment, not line
overlap."*

- **MAJOR fixed — R3 gated on whole-LINE visibility, not the interpolation's
  own span.** Round 4's fix (§11) gave R3 a visibility gate for the first
  time, but that gate was `lineIsVisible(spans, sourceFile, lineNo)` — true
  whenever ANY span (text or expr) overlapped the physical line. MEASURED,
  the reviewer's exact repro: `<Foo bar={cfg.type} title="Hello there
  friend" />` fired `raw_slug_interpolation tok=type` even though `bar` is
  not in `VISIBLE_ATTR_NAMES`, so `{cfg.type}` gets no span of its own — the
  finding existed only because the sibling `title="..."` literal's span
  shares the physical line. Fixed: R3 now computes the ABSOLUTE character
  offsets of its own `interpRe` match (`lineStart + m.index` through
  `+ m[0].length`) and requires that specific range to be CONTAINED in a
  span (`span.start <= absStart && absEnd <= span.end`) — necessarily a
  `kind: "expr"` span, the only kind `computeVisibleSpans` emits for a bare
  `{...}` interpolation. Test 25 locks in all three fixtures the ruling
  named: `<Foo bar={cfg.type} title="Hello" />` (not flagged — `bar` is
  non-visible, no sibling span can rescue it), `<Foo title={cfg.type} />`
  (flagged — `{cfg.type}` IS the visible attribute's own expr span), and
  `<p>{cfg.type}</p>` (flagged — `{cfg.type}` is a direct JSX-child expr
  span). Confirmed RED-first: reverting only this fix reproduces the exact
  false positive on fixture (a) while (b)/(c) still pass.
- **Minor fixed — no separate `legacy` bucket.** The `--json` contract
  previously mixed blocking, waived, and legacy findings into one
  `findings[]` array, distinguished only by each entry's own `blocking`
  field — materially equivalent to a separate bucket, but not what earlier
  ruling text names. Fixed: `findings[]` now carries only entries that count
  for the current run (`blocking` + `waived`); `legacy[]` is a new top-level
  array carrying the non-blocking, pre-existing entries. `counts` is
  unchanged (`legacyReported` still counts the `legacy[]` array's length).
  Test 3b and test 9 (`--json` contract shape) updated for the new key; test
  27 covers a case that must appear in neither array (see below).
- **Minor fixed — duplicate findings for one `path:line:rule:token`.**
  MEASURED (pre-fix, real tree): `terminal/components/OptionsHubView.tsx:3676
  tok=oi` fired 3 times, `:3646 tok=oi` fired 2 times — R2/R4 walk every
  regex match per visible span with no dedup of their own, so a token
  repeated inside one span (or across two spans sharing a line) produced one
  finding PER OCCURRENCE. Fixed: `scanLines` now dedups its own findings at
  the `(path, line, rule, token)` key before returning — every duplicate on
  that key carries the same `blocking`/`detail`/`suggestion` (both are pure
  functions of `relPath`/`lineNo`/rule/token), so keeping the first
  occurrence loses no information. Test 26 locks this in
  (`<span>oi versus oi contracts</span>` produces exactly one
  `untranslated_stat_token` finding, not two).
- **Minor fixed — dev-only harness pages were in scope.** `EXCLUDE_RE`
  excluded `__tests__`/`.test.`/`/e2e/`/`.d.ts`/`terminal/scripts/` but not
  `terminal/app/dev/**`. MEASURED: 9 of the real tree's `missing_zh` hits
  were `terminal/app/dev/settings/page.tsx` / `terminal/app/dev/theater/
  page.tsx` — both self-described "Production-gated" (`NODE_ENV ===
  "production"` → `notFound()`) developer harnesses no real user ever sees.
  Fixed: `EXCLUDE_RE` now also excludes `terminal/app/dev/`. Test 27 locks
  this in (`terminal/app/dev/settings/page.tsx` never appears in `findings`
  or `legacy`, even with a genuine `raw_state_enum` violation on an added
  line).
- **Minor fixed — internal lane slug shipped into the Terminal repo.** The
  Macro-internal lane identifier `marketontology-b4-plain-language-guard`
  appeared in this doc's header and in a `check_plain_language.mjs` comment.
  Removed from both; the packet id `B-PL-5` (not itself a lane slug) is kept
  as the only cross-reference.

### Real-tree measurement (this round)

Same invocation shape as prior rounds (`--root . --diff-file <empty patch>
--json`; this PR's own diff gives the identical count, since it touches only
`terminal/scripts/`, `terminal/lib/__tests__/`, and `docs/`, none of which
fall under `SCAN_GLOBS`):

```
scannedFiles: 229   (was 231 — the 2 terminal/app/dev/** files are now excluded)
counts: { blocking: 0, legacyReported: 247, waived: 0 }
nulls: []
byRule (legacy[]): { missing_zh: 215, raw_slug_interpolation: 22, untranslated_stat_token: 10 }
```

`blocking: 0` (this PR's own diff still touches no scanned surface).
`legacyReported` fell from 264 to 247 — `missing_zh` 224→215 (the 9
dev-harness lines, now excluded), `untranslated_stat_token` 18→10 (dedup
removing the measured `OptionsHubView.tsx` duplicates plus other repeated
tokens), `raw_slug_interpolation` unchanged at 22 (the real pre-existing
instances of this rule were never sitting on a line with a rescuing sibling
span — the false positive the MAJOR fixed was reproduced only by the
review's synthetic fixture, not present in the current tree).

Full suite: 28/28 passing (`npx vitest run
lib/__tests__/plainLanguageGuard.test.ts`); `npx tsc --noEmit` clean.

## 13. Review fixes (round 4, PR #530)

Review of the §12 head found that the §12 containment fix itself introduced
a real regression, plus a pre-existing correctness bug and three doc/leak
minors. Fixed as written, per the standing rule that the RULING wins over a
reviewer finding only where they conflict — none did this round.

- **MAJOR fixed — R3 tested only the FIRST `{...field}` match per line per
  field, silently dropping every later match on that line.** §12's fix used
  a non-global `interpRe.exec(rawLine)` and moved on once it had a match
  (or none). MEASURED: `<Foo bar={cfg.type} title={row.type} />` and
  `<div style={cfg.kind}>{row.kind}</div>` both produced ZERO findings —
  the first match on each line (`bar={cfg.type}`, `style={cfg.kind}`) is
  not contained in any span, and the SECOND match on the same line
  (`title={row.type}`, a visible-attribute expression; `{row.kind}`, a bare
  JSX child) was never even examined. This is not merely "the false
  positive count changed" — it is a true positive silently lost, and it
  contradicts the ruling's own instruction to confirm the finding count
  moved only for the false positives. Fixed: the regex is now global
  (`g` flag) and the match loop runs to exhaustion (`while ((m =
  interpRe.exec(rawLine)))`), testing each match's own [start,end) range
  for containment independently — a match that fails containment no longer
  suppresses examination of a later match on the same line. Test 28
  (RED-first) locks in both fixtures.
- **MAJOR fixed — `--json` output silently truncated at 65536 bytes when
  stdout is a pipe.** Every exit path did `console.log(...)` /
  `process.stdout.write(...)` immediately followed by `process.exit(n)`.
  Node's stdout is a non-blocking pipe whenever the parent redirects it (CI,
  `| jq`, a test harness's `spawnSync`); a write larger than the OS pipe
  buffer (64 KiB) is queued rather than completed synchronously, and
  `process.exit()` tears the process down before that queued write drains.
  MEASURED on this PR's own tree: the same `--json` invocation wrote a full
  94339-byte, valid JSON document to a file, but was cut to exactly 65536
  bytes (`JSONDecodeError: Unterminated string`) when piped through `wc -c`.
  Fixed: every exit path now sets `process.exitCode` and returns from
  `main()` instead of calling `process.exit()`, letting Node's event loop
  drain the pending write before the process exits naturally. Test 29
  (RED-first) reproduces the truncation on a synthetic large-output fixture
  and asserts the full byte count and valid JSON survive a piped read.
- **Minor fixed — stale contract comment on `lineIsVisible`.** The comment
  still described it as "used ONLY by R3", which stopped being true the
  moment §12 moved R3 to span-range containment; the sole remaining caller
  is the `visibleAddedCount` null-gating heuristic. Comment rewritten in
  place (see the function's own doc comment in the source) — no behavior
  change.
- **Minor fixed — `--json` contract inconsistency on the `baseResolved:
  false` early-exit branch.** The success branch emits a top-level
  `legacy` key (per §12); the unresolvable-base branch did not, so a
  consumer reading `d.legacy` unconditionally would throw on that one path.
  Fixed: the early-exit branch's JSON now also carries `legacy: []`.
- **Minor fixed — operator-local absolute path shipped into the Terminal
  repo.** `check_plain_language.mjs`'s header comment cited
  `/Users/chriswong/Documents/Cluade/macro-main/scripts/
  check_design_system.py` — the same leak class as the internal lane slug
  §12 already removed. Replaced with a repo-relative description ("the
  sibling Macro Dashboard repo's `scripts/` directory") carrying the same
  information with no operator-local path.
- **NIT fixed — §11's R3 bullet still read as present-tense current
  behavior.** Marked superseded, pointing at §12 (the containment fix) and
  the source's own updated `lineIsVisible` doc comment, per the minor above.

## 14. CI wiring (packet `B-PLAT-B5-1`)

Before this packet the guard was advisory. It existed, it was tested, and
nothing ran it: no workflow named it, no `package.json` script named it, and
no job depended on it. A pull request could put a raw state enum or an
untranslated statistic token in front of a user and every required check
still went green.

Two steps in the `terminal-unit` job of `.github/workflows/ci.yml` now run it.
They are the LAST two steps in that job — after `npm test` and after
"Disclose quarantined e2e journeys". The placement is deliberate: the
disclosure step's own comment promises it annotates every run, but it carries
no `if: always()`, so a guard step in front of it would, the first time it
found a blocking line, skip the disclosure outright and quietly retract that
promise. That job feeds the aggregate check named "Terminal typecheck +
tests", which is the check master's branch protection requires — so either
guard step going red blocks the merge.

**Step 1, the self-check** (`node scripts/check_plain_language.mjs
--self-check`) proves the guard still works before anyone trusts what it says
about the diff. Each rule is fed a fixture that violates it, through the same
`scanLines()` the real scan uses. If a rule no longer fires, the step exits 2
and the job is red. A dead guard must never be readable as a clean tree.

**Step 2, the enforce run** takes the forward-only verdict. A finding on a
line this pull request ADDED is blocking and fails the step. The identical
finding on a pre-existing line is printed as the legacy census and never
fails anything. An untouched legacy file cannot turn a pull request red —
that is the same promise §2 makes, unchanged, and
`plainLanguageGuardCi.test.ts` holds the guard to it with fixtures on both
sides.

Two details in that step are load-bearing, and both are commented in the
workflow itself:

- **On `pull_request` the base is `HEAD^1`, the merge commit's first parent
  — never a freshly fetched `refs/heads/<base>`.** HEAD on that trigger is
  the merge commit `M` GitHub built when the run was queued: this branch
  merged into the base tip *as it was then*. Re-fetching the base branch at
  step time would instead read the base *as it is now*, and the base can
  advance while the job runs. Every line those newer commits changed still
  stands in `M` in its older form, so `git diff base@now M` emits that older
  form as a `+` line. Legacy findings in files the pull request never opened
  would then count as ADDED and turn the required check red — precisely the
  false red the forward-only promise in §2 exists to prevent, and, because it
  depends on someone else's merge timing, an intermittent one. `M`'s first
  parent *is* the base tip GitHub merged against and cannot drift, because
  `M` is fixed.

  This is why the job's checkout asks for `fetch-depth: 2`. The default depth
  of 1 holds `M` and neither parent. `actions/checkout` does the deepening
  itself against the exact ref it checks out (`refs/pull/N/merge`), so the
  parents come down with it; a later `git fetch --deepen=1 origin` would not
  reliably do the same, because checkout leaves `remote.origin.fetch`
  pointing at `refs/heads/*` and the merge commit sits on no branch. Only
  `terminal-unit` asks for the extra commit.

  The step runs under `set -euo pipefail`, so an `HEAD^1` that cannot be
  resolved kills it loudly instead of leaving the base empty and passing
  green. Fail closed, like the guard's own exit 2.
- **Off `pull_request`, the base branch tip is fetched explicitly.** A
  `workflow_dispatch` re-run has no merge commit, and a shallow checkout does
  not contain the base — without the fetch `$BASE` cannot resolve at all.
  This step always supplies `--diff-file` (never `--since`), so an
  unresolved `$BASE` does not fail open: `git diff --unified=0 "$BASE" HEAD`
  fails under `set -euo pipefail` and the step dies loudly, having invoked
  the guard on nothing. The fetch is what lets `$BASE` resolve, not a guard
  against a silent pass. Once it resolves, the step fetches `origin/<base
  ref>` (or `master` when there is no base ref) one commit deep, reading the
  branch name from an environment variable rather than interpolating it into
  the shell text. The diff is then base tip vs HEAD, so the branch's OWN
  changes count as added and can block — which is the point of re-running
  the proof. A pre-existing line can surface as added on that path only if
  the branch is BEHIND the base: git reads the branch's older copy of a line
  the base has since changed as an addition. merge-on-green issues that
  refresh (`PUT /pulls/{n}/update-branch`, queued async as a 202) and
  dispatches this workflow immediately after, without polling the refresh to
  completion or pinning the dispatch to the post-refresh sha — so the
  disclosed residual (§8) is not limited to a hand-dispatched run: it is the
  window, on ANY `workflow_dispatch` run, between the branch's tip at
  dispatch time and the base moving; the failure direction stays false-red
  only.
- **The diff is taken with two dots, not three.** `git diff A B` compares two
  trees and needs no merge base; `git diff A...B` needs one, and two shallow
  histories give git nothing to find it in. On a pull request run, HEAD is
  the merge commit and the base is its first parent, so the two-dot diff is
  exactly the change the pull request makes — which is also what the
  three-dot form would have produced.

The guard reads that diff through `--diff-file`, the same entry point every
test in both suites uses, so what CI exercises is the path the suites cover.
