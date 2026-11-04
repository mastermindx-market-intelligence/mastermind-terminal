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

## Live legacy control, November 4 read-only observation

On M2 `curl`, the current beta `https://beta.mastermind-x.com/api/shared-shell/status` returned HTTP 200, enabled true, `buildId=3930ce93bb1ed6f3d66ba1ae4cac7e441995ba78`; the Terminal `https://app.mastermind-x.com/api/shared-shell/status` returned HTTP 200, enabled false, `buildId=db06eacd8938cf44588d3906bca95bfd7122b74b`. Both reported the same underlying legacy bridge `20261018.1`. Their differing build IDs are positive real-path evidence that a blanket status proxy to the old Terminal would invalidate a new Vercel beta identity. These were unauthenticated GET baseline observations only, not full application acceptance.

The incumbent `https://app.mastermind-x.com/data/manifest.json` returned HTTP 200, a `macro-multimarket` payload and `as_of=2026-11-03` (market-data freshness semantics require the owning publisher's clock). The proposed `https://data.mastermind-x.com/data/manifest.json` failed DNS `ENOTFOUND`, confirming the dedicated origin is not yet provisioned. A live-data change, DNS cutover, or new frontend deployment is not claimed.

Read-only `data.mastermind-x.com` Caddy candidate is now GitHub [Macro #10729](https://github.com/mastermindx-market-intelligence/macro/pull/10729), head `674072ad5a40f10508195fe9a4de0d6afbf310da`. Caddy v2.11.4 adapted it with existing Caddyfile, and its three unit/adapter tests passed. Candidate remains dormant; Macro #10670/#10678 still open and collision-sensitive.

The Vercel source config now also **requires** a 40-character `VERCEL_GIT_COMMIT_SHA` for every Vercel build rather than silently accepting a stale VPS fallback. The versioned Shared Shell contract cannot become `unversioned` by omission. 16/16 source contract tests pass, including omitted/malformed Git identity, and a fresh Next.js production build with explicit committed source identity passed (102.14 seconds); no hosted Vercel deployment or commercial plan change has occurred.

**Remaining acceptance gates:** provider plan upgrade, distinct HTTPS origin DNS/TLS/install proof, API route and auth compatibility, scoped Vercel project setup/secure env, CI/current reviewed source, live beta real-path and rollback, then separately live Terminal real-path and rollback. Source readiness does not grant production readiness.

## Explicit API continuity — source implementation (Vercel only)

Rather than putting the 109 incumbent Terminal API handlers into unproven Vercel Functions with missing local quote-hub and private server dependencies, the reviewed frontend now preserves the existing API execution owner by mapping **50 source-listed API family roots** through Next `beforeFiles` to the matching current VPS service. For Shared Shell, only `/api/shared-shell/today` and `/api/shared-shell/research/:path*` use that backend. `/api/shared-shell/status` remains **local on the Vercel build** to preserve the actual frontend `buildId`, registry fingerprint and versioned bridge status. No broad `/api/:path*` rewrite is used. Private/no-store API cache rules apply to Vercel mode. The test derives API family coverage from `terminal/app/api/` to fail if a new top-level route family is omitted.

The origins are strictly mode-specific:
- `MMX_SHARED_SHELL=1`: `MMX_TERMINAL_API_ORIGIN=https://beta-origin.mastermind-x.com` -> the existing port3001 beta API and matching source release.
- `MMX_SHARED_SHELL=0`: `MMX_TERMINAL_API_ORIGIN=https://terminal-origin.mastermind-x.com` -> port3000 production Terminal API.
- Both use `MMX_MARKET_DATA_ORIGIN=https://data.mastermind-x.com` from the existing live publisher, never a frontend hostname or static Git asset.

The Caddy-source API host candidates are added only as uninstalled source under [Macro #10729](https://github.com/mastermindx-market-intelligence/macro/pull/10729). The original `Caddyfile` is untouched. Installation requires explicit Caddyfile serial adoption after #10670/#10678 and accepted DNS/TLS/security testing of Host/Origin/cookies, CSRF, rate limits, cross-origin mutation paths, mixed source versions and browser-to-Vercel-to-VPS request bodies. Vercel environment grants are not inferred; secrets stay on current authorized VPS and must not be copied from an unrelated Vercel project.

The isolated Vercel config now passes **23/23** local source contract tests, including both beta/Terminal backend maps, source inventory coverage, build-local status, cache headers, incorrect/missing API origin and recursion refusal. A full local Next.js production build with these 52 explicit API mappings and both market-data/source guards completed successfully (~107s). That compilation used a test `VERCEL_GIT_COMMIT_SHA` value; the final Git SHA and hosted build identity must be separately verified at deployment. No real API backend alias is currently resolvable, and no public domain or account has moved.

## 2026-11-04 continuation — required CI integration

The original standalone 23-case Vercel contract runner depended on Node 26 native TypeScript stripping, but Terminal's protected unit/typecheck job uses **Node 20**. Source was hardened to transpile the real `next.config.ts` in memory using the repository's existing locked TypeScript dependency; no runtime or build configuration changes were required for the test harness. `lib/__tests__/vercelFrontendContract.test.ts` runs the complete executable 23-case suite under the normal Vitest collection, so the existing required `npm test` CI step enforces the migration contract without adding a second workflow/CI owner. Node v26 local verification of the revised runner passed 23/23; Vitest integration passed 1/1 (7.04s). Exact CI Node 20 acceptance is still owed and cannot be claimed from the local Node 26 run alone.

At this continuation's initial exact source observation, Terminal #1284 head `6240427528d9e61b809e8598ef25b862db83a701` showed one red browser check `Terminal e2e desktop-5 (shard)` within a partially running run, while Macro #10729 head `377ea9158cb1dbb2a8d33a23ea318523babeb9a0` showed 22 successful checks, four skipped and an inactive `ci-authority/codex/merge-queue-pilot` failure. Neither status equates to reviewed/releasable CI; do not bypass the true browser regression or claim a nonbinding pilot red proves production failure. The desktop-5 run remained in progress when a bounded job-log read was attempted; do not repeatedly poll unchanged logs. No deploy/domain mutation or account upgrade occurred.

Current architecture retains explicitly selected beta-vs-Terminal API forwarding and the local Shared Shell status path. The two Caddy origin candidates remain dark and source-isolated while original Caddyfile #10670/#10678 custody, DNS/TLS/security and paid Vercel eligibility remain unresolved.

## 2026-11-04 Vercel team configuration and authentication gap — exact names, no values

Read-only Vercel team audit of `team_Wxiikqc462Fq5I15NROgNAvw` confirmed **Hobby**. Existing Git-linked project `mastermind-terminal` (`prj_pwdArfRQq01jn90RPxcu0iOhFsL7`) and second Terminal-linked `macro-eiz4` (`prj_QgGFI4GStQtojkNqCJd4Nfk8tF58`) both have 14 old sensitive environment key **names**, including Codex/Claude/LLM and bot/internal settings. Neither returned inventory contains `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which are required by the current `lib/supabase/client.ts`, `server.ts`, middleware session refresh, and `app/auth/callback`/signout. No value was decrypted or copied; unrelated tokens must not be inherited by an externally hosted frontend. The distinct `macro` Python Vercel project is not a Shared Shell deployment target.

**Review-only intended allocation once the eligible commercial team and credential owner authorize it:** reuse `mastermind-terminal` as the app frontend; evaluate repurposing existing second Terminal Git project `macro-eiz4` as isolated Shared Shell beta rather than creating an unnecessary third project. Verify Git source/repo, root `terminal/`, Next.js framework, Node supported version, output/build settings, no automatic customer-domain assignment, source-pinned release and least-privilege keys before changes.

The required public build inputs for each project are:
- Beta: `MMX_SHARED_SHELL=1`; `MMX_MARKET_DATA_ORIGIN=https://data.mastermind-x.com`; `MMX_TERMINAL_API_ORIGIN=https://beta-origin.mastermind-x.com`.
- Terminal: `MMX_SHARED_SHELL=0`; same data origin; `MMX_TERMINAL_API_ORIGIN=https://terminal-origin.mastermind-x.com`.
- Both: owner-approved `NEXT_PUBLIC_SUPABASE_URL` (exact HTTPS origin) and its matching **publishable** `NEXT_PUBLIC_SUPABASE_ANON_KEY` (neither currently installed), injected through the environment owner, not a checked-in value. `VERCEL_GIT_COMMIT_SHA` is provider-supplied for Git builds; never hardcode an arbitrary build identity. No `SUPABASE_SERVICE_ROLE_KEY`, LLM provider secrets, VPS credentials or arbitrary local-only tokens are needed for the frontend architecture.

The new Vercel-only Next config fails at build/config evaluation when these Supabase public inputs are missing, the URL is not an exact HTTPS origin, or backend origins/mode/source SHA are unsafe. The existing VPS configuration is unchanged. Source tests exercise errors with **synthetic fixture strings only**.

**Preview/auth boundary:** `lib/supabase/cookies.ts` defaults production cookies to `Domain=.mastermind-x.com`. A `*.vercel.app` preview cannot set that cookie domain and **does not qualify as authenticated continuity proof**, even if its guest page loads. Use an approved staging/preview hostname under `mastermind-x.com` and exact Supabase OAuth redirect/PKCE configuration for real signed-in acceptance; no blanket wildcard provider callback allowlist or cookie downgrade. Preview guest-only checks and authenticated first-party staging are distinct evidence. Never claim the latter from the former.

Additional independent blockers remain DNS/EdgeOne/TLS origins, signed-in browser API/CSRF and POST/streaming verification, protected reviews and current-head CI, beta rollback before Terminal cutover, and controlled commercial Vercel account change. None is solved by creating a Vercel project name.

## Staged-host guest acceptance — executable, read-only proof

A deterministic `terminal/scripts/verify-vercel-staging-guest.mjs` now implements the **guest-only** staging gate, separate from authentication/production acceptance. It accepts an exact staged HTTPS origin under `mastermind-x.com` or the connected Vercel team's deployment-host suffix, the explicitly expected 40-hex source SHA, and the beta/Terminal mode. It refuses live app/beta domains as staging targets to prevent a false pass against the incumbent frontend. Redirects are not followed. The tool sends **no cookies, tokens, writes, domain changes or browser state**.

For a qualified first-party beta staging hostname, run only after DNS/TLS/API/data origin readiness:
```bash
node terminal/scripts/verify-vercel-staging-guest.mjs --target=https://beta-stage.mastermind-x.com --mode=beta --sha=ACTUAL_FORTY_HEX_GIT_SHA
```

The canary checks `/api/shared-shell/status` against the **exact staged source SHA**, expected beta/Terminal enabled state, protocol and registry hash, private/no-store response headers, and compares the real `/data/manifest.json` bytes and publisher `as_of` with the corresponding still-live original domain at the same acceptance interval. It returns a typed JSON receipt containing only source/data hashes and publisher metadata, with `authenticatedProof=false` and `productionCutoverProof=false`. Publisher updates between reads legitimately fail closed and must be reconciled against the original source; a stale snapshot must never be accepted because JSON shape matches.

Seven synthetic, in-memory network tests cover approved target scopes, exact source/mode, byte-identical publisher, stale data, unsafe public caching and untrusted redirects without accessing any real hostname. The existing required Vitest CI harness now runs these seven and the 28 Vercel config tests together. **No live staging hostname, provider entitlement or authenticated session has been proven.** Full Playwright 1440/820/390, identity/OAuth/paid entitlements, API mutations and stream paths, beta/Terminal rollback and production switch remain separate gates.
