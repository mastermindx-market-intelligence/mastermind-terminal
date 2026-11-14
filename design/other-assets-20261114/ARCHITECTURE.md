# Other Assets — native shared-shell architecture

Status: implementation plan, not implemented application code. Native Paper completion precedes the production work below. The interactive study is a design-review tool with synthetic data and a small local draft store; neither its global CSS nor its state store is a production architecture proposal.

## 1. Ownership that must survive migration

| Responsibility | Existing owner to preserve | Native consumer responsibility |
|---|---|---|
| Shell, session and entitlement | Terminal `AppShell` and existing account/access services | Render content inside the shell; consume existing identity and entitlement |
| Global navigation and route eligibility | Macro page registry/exporter and Terminal `sharedShellRoutes` projection | Register qualified native destinations through the existing source path |
| Legacy compatibility | Terminal persistent legacy host and catch-all routing | Preserve source route, query, fragment and back/forward semantics during cutover |
| Crypto state | Macro crypto producers and their published artifacts | Adapt the existing snapshot into a typed, availability-aware view model |
| Bitcoin allocation | `engine/btc_decision.py`, `btc.decision/v1` | Display the canonical target and original decision records; no independent allocation logic |
| Performance and commodity evaluations | Existing model/evaluator/build owners | Preserve version, sample, costs, units and benchmark; project into native views |
| Commodity workspace | `commodity_decision_workspace.py`, `commodity_workspace_adapter.py` | Reuse seventeen instruments, five task views and qualified company continuations |
| FX research conditions | Existing R26 account-owned inactive CRUD and migration 0038 | Call that owner; preserve isolation, inactive status and monitoring gate |
| Bonds and credit research | Existing bonds producers, R33 contracts and continuation routes | Preserve the established research families beneath a clearer overview |
| Ask Mastermind | Existing singleton shared Brain host | Pass a compact qualified investigation context; do not mount another Brain widget |
| Monitoring, alerts and publication | Their incumbent admitted owners | Continue to the existing workflow only when the action is supported and permitted |

The existing catch-all page returning `null` while the persistent legacy host renders the old page is a useful transition mechanism. It is not evidence of a native page or engine-consumer migration.

## 2. Route compatibility map

These are current source routes, not a declaration of final native URLs. The final native pathname must follow the current registry and shell conventions at implementation time.

| Destination | Existing entry | Compatibility obligation |
|---|---|---|
| Crypto Intelligence | `/crypto.html` | Preserve asset/class/query context and accepted continuations |
| Bitcoin Vector | `/vector.html` | Preserve selected study, original snapshot and model context |
| Strategy Track Record | `/vector.html#strategy-track-record` | Preserve anchor behavior and the `/btc_strategy.html` redirect |
| Commodity Dashboard | `/commodities.html` | Preserve five task views, selected instrument, comparison and inactive note context |
| Commodity Strategies | `/commodity_strategies.html` | Preserve `strategy_<key>.html` detail destinations and model identity |
| Strategic Reserves | `/spr.html` | Preserve country, measure, basis, event and source context |
| Forex | `/forex.html` | Preserve pair orientation, R26 draft identity/account and accepted child routes |
| Bonds | `/bonds.html` | Preserve R33 continuations, curve/credit selection and observed-versus-scenario context |

Before a route switches to native ownership, record its exact old and new registry entries and a concrete rollback. Do not flip all eight to native because the first page passes. Do not keep competing registries in each application.

## 3. Proposed adapter boundary

The producers retain financial meaning. A thin adapter validates and normalizes data for display. It may map fields, resolve canonical identity, normalize units for a defined comparison and expose availability. It may not invent a score, allocate capital, collect data, alter an evaluation or start monitoring.

The following is a **proposed consumer shape**, to be reconciled with actual incumbent types. It is not a new canonical wire schema or an instruction to replace existing data envelopes.

```ts
type Availability =
  | { kind: 'available' }
  | { kind: 'partial'; missingSources: string[] }
  | { kind: 'stale'; lastQualifiedAt: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'not_applicable'; reason: string };

type EvidenceRef = {
  sourceId: string;
  observationAt: string | null;
  publishedAt: string | null;
  availableAt: string | null;
  vintageId: string | null;
  originalRecordId: string | null;
  methodRef: string | null;
};

type Observation<T> = {
  value: T | null;       // 0 is a valid value; absence is explicit
  availability: Availability;
  unit: string;
  convention: string;  // e.g. quote-per-base, par yield, net total return
  evidence: EvidenceRef[];
};

type InvestigationContext = {
  destination: string;
  instrumentId: string | null;
  producerBuildId: string;
  modelVersion: string | null;
  window: { start: string; end: string; convention: string };
  selectedRecordId: string | null;
  comparisonIds: string[];
  mode: 'observed' | 'historical' | 'hypothetical';
};
```

Keep authorization and account ownership out of user-controlled URL claims. A URL can select a record, but the server/owner must still enforce access to it. Financial values must not become eligible because the UI happens to deserialize successfully.

### Transformations allowed at the view boundary

- Rebase an already-qualified price/return series to a selected common start, retaining source values and method.
- Calculate a clearly named matched-window return or basis-point difference when the incumbent contract permits that projection.
- Invert all points and the corresponding return of a currency quote.
- Express a declared, isolated educational scenario such as modified-duration/convexity sensitivity, with an explicit approximation boundary.
- Format numbers, dates, missing states and accessible equivalents.

Model allocation, signal weights, causal confidence, forecast probabilities, strategy P&L reconstruction and monitoring rules remain with their existing owners. If an accepted owner already calculates a displayed measure, consume that result and its provenance rather than making a second calculation authoritative.

## 4. Native component organization

Inspect the current `terminal/AGENTS.md`, `CLAUDE.md`, actual module conventions and installed chart adapters before application edits. Candidate names below describe responsibilities, not required new files.

| Responsibility | Reuse/extend approach |
|---|---|
| Page heading and current context | Existing shell/content header primitives, with a compact source-aware context row |
| Task navigation | Existing accessible tab/route primitive; selected view belongs to the investigation context |
| Main analytical canvas | Existing chart stack/adapter with qualified data, direct series identity and accessible values |
| Market or decision list | Existing table/list primitives, keyed by canonical asset/record identity |
| Evidence inspector | Existing dialog/drawer primitive; one focus/escape owner and explicit return context |
| Comparison | A bounded selection over compatible data, not a new screener or persistence system |
| Hypothetical calculation | Isolated state with explicit assumptions; no mutation of the observed snapshot |
| Research condition | Adapter to the existing inactive owner; no shadow database or parallel activation flow |
| Brain continuation | Existing singleton host with source-bound context, not a second assistant surface |

Do not import `studio.css` into Terminal. It is a standalone review artifact using a restrained token vocabulary. Production maps the approved designs to current `globals.css`, `observatory.css` and existing theme/locale settings. Do not replace the root theme, app chrome, identity store or settings provider.

## 5. State and persistence model

**URL-safe state:** destination, task, canonical public instrument identifier, window, compatible comparison identifiers, selected evidence record, quote orientation and declared scenario parameters. Validate all of it. Unknown values return a coherent default or an explicit unsupported state.

**Transient state:** focused trigger, chart cursor, open inspector, current loading boundary and scroll restoration. Preserve enough context across an inspector round trip without creating a second navigation history controller.

**Account-owned state:** existing saved research conditions, bookmarks, notes or scenarios. Use the established owner, entitlement and audit behavior. The study’s localStorage draft retention only proves the review interaction concept; it is not account isolation or durable product persistence.

**Historical state:** exact producer build, original decision identifier, model version and data vintage. Replaying one date cannot combine it with the current allocation or later-revised inputs. A record lacking point-in-time evidence must say what is actually available.

**Scenario state:** separate mode and parameters. Switching between observed and hypothetical restores the original observation. No scenario state is sent as an order, allocation instruction or monitoring activation.

## 6. Availability, clocks and corrections

Use independent source clocks. A page publication time does not make every series current. A delayed CHF leg affects its crosses; a delayed derivatives source affects the leverage aggregate; a missing gold settlement affects that evaluation. Preserve unrelated valid panels.

Render empty selections, empty datasets, unavailable data and not-applicable calculations differently. A zero allocation, zero stock change or zero return is not an empty state. A nonpositive net-import denominator may make that coverage question inapplicable even when the stock itself is valid.

A correction records the original and revised value, both publication identities and the affected analyses. It does not silently rewrite a historical decision. If the original source does not provide vintage history, the native design must not claim to reconstruct it.

## 7. Performance and accessibility

- Reserve layout geometry while the affected source loads. Do not replace the entire shell with a spinner.
- Bound visible comparisons and table payloads. Preserve the full eligible universe through existing paging/search/filter patterns rather than squeezing every item above the fold.
- Reuse the existing chart adapter and its downsampling approach; retain exact values for inspection. Downsampling must not alter an endpoint, omit a selected event or hide a brief invalidation.
- On narrow screens, rebuild chart geometry and tick density. An 820-unit SVG scaled into 310 pixels is not readable because its CSS height is large.
- Use maturity tenors for curves, dates for histories, correct decimal precision for FX, and persistent unit/convention labels in evidence.
- Follow the incumbent locale behavior, including EN/ZH expansion and semantic market colors. Keep signs and words as redundant meaning.
- Verify keyboard tabs, focus return, screen-reader names, reduced motion, 200% zoom and actual text/graph contrast. The source checks in this packet do not satisfy those browser acceptance cases.

## 8. Migration ladder and concrete exit evidence

| Phase | Input and action | Evidence that exits the phase |
|---|---|---|
| Native design | Safe exact Paper file, original references, current source contracts; build one scoped page at a time | Native file/page/node receipts, primary/interaction/degraded/narrow screenshots, build notes, no overlap with other writers |
| Consumer contract | Current exact producer snapshots and existing types | Adapter cases for identity, units, clocks, zero/missing, model/version and revisions |
| Native view | Approved Paper design and current Terminal shell primitives | Content-only route with qualified fixtures; existing shell/session/Brain remain the owners |
| Integration | Actual data/access path and legacy route map | Authenticated select → inspect → return → reload journey; query/anchor/back compatibility |
| Release | Owned diff, affected checks, exact-head CI and actual protections | Permitted protected merge/deploy receipts; no fabricated approval or release claim |
| Acceptance | Deployed native route under real account/source conditions | Production screenshots, source identity, original workflow completion and explicit residual limits |

Work top to bottom. Pending CI/review blocks the affected release lane, not all independent design or source work. Preserve accepted programmes and current writer custody. A checkpoint or a green build is not the parent outcome.

## 9. Deliberately excluded duplications

This plan creates no additional account system, auth store, chart platform, assistant host, scheduler, alert engine, performance engine, quant scorer, event collector, publication queue or control plane. If an advanced design requires a capability not supported by the existing owner, record the dependency and implement the qualified extension there only within the relevant authority. The page itself must remain honest and useful without that capability.

## Source basis

See `SOURCE_MAP.md` for exact pinned repository links and the accepted programmes being preserved. All production details must be reconciled against the current touched source preimages before implementation; this packet preserves its evidence pin without pretending that a later branch has the same state.
