# Hunan Gold suspension-integrity implementation plan

> Execute test-first. Each red test must fail for the named production defect,
> then pass only after the smallest implementation change.

## 1. Pin carriers and baselines

- Terminal carrier: `claude/hunan-gold-zero-percent-032e7c` from current
  `origin/master`.
- Macro carrier: `claude/hunan-gold-suspension-integrity-20260826` from current
  `origin/main` with the full data tree materialized.
- Confirm no open PR owns the same files and preserve both shared primary checkouts.

## 2. Macro source-store integrity

Files:

- Modify `collectors/_stock_ohlc.py`.
- Modify `tests/test_stock_ohlc_open.py`.
- Repair `data/china_stocks/002155.SZ.parquet`.
- Repair `data/china_stocks_raw/002155.SZ.parquet`.

TDD sequence:

1. Add a literal yfinance-shaped fixture containing a normal row, a zero-volume
   flat placeholder, a positive-volume traded-flat row, and a missing-volume row.
2. Assert `_extract` removes only the zero-volume flat placeholder. Run the focused
   test and observe the expected failure.
3. Add a narrow shared predicate in `_stock_ohlc.py` and apply it after column
   normalization. Re-run the focused test.
4. Remove the existing Hunan Gold placeholder dates from adjusted and raw parquet
   files. Verify both tails end at 2026-08-19 and retain the 47,735,572-share row.

## 3. Terminal publication defense

Files:

- Modify `ingest/build_universe.py`.
- Add or modify a focused test under `tests/` for `build_ohlc_json`.

TDD sequence:

1. Pass a dataframe with the same four row types to `build_ohlc_json`.
2. Assert the emitted date list excludes only the placeholder and preserves the
   genuine traded-flat and missing-volume rows. Observe failure first.
3. Filter the dataframe before tail selection and open reconstruction. Re-run the
   focused test.

## 4. Explicit Tencent suspension contract

Files:

- Modify `terminal/lib/intradaySources.ts`.
- Modify `terminal/lib/quoteDisplay.ts` only as needed for its public type.
- Modify `terminal/lib/__tests__/liveSplice.test.ts`.
- Modify `terminal/lib/__tests__/quoteDisplay.test.ts`.

TDD sequence:

1. Extend the literal Tencent fixture through field 40 and assert `S` becomes
   `suspended:true`; assert an empty status does not set it. Observe failure first.
2. Assert `withRegularSessionDisplay` preserves `suspended:true` while clearing
   current tradable fields and keeping `prevClose`/provenance. Observe failure if
   the public type or normalization drops it.
3. Parse field 40 in the shared Tencent parser and add the optional boolean to the
   quote contract. Keep the existing no-trade splice guard unchanged.

## 5. Terminal suspension presentation

Files:

- Modify `terminal/components/TerminalShell.tsx`.
- Modify `terminal/components/ChartPane.tsx` if multi-pane status requires it.
- Modify `terminal/components/ChartPanel.tsx` only for the threaded quote type.
- Modify `terminal/lib/i18n.tsx`.
- Modify `terminal/app/globals.css` with existing status-token styling only.

Behavior:

- Derive suspension directly from the current quote on every render.
- Keep the last genuine manifest price visible.
- Replace percentage change with `Suspended` / `停牌` in desktop, rail, mobile,
  and multi-pane quote chrome; do not render both `Suspended` and `Market closed`.
- Do not create a persistent client suspension state.

## 6. Verify locally

Macro:

- Run the focused stock-OHLC tests and relevant basis-upsert tests.
- Inspect the exact parquet tail and row invariants.
- Do not run the full Macro suite from an incomplete sparse checkout.

Terminal:

- Run the focused Python and Vitest files.
- Run the full Vitest suite, TypeScript check, build, and
  `npm run test:e2e:responsive`.
- Inspect the UI at 1440x900, 820x1180, and 390x844 with the suspension fixture.

## 7. Deliver Macro first

- Re-fetch `origin/main`, verify the carrier tuple and scoped diff, commit, push,
  open a ready PR, add `merge-on-green`, and wait for all binding checks to
  conclude.
- Resolve only head-attributable failures. Squash-merge after green.
- Verify the merged source and repaired parquet files on `origin/main`, then wait
  for the normal VPS pull and confirm the production Macro clone carries them.

## 8. Deliver Terminal and repair the published series

- Re-fetch `origin/master`, reconcile only if needed, verify the carrier tuple and
  scoped diff, commit, push, open a ready PR, and wait for binding checks.
- Squash-merge and deploy the exact merged `origin/master` through
  `/opt/terminal/terminal-build.sh`.
- Back up the single production `002155.SZ.json`, regenerate or repair it from the
  merged clean source, and verify its final bar is the genuine 2026-08-19 row.

## 9. Production acceptance

- Verify the deployed build SHA/service health.
- Verify `/api/quote?sym=002155.SZ` exposes `suspended:true` with no fake current
  tradable fields.
- Verify the public OHLC JSON has no Aug 20+ placeholder dates.
- Use the real browser at 1440x900, 820x1180, and 390x844 to prove the last genuine
  price is visible with `Suspended`, the fake `+0.00%` is absent, and the layout is
  intact.
