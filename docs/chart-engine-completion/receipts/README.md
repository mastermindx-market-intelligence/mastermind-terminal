# Chart-engine performance receipts

Official measurement artifacts for the P4 default-flip gate. Each file is one
impl × one commit × one host, matching `docs/chart-engine-completion/performance-receipt.schema.json`.

## Naming

```
receipt-<impl>-<commit>-<host>.json
```

- `<impl>` is `mm` (the owned Canvas2D renderer) or `lwc` (the control row).
- `<commit>` is the 40-hex `git rev-parse HEAD` of the tree the renderer was built from.
- `<host>` is `os.hostname()` lower-cased with `[^a-z0-9-]` replaced by `-`.

Example: `receipt-mm-cc140a0b36a5866bac1a5fa5d31349b4552960ef-review-mac.json`.

A P4 flip PR carries **two** receipts from the **same run**: a green `mm` receipt
and the `lwc` control receipt produced immediately after it.

## Provenance

- **The seat commits official receipts.** A lane, a laptop, or a CI shard does
  not. Official numbers come from the headed, 3-run, prod-mode protocol on the
  reference Mac after the P1 canvas repair and the ChartPanel migration land.
- **Never commit a dev-mode receipt.** `next dev` pays Turbopack compile and a
  different scheduler; those files are local smoke only (`terminal/test-results/bench/`,
  gitignored).
- Official receipts are produced with:

  ```
  NEXT_PUBLIC_CHART_BENCH=1 npm run build && npm run start -- -p 3111
  BENCH_BASE_URL=http://127.0.0.1:3111 npx playwright test -c playwright.bench.config.ts
  ```

  Headed (default), `BENCH_RUNS=3`, Chromium `--disable-partial-raster`,
  viewport 1440×900 at `deviceScaleFactor` 2.

## Creep ratchet (§5)

A regression of ≥ 10 % versus the previous committed `mm` receipt is treated as
red even when every metric is still under budget. Tightening a budget is always
allowed; loosening one needs a written justification in `performance-budget.md`
and a fresh receipt showing the old ceiling could not be met without a
correctness trade.

## What this directory holds today

README only. The unit test globs `*.json` here and validates every file against
the schema; it also fails if any `receipt-mm-*.json` has `budget_ok: false`.
When the seat lands the first official pair, those two files join this folder.
