# Intraday Options Root Catalog Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every producer-declared intraday options root searchable in the Ticker Drill while preserving an honest fallback when the catalog is unavailable.

**Architecture:** Parse `live_flow.meta/v2.root_catalog` through one pure defensive module, derive presentation rows there, and keep `OptionsHubView` responsible only for subscription, selection and rendering. Reuse the existing `meta` and `ticker:{ROOT}` paths; no new endpoint or fetch plane.

**Tech Stack:** TypeScript, React, Next.js, Vitest, Playwright, existing flow stream/cache clients.

**Spec:** `docs/superpowers/specs/2026-09-20-intraday-options-root-catalog-consumer-design.md`

## Global Constraints

- Consume only the existing `meta` flow object and existing `ticker:{ROOT}` drill path.
- Reject the entire catalog on any malformed row or duplicate root; fallback to session candidates.
- Catalog activity affects order/annotation only, never coverage admission.
- Preserve responsive EN/zh behavior and existing Ticker Drill layout ownership.
- Do not modify `terminal/lib/flowSource.ts`; open PR #668 owns adjacent work there.
- Keep changes to `OptionsHubView.tsx` outside the Flow Leaders hunks owned by PRs #671/#680.
- Source paths are based on Terminal `1199aba21aecb5a57c9d8bf5a5634928a9dc1b4a` and Skillpack `bceb5e1593b1dd7e9e34c3bccbceb02e6ccd5a26`.

## Review Focus

- One malformed row among valid rows must reject the catalog instead of overstating partial coverage.
- A query beginning with `$` or lowercase letters must find the expected root.
- A quiet root absent from both tide and unusual feeds must remain selectable.
- A catalog-backed root with session data but missing ticker artifact must not be mislabeled quiet.
- The 150-root scroll list must not create horizontal overflow on mobile.

---

### Task 1: Defensive catalog parser and candidate builder

**Files:**
- Create: `terminal/lib/liveFlowRootCatalog.ts`
- Create: `terminal/lib/__tests__/liveFlowRootCatalog.test.ts`

**Interfaces:**
- Produces: `LiveFlowRootCatalogEntry`
- Produces: `parseLiveFlowRootCatalog(value: unknown): LiveFlowRootCatalogEntry[] | null`
- Produces: `normalizeRootQuery(value: string): string`
- Produces: `buildTickerCandidateRows(args): TickerCandidateRow[]`
- Consumes: active root impact map and fallback roots supplied by the component.

- [ ] **Step 1: Write failing parser tests**

Create tests equivalent to:

```ts
it("parses a complete catalog and preserves producer order", () => {
  expect(parseLiveFlowRootCatalog({
    schema: "live_flow.meta/v2",
    roots_configured: 2,
    root_catalog: [
      { root: "AMD", tier: "rotating", scheduled_this_cycle: true,
        source_ok_this_cycle: true, last_source_success: "2026-09-20T15:42:00Z",
        has_session_data: true, activity_rank: 1 },
      { root: "TLT", tier: "core", scheduled_this_cycle: false,
        source_ok_this_cycle: false, last_source_success: null,
        has_session_data: false, activity_rank: null },
    ],
  })?.map((row) => row.root)).toEqual(["AMD", "TLT"]);
});

it.each(["wrong schema", "duplicate root", "bad boolean", "bad timestamp", "bad rank"])(
  "fails closed for %s",
  () => expect(parseLiveFlowRootCatalog(malformedPayload())).toBeNull(),
);
```

- [ ] **Step 2: Run parser tests RED**

Run: `cd terminal && npx vitest run lib/__tests__/liveFlowRootCatalog.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal parser**

Use record/type guards, a safe root regex, exact booleans, exact integer checks, ISO timestamp validation and duplicate rejection. Map snake-case producer fields to camel-case TypeScript fields. Do not silently drop bad rows.

- [ ] **Step 4: Write failing candidate tests**

Add tests proving:

```ts
expect(normalizeRootQuery("  $amd ")).toBe("AMD");
expect(buildTickerCandidateRows({ catalog, impacts: new Map(), fallbackRoots: [], query: "$tlt" })
  .map((row) => row.root)).toEqual(["TLT"]);
expect(buildTickerCandidateRows({ catalog, impacts, fallbackRoots: [], query: "" }))
  .toHaveLength(catalog.length);
expect(buildTickerCandidateRows({ catalog: null, impacts, fallbackRoots, query: "" }))
  .toHaveLength(Math.min(20, fallbackRoots.length));
```

- [ ] **Step 5: Run candidate tests RED, then implement GREEN**

Run: `cd terminal && npx vitest run lib/__tests__/liveFlowRootCatalog.test.ts`

Expected before implementation: FAIL on missing candidate helpers. Implement catalog-backed full-list filtering and the 20-row fallback preview, then rerun to PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add terminal/lib/liveFlowRootCatalog.ts terminal/lib/__tests__/liveFlowRootCatalog.test.ts
git commit -m "feat(options): parse the live root coverage catalog"
```

### Task 2: Wire the Ticker Drill to catalog coverage

**Files:**
- Modify: `terminal/components/OptionsHubView.tsx`
- Modify: `terminal/public/data/flow_fixture.json`
- Modify: `terminal/lib/__tests__/liveFlowRootCatalog.test.ts`

**Interfaces:**
- Consumes: Task 1 parser/candidate interfaces and existing `flowMeta`, `tideData`, `feed`, `fetchTicker`.
- Produces: full covered selector, catalog summary and honest root-state no-data copy.

- [ ] **Step 1: Add a fixture catalog with a quiet root**

Extend the fixture meta with valid rows including active `SPY`, quiet core `TLT`, and quiet rotating `AMD`; keep `AMD` absent from fixture tide impact and unusual-name lists. Set `roots_configured` equal to the row count.

- [ ] **Step 2: Write a failing component-contract test**

In the helper tests, build rows from the fixture meta and fixture activity roots and assert `AMD` is returned although it is absent from fallback roots. This pins the component's data contract before JSX changes.

Run: `cd terminal && npx vitest run lib/__tests__/liveFlowRootCatalog.test.ts`

Expected: FAIL until the fixture and contract assertion are wired.

- [ ] **Step 3: Subscribe to meta on the Tickers tab**

Include `activeTab === "tickers"` in `flowTimingTab`. Parse `flowMeta` with `parseLiveFlowRootCatalog`. Build an impact map from `tideData.top_net_impact`; build fallback roots from the existing tide/unusual union; derive `tickerCandidateRows` with the helper.

- [ ] **Step 4: Replace sidebar candidate rendering**

Render all catalog-backed rows and only the old 20-row fallback preview. Active rows retain signed premium. Quiet rows render bilingual `CORE`/`ROTATING` text and a title derived from last source success. Add a compact bilingual summary such as `150 covered · 27 active`. Search uses normalized full-catalog matching.

- [ ] **Step 5: Make empty and no-data states source-aware**

For no search match under a valid catalog, say no covered root matches. Under fallback, say the coverage catalog is unavailable and the list is session-scoped. For a selected catalog row with no payload, distinguish awaiting first refresh, checked-but-quiet, and artifact pending according to the spec. When `has_session_data=false`, render that authoritative state without issuing a doomed `ticker:{ROOT}` request.

- [ ] **Step 6: Run unit and type checks**

Run:

```bash
cd terminal
npx vitest run lib/__tests__/liveFlowRootCatalog.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add terminal/components/OptionsHubView.tsx terminal/public/data/flow_fixture.json terminal/lib/liveFlowRootCatalog.ts terminal/lib/__tests__/liveFlowRootCatalog.test.ts
git commit -m "feat(options): expose quiet covered roots in Ticker Drill"
```

### Task 3: Browser proof across responsive and bilingual paths

**Files:**
- Create: `terminal/e2e/options-ticker-root-catalog.spec.ts`
- Modify: fixture data only if the browser harness exposes a missing exact contract.

**Interfaces:**
- Consumes: fixture catalog and Ticker Drill UI from Task 2.
- Produces: real-browser evidence that a quiet catalog-only root is searchable and selected.

- [ ] **Step 1: Write the failing Playwright journey**

The test must:

1. open the Options Tickers tab in fixture mode;
2. assert the coverage summary is visible;
3. search `$amd` and see exactly the `AMD` row despite its absence from activity feeds;
4. select it and verify the truthful no-data state;
5. repeat at desktop, tablet and mobile viewport projects;
6. switch to Chinese and verify the rotating/status and no-data copy are localized;
7. assert document scroll width does not exceed client width.

- [ ] **Step 2: Run Playwright RED**

Run: `cd terminal && npx playwright test e2e/options-ticker-root-catalog.spec.ts --workers=1`

Expected: FAIL before any remaining selectors/copy/responsive details are completed.

- [ ] **Step 3: Implement the minimum browser-facing adjustments**

Add stable accessible labels only where the browser test demonstrates a real missing contract. Do not refactor unrelated Options Hub layout or Flow Leaders code.

- [ ] **Step 4: Run Playwright GREEN**

Run: `cd terminal && npx playwright test e2e/options-ticker-root-catalog.spec.ts --workers=1`

Expected: PASS in the configured responsive projects with no console, page or HTTP errors.

- [ ] **Step 5: Commit Task 3**

```bash
git add terminal/e2e/options-ticker-root-catalog.spec.ts terminal/components/OptionsHubView.tsx terminal/public/data/flow_fixture.json
git commit -m "test(options): prove full ticker coverage discovery"
```

### Task 4: Terminal branch verification and PR evidence

**Files:**
- Modify: spec only if implementation required a contract correction.
- Modify: PR body after push; no product code in this task.

**Interfaces:**
- Consumes: Tasks 1-3 and Macro producer contract.
- Produces: immutable Terminal branch head, exact verification receipt and linked PR.

- [ ] **Step 1: Run focused unit, type and browser checks**

Run:

```bash
cd terminal
npx vitest run lib/__tests__/liveFlowRootCatalog.test.ts
npx tsc --noEmit
npx playwright test e2e/options-ticker-root-catalog.spec.ts --workers=1
```

Expected: PASS with exact counts recorded.

- [ ] **Step 2: Run the repository's required relevant suite**

Run the canonical Terminal unit command from `package.json`; record every failure by name. Then run `git diff --check`.

- [ ] **Step 3: Inspect branch collision and diff**

Compare `origin/master...HEAD`, confirm owned hunks remain path-disjoint from PRs #671/#680 and no `flowSource.ts` modification exists.

- [ ] **Step 4: Push and open the Terminal PR**

Push `sol/intraday-options-root-coverage-20260920`, open a PR closing issue #681, and link the Macro producer PR. State local proof, CI, merge, deployment and production proof as separate gates.
