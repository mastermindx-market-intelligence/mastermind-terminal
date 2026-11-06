# Explicit clearing of retained Portfolio targets

## Change and boundary

A target is intentionally retained after its last holding closes or is deleted.
The shared Portfolio/Settings readout displayed that retained target without a
removal action. This change adds **Clear target** to each orphaned row, using the
existing owner-fenced clear callback and API. It adds no target editing on an
orphaned row, no automatic deletion, no new store, and no schema change.

The control is disabled while clearing, reports a sanitized localized failure,
and leaves the row in place until the canonical summary removes it. The
Portfolio readout announces confirmed removal after the orphan has disappeared;
Settings shows its existing empty state when the last target is removed.
Existing target inputs, debounce lifetimes and owner-remount code are unchanged.

This is a separate fix on consumer base
7a95936b2f6092f9176309f6beb188509621849f. The five accepted Treasury source/test
postimages remain byte-identical. The old whole-file PortfolioView hash is
superseded only by the bounded readout delta; it is not claimed unchanged.
The validation.json file binds the three changed source/test files and confirms the
unchanged PortfolioView prefix (including owner fencing), debounce/card suffix,
owner regression, history compiler, SQL and original application receipt.

## Verification

- **RED:** the five new component regressions failed against the old implementation
  because no Clear control existed. The other 37 tests were excluded by the
  deliberate name filter for this step.
- **GREEN:** 140/140 tests in five affected suites passed: shared readout,
  owner panels, both Settings suites and target API behavior.
- **TypeScript:** full project tsc --noEmit --incremental false passed after
  the browser tests were added.
- **Browser:** all 12 new cases passed, zero retries, zero skips and zero flakes:
  Portfolio/Settings × EN/ZH × 1440×900, 820×1180 and 390×844.
  Portfolio cases close the last holding; Settings cases delete it. Each case
  confirms retention, clicks the real shared control, checks the actual fixture
  POST and canonical readback, reloads, and proves holdings are unchanged.
  The targets endpoint is not mocked.
- Each browser case uses a fresh context and isolated fixture owner. CI=1
  disables server reuse; Playwright owned the fresh loopback server on port 39109.
  The required route warmup remained enabled. No real account write occurred.
- All 12 bilingual screen crops were visually inspected. Labels and band units
  remain readable, the button fits, Chinese wraps on the narrow screen, and
  there is no horizontal page overflow. Mobile controls meet the 44 px floor.
- Actual local runtime: **Node v26.5.0 / npm 11.17.0**. Full hosted Node 20 CI and
  independent review of the published combined candidate are separate gates.

The unit log contains the existing Vite CJS deprecation warning and deliberate
driver-failure diagnostics from negative API tests. The fixture server reports
its expected in-memory analytics fallback without a service-role key. These
observations are not represented as production failures or a warning-free run.

## Evidence

The validation.json file records command identities, outcomes, hashes and preservation
checks. The three gzip logs preserve the original RED, affected-unit and browser
logs byte-for-byte. The typecheck.log file is the successful empty output. The twelve
screenshots/ files are synthetic fixture captures, not personal account data.

These checks establish this cleanup path and preserve retention behavior.
They do not establish deployed personal-account CRUD/Targets acceptance,
producer custody, positive historical-source coverage or whole-project completion.
