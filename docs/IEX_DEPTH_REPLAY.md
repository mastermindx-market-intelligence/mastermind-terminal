# IEX historical depth replay

This extends the existing IEX HIST acquisition, `ingest/iex_deep_trades.py`
order lifecycle, `mastermind.large_trades.v1` artifact, authenticated
`/api/large-trades` reader and admitted IEX source. It adds no downloader,
provider socket, recurring worker, publication root, source-rights registry or
independent execution-accounting engine.

## User workflow

The existing Futures workspace links to `/options/equity-replay?symbol=NVDA`.
An admitted historical artifact with a `depthReplay` extension renders discrete
observed IEX book states, an explicit archive-acquisition clock, native-sequence
replay, and corrected price-by-price executed share volume. SPY and QQQ can be
selected on the same responsive page. Missing artifacts, wrong instruments,
incompatible units and source gaps remain unavailable; no fixture is substituted.

Prices remain exact integer units divided by 10,000 and quantities are shares.
They are never mapped to ES/NQ quarter ticks or called futures contracts. A depth
column represents ONE actual post-packet book observation, not an average across
time or evidence of continuous resting liquidity. No interpolation fills missing
columns. Displayed levels and retained observations have explicit finite limits.
An observed empty book differs from an unqualified/missing book.

The market watermark is at least both the source send clock and the latest
accepted event clock. Source-sequence gating also prevents a later execution with
an older event timestamp from appearing in an earlier selected book. All samples
remain available only at the recorded historical archive-acquisition time. This is
retrospective historical replay, NOT original intraday Mastermind possession.

Executed volume uses the existing `buildLargeTradesSnapshot` accounting, including
observed cancellations and unknown aggressor sides. It does not sum MBO changes
as trades or count trade breaks as new executions. The same source-sequence cutoff
controls book selection and eligible execution identities. Later corrections can
change a past execution's contribution at a later cursor; incomplete correction
history is not advertised as final-volume authority.

## Producer invocation: same source/CLI, explicit opt-in

```sh
python3 ingest/iex_deep_trades.py \
  --archive /Volumes/Mastermind/market-data/iex/hist/raw/DPLS/2026/10/20261005_IEXTP1_DPLS1.0.pcap.gz \
  --symbols NVDA,SPY,QQQ \
  --output-dir <new-private-output-directory> \
  --max-packets 2000000 --depth-snapshots \
  --depth-interval-ms 5000 --depth-max-frames 480
```

The existing acquisition receipt is used, not recreated. The original output
location must be reconciled before another invocation; the CLI refuses an
existing target. The optional sampler reads the incumbent decoder's deduplicated
orders after completed transport packets and never changes its lifecycle or
prints. Unknown prefixes, sequence gaps, orphan book mutations, overrun fills and
ambiguous symbol/stream bindings withhold depth. Explicit symbol-book clears can
restore a known empty baseline. Excess old observations are evicted from the
bounded presentation window and `samplingTruncated` is disclosed.

The existing private artifact writer retains the source and sampler hashes,
selected limits, stream state, native records and acquisition receipt. The
incumbent publisher may then project an approved artifact into its EXISTING
`MACRO_LIVE_DIR/large_trades/SYMBOL.json` location. This source PR does not itself
change that production directory or permission. The current API reads it under
its existing authenticated source-admission checks; the new page retains the
existing Options page gate.

## Verification boundaries

- The original 109 execution/parser tests plus 18 new sampler tests pass together.
  Observer-disabled outputs remain unchanged; enabled output only adds the
  optional depth extension and audit metadata.
- Deterministic tests cover duplicate packets, new-total modifications, removals,
  partial fills, trade breaks, gap recovery, unknown versus empty books,
  multiple streams, level/frame bounds, precise prices and native-sequence clocks.
- The preserved October 5 archive (9,875,890,058 compressed bytes) was already
  acquired by the existing #841 lane. This work did not re-download it.
- A bounded two-million-packet run consumes 312,182,060 decompressed prefix bytes.
  Prefix SHA-256 is `3b173fd73113318e5db6ac0d232c19f7a7aaa25b55bd92228b66b17406a9fe5d`,
  matching the accepted parent decoder prefix. Three selected symbols supply
  821 native executions / 69,144 shares, with no observed B in this prefix.
- The recent retained window contains 480 observations per symbol, roughly
  12:50–13:30 UTC, with up to 37/33/41 displayed orders for NVDA/SPY/QQQ.
  An artifact consumer compares corrected cumulative shares at selected states
  with independent scalar sums where no breaks are present. Actual break behavior
  remains deterministic-test proof, not an observed real-bust claim.
- Neither the full compressed archive hash nor full gzip integrity is recomputed
  by a bounded prefix run. No whole-session or consolidated-market coverage,
  original receive clock, hidden liquidity or predictive trading result is claimed.

## Local real-artifact consumer check

```sh
# From terminal/; all input bytes stay private.
node_modules/.bin/esbuild scripts/verify-iex-depth.ts --bundle --platform=node \
  --format=cjs --outfile=/tmp/mmx-verify-iex-depth.cjs
node /tmp/mmx-verify-iex-depth.cjs <private-output-directory> NVDA SPY QQQ
```

Use the actual JSON through the same API shape for browser tests. Label synthetic
HTTP fixtures as test evidence, and distinguish real historical data rendered over
an isolated test transport from an actual signed-in production customer session.
A source merge is not deployment or publication; the prior deployment SSH denial
remains held. A production canary still needs the installed candidate, admitted
publisher output and an existing entitled customer session.

## Source terms and non-substitution

IEX HIST is IEX-venue-only historical equities data, not live ES/NQ CME depth or
NDX options. Its existing source-admission owner requires the original attribution
and terms link, preserved by this view:

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree
to the IEX Historical Data Terms of Use.

https://www.iex.io/legal/hist-data-terms

The public historical rights do not establish a live IEX connection, consolidated
NBBO rights, an exchange-wide futures source, or a paid CME redisplay grant.

## Regular-session and full source-reader canary (2026-10-17)

A second explicit source window starts at 2026-10-05T13:30:00Z and uses six
million packets / a 1 GiB decompressed limit, without downloading another archive.
It ends at the packet ceiling, not at session completion: 938,216,356 prefix
bytes, 1,930 selected executions, 231,467 captured shares, and 43 book observations
per symbol covering approximately 13:30:00-13:33:30 UTC. It is an opening-window
sample, not a full-session feed. Its prefix hash is
`e4889c7b3a63d625efd8bb94914978dcf88896a825b5145d2206fa7a08a8332a`.

The opt-in `iexDepthRealSource.local.test.ts` reads actual private source files
through the unchanged production `/api/large-trades` function, filesystem bounds,
IEX source-admission checks and exact-byte digest, then the depth consumer. Only
the authenticated principal is an explicit mock. Its four passing cases prove
this source path, NOT an actual authenticated customer or a live deployed source.
The test is intentionally not executed without `IEX_DEPTH_REAL_DIR`:

```sh
IEX_DEPTH_REAL_DIR=<private-output-directory> node_modules/.bin/vitest run \
  lib/__tests__/iexDepthRealSource.local.test.ts
```

A separate localhost-only browser harness is `e2e/tools/qualify_iex_depth.mjs`.
It retains source hashes, verifies all three symbols at all three viewports,
checks real source quantities and raw level counts, and captions screenshots as
real historical data over an isolated test transport. Near-top (+/-1%) and all
retained-price views change only the picture, never quantities or source clocks.
