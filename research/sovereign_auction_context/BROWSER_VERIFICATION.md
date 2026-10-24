# Terminal sovereign auction browser verification handoff

**Status: runnable source prepared; browser execution is pending root's official Mac workspace.** The two TypeScript files pass Node v24.19.0 syntax checking. No Playwright, Next, browser, host-entitlement or production result is claimed by this author.

## Copy targets and command

Copy these new files into the already acquired Terminal operation worktree, preserving the paths beneath `terminal/`:

- `terminal/e2e/sovereign-auction-context.spec.ts`
- `terminal/e2e/fixtures/sovereign_auction_context_full_capture.json`
- `terminal/playwright.sovereign-auctions.config.ts`

The original authoritative fixture must already be present at `terminal/lib/__tests__/fixtures/sovereign_auction_context_w1.json`. The spec asserts its exact SHA256 before running. It imports the actual final validator from `terminal/lib/sovereignAuctionContext.ts`; it never renders a substitute component.

From the operation worktree's `terminal/` directory, after choosing a free dedicated local port:

```sh
TERMINAL_E2E_PORT=33187 npm run test:e2e:responsive -- --config=playwright.sovereign-auctions.config.ts
```

`33187` is an example reservation, not a verified free port. Root should read local listener state and select an unoccupied operation-specific port. The focused config requires an explicit valid port, inherits the existing `playwright.config.ts` and all its fixture environment settings, selects exactly the canonical desktop/tablet/mobile projects, uses one worker with no retries, and sets `reuseExistingServer:false`. A conflicting listener should fail rather than silently test another checkout. Playwright owns the local Next child process and should terminate it when the run ends. No watcher or provider job is armed.

The existing config supplies `TERMINAL_E2E_FIXTURE=1`, its fixture email/entitlement, `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key`, existing market fixtures and the existing route warmup. The wrapper does not add a production flag or auth bypass. Use lockfile-installed `@playwright/test` and its Chromium browser. If the browser executable is absent, report that exact local dependency gate; do not claim a run occurred.

Use the full standard `npm run test:e2e:responsive` separately when required by the owner gate. This focused run does not silently substitute for unrelated required CI checks.

## Actual composition prerequisite

The source census found **NeuralWebStrip is dormant**: it has no product importer. A wrapper rendered only in its own test would therefore leave `/terminal` unchanged. Root independently confirmed this in the canonical worktree.

The source-only integration should mount the `SovereignAuctionContext` leaf directly in the active detail surface. After a fresh overlap census, root selected the existing `.detail-scroll`, **after `.sa-btn-group`**, preserving the held returns-calendar owner's insertion before that button group. The spec locates only `data-testid=sovereign-auction-context`, so it remains independent of the precise approved wrapper. It requires exactly one real mount and fails if the component is absent; it never injects HTML or mounts a test React tree.

The dormant market-plane strip must remain dormant. The spec checks that `.nw-strip` is absent and `/api/nw?f=market_plane` is never requested. It snapshots the active `.sig-btn` text before changing auction states and checks exact equality afterwards. This verifies the visible incumbent signal card; it does not claim a full Oracle overlay/ARM/CONFIRM history audit or predictive validation.

## What the spec exercises

Each test starts in a fresh Playwright BrowserContext, enters `/terminal?symbol=NVDA` once, waits for the real existing `mm:terminal-visual-ready` handoff, scrolls the active detail surface and opens the native disclosure. No reload is used to recover a state.

The canonical projects supply **1440×900, 820×1180 and 390×844**. EN and ZH are selected through the existing `mm.lang` preference and real `LangProvider`. Tests cover:

- The authoritative three-Bill fixture's episode ID, exact `95000000000 USD`, October 13 17:00 UTC deadline, source observation and decision-cutoff clocks, null-result wording, not-scored/research-only state and unassessed freshness.
- Genuine full-source expansion from six rows to the maximum 24 of 74, valid row identities, scheduled rows before results and chronology within each group.
- A genuine observed result displayed after the three genuine announced Bills, using actual captured numbers rather than invented result values.
- Degraded source coverage with last-good observation preserved and the explicit diagnostic `fixture_transport_failure` reason.
- Unavailable 503, sign-in-required 401, entitlement-denied 403, invalid widened authority, and valid observed-empty state; previously displayed event bytes disappear on refusal.
- No document or disclosure-content horizontal overflow, no nested anchors, a reachable Bill amount/deadline row, bounded expansion and unchanged visible incumbent signal text.

Each state writes screenshot and JSON measurement attachments beneath Playwright's normal test-results output. Filenames carry viewport project, language, theme/diagnostic and state. The JSON includes measured geometry, displayed episode IDs, fixture request counts, blocked external origins and page errors. The spec fails on unhandled page errors rather than filtering them silently.

## Theme truth

The existing Terminal shell contract is **dark-only** (also cited by the inspected September invite-link capture harness). The supported visual pass is EN/ZH in dark mode.

To honor the requested robustness check without inventing a theme feature, the two extra cases set `data-theme=light` after normal dark-mode hydration and record the actual computed background/foreground. Their names and Playwright annotations explicitly say **light attribute diagnostic**. They do not claim a supported light theme, activate a new setting, add CSS, or change production theme behavior.

## Fixture, authentication and network boundaries

The baseline wrapper SHA256 is `b3e7eb3b5ca32e0ebe3d23011d9fa917841f38e9fb436c73c8ca62b53b01d0cb`. Its source history and conservative receipt basis remain exactly root's authoritative fixture.

The larger projection SHA256 is `80b6a9f2c061804709ed965e92da5b7a073aab5b53b987975f185c690fa69222`. It was generated from the four genuine primary-runtime captures through final W1 `snapshot` at `2026-10-08T22:54:00Z`, then the actual Terminal pure validator. There are 74 episodes: 43 observed results, 28 tentative and three announced. `FULL_CAPTURE_FIXTURE_RECEIPT.json` records producer/source hashes and URLs. The expanded file is a browser fixture, not a forecast study. The failure/empty/invalid variants are explicitly diagnostic mutations of these fixtures and supply no new economic evidence.

The browser Date is fixed at `2026-10-08T22:55:00Z` with Playwright's documented `clock.setFixedTime`; timers and animation frames keep running. This avoids invalidating PIT fixtures during future reproduction and does not alter source timestamps or suggest a historical forecast decision.

The fake browser session uses the exact encoding pattern already documented in `e2e/tools/capture_w9t_f12_17_invite_link.cjs`: `sb-127-auth-token.0 = base64-<base64url JSON>`. The token and refresh token are conspicuously fake; the host is loopback. It is seeded in the document initialization script **after the initial server request**, so the server's initial middleware does not inspect a fake auth cookie. The actual browser Supabase client reads it and emits its real initial-session callback. Only the loopback `/auth/v1/user` lookup is answered with the corresponding fake user. Other loopback Supabase operations receive 503.

All browser HTTP(S) requests outside the selected Next origin and the intercepted loopback auth URL are aborted. External WebSockets are also refused; only the selected local Next HMR socket may connect. Service workers are blocked. The local browser uses the existing harness's `bypassCSP` setting solely to permit the intercepted loopback auth lookup. **This run therefore does not verify production CSP or real authentication.** The browser routing is not a server-process network sandbox; the existing Next E2E fixture environment governs its own server dependencies.

`page.route` answers `/api/nw` at the browser boundary. The actual proxy's cookie relay, timeout, redirect refusal, private cache headers and malformed-wrapper handling are verified by the separate native route tests. Browser fixture responses cannot prove those properties, actual Macro publication, `/feeds/event_calendar.json` entitlement guarding, a real account's access, or an exact deployed SHA. These remain separate gates.

Same-tab real auth callbacks and stale response generation checks have native React regressions in the implementation. This browser spec does not claim real sign-out, refresh-token rotation or cross-account Supabase integration; testing those against a real service requires separate authorized host acceptance.

## Source context and local preparation receipts

`SOURCE_CONTEXT_RECEIPTS.json` identifies the exact pinned Playwright config, app route, TerminalShell, Supabase cookie/client/middleware and existing E2E helper sources inspected. No additional source files are missing for this bounded spec. Root owns the current-branch/preimage and overlap checks before copying it.

Executed during preparation:

```sh
node --check terminal/e2e/sovereign-auction-context.spec.ts
node --check terminal/playwright.sovereign-auctions.config.ts
```

Both syntax checks passed under Node v24.19.0. They do not resolve TypeScript imports or constitute a Playwright/browser run. Root's native typecheck and actual local run must establish that remaining evidence.
