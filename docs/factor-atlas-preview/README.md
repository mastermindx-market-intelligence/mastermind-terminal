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
