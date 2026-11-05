# Stock Intelligence R6 — Evidence Desk implementation plan

**Goal:** Make the existing stock Intelligence workspace useful in the first five seconds, with compact source qualification, immediately comparable evidence and a searchable, source-faithful historical timeline.

**Architecture:** Extend the existing OracleDash, source cache and intelligenceActivity owner. Extract a focused presentational overview rather than another decision engine. Preserve the actual Terminal chart, all four views, signal semantics, entry qualification, source clocks and permission boundaries.

**Tech stack:** Existing Next.js 16 / React 19 / TypeScript / CSS modules / Vitest / Playwright. No dependency addition.

**Authority / continuity:** Current Chairman explicitly requested further design and implementation. Parent carrier Terminal #612. R5 PR #1252 is MERGED at `45528fe7be9372ba99f47cb4ebbeac86f9f0dfc2`; never reuse its completed branch. New managed operation `stock-intelligence-r6-20261103-c3` starts at protected Terminal `f528a219cc5d73e94e058575e3df83d689632bf9`. Governing procedure pin remains Mastermind `9f65957e29eba92245d78609f032aaea523b7cb4`, skillpack 1.0.1 / bootstrap-major 1. Direct execution reason: PRINCIPAL_JUDGMENT and LOWER_TOTAL_OVERHEAD for a tightly coupled design/implementation iteration. No new reviewer runner or retry of the historical R4 Fabric failure.

## Intent and approach

Primary persona: a stock researcher working beside an active chart, moving rapidly between symbols. Their first task is to understand available evidence, its date and its limits; their deeper task is to inspect research and trace past events back to the chart.

Considered approaches: (1) cosmetic R5 refresh retains the oversized unavailable-state hero and does not add useful work; (2) a new full-screen route would duplicate existing chart and navigation owners; (3) a denser, elegant evidence desk within the existing responsive workspace adds materially useful exploration without those costs. The third is the implementation choice under the user's delegated design authority.

R6 moves from a large warning to a compact current-entry status with its limitation intact. Source comparison becomes two responsive cards (Oracle / Research), a separate Prophet observation, historical sample context and a small recent-events trail. Deep source detail and retries remain reachable. No confidence percentage, aggregate buy/sell recommendation or invented live source is added.

Activity adds a literal, bounded, bilingual search; category counts; newest/oldest order; and an explicit clear-search state. Source timestamps, chart coordinates, original row keys and classification are preserved. Missing dates sort last in both orders. A displayed Starter, refused/retro event or candidate never becomes a current entry permission.

## Global constraints

- One source workspace and publisher, exact-head commit/push; no shared primary-checkout edits.
- Paper file `01M3NSZGE8JWN2EZCSF0DT05RM`, page `p-I-1`; R5 boards `1NT3-0` and `1NXH-0` are retained reference anchors. New R6 board/node targets only; screenshot actual edited boards.
- Existing tabs, desktop nonmodal docking, resize, chart jumps, safe-area mobile sheet, focus return, keyboard tabs, reduced motion and existing entitlement behavior remain.
- Scope new styles to stock overview/explorer components; other Sector Intelligence consumers of the old shared stylesheet must not be redesigned.
- No chart schematic is treated as market data. No new calculation/authority/data pipeline; use existing source contracts and classifications.
- English and Chinese, 1440×900 / 820×1180 / 390×844; add 320px and long-label checks. Light tokens may be tested as a labeled component specimen where the Terminal route itself is dark-only.
- Protected CI, required independent non-author approval, merge/deploy holds remain binding. Local fixtures and Paper proof are not production proof.

## Review focus / falsifiers

1. A historical bullish regime must never override the unavailable current-entry qualification.
2. Search for Starter/Stop/blocked/candidate in either language must return the correct source class, not simply raw BUY/SELL strings.
3. Filter counts must describe the searched source cohort and may not turn missing source coverage into an observed zero.
4. Search, sort and pagination must not leak state across a rapid symbol change or reuse another symbol's data.
5. Long labels, stale research, refresh failure, no Prophet permission, empty/undated events and actual zero prices remain readable and correctly labeled.

## Ordered work

- [x] R6.1 — Freeze design and create editable Paper compact overview + activity targets. Visually inspect and extract the accepted markup, keeping app integration on existing routes.
- [x] R6.2 — Add RED unit tests for bilingual literal Activity search, query bounds, category counts, stable sorting, undated-last and source preservation in `terminal/lib/__tests__/intelligenceActivity.test.ts`. Implement those pure display/exploration helpers in the existing `terminal/lib/intelligenceActivity.ts` owner; prove GREEN.
- [x] R6.3 — Add failing browser assertions for the compact overview, source inspection/refresh and search/sort/reset interaction. Implement a focused `StockEvidenceOverview` and stock-scoped CSS module; connect it through `OracleDash.tsx`. Extend Activity without changing entry/history semantics.
- [x] R6.4 — Run focused source tests, TypeScript and exact browser journeys. Screenshot actual desktop/tablet/mobile EN/ZH states; inspect clipping, typography, hierarchy and touch/focus. Repair identified regressions and rerun their original checks without weakening assertions.
- [ ] R6.5 — Publish coherent source/proof on the managed branch, open successor PR linked to #612/#1252, consume current-head CI and formal reviews, then protected integration/deploy/live proof where all required gates permit.

## Completion ruler

Design, implementation, local verification, CI, independent approval, merge, deployment identity and authenticated product acceptance are separate claims. Do not mark the whole mission complete until the real live Intelligence journeys pass. When release is held, finish all independent source and proof work, then preserve exact current state and next action in the same #612 carrier.

## Implementation / review frontier

R6.1–R6.3 are implemented. Real Paper board `1SNP-0` was screenshotted and visually corrected for text contrast; source-card JSX was extracted after QA. Editing completion returned APPLIED on the original Paper carrier after one exact-file snapshot refresh. R6.4 completed36 browser checks with12 expected skips and zero retries,231 focused unit tests, current-source TypeScript and the added-line plain-language guard. The strengthened keyboard-to-chart journeys passed6/6. R6.5 publication/release is the next phase.

Important self-QA findings already repaired: clear-search lost keyboard focus; the initial compact Oracle card could omit the canonical newer-refusal subtitle and incorrectly borrow latest-marker quality; per-row Intl formatter construction made 400-event searches take about150ms. Repairs keep original test assertions, restore source-owned wording, return focus and reuse only locale formatters (not a second data cache). A 320px geometry test now reads both rectangles atomically in one frame rather than comparing two different frames of the sheet entrance animation.

Protected Terminal advanced only through `e48170b609dddf3b5b4eba1c047620d5d017290f` (#1263) after pickup. Both updated agent guides were read. The clarification permits session-owned technical self-QA but explicitly preserves required independent/formal review until the proposed risk-rule exemption is actually protected and enrolled. No early exemption is claimed; no ancestry-only merge is needed for this docs-only movement.

Original typed publisher precheck initially refused before effect during the owned dependency clone/slow git status. After the clone completed, read-only same-owner status was0.26s and the original typed publication status succeeded: HEAD unchanged, dirty owned files, remote absent. This is material same-carrier recovery evidence, not a permission bypass. The next coherent source commit still uses the original typed publisher.


## Recovery phase — 2026-11-04

R6 publication already exists as PR #1274, original branch/operation unchanged. The first head `da1d713634e7f39ea2ffe5fd1e7a27ac6cbb6c22` completed all 17 hosted CI jobs, including the three required checks. Formal independent approval remains absent; no merge/deployment is claimed.

The live source audit completed CLEAN at deployed `db06eacd8938cf44588d3906bca95bfd7122b74b`. Fresh guest browsers on desktop EN and mobile ZH proved the deployed product still lacks R6; this avoids misreading green source CI as a shipped UI. Production access used the existing repository-provisioned identity; no credential, host, service or auth changes were made.

Live AMZN/COST/NVDA data revealed a real R6 search defect: raw numeric indexing did not find many displayed two-decimal prices. The minimal repair indexes the displayed value alongside the original number without changing source data/classification. Six regression cases failed before the fix, all seven new cases passed after it, and 238 focused tests passed. All 1,161 finite prices in the same three live response snapshots now find their own records (545 missed before). The full 36-pass/12-device-skip browser matrix passed again with zero retries and six input-file SHA-256 drift checks. TypeScript and the three changed-file lint checks passed.

The bare full-repository test run exposed local verification-preparation issues: 106 jsdom storage failures under the host's Node 26.5.0 (the repository CI uses Node 20), plus two old evidence-lock mismatches on AppNav and shell layout files byte-identical to the acquisition base. All 106 storage cases passed with the existing capture owner's supported `--no-experimental-webstorage` flag, applied only to the test process. The two visual guards are not disabled or repinned by hand: fresh immutable PL6/VI captures and the native composition validator supply current-source evidence before the full rerun.

The recovery evidence is under `terminal/docs/verification/stock-intelligence-r6-20261103/recovery-20261104/`. Source pin is now `75a6540519cf519edfef7633e74f57b68aef9329`; core startup/execution paths were unchanged and material delivery/review policies were read. New protected Terminal movement to `3930ce93bb1ed6f3d66ba1ae4cac7e441995ba78` changes separate Today workspace paths, not this stock-scoped repair.

No new review was commissioned. The existing native reviewer request is preserved. One Secretary coordination send was platform safety-blocked, not delivered or rerouted. Executive state/session/root reads returned backend-unavailable, so no root, grants, worker START or independent approval was invented. Release remains on the same original PR and still owes fresh repaired-head hosted CI, required review, protected integration, exact-target deployment and real R6 browser acceptance.
