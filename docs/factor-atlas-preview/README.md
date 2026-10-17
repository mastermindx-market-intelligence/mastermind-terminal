# Factor Atlas — native Terminal history preview

Status: native component BUILT_NOT_PROVEN at product level. Local unit, type and
browser verification passed; no customer source admission or production release.

## Outcome and scope

Provide a reusable Terminal view of the existing S1 native history result, using
explicit comparison dates, source NAV rather than reconstructed holdings, and
visible valuation gaps. This is a bounded dependency of Macro principal #8679.

Operation: `factor-atlas-terminal-preview-20261011-c1`.
Terminal base: `fc76cf495781e5f53254aa3c457411de0cb64654`.
Protected procedure: Mastermind `8d62a8571d2a6ad9da9d50e5e4624de6eecaac4c`;
compatible unchanged Skillpack 1.0.1 procedures. User-selected mode: Pro; actual
served model, hidden budgets and autonomous admission are not inferred.

The installed Terminal workspace owner admitted the isolated operation. This
source lane does not repeat the earlier denied Macro architecture/custody read,
modify S1 or S2, or take over a specialist source lease. Executive V3 reported
read-only; no worker submission or provider launch is represented here.

## Bounded design

- `terminal/lib/factorAtlasHistory.ts`: accept only explicit synthetic-preview
  requests for the preserved `factor_atlas_read.v1` candidate. Customer requests
  always return withheld, without numbers. Retained-owner input is not preview
  admission. Necessary field checks do not authenticate an upstream digest,
  data rights, identity, membership, or receipt.
- `terminal/components/factor-atlas/FactorHistoryPreview.tsx` and its CSS module:
  native React presentation, shared Terminal SVG helpers/tokens, explicit date
  controls, comparison selection, unavailable states, source construction and
  per-observation table. English/Chinese text is selected by the caller's existing
  locale; no language or saving store is created.
- Tests live in the existing `terminal/lib/__tests__/` discovery paths, so this
  slice does not require a new CI workflow or unrun-test exception.

There is no API, page route, upstream fetch, identity creation, source store,
authentication change, paid/public publication, signal, ranking, portfolio,
alerting, sizing or trading side effect. No production rollout is requested.

## Interfaces and invariants

`prepareFactorHistory(unknown, {basketId, audience})` projects a supported native
synthetic candidate or returns a fixed withheld/invalid reason. Preserve source
schema, original result-digest reference, construction identity, membership mode,
USD/TRADJ regular-session and gross-zero-cost semantics. Copy no arbitrary
upstream object into the rendered view.

`factorHistoryWindow(history, {anchorDate, endDate})` requires the exact requested
source observations. It never chooses a later common date or resets holdings.
A displayed cumulative return is `source_level / explicit_anchor_level - 1`;
formatting converts a return fraction to percent exactly once. Local returns
cannot repair a broken source index chain. A null valuation remains null.

`compareFactorHistories(histories, window)` preserves independently valid series,
withholds a pair spread unless both exact windows are complete and their history
modes/bases agree, and rejects duplicate or excessive selections. Eight is a UI
selection bound, not a claim about the underlying factor catalog.

`splitFactorSegments(points)` breaks SVG line geometry at every gap or source
segment boundary. The chart reuses `components/charts/svgChart.ts`; it does not
interpolate, forward-fill, fabricate OHLCV, or establish another return engine.

## Test and delivery plan

1. Run an unchanged native test as an environment baseline.
2. Run new contract tests in RED before adding implementation, then GREEN.
3. Pin React controls, fixture-only display, gaps and language behavior in DOM tests.
4. Check focused lint and native TypeScript. Check responsive browser behavior at
   1440x900, 820x1180 and 390x844 in both themes/languages using an isolated local
   harness that mounts the real component. It is not authenticated production.
5. Publish an exact-head Draft/HOLD PR, record actual checks and unresolved gates.
   No auto-merge or deployment. Update the existing principal evidence carrier.

## Source basis

The original synthetic fixture is copied without modification from Macro
`ddf1f07f2059caebb4bfa6b1db6c4008dd97859c`, path
`research/factor_atlas/session1/evidence/native_round_trip.v1.json`, blob
`3590dc40e3116834b79ae17628b399d4be01a18f`, SHA-256
`6860786ee663c394e0d33b18e241592879501a6bc5335a09faed6d66b0b42626`.
Its AAA/BBB/CCC data are fabricated. The basket-shaped `mag7` identifier does not
turn it into actual Magnificent Seven performance. All preview labels must say
synthetic; the fixture's candidate-release ceiling survives presentation.

S1 principal returns #8679 comments 6078705195 and 6088941742 supply the consumer
and data-coverage rationale. Their 16 source-extraction checks and separate data
census are not rerun or counted as this Terminal implementation's native tests.

## Remaining release gates

S1 native bridge/CLI integrity repairs and source admission remain with #8680.
Actual data basis, rights, identity knowledge, PIT completeness and construction
inception must be qualified before any future customer consumer. Independent
review, native integration and authenticated browser/production proof remain
separate. A preview PASS clears none of them.

## Verified native result

The exact original S1 synthetic fixture is preserved. Native tests: **82 passed** after the bounded CI repair.
History RED: 64 expected missing-implementation failures. DOM RED: 10 expected
missing-component failures after correcting a file-URL test-harness error; the
initial 10 skipped tests are not RED proof. Focused lint: zero errors/warnings.
Application TypeScript: exit 0. See [verification.json](verification.json).

Real component browser proof: **24 fresh contexts / 432 assertion groups** across
Chromium and WebKit, all three required widths, both themes and languages.
Checks cover exact anchors, no holding reset, gap/table presentation, comparison,
mixed-mode withholding, retained-data rejection, customer withholding, no document
overflow, pixel-space SVG, unique tick labels and zero external requests/errors.
[Full browser receipt](browser-proof.json) binds source hashes. This is an
isolated esbuild mount of the native React component, not the complete Next.js
shell, authenticated serving path, independently reviewed release or production.

### Reproduce

From an admitted workspace with the pinned Terminal lockfile dependencies:

```bash
cd terminal
npm ci --ignore-scripts --no-audit --no-fund
npx vitest run lib/__tests__/factorAtlasHistory.test.ts lib/__tests__/factorAtlasPreview.test.tsx
npx tsc --noEmit --incremental false
cd ..
node docs/factor-atlas-preview/prove.mjs
# Optional local-only interactive inspection (Ctrl-C closes it):
node docs/factor-atlas-preview/serve.mjs
```

The browser runner uses the installed Playwright browser binaries and reports
unavailable engines honestly. It binds an ephemeral 127.0.0.1 port and closes it
on completion. Harness scenario variants are fabricated and carry distinct
harness-byte references, not native producer digest attestations.

### Representative captures

- [Desktop comparison / dark / English](screenshots/chromium-1440-dark-en-compare.png)
- [Mobile / dark / English](screenshots/chromium-390-dark-en.png)
- [Desktop / light / English](screenshots/chromium-1440-light-en.png)
- [Tablet / light / Chinese](screenshots/webkit-820-light-zh.png)
- [Mobile / light / Chinese](screenshots/webkit-390-light-zh.png)

## Hosted-check repair at the first published candidate

Initial head `233a529c75e4a0215a5efa4cec1be9d8bfd011c2` ran the full hosted unit
suite successfully: 531 files / 8,681 tests passed, four TODO. Its job still failed
because the later plain-language gate found five added-line issues. CodeQL also
flagged the percent-sign replacement used for the percentage-point label.

The repair uses the repository-recognized bilingual `pick` convention, including
an explicit brand-name pair, and formats percentage points directly from the
numeric difference. No finding was waived or test weakened. Eight new tests first
failed, then all 82 native cases passed; lint, application typecheck and the exact
local enforce-added plain-language gate pass. All 24 browser contexts were rerun
on the repaired source and passed. Fresh hosted checks remain a separate gate.

The client-side withheld view is not an access-control boundary. A future server
consumer must validate authentication, product entitlement and purpose-specific
source admission before serializing any retained or restricted payload. Never
send unauthorized bytes to this component and rely on a blank customer view.

## R3: catalog scaling and actual Next.js shell integration (development-only)

The preview now accepts a bounded catalog of up to 4,096 entries; it renders at
most 64 matching choices at once, with localized search to reach entries beyond
the first page. **Eight remains the comparison-selection ceiling**, not a limit
on total available factors. Existing selections and NAV source history are
preserved while filtering. For any real catalog, source identities, entitlement
and rights decisions still belong to their existing owners.

An additional route lives at
`terminal/app/(shell)/admin/factor-atlas-preview/page.tsx`. It is a
**development-only, admin-gated** integration proof, not a customer route.
Its first branch is `NODE_ENV !== "development" -> notFound()`, before
any synthetic fixture or authorization query. In development it uses the
incumbent `isAdminRequest()` and shared `AppShell`/language context. Unknown
admin-authority state displays a localized refusal and no preview data. The
fixture contains only the source-owner's fabricated AAA/BBB/CCC observations.

For reproducible local browser proof, never bind an admin-dev server to a
public interface. On an isolated, admitted Terminal workspace:

```sh
cd terminal
ADMIN_DEV=1 TERMINAL_E2E_FIXTURE=1 NEXT_TELEMETRY_DISABLED=1 \
  ./node_modules/.bin/next dev -H 127.0.0.1 -p 49281
# in another shell, from the repository root:
FACTOR_ATLAS_LOCAL_URL=http://127.0.0.1:49281 \
  node docs/factor-atlas-preview/prove-shell.mjs
```

The browser script refuses a non-loopback URL, uses the existing development
fixture cookie solely for the shared shell, checks the actual Next route in
Chromium/WebKit at three viewports × two languages × two themes, and saves
screenshots/receipt under the workspace-ignored
`terminal/.next/factor-atlas-proof/` directory. This tests an actual Next.js
route and its shell, **not real authenticated production**, source-use admission
or authorization of a customer payload. Do not set `ADMIN_DEV=1` on a VPS or
network listener. Stop the local server after proof.

The original standalone component harness also has `?case=catalog`, with
161 fabricated choices. Its browser proof validates finding and selecting
`Cohort 160` without loading every checkbox into the DOM. Those clone receipts
are local synthetic scenario identifiers, never authenticated native digests.

### Missing for release

The system still needs the incumbent source owner's admitted PIT membership,
price/corporate-action vintages, dataset rights and clock-bearing receipts.
A future authenticated server gateway must withhold unauthorized data **before
serialization**, rather than relying on this client's blank customer state.
Independent exact-head review, current protected-base integration, full
application checks and true customer/browser/production proof remain separate
release gates. No deployed Atlas product is claimed by these development tools.

## R3 execution verification (local; before hosted CI)

- Focused native unit/DOM suite: **87 passing cases** (the earlier 82 are an
  immutable prior milestone). The final catalog-scaling test failed against
  the 128-entry hard catalog refusal before the repair. The implementation
  now bounds visible entries to 64 and comparisons to eight, without treating
  a 160-entry catalog as invalid. A 4,096-input catalog ceiling remains a
  defensive application limit, not a universe model or data-source restriction.
- Standalone actual-component browser: **24/24 contexts and 433 assertion
  groups** across Chromium/WebKit, 1440×900/820×1180/390×844, EN/ZH and
  dark/light. Added scenario validates searching for `Cohort 160` in a
  161-choice synthetic catalog, selecting it and retaining the original
  three source histories. [Browser receipt](browser-proof.json).
- Actual Next.js shell browser: **24/24 contexts and 240 assertion groups**
  on `/admin/factor-atlas-preview` under explicit local developer fixture
  authorization, with real AppShell and existing language context.
  [Next shell browser receipt](next-shell-browser-proof.json).
- All UI/browser passes are controlled synthetic evidence. No actual admin
  account identity, genuine rights decision, live Macro feed, paid entitlements,
  or production deployment was exercised. The development-only server was
  bound to `127.0.0.1`, not a LAN interface, and stopped after proof.
- [Verification receipt](verification.json) pins source digests and representative
  screenshots. This source still requires independent review and exact-head
  hosted checks on its own new Git commit before any accepted release.

## R4: exact, shareable factor comparison locations

A new **pure presentation-state codec**, `terminal/lib/factorAtlasLocation.ts`, serializes
`faFactor` (up to eight repeated qualified *catalog-local* identifiers),
`faStart`, and `faEnd` into the existing page URL. It does not declare
a factor source, create server-side state, or grant access. Existing unrelated
query values, including `?tab=`, are retained. The client uses the existing
`window.history` and `popstate` mechanism; it creates no persistence system.

Only factor IDs actually supplied by the current qualified input catalog can be
selected from a copied URL. Unknown, duplicate, over-eight, malformed-date,
partial or excessive links show a localized invalid-link state, never a
different silently chosen basket. An explicitly empty selection is preserved.
Display-window changes do not reset underlying S1 holdings, and the same exact
source NAV is used on browser Back, Forward and reload. Customer mode
continues to withhold all numerical source data regardless of URL parameters.

**Implemented on the original Draft/HOLD PR #928 carrier**, not in a new route
or specialist source. Existing non-URL component consumers default to URL
sync **disabled**; only the dev-only existing AppShell mount opts in. The
original `factor_atlas_read.v1` synthetic fixture remains unmodified.

Evidence: `terminal/lib/__tests__/factorAtlasLocation.test.ts` covers pure
selection/date parsing and writing; `factorAtlasLocationDOM.test.tsx` covers
real React history state, reload-state restoration, invalid IDs, empty selection
and withholding. The existing 87 tests remain; **108 focused tests pass**.
The actual Next.js development-shell browser receipt
([link](next-shell-browser-proof.json)) now exercises full browser Back,
Forward, reload and unknown/valid direct deep links across Chromium/WebKit,
1440/820/390 widths, light/dark and EN/ZH. It is a local authorized fixture,
not an account login, real retained data, or production route.

The [principal source-grounded Terminal UX census](S5_TERMINAL_PRODUCT_CENSUS.md)
maps the proposed Factor Atlas journey to existing Discover, Sector
Intelligence, issuer research, Options and Portfolio owners. It is a new
principal analysis, **not** a recovered historical Session 5 specialist result,
design sign-off or permission to change primary navigation before source
admission.

Release criteria are still separate: true source/rights/identity and
adjusted-price vintage receipts, accepted server-side auth/entitlement
use, qualified independent review, current-base hosted CI, and an actually
authenticated customer and production browser journey. The synthetic
dev-only route must remain invisible in production.

### R4 source-first-render protection and verification

A further test found a browser-only timing defect: server rendering could
display the initial default candidate before a malformed shared link had been
validated by the first client effect. The URL-enabled client now renders a
neutral, localized **validating-link** state on the server and during hydration.
Only after the explicit allowlist/date check does it render source-derived
numbers. Invalid links remain withheld with an explanation instead of
temporarily showing the wrong basket. Source audiences not using URL state
retain the original presentation behavior.

The test was observed RED before repair, then the complete **109/109**
native history, catalog, URL-codec, URL-DOM and SSR cases passed.
Focused TypeScript also passed after isolating the ignored malformed
Next development-generated validator; the tracked repository was not altered
by that generated-artifact repair. The final **24 standalone** and
**24 actual Next AppShell** browser contexts passed again under the current
source hashes. Actual Next browser proof now includes exact direct-link
acceptance/refusal, Back/Forward, refresh and preserved selected-source NAV.
These are synthetic research fixtures only, not market returns or a
production data-release authorization.

## R5: unavailable evidence cannot become a return or mislabelled source refusal

Three source-consistency test witnesses failed on the inherited native-preview
adapter before repair:

- A source return marked `PARTIAL` could contain a null held-weight NAV level
  together with a numerical interval return. The projection rejected neither,
  so the observation table could imply a measured percentage for an unknown
  portfolio valuation. The adapter now rejects the contradictory pair.
- A source envelope marked `UNAVAILABLE` with populated numerical points
  could nevertheless display a READY result. The adapter now withholds the
  unavailable input, even if its method/synthetic fixture structure is valid.
- A previously projected `FactorHistory` with its source status changed to
  `UNAVAILABLE` could still compute a READY window. The pure window
  function now fails closed, with null return and no displayed points.

The UI now distinguishes source unavailability (English/Chinese) from a
retained-owner input presented to the synthetic-only preview. The former
must not tell a user merely to supply a synthetic fixture, and neither
state publishes an invented return.

**Test-first:** the three source assertions were visibly RED before the
implementation, then GREEN. The two display-copy tests likewise failed
before the localized correction. Complete focused suite: **114 tests passed**
across four native/unit/React/URL suites, with no skipped tests counted as
passes. ESLint and TypeScript checks passed, and the optimized local Next.js
production build completed. These are author/local source and synthetic
browser tests, *not* S1 market-data qualification, receipt authentication,
rights approval, actual profitable strategy evidence or release permission.

S1 `factor_atlas_read.v1`, capital-pressure S2, options S3,
evidence S4 and evaluation S6 remain original upstream owners. The Terminal
consumer enforces presentation semantics only and never mutates their
stores, payloads or original release ceilings.

## R6: source-native coverage, breadth and concentration (synthetic-only)

The native S1 history candidate already carries diagnostics with each interval.
Factor Atlas previously dropped those values. This revision preserves **only the
native source fields** in the read projection and renders them inside the
accessible, horizontally scrollable observation table:

- **Eligible / valid count:** source-native numerator and denominator, not a
  renormalized percentage over whichever names remain visible.
- **Held-weight coverage:** the native fraction using **declared start weights**;
  this is not turnover, capital flow or end-weight coverage.
- **Advancing share:** source-native fraction conditional on the original
  breadth status. A PARTIAL/UNAVAILABLE breadth status displays a dash rather
  than promoting an incomplete fraction to an all-name observation.
- **Concentration:** native HHI, effective N (native producer calculates
  `1 / HHI`), largest held end weight and qualified security count. The
  end-weight concentration basis is distinct from the held-start-weight
  coverage denominator. An absent concentration object renders **unknown**,
  never a fabricated equal-weight estimate.

The projection rejects non-finite/out-of-range ratios, contradictory counts,
unsupported method bases, cross-field disagreement between coverage and
breadth denominators, and inconsistent HHI/effective-N arithmetic. A missing
held valuation yields no rendered diagnostics for that date. Every field is
copied from the established `factor_atlas_read.v1` source contract; the
Terminal client does not infer dealer flow, portfolio trading economics,
constituent selection or predictive alpha. Percentage-share formatting never
adds a return-like plus sign. English and Chinese labels are inherited from
the component's existing language input; no second locale store was added.

Source: S1 original native implementation `engine/factor_atlas_read.py` at
Macro `ddf1f07f2059caebb4bfa6b1db6c4008dd97859c`, where the same
per-member return collection calculates count/weight coverage and breadth,
and `_concentration()` calculates end-held-weight HHI and effective N.
This source is an internal synthetic reference, **not** an authenticated
customer data receipt or a historical PIT rights approval.

The source-backed behavior is covered by new
`terminal/lib/__tests__/factorAtlasDiagnostics.test.ts`, expanded preview
DOM tests, and the incumbent history/navigation tests. The 13 original RED
cases and three additional discriminating HHI/denominator RED witnesses
preceded implementation. The combined focused suite passed **141/141**;
ESLint, TypeScript, plain-language, and browser evidence are separate gates.

## R6 browser-proof boundary — October 17 exact-source continuation

The standalone real-component browser proof has **24/24 contexts and 529 checks**
for current native coverage/breadth/concentration fields. The R6 **first**
Next.js development-shell attempts remained **NOT VERIFIED** due to WebKit
Turbopack HMR errors and a separate Webpack first-navigation timeout. Those
negative observations are retained in [R6 verification limitations](R6_EVIDENCE_LIMITATIONS.md)
rather than erased or reported as old-head proof.

On **2026-10-17 UTC**, the same immutable native source
`43321d628eec1da98f09beb77698278932a53dc5` was executed in the real
Next.js 16.2.9 Webpack development AppShell on **loopback 127.0.0.1 only**,
with the incumbent `ADMIN_DEV=1` and `TERMINAL_E2E_FIXTURE=1` test gates
plus an inert (non-secret, non-connected) Supabase configuration. The first
unconfigured warmup returned HTTP 500 (missing local Supabase environment);
the configured, fixture-cookie warmup returned HTTP 200. The unchanged
`prove-shell.mjs` produced **Chromium 12/12, WebKit 12/12, 24/24 complete,
480 recorded named checks, zero captured page errors**, across three
viewports, EN/ZH, both OS color-scheme preferences, navigation/history,
invalid IDs, native diagnostics and overflow/visibility checks.
[New exact-source Next shell receipt](next-shell-browser-proof.json) carries
source hashes and each context result. Its complete JSON SHA-256:
`989789b2cfe28e73991c4028a8ef35299d86cc0fc2ed809b8c146a7c742c23f0`.
Three current screenshots replace the prior R5-era representatives.

**Important visual scope:** Terminal is intentionally **dark-only** (root
`app/layout.tsx` sets `data-theme="dark"`; `app/settings.css` explicitly
refuses a light palette). The light/dark *OS-preference* contexts exercise
layout stability, **not two distinct application palettes**. Same-language
screenshots may be byte-identical across those preferences by design.
This browser proof closes only the synthetic **development-shell** gap; the
optimized production build and negative production route remain separate.
It does **not** admit real market history, verify signed-in customer rights,
approve source revision/PIT/adjustments, deploy the route or authorize trades.
