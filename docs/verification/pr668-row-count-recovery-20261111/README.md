# PR668: adopt row-population validation from the retained reference

## Scope and authority

The Chairman assigned recovery of orphaned Terminal PRs. This bounded takeover stays on the original Packet C branch at `d25e8ee1ea0b06878e479135678e926515e1ab6b`; the original normalizer blob is `a55fb70bcf10082a903afadf05c9b267ae21f7c1`. It adopts only the row-outcome/raw-population and empty-statistics guards from the completed, unapplied [reference return5760132200](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/668#issuecomment-5760132200), with new regressions in the existing suite. It does not claim the entire normalizer or six-file Packet A screen proposal has been adopted.

The [published partial-state receipt5745801651](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/668#issuecomment-5745801651) makes truthful raw-result coverage an existing consumer requirement. The [cumulative reference5769759695](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/668#issuecomment-5769759695) separates source adoption from producer/release gates. No current writer or unknown branch-publication effect was found on these two paths. Active #1460's ProphetView source is untouched. The older denied three-file screen refinement5761124110 and the local browser-launch refusal are not replayed.

## Actual defect and correction

The original validator checks that aggregate counts add up. It never compares the outcome bins, available-return population or raw signs with the admitted plan rows. The committed four-plan fixture has T1_HIT/INVALIDATED/EXPIRED/NO_ENTRY rows, with raw returns `6.5`, `1.25`, `-3.25`, and null respectively.

Consequently, it accepted a T1-to-T2 substitution while total4/NO_ENTRY1 stayed unchanged, coverage2/3 while all three entered rows still had values, and total-preserving substitutions of positive/negative/zero counts. It also accepted a single numeric statistic with no raw observations because the previous all-statistics-present predicate was false for a partially populated statistic set.

The new guards compare every declared outcome bin against the complete v1 row population; compare available/unavailable coverage and sign counts against non-NO_ENTRY rows with numeric raw returns; and require all four statistics to be null when that population is empty. They reject inconsistent input without recomputing or changing the returned wire values. Positive underlying moves remain positive for BEAR rows; this is not direction-adjusted plan P&L. NO_ENTRY remains outside the closed-return denominator.

Only `terminal/components/prophet/prophetPerfTypes.ts` and `terminal/lib/__tests__/prophetPerf.test.ts` change outside this proof directory. Transport, producer, DTO/schema version, UI, fixture file, browser cases, source/release controls and every other original tree entry remain unchanged.

## Meaningful validation

- The same actual Vitest suite on the original parser reports **12 passed and9 expected regression failures**. All nine failures are the newly discriminated false admissions.
- The repaired parser reports **21 passed, zero failed**. Positive controls cover populated, partial, zero, all-unavailable and empty populations, unchanged emitted values and raw BEAR direction semantics.
- Strict TypeScript for both changed files and their imported type closure passes. This is not whole-application Next type generation or a production build.
- Scoped ESLint and whitespace checks pass with no diagnostics. An initial sparse-workspace Pages-directory notice was removed by hydrating the actual unchanged app layout; no product lint rule changed.
- The two exact `empty` and `partial` literal payloads in the incumbent browser spec are extracted from the original Git blob and admitted by the compiled actual normalizer with identical summary/row values. This compatibility check starts no Playwright/browser/server and is not a fresh browser acceptance claim.

See `checks.json`, before/after native logs and `authored-fixture-qualification.json`. `verify-authored-fixtures.cjs` takes the exact source worktree as its argument and uses its installed TypeScript.

## Remaining obligations

The PR stays Draft / BUILT_NOT_PROVEN with no auto-merge. Current protected integration, actual hosted CI for this new source and private-endpoint/full-application acceptance remain separate. Macro #7399 producer acceptance, #6872 deployment/restart dependency and the original light-theme/source-custody obligations remain. No endpoint, schedule, migration, runtime activation, release, merge, approval or screen-refinement effect is performed here.

This bounded adoption does not implement the retained reference's provenance DTO, date/clock/freshness checks, numeric-statistic precision checks, benchmark authority, refresh/privacy UI, or six-file screen composition. The original reference receipts preserve those outstanding behaviors and their prior proof. They must not be described as completed by these21 cases.
