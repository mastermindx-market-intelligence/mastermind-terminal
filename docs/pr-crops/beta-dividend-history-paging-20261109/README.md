# Dividend history paging — 2026-11-09

## Outcome and design basis

The supplied dividend history can now be read in 40-row pages. Previous/Next are native, 44px controls with visible keyboard focus and an announced range. Selecting a page brings its first records into view while retaining focus. Company changes start at the newest records; shrinking datasets clamp to a valid page and keep existing controls mounted.

This is a source-evidenced interaction enhancement within the accepted Company presentation. The Paper Company R2 reference is file `01M6Y2GT8S3YP4TK052PPESZEC`, page `p-2-0`, artboard `2RK-0`; it does not specify a detailed dividend pager. No exact Paper pagination design is claimed.

- Mastermind source law: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Shared Macro design doctrine: `536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136`.
- Qualified protected Terminal source: `b387616013f38cce9e467cc7da7b87fd2672718c`.
- Operation: `beta-dividend-history-paging-20261109-c4`.
- Managed branch base: `1377853d02fdb0295c0848d7127fdee4ca36714b`; the affected source blobs match protected source.
- Original component blob: `9de61962b98902c3023f4a4562125dff76b0a743`.
- Original incumbent test blob: `cf96d400683d5be95d7a9d3b75437e7d2d5281ca`.

The leaf and incumbent test were checked against three targeted open-PR pages and all 16 capped heads/merge-bases. No current overlapping edit was found. The implementation uses the existing table, formatting, theme tokens and data owner. Global finance styles and MegaPane are outside this diff.

## Reproduced problems

The original real Analysis consumer rendered exactly 40 of 83 supplied synthetic records and a static total, with no Next action. The Chinese/light 320×568 baseline failed on the missing button (process 37756, exit 1).

The first paging implementation also exposed persistent Terminal phone occlusion: the outer scrollport extended to y568 while the bottom tabs started at y496. Next at y502–546 was intercepted by a navigation tab. A bounded settled-scroll diagnostic confirmed this was not animation timing (57862, exit 1). A changing range could also wrap the control row in Chinese.

Local button scroll margins now honor the existing 96px finance clearance. The phone pager stacks its range and controls consistently. A user-requested page change scrolls the local pager into view after the matching commit, without moving focus. Data refreshes, language changes and clamping create no scroll intent.

## Verification

The browser fixture contains 83 distinguishable synthetic monthly events, supplied in reverse order, with amounts 0.01–0.83 USD. These are presentation fixtures, not actual company dividend claims. The spec mounts the actual Analysis and Terminal consumers. API requests are refused locally; the existing development fixture/preview configuration supplies the consumer surface. No account, payment or production entitlement acceptance is claimed.

- Final beta matrix: **13 passed, 2 duplicate landscape-project skips** (79225, exit 0).
- Final default browser matrix: **13 passed, 2 duplicate landscape-project skips** (87349, exit 0).
- Final incumbent component suite: **32 passed** (79386, exit 0), retaining ex-date, KPI, provenance, empty-state, language and the initial 40-row assertions. Added cases cover shrink/regrowth across 40 rows, focus continuity and company reset.
- Final scoped ESLint: **exit 0**, with the unchanged pre-existing unused `lastEvent` warning (89071).
- Final Next type generation / TypeScript: **exit 0** (93228).
- Final diff check: **exit 0** (93355); no owned development server remains on port 3184.

The browser matrix covers both consumers in English and Chinese on desktop 1440×900, tablet 820×1180 and phone 320×568, plus Terminal at 568×320. Beta covers English/dark and Chinese/light. Ordinary Analysis retains its supported dark presentation; ordinary Terminal also exercises Chinese/light.

Each main case verifies the 40/40/3 windows, all 83 unique rows, descending date order, amount/currency continuity, unchanged KPI text and no additional fund request. Enter and Space navigate in both directions. First/last unavailable controls retain focus and do not advance. Native focus/page-change scrolling must leave each button hit-test reachable; the assertion does not reposition the button. The first new date cell must also be hit-test visible after a page change. The landscape case additionally uses a real touch tap to return to the previous window. No document horizontal overflow is accepted.

Intermediate checkpoints were 10/12 beta cases before the phone fix; two phone cases then passed after the local CSS remedy; the stronger native-focus matrix passed 13 before the final visible-result refinement. Only the final accepted-source matrix above is the browser result for this artifact.

## Commands

Run from the operation's `terminal/` directory.

```sh
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3184 npx playwright test e2e/dividend-history-paging.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line --output=test-results/dividend-beta-accepted
MMX_SHARED_SHELL=0 TERMINAL_E2E_PORT=3184 npx playwright test e2e/dividend-history-paging.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --reporter=line --output=test-results/dividend-default-accepted
NODE_OPTIONS=--no-experimental-webstorage npx vitest run lib/__tests__/dividendExDateLabel.test.tsx
npx eslint components/fin/DividendsPage.tsx e2e/dividend-history-paging.spec.ts
npx next typegen
npx tsc --noEmit
git diff --check
```

The process-local Node option is the installed Node 26 compatibility setting for the existing jsdom/Vitest environment. No workflow, retry budget, timeout, release or authentication policy was changed.

## Images

All images are unmodified actual local browser captures.

- [Original missing paging control](before-analysis-phone-zh.png)
- [Intermediate phone occlusion](intermediate-phone-occlusion.png)
- [Final Analysis desktop](analysis-desktop-en.png)
- [Final Terminal desktop](terminal-desktop-en.png)
- [Final Analysis phone](analysis-phone-zh.png)
- [Final Terminal phone](terminal-phone-zh.png)
- [Final landscape phone](terminal-phone-landscape-zh.png)

## Custody and delivery

The original installed workspace owner reconciled the unqualified adapter acquisition to `/Volumes/Mastermind 2/agent-workspaces/terminal/web/beta-dividend-history-paging-20261109-c4`, with the exact operation branch and base; the typed publisher independently confirmed a clean original carrier before edits. No acquire retry, re-home or carrier switch occurred.

Principal implementation was the lower-overhead path for this bounded coupled change. Native children supplied read-only ownership, design and adversarial reasoning; this is self-checked source work, not a formal independent GitHub approval.

Studio Direct already defaults to M2; no host selection was requested. Publication, protected merge, beta acceptance and live consumer proof are separate states. This artifact qualifies the local source; final beta release/live acceptance remains owed through the incumbent release path.
