# Terminal Index Deep-History Census and Staging Proof — 2026-11-04

## Scope and user job
Terminal production has 22 native catalogued index symbols (confirmed against the live `/data/manifest.json`, 11,715 total symbols). Before this change, 21 non-Shanghai indices were either truncated to approximately five years or had no credible chart history. The Shanghai Composite's separate accepted deep-history path already exists on `master` after PR #1283.

The chart already loads `/data/<SYMBOL>.json` and resamples the available positional OHLC bars to `1M`; an `All` viewport can show older years **only once those bars are published**. No chart or quote-route changes are needed for this bounded data-producer repair.

## Daily-history data contract
- Curated catalog in `ingest/macro_catalog.py` remains sole index membership source.
- `ingest/build_macro_symbols.py` selects all index rows with verified daily Yahoo history. Explicit `period1=1900-01-01 UTC` and `period2=now+1d` with `interval=1d` retrieves Yahoo's **earliest available** daily OHLC for non-Shanghai indices, preserving Shanghai's existing 1990 lower request bound.
- **Never use `range=max&interval=1d` for history**: Yahoo silently down-samples to monthly (`dataGranularity=1mo`) even though the request says daily. Refuse monthly or thin (<1000 valid, unique, qualified daily candles) responses. Reject malformed OHLC, preserve previously published valid dates, refresh overlapping dates, write atomically.
- No foreign symbols are relabeled, no ETF NAV is substituted for an index, no price adjustment basis is invented. Tencent China live quotes, Yahoo delayed index quotes, equities, currencies, rates, futures, crypto, and other history workers are unchanged.
- File contract remains `{"t":"^GSPC","o":1,"src":"yahoo","bar_quality":"real_ohlc","bars":[[date,o,h,l,c,v],...]}`. Publisher retains the existing nightly admission and disk guard.

## Source-backed live census and isolated staging (mini1)
Live provider audit: Yahoo Finance v8 chart, requested with daily explicit period bounds. Baseline: actual unauthenticated production `https://app.mastermind-x.com/data/<SYMBOL>.json` files. **All output and tests stayed isolated on mini1 under `/tmp`; no production mutation.** Exact source tested: `afd686ceeb9cc60e3412c6ab9a905fe38e323d07` (updated index ingestion + tests, before adding this evidence document). Staging artifact root: `/tmp/mmx-index-deep-stage-f4fkiml2/`; receipt: `verification.json`. SHA-256 and file metadata live in that receipt and should be reverified if used for publication. This local artifact is a rehearsal, not an accepted deployment source.

| Native symbol | Index | Prior production daily bars | Staged qualified daily bars | New first bar | Last bar | Months available |
|---|---|---:|---:|---|---|---:|
| `^GSPC` | S&P 500 | 1,254 | 24,829 | 1927-12-30 | 2026-11-04 | 1,188 |
| `^NDX` | Nasdaq 100 | 1,254 | 10,354 | 1985-10-01 | 2026-11-04 | 494 |
| `^DJI` | Dow Jones Industrial | 1,254 | 8,773 | 1992-01-02 | 2026-11-04 | 419 |
| `^RUT` | Russell 2000 | 1,254 | 9,863 | 1987-09-10 | 2026-11-04 | 471 |
| `^VIX` | Volatility Index | 1,257 | 9,281 | 1990-01-02 | 2026-11-04 | 443 |
| `399001.SZ` | Shenzhen Component | 1,211 | 7,073 | 1997-08-22 | 2026-11-03 | 352 |
| `^HSI` | Hang Seng | 1,230 | 9,833 | 1986-12-31 | 2026-11-04 | 480 |
| `^HSCE` | Hang Seng China Enterprises | 1,230 | 8,215 | 1993-07-15 | 2026-11-04 | 401 |
| `^GSPTSE` | S&P/TSX Composite | 1,255 | 11,889 | 1979-06-29 | 2026-11-04 | 570 |
| `^N225` | Nikkei 225 | 1,222 | 15,199 | 1965-01-05 | 2026-11-04 | 743 |
| `^KS11` | KOSPI | 1,222 | 7,358 | 1996-12-11 | 2026-11-04 | 360 |
| `^TWII` | TAIEX | 1,213 | 7,189 | 1997-07-02 | 2026-11-04 | 353 |
| `^FTSE` | FTSE 100 | 1,262 | 10,823 | 1984-01-03 | 2026-11-04 | 515 |
| `^GDAXI` | DAX | 1,275 | 9,825 | 1987-12-30 | 2026-11-04 | 468 |
| `^FCHI` | CAC 40 | 1,281 | 9,317 | 1990-03-01 | 2026-11-04 | 441 |
| `^STOXX50E` | Euro Stoxx 50 | 1,257 | 4,914 | 2007-03-30 | 2026-11-04 | 237 |
| `^BSESN` | BSE Sensex | 1,234 | 7,229 | 1997-07-01 | 2026-11-04 | 353 |
| `^AXJO` | ASX 200 | 1,266 | 8,585 | 1992-11-22 | 2026-11-04 | 409 |

**18 / 18 index files staged successfully**, each with validated positional six-field OHLC, strictly increasing unique trading dates, a passing publish-depth decision, and exact JSON disk readback. Some saved long-history files retain one older valid production date absent from the latest provider response, by design. Earliest dates reflect **the provider's actual coverage**, not necessarily an index's inception. Index benchmarks and derived signals must respect that difference.

## Three authentic-index source blockers
These are **not solved** by full-range Yahoo requests: each currently returns a single daily timestamp, and their two empty chart files (CSI 500, ChiNext) must not be replaced with ETF data.

| Symbol | Index | Observed Yahoo daily response | Existing production state | Disposition |
|---|---|---|---|---|
| `000300.SS` | CSI 300 | 1 candle | 1,170 historical bars through 2026-07-17 (stale) | Preserve guarded history; needs an authenticated/rights-qualified index source |
| `000905.SS` | CSI 500 | 1 candle | 404 / absent | Keep explicit no-data instead of fabricated index |
| `399006.SZ` | ChiNext | 1 candle | 404 / absent | Keep explicit no-data instead of fabricated index |

Macro `research/CHINA_DATA_AUDIT.md` and `scripts/build_china.py` independently document that `510300.SS` and `159915.SZ` are *ETFs*, not suitable replacements for the CSI 300 and ChiNext **index levels**. Follow-on work must find real exchange/index-provider daily history, verify dates/units/rights, and route through the canonical Terminal writer without a duplicate publisher.

## Verification and release holds
- Actual source snapshot + focused unit tests fetched into isolated mini1 scratch: `/tmp/mmx-index-tests-2k39whca/`. **83 focused pytest cases passed** after using an isolated `uv`-managed test environment. No package installed globally.
- Hosted GitHub CI must pass at the eventual PR exact head. Its success alone does not prove deployment or user acceptance.
- Once release is independently authorized: publish through the installed Terminal build/nightly data publisher. Compare the published `/data/<SYMBOL>.json` per-index earliest/latest/count and freshness to this receipt, then use actual Terminal `1M` → `All` on representative indices (`^GSPC`, `^N225`, `399001.SZ`) and confirm ancient candles are reachable, not only present in the file. This evidence is NOT yet available.
- Keep all prior Chairman holds: do not merge, merge-queue, relabel held PRs, deploy, or purchase without explicit applicable authorization.
