# ops/ — VPS operational scripts

Source-of-truth for scripts deployed to the VPS. Orchestrator deploys; never edit files
in place on the VPS outside of a deploy.

## terminal-build.sh

VPS path: `/opt/terminal/terminal-build.sh` — the git-gated deploy script itself
(see `DEPLOY.md` for the full path-by-path deploy contract).

Every deploy re-installs this file from master onto the box, so an edit to
`ops/terminal-build.sh` takes effect on the **next** deploy after it merges.
Never edit the box copy in place — it is overwritten on every run.

The deploy writes the deployed commit to the gitignored
`terminal/.deployment-id` marker before restarting Next. `next.config.ts` reads
that marker during `next start`, keeping the runtime deployment ID identical to
the ID used during `next build` so clients never fetch the same chunks twice
under build-time and runtime cache keys.

## terminal-data

VPS path: `/usr/local/bin/terminal-data`
Cron: `30 21 * * *` (21:30 UTC = 17:30 ET, after US market close)

Nightly universe + price refresh. Two-phase design after the 2026-07-09 prevClose fix:

**Phase 1** (~5 min): flagship 37 + Polygon grouped-daily US OHLC + early hydrate → early
baseline swap. Gives the quote hub correct same-day prevClose by ~21:35 UTC.

**Phase 2** (~3-4 hr): full universe marathon (build_universe, expand, enrich, backfill,
gen_slices_all, intel bridge, intl OHLC) → final swap at ~03:00 UTC.

Both swaps are guarded by the 80%-count check (≥1000 floor).

Deploy: automatic — every `terminal-build.sh` run installs `ops/terminal-data` to
`/usr/local/bin/terminal-data` (merge to master → deploy; no scp).

## MACRO_DATA_DIR (event-impact route)

`terminal/app/api/event-impact/route.ts` (B-F08-5) joins the caller's open positions against
the macro nightly's `portfolio_ctx.json` artifact. That artifact lives under the macro repo's
own registration wall (`app/regwall.py`) — every `/data/*` path 401s an unauthenticated
server-to-server fetch (`x-regwall: deny`), so a plain HTTP `fetch()` to
`https://www.mastermind-x.com/data/portfolio_ctx.json` can never succeed in production.

Both products are deployed on the same VPS, so the route reads the artifact directly off disk
instead: `MACRO_DATA_DIR` (default `/opt/macro/site/data`, matching macro's own
`REPO / "site/data/portfolio_ctx.json"` read in `app/main.py`) names the directory holding
`portfolio_ctx.json`. The HTTP fetch is kept only as a fallback for a box where that path is not
mounted (local dev, CI, a future split deploy) — a 401/403/timeout from the fallback renders the
typed `upstream_locked` state rather than being confused with a genuinely missing/malformed
artifact (`calendar_unreadable`).

No deploy action is required beyond setting `MACRO_DATA_DIR` in `/etc/*.env` on the VPS if the
default `/opt/macro/site/data` ever diverges from macro's actual `REPO` path.
