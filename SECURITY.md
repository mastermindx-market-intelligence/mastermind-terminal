# Security hardening — code & data theft

Audit + hardening pass (2026-07-12). Goal: raise the cost of stealing the site's code and data.

**Reality check.** `app.mastermind-x.com` is a public web app that must render proprietary data and
run charting logic in the browser. Nothing the browser receives can be made truly un-copyable. The
strategy is to (1) remove the cheap bulk-scrape primitives, (2) close the CDN-bypass hole, (3) add
rate limiting + auth gates so mirroring needs real accounts/effort, and (4) keep the crown-jewel
math server-side. What can't be prevented is called out at the bottom.

---

## Shipped in this repo (code/config — deployed via the normal git-gated build)

| Change | Files | What it stops |
| --- | --- | --- |
| **Security headers on every app route** — CSP (incl. an exact `frame-ancestors` allowlist for the first-party Macro Dashboard), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS | `terminal/next.config.ts` | Competitors iframing/rehosting the UI (clickjacking/embedding); MIME confusion; referrer leakage. `X-Frame-Options` is intentionally omitted because it cannot express a cross-origin allowlist; modern CSP admits only `mastermind-x.com` and `www.mastermind-x.com`. |
| **Source-map lock** — `productionBrowserSourceMaps: false` (was Next's default; now pinned) | `terminal/next.config.ts` | Trivial de-minification of client JS back to readable source. |
| **Per-IP rate limiting** on the open read APIs (300 req/min/IP/route, `RATE_LIMIT_MAX`-tunable; returns `429 + Retry-After`), with a **hard live-bucket ceiling** (`RATE_LIMIT_MAX_BUCKETS`, default 20k/limiter) so a high-cardinality IP flood is refused rather than allocated. Deliberately not an LRU: a tracked bucket is never evicted to admit a new IP, so address rotation cannot reset a spent quota. `/api/snapshot` uses this limiter rather than a private map of its own | `terminal/lib/rateLimit.ts`, `app/api/{quote,intraday,flow,nw,ext-quote,snapshot}/route.ts` | Symbol-by-symbol scraping of quotes/intraday/flow via the API, and memory exhaustion of the origin through spoofed/rotated client-IP headers — the brake must not itself be the resource the flood is after. Origin-side brake; the durable layer is edge rate limiting (owner action below). |
| **Auth defence-in-depth** — explicit `.eq("user_id", …)` on every RLS-only read/delete | `app/api/{drawings,layouts,alerts,watchlist}/route.ts` | Cross-user data access if Supabase RLS is ever misconfigured (a single-boundary failure becomes a two-boundary failure). |
| **`drawings` table RLS migration** (table existed with no tracked migration / no guaranteed RLS) | `supabase/migrations/0002_drawings.sql` | Any user reading/writing every user's drawings via the public anon key. |
| **`/data/*` static headers** — `Cross-Origin-Resource-Policy: same-origin` + `nosniff` | `app/deploy/Caddyfile` (macro repo) | Other origins' pages reading the per-symbol JSON via `fetch`/XHR (browser hotlinking/embedding of the dataset). |

**Verified:** `tsc --noEmit` clean, 143 tests pass, all 7 headers emitted, the Terminal renders fully
under the CSP with zero console violations, and the limiter returns `300×200 → 429` with `Retry-After`.

CSP note: `script-src`/`style-src` use `'unsafe-inline'` because the locale bootstrap script
(`app/layout.tsx`) and Next's App Router streaming inject inline `<script>`/style. A **nonce
migration** would let us drop `'unsafe-inline'` and is the recommended follow-up XSS hardening.

---

## Owner actions required (console/infra — code can't do these)

Ordered by leverage.

1. **Close the CDN-bypass hole (highest leverage).** The public `macro` repo's Caddyfile + README
   disclose the origin VPS IP `146.190.142.17`, and `firewall-cloudflare.sh` opens `:443` to the
   whole internet — so `curl -k https://146.190.142.17/data/<SYM>.json -H 'Host: app.mastermind-x.com'`
   **bypasses the CDN entirely**, voiding every edge control below. Fix: restrict origin `:443` to
   EdgeOne's published origin-pull IP ranges (ufw / cloud firewall), then **rotate the origin IP**
   (it's burned). Keep `admin.mastermind-x.com` (grey-cloud, direct) reachable via an allowlist/VPN.

2. **Enable EdgeOne WAF: per-IP rate limit + bot rules on `/data/*` and `/api/*`.** This is the real
   brake on headless scraping that the origin limiter and CORP can't provide. Only effective *after* #1.

3. **Make the `macro` GitHub repo private + purge history.** It's currently PUBLIC and leaks: the
   origin IP, full service/port topology, admin console location, `ADMIN_PASSWORD`/`MASTERMIND_PASSWORD`
   env paths, the public R2 bucket URL, and `research/momoedge/our_terminal_map.md` (a source-audit
   map of the private Terminal). Flip to private, then `git filter-repo`/BFG the IP + R2 URL + admin
   topology out of history (they persist after any edit).

4. **Lock down the R2 bucket** `pub-f7ffb4441c5f4ad983ca56ec7c651c61.r2.dev` (world-readable, predictable
   keys → `live_flow/feed_current.json`, `live_flow/tickers/<ROOT>.json` return 200 no-auth). Make the
   `live_flow/*` + `options_hub/*` prefixes private/signed and front them via `/api/flow`. **Keep
   `snapshots/*` public** — those are OG unfurl images (and the CSP `img-src` allows `*.r2.dev`).

5. **Strip proprietary signals from the public `manifest.json`.** The 1.9 MB whole-universe manifest
   (8,736 symbols) is the scraper's index and also ships per-symbol backtest outputs
   (`verdict/wr/pf/cagr/regimeBull`). In the nightly pipeline generator, emit a **minimal public
   manifest** (ticker + name + exchange only) and serve quote/signal fields through an authenticated,
   rate-limited API. Highest-value single data-theft fix; the generator lives in the data pipeline.

6. **Turn auth on** once login is live: `TERMINAL_REQUIRE_AUTH=1` in the `terminal.service` env. Note
   this gates page/SPA routes only — `/data/*` (Caddy) and `/api/*` need #1/#2 + the shipped limiter.

7. **Rotate + verify.** Rotate `ADMIN_PASSWORD` and `MASTERMIND_PASSWORD` (names/paths are public).
   In Supabase, confirm RLS is **enabled** with owner policies on all user tables incl. `drawings`
   (the 0002 migration doesn't retro-fix an already-created live table). Enable EdgeOne "Force HTTPS"
   + edge HSTS. Confirm the VPS build ships no `*.map` under `.next/static`.

**No action needed:** the Supabase key in the public repo is the `anon` key (role-checked; designed to
ship, protected by RLS). No `service_role` key is tracked anywhere.

---

## Open code follow-up (tracked separately)

- **Move `flow_score_v1` server-side.** `terminal/lib/flowScore.ts` ships the full scoring model
  (weights + curve constants) to the browser. Moving `computeFlowScore` into `/api/flow` (client reads
  the server-attached score) removes the ~150 lines of curve math from the bundle. Deferred here
  because it's a refactor of a live feature that needs verification against the real flow backend, not
  just the fixture — spun off as its own task.

## What cannot be prevented (set expectations)

The Pine v6 interpreter, TradingView-parity `techRating.ts`/`indicators.ts` math, and any indicator
that runs in-browser for chart interactivity are **inherently recoverable** from the bundle even
minified (comments strip; formula structure survives). Mitigate with aggressive mangling + a
proprietary-license header + ToS, and keep only genuinely-secret math server-side (the flagship
BUY/SELL verdicts already do this correctly — they read a precomputed oracle value, not the model).
Treat client-side analytics as a legal/deterrence problem, not a purely technical one.
