# Mastermind Quote Hub

Localhost-only (127.0.0.1:3100) WebSocket fan-out + REST quote server for the
Mastermind Terminal. Serves crypto (OKX UTC-0 spot plus USDT perpetual companion, Coinbase
rolling-24h fallback), delayed-US (Polygon AM.*) or entitled
real-time US (Polygon A.* per-second aggregates), and
macro (futures / indices / FX, near-live via Sina) quotes to the Next.js frontend via
loopback proxy.

## VPS deploy path

```
/opt/terminal/hub/          ← working directory
  hub.js                    ← entry point
  lib/
    anchor.js               ← session-keyed prevClose resolution (new 2026-07-09)
    coinbase.js
    okx.js
    polygon.js
    store.js
    extfeed.js              ← extended/overnight equity prints (alpaca / webull / yahoo)
    macrofeed.js            ← macro quotes: sina near-live + yahoo-spark delayed (new 2026-07-27)
    quotes.js               ← symbol routing + /quotes response assembly (new 2026-07-27)
    log.js
  package.json
  node_modules/             ← npm ci after deploy; ws only dependency
```

Env vars come from `/opt/terminal/.env` (EnvironmentFile in the unit):

| Var | Required | Notes |
|---|---|---|
| `POLYGON_API_KEY` | yes (US feed) | Polygon stocks key (delayed or RT-entitled) |
| `HUB_POLYGON_CLUSTER` | optional | `live` → wss://socket.polygon.io (basis `LIVE`); requires an RT-entitled plan + signed exchange agreements. Anything else/unset → delayed cluster (basis `DELAYED_15M`). A non-entitled key on `live` auto-demotes to delayed for the process lifetime — flip the env only after the plan upgrade, then `systemctl restart quote-hub`. `/health` reports the effective `cluster` |
| `MANIFEST_PATH` | optional | default `/opt/terminal/terminal/public/data/manifest.json` |
| `HUB_DATA_DIR` | optional | directory of per-symbol `<SYM>.json` files; default = dirname(MANIFEST_PATH) |
| `HUB_PORT` | optional | default 3100 |
| `HUB_DISABLE_US` | optional | set to `1` to disable the Polygon US feed |
| `HUB_DISABLE_CRYPTO` | optional | set to `1` to disable Coinbase/OKX |
| `ALPACA_API_KEY` | optional | Alpaca free plan key — enables overnight/ext ws feed |
| `ALPACA_API_SECRET` | optional | Alpaca free plan secret |
| `EXT_FEED_DISABLE` | optional | set to `1` to disable the entire ext-hours feed |
| `WEBULL_DISABLE` | optional | set to `1` to disable **only** the Webull ext leg (Alpaca + Yahoo legs unaffected) |
| `MACRO_FEED_DISABLE` | optional | set to `1` to disable the macro feed — futures/indices/FX drop out of `/quotes` entirely |
| `HUB_DISABLE_SNAPSHOT` | optional | set to `1` to disable the REST snapshot leg (reverts to exactly the pre-2026-08-07 behaviour — symbols the stream is not carrying fall back to the nightly manifest) |
| `HUB_GIT_SHA` | optional | commit/build identity, read once at boot and echoed on `GET /health` as `build`. `null` when unset (every environment today). Deployment-identity seam for the R1A-T Task T3 post-deploy running-commit proof — the deploy path may later export it; nothing else consumes it |
| `HUB_REALTIME_QUOTES` | optional | set to `1` to put the snapshot leg in **real-time mode**: 8s poll (vs 60s) and a `lastTrade` parse. Requires the Massive "Stocks Advanced" plan; **US STOCKS ONLY** — no index/futures/FX/crypto entitlement. **Also gates the Terminal's second-resolution bar band** (`/api/intraday` refuses `1s/5s/15s/30s` unless this is set, and the timeframe picker renders the Seconds group disabled to match) — one lever for everything real-time-derived, so the pending anonymous-vs-sign-in ruling has a single switch to land on. Set `HUB_POLYGON_CLUSTER=live` as well to feed each open chart the official `A.*` per-second OHLC stream; otherwise the snapshot lane remains the freshest source. See below |

Both new feeds are **keyless**: no credentials are required for the Sina, Yahoo-spark or
Webull legs.

### Real-time tier — the flag enables, the MEASUREMENT labels

`HUB_REALTIME_QUOTES=1` does **not** make anything claim to be real-time. `SnapshotFeed.verdict()`
times the youngest print seen against the wall clock, and `store.getQuotes` stamps
`basis: "REALTIME"` only on that verdict — so a plan downgrade, an entitlement change, or a
vendor outage degrades the label automatically instead of leaving a stale promise in the UI.

**Two measurements, because they answer different questions.** `verdict()` grades the FEED and
is deliberately a FLOOR across symbols — a per-symbol rule would call a legitimately quiet name
"delayed" on a genuinely real-time feed. But a badge is per SYMBOL, so `store.getQuotes` applies a
second, per-name bound (`NAME_REALTIME_MAX_LAG_MS`, 15 min) before adopting a row as real-time.
Without it a floor of 3s set by one liquid name let a quiet name's 5h55m-old print publish
`basis: "REALTIME", live: true` — a green "Live" chip on a six-hour-old price, with the real age
reachable only on hover. A row failing that bound keeps the delayed basis and labels.

The verdict measures a **floor across symbols**, not a per-symbol age: an illiquid name can go
ten minutes without printing on a genuinely live feed, while a 15-minute-delayed plan cannot
produce a print younger than 15 minutes for *any* symbol. `/health` reports
`snapshotFeed.verdict` as `{tier, floorLagMs, measuredAt, session}`, where `tier` is
`realtime | delayed | unknown | closed | off`. Outside a US session it refuses to grade at all
(`closed`) — an old print proves nothing when nothing is printing.

With the real-time tier measured, `getQuotes` switches from "the stream is authoritative" to
**freshest-print-wins**, because the WebSocket cluster stays `delayed` unless
`HUB_POLYGON_CLUSTER=live`; a tie keeps the stream so a quiet symbol cannot flap between legs.

Re-measure any time (never prints the key):

```sh
POLYGON_API_KEY=… HUB_PORT=3100 node hub/tools/measure-freshness.js --rounds 10 --every 10 --hub
```

## systemd unit

```ini
# /etc/systemd/system/quote-hub.service
[Unit]
Description=Mastermind Quote Hub (crypto + delayed-US fan-out)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/terminal/hub
EnvironmentFile=/opt/terminal/.env
ExecStart=/usr/bin/node hub.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/opt/terminal/terminal/public/data
PrivateTmp=true
MemoryMax=256M

[Install]
WantedBy=multi-user.target
```

Deploy steps (executed by the orchestrator, never in this build stage):

```bash
# 1. rsync hub/ to VPS
rsync -av hub/ root@146.190.142.17:/opt/terminal/hub/

# 2. install deps on VPS
ssh root@146.190.142.17 "cd /opt/terminal/hub && npm ci --omit=dev"

# 3. reload and restart
ssh root@146.190.142.17 "systemctl daemon-reload && systemctl restart quote-hub"
```

## prevClose / chg fix (2026-07-09)

**Root cause:** `manifest.json` baseline is stale all day — the nightly pipeline takes 4+
hours and atomically swaps the manifest only at the very end (~03:00 UTC). Hub was
deriving `prevClose = manifestLast / (1 + manifestChg/100)`, which when the manifest is
from yesterday produces the close two days ago as the anchor.

**Fix:** `lib/anchor.js` — `AnchorCache` keyed by `(sym, ET-session-date)`.

Resolution order:
1. **Daily file** `/opt/terminal/terminal/public/data/<SYM>.json` — last completed bar
   whose date is before today-ET. During RTH this is yesterday's close. After the daily
   file rolls (post-close), the second-to-last bar is yesterday and the last bar is today's
   official close (surfaced as `close` + optionally `afterHours`).
2. **Polygon REST** `/v2/aggs/ticker/<SYM>/prev` — cheap, one call per sym per session,
   cached in the AnchorCache entry.
3. **Manifest fallback** — last resort, emits `stale_anchor: true` on the quote.

The cache key includes the ET session date, so a process alive across a midnight boundary
gets a cache miss on the new key and re-resolves fresh — no TTL guessing.

## After-hours semantics

When the official session close is known (daily file has rolled):

- `close` — official EOD close price
- `afterHours` — present only when the delayed AM print differs from `close` by >$0.01
- `chg` — always vs `prevClose` (yesterday's close), not vs the AH print

The UI should show `close` as the primary price with a CLOSED badge, and `afterHours` as
a secondary subtle "AH <price>" line when present.

## Extended-hours feed (ext fields)

`lib/extfeed.js` adds extended/overnight trade data as a secondary block alongside the primary quote.

**Session windows (ET):**

| Window | Identifier | Coverage |
|---|---|---|
| Pre-market | `pre` | 04:00–09:30 ET |
| Regular trading hours | `rth` | 09:30–16:00 ET — ext fields suppressed |
| Post-market | `post` | 16:00–20:00 ET |
| Overnight | `overnight` | 20:00–04:00 ET (Blue Ocean ATS) |

**Feed selection (automatic):**

Serve priority is **Alpaca → Webull → Yahoo/R2 relay**, evaluated per symbol on every read.
A leg is skipped when it has no usable print, so an empty Alpaca map no longer blanks the
ext block.

| Priority | Leg | Condition | Coverage |
|---|---|---|---|
| 1 | Alpaca overnight ws | `ALPACA_API_KEY` + `ALPACA_API_SECRET` set and auth succeeded | All ext windows; true overnight via `v1beta1/overnight` feed (UNCONFIRMED — entitlement depends on Alpaca plan) |
| 2 | Webull keyless REST | always, unless `WEBULL_DISABLE=1` | Pre-market + post-market **confirmed**; true overnight **best-effort** — accepted only when the print passes the session gate below |
| 3 | Yahoo unofficial / R2 relay | always (last resort) | Pre-market + post-market only; never overnight |

**Webull leg detail** (`extSource: "webull"`):

- `quotes-gw.webullfintech.com` — `search/pc/tickers` resolves `sym → tickerId` once (cached
  for the process lifetime; misses cached 1 h), then `stock/tickerRealTime/getQuote` is polled
  every 60 s, **only outside RTH**, sequentially with a 150 ms stagger. LRU cap 30.
- The ext print is taken from an explicit overnight field (`ovnPrice`/`overnightPrice`/…) when
  Webull exposes one — the discovered key name is logged once — otherwise from `pPrice` with
  `tradeTime` as its timestamp. Every numeric field arrives as a **string** and is `Number()`d.
- **Session gate (the honesty rule).** A print is cached only when its own timestamp classifies
  into the *same* session that is currently being served, and is under 90 minutes old. Webull
  keeps serving Friday's last post-market print all weekend; without this gate that stale number
  would be published as live Sunday-overnight data. A rejected print writes **nothing** — the
  previous (honest) cache entry survives untouched.
- Whether Webull carries true overnight (20:00–04:00 ET, Blue Ocean) prints through
  `pPrice`/`tradeTime` is **unverified** — only pre-market was testable from the VPS. The gate
  decides at runtime rather than trusting the source blindly.

> **Note:** The 30-symbol free-plan websocket cap and overnight feed entitlement on Alpaca's
> Basic (free) plan are not confirmed in Alpaca's primary public documentation. Both may require
> a paid plan. If `ALPACA_API_KEY` / `ALPACA_API_SECRET` are set but auth returns 402/403, the
> hub automatically degrades to Webull and then the keyless Yahoo leg.

**Multi-user note:** The hub is a singleton. The 30-symbol LRU budget is shared across ALL users. A
`/quotes` request for symbol X from any user advances X to MRU. The oldest symbol is unsubscribed when
the cap is exceeded. This is intentional: the hub is a loopback fan-out, not a per-user socket pool.

**Ext fields on US quotes (outside RTH only):**

```
extPrice     number   — latest ext trade price
extChg       number|null — (extPrice − closeRef) / closeRef × 100; closeRef = officialClose when daily file has rolled, else prevClose (prior-session close); null only when neither is available
extTs        number   — Unix seconds of the ext bar
extSession   string   — 'pre' | 'post' | 'overnight'
extSource    string   — 'alpaca_overnight' | 'webull' | 'yahoo_unofficial' | 'yahoo-relay'
```

These fields are absent (never emitted) during RTH. They are also stripped if the cached ext print ages past 90 minutes.

A cache entry missing a finite `price`/`ts` is discarded at serve time rather than emitted —
a populated `extSource` with a missing `extPrice` is worse than no ext block at all.

## Macro feed (futures / indices / FX)

`lib/macrofeed.js` answers macro symbols through the same `GET /quotes` contract. Before this,
the terminal fetched them itself from Yahoo spark at `DELAYED_15M`; the hub now serves the
liquid contracts near-live.

**Crypto change basis.** OKX is the preferred crypto writer. Its `sodUtc0` anchor is used for
`prevClose`/`chg` on the canonical `-USD` spot rows, and the matching `-USDT-SWAP` ticker is
carried as `perpLast`, `perpPrevClose`, `perpChg`, `perpOpen`, `perpHigh`, `perpLow`, `perpVol`,
`perpTs`, `perpChangeBasis`, and `perpSource`. If OKX is unavailable for 60 seconds, the warm
Coinbase socket becomes the fallback; its `changeBasis: "ROLLING_24H"` is explicit so a degraded
quote is not mistaken for the UTC-day basis. Both sockets are kept warm and only the coordinator's
primary may write canonical fields.

**Routing.** `isMacroSymbol()` claims a symbol before the `us`/`crypto` classifier ever sees it:
literal `DX-Y.NYB`, `^INDEX` (caret), `*=F` (futures), `*=X` (FX). Macro symbols bypass the
Store, Polygon and the AnchorCache entirely — they carry their own `prevClose`/`chg` and have no
manifest or daily file to anchor against.

**Legs.**

| Leg | Source | Cadence | Labels | Coverage |
|---|---|---|---|---|
| Sina | `hq.sinajs.cn/list=<codes>` — one batched GET for every demanded code | 3 s | `source: "sina"`, `basis: "LIVE"`, `live: true` | The 13 mapped contracts below (~seconds behind) |
| Yahoo spark | `query1.finance.yahoo.com/v7/finance/spark` — chunked ≤18 symbols (Yahoo 400s above ~20) | 15 s | `source: "yahoo-spark"`, `basis: "DELAYED_15M"`, `live: false` | **Every** demanded macro symbol — the only source for what Sina lacks (`^GSPC`, `^TNX`, `^VIX`, FX pairs, `PL=F`, `PA=F`, `RTY=F`) *and* the standby a Sina-mapped symbol falls back to when that leg goes stale |

A delayed source is **never** labelled `LIVE`. Sina requests need `Referer: https://finance.sina.com.cn`
and a `Mozilla/5.0` User-Agent; the GBK response is decoded as latin1 (every field we read is ASCII —
only the Chinese contract name, which we ignore, is affected).

**Symbol map.**

| Symbol | Sina code | Contract | Symbol | Sina code | Contract |
|---|---|---|---|---|---|
| `CL=F` | `hf_CL` | WTI crude | `ZC=F` | `hf_C` | CBOT corn |
| `BZ=F` | `hf_OIL` | Brent crude | `ZS=F` | `hf_S` | CBOT soybeans |
| `NG=F` | `hf_NG` | Henry Hub nat gas | `ZW=F` | `hf_W` | CBOT wheat |
| `GC=F` | `hf_GC` | COMEX gold | `ES=F` | `hf_ES` | E-mini S&P 500 |
| `SI=F` | `hf_SI` | COMEX silver | `NQ=F` | `hf_NQ` | E-mini Nasdaq 100 |
| `HG=F` | `hf_HG` | COMEX copper ⚠️ | `YM=F` | `hf_YM` | E-mini Dow |
| `DX-Y.NYB` | `DINIW` | ICE dollar index | | | |

`hf_PL` (platinum), `hf_PA` (palladium) and `hf_RTY` (Russell 2000) return **empty strings** on
Sina and are deliberately absent from the map — those symbols fall to the Yahoo leg.

> ⚠️ **HG=F unit quirk.** Sina quotes COMEX copper in **US cents per pound** (`640.013`), while
> Yahoo `HG=F` — what the terminal charts and what the nightly daily files store — quotes **USD
> per pound** (`6.40013`). Every price field (`last`/`open`/`high`/`low`/`prevClose`) is scaled by
> `0.01` for this symbol **only**. Serving the raw number would make the live price look 100× the
> chart. `chg` is scale-invariant and unaffected.

**Row layouts** (0-indexed, verified live 2026-07-27). `hf_*`: `[0]` last, `[2]` bid, `[3]` ask,
`[4]` high, `[5]` low, `[6]` `HH:MM:SS` Beijing, `[7]` prior settle → `prevClose`, `[8]` open,
`[12]` `YYYY-MM-DD` Beijing, `[13]` name. `DINIW` differs: `[0]` time, `[1]` last, `[3]` prev
close, `[5]` open, `[6]` high, `[7]` low, `[10]` date. Timestamps are Beijing wall-clock (UTC+8,
no DST) converted to epoch seconds; the row's own clock is used, never ours.

**Demand + budget.** `demand(sym)` on every `/quotes` request drives an LRU with cap **64**,
shared globally across all users (same singleton model as the ext feed). The cap must stay above
the catalog's macro count (49) — one below it and the last symbol rotates through eviction
forever, never holding a cached quote. Symbols idle for 30 min are dropped along with their
cached quotes. A poll cycle with nothing demanded on its leg is skipped entirely — no request is
made.

**Staleness.** Each entry carries its own honest `ts`, and both legs cover every demanded symbol,
so `getQuote()` serves whichever entry carries the later print (ties go to Sina — the near-live
leg, which also carries session high/low the spark row lacks). A served **Sina** print older than
15 minutes is demoted to `basis: "DELAYED_15M"` / `live: false`: past that point it is the last
print before a session break, not a live one. The price and its `ts` are untouched — on a weekend
Friday's settle *is* the right answer, and labelling it `LIVE` until Monday is not.

**Backoff.** A failed poll logs (rate-limited), bumps a consecutive-error counter and leaves the
last good cache in place — it never throws out of the timer. The next poll is armed at
`interval × 2^min(errors, 5)`, capped at **60 s** (Sina) and **300 s** (Yahoo), and returns to the
base interval on the first success. This VPS's IP is already Yahoo-429-prone; re-arming a fixed
15 s timer into an upstream that is refusing us is how a soft rate-limit becomes a hard block.

**Macro quote shape:**

```
sym, last, chg, prevClose, open, high, low,
vol: null, amount: null,          — Sina's global-futures rows carry no usable volume
ts, live, source, market: "macro", basis
```

## HTTP API

```
GET /health
→ { ok, port, build, quotes, manifest:{path,mtime,symbols}, anchorCache:{size,dataDir},
    cryptoPrimary, coinbase, okx, polygon, extFeed, macroFeed, ts }

GET /quotes?syms=NVDA,AAPL,BTC-USD,CL=F,^GSPC[&view=full|regular]
→ { NVDA: { sym, last, chg, prevClose, close?, afterHours?, open, high, low, vol,
             ts, live, source, market, basis, anchor_source, stale_anchor?,
             extPrice?, extChg?, extTs?, extSession?, extSource?, changeBasis?,
             perpLast?, perpPrevClose?, perpChg?, perpOpen?, perpHigh?, perpLow?, perpVol?,
             perpTs?, perpChangeBasis?, perpSource? }, ... }
```

The response is always a **flat `{ SYM: quote }` object carrying present entries only** —
merging the macro feed did not change that contract. Symbols with no quote are simply absent
(never `null`), and `cn`/`hk`/`ca` listings are still never served.

`build` is the deployment-identity marker for the running commit — `HUB_GIT_SHA` read once
at boot, `null` when the env var is unset (every environment today; see the deploy path
before relying on it).

### `view` — closed vocabulary (Reactive Projection R1A-T)

`view` is a **closed** query parameter, not a free-form flag:

```
missing view          → exactly `full` (today's unchanged default behavior)
view=full             → unchanged: SnapshotFeed + Polygon + AnchorCache + ExtFeed demand;
                         response rows may carry ext* fields
view=regular          → SnapshotFeed + Polygon + AnchorCache demand still run; ExtFeed.demand()
                         is called ZERO times; the response never receives/uses ExtFeed and
                         never carries an ext* field on any row, even when the Store holds a
                         legacy row that already has one (e.g. from an earlier view=full
                         request against the same symbol)
anything else          → HTTP 400 with an opaque `{ error }` body — unknown, blank, repeated
                         or conflicting `view=` values (`?view=all`, `?view=full&view=regular`,
                         `?view=regular&view=regular`) are all refused, never silently
                         defaulted
```

`view` is parsed and validated **before** the empty-`syms` early return, so
`?syms=&view=bogus` is `400`, not an empty `200`.

Regular view is closed at two boundaries, both load-bearing: (1) demand — `extFeed.demand()`
is never called, so a public poll over the view never spends a slot in the shared 30-symbol
ExtFeed LRU; (2) response — `extFeed` is never forwarded into `store.getQuotes`, AND a final
pass strips every `ext*` key from every row immediately before the response is returned,
independent of (1), so a Store row already poisoned with ext fields from a prior full-view
request can never leak them back out under `view=regular`. See
`lib/quotes.js::parseQuoteView` / `applyDemand` / `buildQuotesResponse` /
`handleQuotesRequest`, and `tests/quotes.test.js` / `tests/quotes_http.test.js`.

This closes the endpoint that Macro's Reactive Projection R1A-M batch route
(`app/intelligence-hub-market-pulse`, macro repo) consumes — a 60-second poll over up to 58
Intelligence Hub names must not churn extended-hours demand that belongs to interactive
Terminal users. No second endpoint, feed, store, cache, scheduler, service or credential was
added; `view=full` and a missing `view` remain byte-for-semantic compatible with every
existing caller.

`extFeed.health()` gained a `webull` block, and `/health` gained a top-level `macroFeed` block:

```
extFeed.webull  → { subs, cacheSize, tickerIds, lastPollAt, consecutiveErrors, lruCap }
                  or { disabled: true } when WEBULL_DISABLE=1

macroFeed       → { sinaSubs, yahooSubs, cacheSize, lastSinaPollAt, lastYahooPollAt,
                    sinaConsecutiveErrors, yahooConsecutiveErrors, lruCap }
                  or { disabled: true } when MACRO_FEED_DISABLE=1
```

`anchor_source` is one of `"snapshot"`, `"daily_file"`, `"polygon_prev"`, `"manifest"`,
`"quote_partial"`. For a current US session, a same-session snapshot reference wins: its
`day.c` and `prevDay.c` are one internally consistent pair and must not be split by a later
serve-time re-derivation from the daily file. After the ET date rolls, a completed snapshot
pair is reused only when its `day.c` matches the independently resolved latest daily close;
it remains labeled with its actual `regularSessionDate`.
`stale_anchor: true` means the anchor fell back to the manifest and may lag one session.

**Sample /quotes response with ext fields (AAPL, pre-market window):**

```json
{
  "AAPL": {
    "sym": "AAPL",
    "last": 316.22,
    "chg": 0.9,
    "prevClose": 313.39,
    "close": 316.22,
    "open": 310.5, "high": 316.53, "low": 308.16, "vol": 44882363,
    "ts": 1783627200,
    "live": false,
    "source": "polygon-delayed",
    "market": "us",
    "basis": "DELAYED_15M",
    "anchor_source": "daily_file",
    "extPrice": 314.5,
    "extChg": -0.5443,
    "extTs": 1783671300,
    "extSession": "pre",
    "extSource": "yahoo_unofficial"
  }
}
```

**Sample /quotes response for macro symbols (`syms=CL=F,HG=F,^GSPC`):**

```json
{
  "CL=F": {
    "sym": "CL=F",
    "last": 82.543,
    "chg": -7.577,
    "prevClose": 89.31,
    "open": 86.12, "high": 86.2, "low": 82.46,
    "vol": null, "amount": null,
    "ts": 1785144763,
    "live": true,
    "source": "sina",
    "market": "macro",
    "basis": "LIVE"
  },
  "HG=F": {
    "sym": "HG=F",
    "last": 6.40013,
    "chg": 0.6705,
    "prevClose": 6.3575,
    "open": 6.362, "high": 6.4065, "low": 6.34,
    "vol": null, "amount": null,
    "ts": 1785144760,
    "live": true,
    "source": "sina",
    "market": "macro",
    "basis": "LIVE"
  },
  "^GSPC": {
    "sym": "^GSPC",
    "last": 7501.25,
    "chg": 0.7217,
    "prevClose": 7447.5,
    "open": null, "high": null, "low": null,
    "vol": null, "amount": null,
    "ts": 1785144699,
    "live": false,
    "source": "yahoo-spark",
    "market": "macro",
    "basis": "DELAYED_15M"
  }
}
```

Note `HG=F` is already rescaled to USD/lb — the raw Sina row read `640.013` cents.

## Tests

```bash
cd hub && npm ci && npm test        # 183 tests, node:test, fully offline
```

Every HTTP transport in the macro and Webull suites is injected, so the tests make no network
calls. Note that on Node ≥ 22 the positional argument to `--test` is a **glob, not a directory**:
use `node --test "hub/tests/*.test.js"` (or `npm test` from `hub/`). A bare `node --test hub/tests/`
fails with `MODULE_NOT_FOUND`.
