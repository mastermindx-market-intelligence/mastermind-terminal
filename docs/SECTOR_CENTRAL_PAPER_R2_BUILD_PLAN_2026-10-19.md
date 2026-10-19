# Sector Central — Paper R2 native delivery and end-to-end build plan

Date: 2026-10-19. Product continuation: [Macro #7646](https://github.com/mastermindx-market-intelligence/macro/issues/7646#issuecomment-6247254582).

## Outcome and current delivery boundary

Sector Central now has a native Paper-based candidate inside the existing Terminal application at `/discover?tab=sectors`. It replaces the six-peer-page navigation with **Brief → Explore → Research → My watches**, retains the selected sector and the existing detailed instruments, and consumes the existing backend owners. This is actual React application source, not the earlier standalone HTML reference.

The native candidate is implemented and locally verified. Publication, complete repository CI, merged-source deployment, authenticated production readback and the legacy URL cutover are separate gates. The original programme remains open. The source must not describe this candidate as deployed merely because its fixture journeys pass.

The old HTML reference published through Macro #9592 is superseded as a visual implementation. Its contract inventory remains useful. The original Macro #7595 source-custody, review and browser restrictions remain attached to that original candidate; this native Terminal implementation does not clear them.

## 1. Actual Paper authority

File `01M2WGNCX9475G79JRKJTCM08P`, Sector page `p-Y-0`:
[open the Paper page](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-Y-0).

| Board | Role in this delivery |
|---|---|
| `24RC-0` | Original R2 Brief composition and typography |
| `2596-0` | Original R2 Explore / Rotation instrument composition |
| `6K0C-0` | New native Brief variant: measured leadership, supported 21/63-session history |
| `6JVY-0` | New native Rotation variant: 63D / 21D relative wealth, SPY total-return basis |
| `261A-0` | Dossier target; native dossier features remain reachable |
| `273O-0` | Research target and continuity |
| `28SK-0` | Compare / Themes reference; decorative warning rail removed from `28VS-0` |
| `28BJ-0` / `28OT-0` | Mobile Brief and Breadth composition |
| `27SZ-0` | Existing backend-contract design reference |
| `24OB-0` | Existing authority reference |

The adapter was read-qualified for write with matching catalog digest `1b9afff4c9bcf6f11f5ca2db301bf25ccdc442025344e2ec402459cedcd6a2db`. The new native variants were created by cloning the actual R2 boards, changing their measurement copy and plots, then inspecting their real Paper screenshots. Original concept boards were preserved. The two native variants and the warning-rail removal were finished through Paper's normal node workflow.

The native page adopts the Paper hierarchy: open white or dark surfaces, large editorial headings, a compact local navigation, a dominant evidence instrument, restrained neutral side panels, and chart-first mobile ordering. It retains Terminal's shared global shell; the separate held shared-shell programme is not silently adopted.

**Permanent design direction:** decorative colored rails on any container edge are prohibited. Hierarchy comes from whitespace, type, neutral surfaces and even borders. Structural rules, complete focus outlines, active-tab indicators and data marks retain their function. This instruction is recorded in both repository AGENTS files.

## 2. Information architecture and preserved capability

| Legacy destination | Native destination | Preserved meaning / next action |
|---|---|---|
| Overview | Brief | Source-ranked leadership, measured/unmeasured coverage, evidence history, three investigation starts |
| Map | Explore → Market map | Existing sector discovery, table, heatmap, matrix and summary representations |
| Moving | Explore → Rotation | Native plot/list, selected-group inspector, reconstructed history and recorded episodes; “What changed?” reaches the event section |
| Money | Explore → Breadth | Participation, advancing/declining counts and coverage. These observations are not renamed capital inflows |
| Explore | Explore + selected dossier | Existing group picker, company comparison/table, cycle/signals, drivers and history |
| Confluence | Explore → Confluence | Source groups, entry tier, regime, priced/member counts and company continuation |
| Theme comparison | Explore → Themes & overlap | Existing theme state and entry-ready field, with explicit limits on overlap/membership history |
| Saved investigation | Research | Sector/ETF investigation questions and existing saved-research route |
| Monitoring | My watches | Existing owned list inventory, explicit add of a sector proxy, reload persistence, sector/company continuation |

Brief answers “where should I investigate?” Explore answers “what supports that observation?” A dossier carries the selected group's detail. Research connects the evidence to a question. My watches preserves a practical way back to the investigation.

The native controller remains the sole owner of the seven sector feed requests, account identity/revision isolation, URL patches, dialogs and fetch cancellation. Paper components do not create another market-data fetcher, global shell, router or scoring service.

Direct Paper lens links normalize the native instrument only for non-detail Explore. Intentional dossiers remain dossiers. Each dossier history entry stores its own same-origin return URL in `mmxSectorPaperReturnV1`; browser Back restores that entry's origin while preserving framework history metadata. Brief and Research openers have stable focus targets. Existing company/group navigation, source-sheet Escape behavior and outer Discover Back behavior are retained.

## 3. Measurement decisions that make the design trustworthy

### Leadership is the existing measured owner output

The Brief reads `leadership_rotation_context.measured_group_read/v1`, definition `leadership_rotation_context/1`, the eleven US-sector cohort, SPY benchmark, total-return basis and the native 63-session ranking. It preserves source ranks; it does not run a frontend ranking algorithm.

The adapter qualifies the original schema, metric, units, cohort, benchmark, price basis, date, count and rank consistency before showing a ready view. Primary 63-session values must be finite. A missing secondary 21-session value remains missing rather than invalidating a valid primary ranking. Malformed non-null measurements are rejected.

These values are already percentages. A source value of 2.40 displays as 2.40%, not 240%. Relative wealth is the change in the sector/benchmark wealth ratio; it is neither an arithmetic percentage-point spread nor proof of positive absolute returns.

Coverage belongs to each source. The test fixture's 9/11 is not a live market observation. The UI renders the actual unmeasured group names and source reasons, and excludes them from the ranking. It does not manufacture a complete cohort from the visible rows.

### The Paper plot must match the available backend measurement

Original Paper concepts included common-start absolute-return curves and differently named rotation axes. The current production contract supplies 21- and 63-session relative-wealth history. The native Paper variants therefore show that supported measurement explicitly.

The Brief history reuses the existing history parser. It requires an unambiguous native ID/ticker join, SPY, source path/version, compatible dates and at least two points. Its own source clock is visible. It is labeled reconstructed descriptive history, not a signal known at the historical date.

The optional common-start total-return chart is a separate typed contract: fraction units, exact identity/benchmark/currency/source, common zero start, ordered dates and independently nullable legs. Only that chart converts fractions to percentages. No live producer of that separate series is connected in this candidate.

The SVG charts use the existing measured-pixel chart primitives, preserve missing-value gaps and provide a full accessible value table.

### Confluence, themes and entry decisions remain distinct

Confluence preserves its source order, T1/T2/T3 entry tier, regime and priced/member counts. Its stale notice uses its own receipt. A small member preview states its limit and does not change the denominator.

Themes consume the existing owner envelope and its own stage/entry-ready fields. Shared membership is relevance, not independent evidence of rotation or money flow. Full overlap and point-in-time membership history are not claimed where the source does not provide them.

Group leadership does not grant a stock entry. The Brief sends “Check entry signals” to the native Signals detail. Existing cycle, company and source evidence remains available; this patch changes neither entry eligibility nor risk sizing.

## 4. Backend integration completed in this candidate

### Existing market-data boundary

The seven-feed controller remains identity- and revision-fenced. A changed account hides previous-account data during render, before effects complete. Requests are cancellable. Loading, access denied, unavailable, invalid and request failure remain distinct. A failed request never becomes an empty successful market.

No backend owner, scheduler, quote service, ranking formula or membership producer is replaced.

### Existing watchlist owner

My watches uses `GET /api/watchlist` and the existing `POST` add action with an explicit owned `listId`. The API/service retains authorization, grants, persistence, normalization and deduplication.

The client keys reads by immutable account UUID, not email; it clears previous-owner inventory immediately and ignores late responses. It consumes only owned lists from `lists`, preserving source order, sections and symbols. It does not fold `sharedWithMe` into writable ownership.

The consumer is add-only. It does not run TerminalShell's migration, deletion outbox, local storage synchronization or list-organization logic. Every write outcome reconciles through a canonical GET. A lost or ambiguous reply is not automatically retried or falsely described as confirmed.

Browser proof uses the repository's existing development fixture identity and per-test isolated watchlist store. It exercises the actual route/service; it is not proof against production Supabase or a signed-in production account.

### Research continuity honestly scoped

The existing saved-research destination receives the selected sector ETF symbol. The current Research view is sector/ETF-scoped, not an arbitrary-company or arbitrary-confluence-group snapshot handoff. It explicitly states that the sector snapshot is not saved with the symbol yet.

The inspected investigation command contract is deliberately unconnected pending its existing owner convergence. This candidate does not infer authorization to create a new evidence adapter or persistence owner merely from the presence of a TypeScript type.

## 5. Remaining end-to-end integrations and acceptance conditions

| Work item | Existing owner / seam | Concrete completion condition |
|---|---|---|
| Native release | Terminal normal PR, CI and git-gated deployment | Exact merged source, all required checks, served marker and authenticated real-route readback |
| Legacy six URLs | Original Macro Sector source / #7595 recovery | Recover original custody/review gate, preserve bookmark meaning, perform admitted serving/browser proof and route users to the native destination |
| Shared shell convergence | Existing shared-shell programme | Adopt its accepted release through normal integration; do not import a held draft |
| Dossier/Compare full Paper refinement | Sector native components + Paper `261A-0` / `28SK-0` | Preserve all company/group/signal/history actions while completing each reference state and mobile return path |
| Saved research snapshot | Existing investigations/Saved Research owner | Exact source references, version and availability cut survive save, reload, ownership changes and reopening |
| Sector condition alerts / saved views | Existing alert and workspace owners | Real condition/state contract, explicit user action, existing delivery/persistence service, deduplication and source-loss behavior |
| Full theme overlap | Membership graph / baskets / canonical theme-membership owners | Exact membership cut, rights, provenance and duplicate-root accounting; no names-only joins |
| Prophet context bridge | Existing Prophet reader and theme-membership evidence seam | Canonical identity and source-qualified evidence reach the admitted receiver without altering score, stage, admission or unintended lane ranking |
| Predictive rotation research | Leadership Rotation owner / Mastermind #1194 | Dated V3 protocol and fresh synthetic feasibility/size/power qualification before any withheld partition is read |

The Prophet bridge must compose existing owners at read time: canonical sector/theme IDs, exact membership revision and effective/known cutoff, source rights, independently timed observations, and nullable exact episode association. Missing association remains absent. Public theme lookup fields are not a substitute for private evidence denominators.

The existing Prophet caveat is retained: the buy-score/stage/admission path is neutral to the new sector context, but the existing RAN path sorts `theme_confirmed` before its cap. Verification must separately compare scores, eligibility, featured selection, every lane's order/cap and that existing RAN behavior. A blanket claim that all rankings are context-neutral would be false. The new bridge must not extend that existing sorting rule.

### Latest related owner record consumed

The [October 18 local / October 19 UTC Prophet owner checkpoint](https://github.com/mastermindx-market-intelligence/macro/pull/9035#issuecomment-6257357872) still records a real B1 receipt-identity failure and 27/27 native bridge refusals at clock provenance, with no newly originated Plans. The existing owner must repair stable per-observation evidence versus mutable publication provenance and prove normal scheduled reader admission. This Sector UI must not treat membership, a refreshed page or a successful symbol handoff as clearing those gates.

[Macro #9600](https://github.com/mastermindx-market-intelligence/macro/pull/9600) is a separate draft repair for visible baked source dates before JavaScript hydration on the legacy page. It is not this native redesign and is not adopted or superseded here. The same owner checkpoint retains missing RIG receipts for the earlier #9592 reference and the #9595 reference-integrity failure. None is cleared by this candidate's screenshots.

## 6. Research and mechanism work

The retained T26 disposition says measured product complete, predictive qualification **NO**, original programme **NOT COMPLETE**. T12R was sized; H1/H2/H3 power remained not executable at their registered margins. The accepted decision withholds P1/P2/P3 until a dated V3 re-registers the statistics and earns fresh synthetic qualification.

A concrete P0-only feasibility proposal accompanies this plan. It separates an estimator that cannot recover a planted contrast, a detector that does not exploit the signal, and a generator that never created the required incremental advantage. No old grid is rerun and no market-data look, sealed trial, signal weight or production entry rule is changed here.

Primary source: [T26 closeout at the inspected Macro pin](https://github.com/mastermindx-market-intelligence/macro/blob/b912fd97827cca925a7123aa2012e9765077f3f7/research/LEADERSHIP_ROTATION_T26_CLOSEOUT_2026_10_14.md). Scientific progress belongs to Mastermind #1194; Sector #7646 is the product continuation, not a substitute scientific progress carrier.

## 7. Review and validation

Source reviews independently accepted the evidence-semantic repairs and the native mount, account boundary, single URL owner and repaired dossier history boundary. Those are source-level judgments, not reviewer claims of production or browser inspection.

The review packet contains the actual Paper JPEG captures, native browser PNG captures, source-byte binding, commands and scoped test receipts under [docs/pr-crops/sector-paper-r2-20261019](pr-crops/sector-paper-r2-20261019/README.md).

Local verification covers the new Paper model/view/watchlist tests, existing rotation/measured/navigation tests, TypeScript, changed-file ESLint and the three native Sector browser suites at all contract viewports. The complete repository CI remains a release gate; a scoped local run is not represented as the full 2,499-test desktop/tablet/mobile inventory.

## Release sequence

1. Preserve the verified candidate through the same exact-HEAD managed publisher and one Terminal PR against master.
2. Resolve exact-head CI and review findings. Retain real holds; never clear them through another branch or transport.
3. Deploy only merged master through the existing git-gated deployment path.
4. Verify the native source marker, real authenticated source states, account-owned watches, legacy/native link behavior and the mobile investigation journey.
5. Continue the existing owner integrations above until their actual user outcomes are proved. Keep Sector product completion separate from predictive scientific qualification.
