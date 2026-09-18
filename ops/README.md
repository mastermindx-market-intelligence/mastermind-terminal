# ops/ — VPS operational scripts

Source-of-truth for scripts deployed to the VPS. Orchestrator deploys; never edit files
in place on the VPS outside of a deploy.

## terminal-build.sh

VPS path: `/opt/terminal/terminal-build.sh` — the git-gated deploy script itself
(see `DEPLOY.md` for the full path-by-path deploy contract).

Every successful deploy re-installs this file from the exact admitted commit.
The first release that adopts a newer owner must execute that exact protected
`ops/` artifact; the installed copy takes effect on subsequent runs. Never edit
the box copy in place — it is overwritten by the existing owner.

The required invocation is:

```bash
/opt/terminal/terminal-build.sh \
  --target-sha <full-lowercase-40-hex-commit>
```

The SHA must resolve exactly and be contained by the freshly fetched protected
`origin/master`. The owner never infers a target from a moving branch tip.

The deploy writes the deployed commit to the gitignored
`terminal/.deployment-id` marker before restarting Next. `next.config.ts` reads
that marker during `next start`, keeping the runtime deployment ID identical to
the ID used during `next build` so clients never fetch the same chunks twice
under build-time and runtime cache keys.

## Terminal source audit and release preflight

`terminal_source_audit.py` is the fail-closed source-state engine. The reviewed
production policy is `terminal_source_audit.production.json`.
`terminal_release_preflight.py` reads the live deployment marker, runs that audit
against the exact deployed SHA, and publishes an immutable sanitized receipt.

These W2A tools are read-only except for receipt publication. They do not fetch,
reset, clean, build, synchronize source, restart services, or deploy. W2B-A makes that preflight the incumbent deploy owner's first gate: it must
return a bound immutable `CLEAN` receipt for the current generation before any
source or build mutation. The owner then admits only the explicit full SHA
contained by the freshly fetched protected ref.

W2B-B adds the next pre-live gate inside that same owner. It holds one root-owned
process lock, requires the exact production build runtime (`/usr/bin/node`
20.20.2, `/usr/bin/npm` 10.8.2, Ubuntu 24.04 / glibc 2.39 / x86_64), archives the
admitted Git object into an isolated root, performs fresh `npm ci` under a closed
process environment, and invokes Next directly so the legacy deploy-time data
coverage writer is not part of the build. Only an allowlisted `NEXT_PUBLIC_*`
surface and the incumbent Next preview/RSC key pair enter the build; receipts
record only identity hashes/expiry, never raw values.

`terminal_build_receipt.py` publishes the immutable pre-live build receipt under
`/var/lib/mastermind-terminal/build-receipts`. It binds the target tree, accepted
ref observation, W2A receipt IDs/policy digest, dependency lock, runtime identity,
public-env/key identities, BUILD_ID, and a canonical serving-output digest. A
repeated build with the same complete input fingerprint must produce the same
serving identity or fail closed. The receipt is read back before the owner may
reset/clean the canonical checkout or touch a live deploy generation.

W2B-B itself is still `BUILT_NOT_PROVEN` until protected review/merge and must not
be production-adopted independently. Whole-release transactional deployment,
rollback, served-browser proof, and drift detection remain W2B-C/W2C #483 work.

Full contracts, usage, retained host-owned path classes, and non-claims:
[`TERMINAL_RELEASE_PREFLIGHT.md`](TERMINAL_RELEASE_PREFLIGHT.md). The underlying
policy schema and finding codes are documented in
[`TERMINAL_SOURCE_AUDIT.md`](TERMINAL_SOURCE_AUDIT.md).

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
