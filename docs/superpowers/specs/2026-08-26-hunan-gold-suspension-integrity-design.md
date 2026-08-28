# Hunan Gold suspension-integrity design

Date: 2026-08-26

## Problem

Terminal shows Hunan Gold (`002155.SZ`) at `24.56`, `+0.00%`, with a sequence of
flat daily candles after 2026-08-19. The dates look like a stalled feed, but the
company was suspended from trading beginning 2026-08-20. Yahoo emitted rows whose
open, high, low, and close all equal the prior close and whose volume is zero.
Macro retained those placeholders and Terminal published them as if they were
sessions.

Tencent's current quote record already distinguishes this state: field 40 is `S`.
Terminal normalizes the no-trade numeric shape to an EOD fallback, but it does not
carry or present that explicit suspension status. The result is a truthful last
price paired with a misleading `+0.00%` and fake dates.

## Product contract

1. The last genuine Hunan Gold candle remains 2026-08-19. No OHLC row is invented
   for a day with no trades.
2. The last genuine price remains visible as `24.56` while Tencent reports the
   instrument suspended.
3. Percentage-change surfaces show `Suspended` / `停牌`, not `+0.00%`, during the
   suspension.
4. The status automatically disappears when Tencent no longer reports `S`; the
   first genuine traded quote and daily bar resume the normal live path.
5. A genuinely traded flat session is preserved. The exclusion requires both a
   zero/non-positive volume and equal finite OHLC prices.

## Data flow

```text
Yahoo daily OHLC
  -> Macro _stock_ohlc extraction rejects zero-volume flat placeholders
  -> Macro Hunan Gold adjusted/raw parquet stores end on last real session
  -> Terminal build_universe applies the same defensive publication filter
  -> published 002155.SZ.json ends on 2026-08-19

Tencent quote field 40 == "S"
  -> Quote.suspended = true
  -> /api/quote preserves status while clearing fake current price fields
  -> Terminal shows last real EOD price plus Suspended status
```

## Implementation boundaries

Macro owns source-store integrity. Its shared China/Hong Kong yfinance extractor
will reject the placeholder shape before `store.upsert`, and the two committed
Hunan Gold planes (`china_stocks` and `china_stocks_raw`) will have the existing
synthetic rows removed.

Terminal owns publication and presentation. `build_ohlc_json` will independently
reject the same shape so a stale or externally supplied store cannot republish a
fake session. The Tencent parser will expose field 40 as an optional boolean; the
public quote normalizer will retain it while keeping current tradable fields null.
Desktop, tablet, and mobile quote surfaces will present the explicit suspension
state without changing the last genuine price.

## Failure behavior

- If Tencent is unavailable, Terminal falls back to the last genuine EOD data and
  does not claim suspension without evidence.
- If volume is missing rather than explicitly zero, the row is retained; absence
  is not treated as proof of a suspension placeholder.
- If OHLC differs or volume is positive, the row is retained even when the close
  is unchanged.
- If the instrument resumes, `S` disappears and no stored client state can keep
  the suspended badge latched.

## Acceptance evidence

- Focused Macro tests prove placeholder removal and traded-flat preservation.
- Focused Terminal tests prove export filtering, Tencent `S` propagation, public
  normalization, and no live-bar splice.
- The two Macro parquet tails and the published Terminal JSON end on 2026-08-19
  with nonzero volume.
- Terminal responsive E2E passes at 1440x900, 820x1180, and 390x844.
- Production `/api/quote?` returns `suspended:true` for `002155.SZ`, and a real
  browser shows `24.56` with `Suspended`, never `+0.00%`, at all three viewports.
