# Vercel frontend migration — Shared Shell beta and Terminal

**Workstream:** WS:MARKET-OS · **Operation:** vercel-frontend-migration-20261104-web
**Owner:** active Chairman-assigned attended Web session; source carrier Terminal `sol/web-vercel-frontend-migration-20261104-web`.
**Source at intake:** Terminal `494f75ad48aba86e0916cef21ffdacadef8fea28`; Macro `24bb49beebccc5ddf19e77082ea5bc0e8138bf13`; protected Mastermind procedure `7a52808e5761739a08b279dddba0d0c88e13224d` (Skillpack 1.0.1).
**Status:** source planning and qualification, not a Vercel production migration or accepted customer release.

## Outcome and constraints

Move **beta.mastermind-x.com** (Shared Shell, beta-only feature flag) and **app.mastermind-x.com** (Terminal) onto two independently deployed Vercel Next.js projects, using the one canonical `terminal/` Next.js 16 codebase. Preserve existing Macro/Python/Jinja/market data collectors, native API/account owners, Supabase identities and entitlements, quote hub, alerts, and persistent engines on their current approved backends. Do not create an alternative business logic, signal, identity, or market-data publisher. Preserve original VPS frontends and rollback until both cutovers have independent real-user proof.

**Commercial plan gate:** the connected Vercel team `team_Wxiikqc462Fq5I15NROgNAvw` is **Hobby** as observed November 4, 2026. Vercel terms restrict Hobby to non-commercial personal use. No commercial preview/production deployment or public DNS cutover is authorized until the account owner changes this team to Pro/Enterprise via the provider's billing UI and readback confirms it. Do not upgrade, enter payment details, or move secrets by automation.

**Existing Vercel projects:** `mastermind-terminal` (Next.js configured, unproven, last production deployment canceled) and `macro` (Python configured; recent deployment fails `PYTHON_ENTRYPOINT_NOT_FOUND`). Do not reuse Macro's Python project as the Shared Shell. Existing `macro-eiz4` is another Terminal-linked project and must be inventoried before project creation to avoid duplicates. No Vercel deployment is production acceptance.

## Dependency graph / editorial task tree

- **P0: Baseline / authority / collision** — in_progress
  - P0.T1: Reconcile existing Terminal and Macro source, live separate ports 3000 and 3001, Caddy/EdgeOne/DNS routes, active Shared Shell feature PRs and Vercel project settings. **Done when:** exact source, current project IDs, environment keys (no values), frontend/data/API ownership, live rollback and permissions are documented.
  - P0.T2: Confirm Vercel commercial entitlement, plan/billing approval and production environment. **Blocked:** Vercel team presently Hobby. No commercial Vercel deploy before verified plan.
- **P1: Separate browser frontend from mutable backend assets** — ready, source work only.
  - P1.T1: Produce a single strict, allowlisted market-data origin contract for Vercel. Before-file routing must prevent tracked `terminal/public/data` snapshots being served as live data. Retain unchanged VPS data production semantics and explicit freshness/staleness evidence.
  - P1.T2: Correct monorepo `terminal/` Vercel root/framework/build (including the existing Python prebuild outside root), and safely handle stable per-deployment ID, auth cookie/same-origin API/CSP and iframe allowlists.
  - P1.T3: Inventory and classify `terminal/app/api` handlers: Vercel-suitable stateless handlers, VPS-bound read/proxy, write/entitlement sensitive, WebSocket/stream/long-lived. No blind catch-all proxy or widened authentication.
- **P2: Backend origin and config** — blocked on approved domain/env/custody
  - P2.T1: Install a distinct HTTPS market data/API upstream route to existing VPS without depending on a hostname being moved to Vercel; source-manage Caddy + EdgeOne, prevent cache poisoning, expose only approved paths.
  - P2.T2: Map required Supabase/auth, Stripe, API, feature flag, secure server environment and secret rotation needs to each project. Copy secrets only via accepted secret-owner controls; no values in docs/logs.
- **P3: Shared Shell staging and beta release** — blocked on P0.T2, P1, P2
  - P3.T1: Deploy reviewed exact source to dedicated **Shared Shell** Vercel project with `MMX_SHARED_SHELL=1`; preserve guest/login/legacy frame/route behavior and no-store private responses.
  - P3.T2: Verify direct/refresh/back/forward, About and legacy Jinja pages, persistent navigation, native Discover/Analysis/Monitor/Research/Portfolio, desktop 1440, tablet 820, phone 390, EN/ZH, dark/light, auth transitions and old-origin continuity.
  - P3.T3: Stage exact production build without domain, run real production-path tests, switch only beta DNS/EdgeOne, verify served build/cookies/API/data/CDN; ensure one-action rollback to prior VPS beta and prove it.
- **P4: Terminal release** — blocked on stable P3 and independently qualified P1/P2
  - P4.T1: Deploy Terminal project using `MMX_SHARED_SHELL=0`, proper Next.js root; verify charts, indicators, saved state, options/Prophet, intraday/quotes, alert/portfolio/API, auth/entitlements and market-data refresh.
  - P4.T2: Stage exact immutable production build, independent CI/security/real-browser evidence; switch `app.mastermind-x.com` only after a distinct backend origin is live (no self-referential proxy).
  - P4.T3: Confirm active source/version, error budget, market freshness, p50/p95 navigation and first-load measurements, writes/rollback, no service interruption; retire previous frontend only after stable proof.
- **P5: Operations and cost** — ready for nonmutating design, production verification later
  - P5.T1: Bind git-gated Vercel source, protected checks, production promotion, immediate rollback and domain ownership without replacing established GitHub review/merge law.
  - P5.T2: Configure observability, error/latency monitoring, usage/spend guard, CDN cache exceptions for account state, deploy-chunk skew and invalidation, plus a tested incident/rollback runbook.

## Acceptance falsifiers and guarded non-goals

- A build, preview, 200 status, CI green, or GitHub merge without live user-path evidence is **not** migration completion.
- `/data/manifest.json`, `/data/coverage.json` and price/bar/intel artifacts must reflect current independent publishers; Vercel static git snapshots are prohibited as their replacement.
- Old customer bookmarks, cookies, premium access, auth, cross-origin legacy pages and personal writes must behave identically; private data must not appear in public cache or route catalogs.
- The beta and Terminal domains switch separately. Terminal must not proxy backend requests to its own future hostname.
- No change to Vercel billing, production DNS, data publisher, active feature PRs, secret plaintext, branch protection or mandatory non-author release approval without the exact eligible owner and proof.
- Preserve shared-shell intelligence work on Terminal #1244 and related navigation/performance owners; this migration owns deployment configuration and disjoint tests, not their live feature sources.

## Current evidence / next action

- Original VPS Caddy serves `app.mastermind-x.com` via :3000, beta via :3001, and live `/data/*` directly from host-owned files. The existing build overlays mutable `terminal/public/data` and scheduled workers, which cannot be treated as Vercel immutable source.
- Root `terminal/package.json` is Next.js 16.2.9; `prebuild` executes `python3 ../scripts/build_data_coverage.py`; Vercel monorepo build includes the external source dependency.
- **Next:** implement and test the isolated Vercel data-origin/source-snapshot guard, then port monorepo project settings and release checks. **Held:** live Vercel deployments and domain mutations until commercial plan and backend origin qualification.

## 2026-11-04 isolated frontend source milestone

A source-pinned managed Terminal worktree was acquired through the existing `mmx-workspace` authority on M2:
`/Volumes/Mastermind 2/agent-workspaces/terminal/web/vercel-frontend-migration-20261104-web`, branch `sol/web-vercel-frontend-migration-20261104-web`, source `494f75ad48aba86e0916cef21ffdacadef8fea28`. No primary checkout was modified.

The implementation is strictly additive to the legacy VPS deployment:
- `terminal/next.config.ts` enforces explicit mode `MMX_SHARED_SHELL=0/1` and approved `MMX_MARKET_DATA_ORIGIN` during `VERCEL=1` builds; it refuses missing, recursive, HTTP, credentialed and path-bearing origins.
- Vercel `beforeFiles` rewrites all `/data/:path*` requests to the dedicated immutable-configured HTTPS upstream so tracked Git market-data snapshots cannot win filesystem precedence. Existing VPS routing is unchanged.
- Publisher-created `/data/manifest.json` and `/data/coverage.json` get a 60-second Vercel edge TTL instead of being bound to a frontend deploy. No Vercel data freshness is claimed until a valid origin is installed and measured.
- The Vercel deployment ID is taken from `VERCEL_GIT_COMMIT_SHA` when the existing explicit VPS marker does not apply, while retaining the native path.
- `terminal/scripts/prepare-data-coverage.mjs` preserves the original Python coverage generator for VPS builds, but skips generation on Vercel, preventing a misleading fresh index from checked-in historical fixtures.
- `terminal/scripts/vercel-frontend-contract.test.mjs` has 14/14 deterministic passed tests under installed Node 26: default VPS compatibility, required mode and origin, eight unapproved origins, exact rewrite precedence, manifest TTL, build ID and no fixture-generation on Vercel.

**Non-proof:** these tests do not demonstrate current DNS, commercial eligibility, live upstream security, Vercel deployment, authenticated browser paths, full application build, or served production acceptance. An isolated Next.js build is part of the next qualifying stage; its result must be recorded separately. The existing Vercel project holds unrelated sensitive environment key *names* and should not be used for a public release without an owner-qualified least-privilege configuration review (secret values were not retrieved).

## API migration refinement — exact build identity, not a blanket proxy

The current application has 109 `terminal/app/api/**/route.ts` handlers (source at Terminal `494f75ad`). A first-pass local scan found six handlers with direct filesystem/runtime artifacts, one with process-like longpoll usage, four stream-like, and 66 mentioning authentication; this is a *direct-file heuristic only*, not a complete dependency-closure classification. Exact source checks and browser/API probes still own acceptance.

**Disallowed shortcut:** a universal `/api/:path*` rewrite to the legacy Terminal origin will intercept `/api/shared-shell/status`. That endpoint reports `SHARED_SHELL_BUILD` and the route registry hash from the actual serving build. An old VPS backend can report a different build/flag and cause the Vercel shell to refuse its own legacy framing/availability. The first draft blanket proxy was tested locally but **rejected before publication**; do not reenact it.

**Migration rule:** retain the Vercel frontend's own build-identity/status path and scope any future VPS API delegation to an explicit, reviewed allowlist. For each candidate include source route, dependent local service, original credential/auth semantics, cache/privacy, upstream hostname, source-version compatibility and negative tests. No wildcard `/api/*` before-files routing without exact contract-level qualification. The data-only `/data/:path*` rewrite is distinct and remains valid.

**Origin conflict:** Macro PR #10670 and #10678 currently both edit `app/deploy/Caddyfile` and associated tests. Preserve their active source carriers; a dedicated `data.mastermind-x.com` / `terminal-origin.mastermind-x.com` serving candidate must be integrated serially after ownership/current source/merge reconciliation, not by racing another Caddyfile writer. Neither hostname currently has proven live DNS/origin-readiness in this session.
