# Analysis navigation R4 — Terminal / Paper reconciliation contract

Status: **code candidate in PR #1041; Paper source editable but live writes blocked by reviewed-catalog deployment drift** (2026-10-17). This is a migration checklist and QA contract, **not** a claim that the Paper artboards have been edited or that production is deployed.

## One navigation authority, two places

- Global Terminal/Mastermind header: global identity and account/product actions. No company-family items are injected into it.
- Analysis context bar: company SymbolPicker plus seven **families** `Overview / Intelligence / Financials / Earnings / Market / Ownership / Lab`. Do not render Back to Chart in the standalone `/analysis` route. The Chart rail action already routes back with the active ticker; the chart-hosted MegaPane overlay **retains its close control**.
- In-page contextual subheader: **local views**, never juxtaposed with families. Only show if the family has >1 child. Single-view families have no empty local-nav row.
- Narrow screens (≤860px): family picker opens the existing Company pages sheet; local tabs remain in the existing touch-sized bottom bar; Saved research/Theses remain reachable from the overflow menu.

`components/fin/finPageFamilies.ts` owns the family mapping; `FinPage`, `?page=<id>`, `?symbol=<ticker>` and chart cursor are unchanged. No new router, nav state store or global CSS authority is created.

| Family | Local views (`FinPage`) |
|---|---|
| Overview | overview |
| Intelligence | intelligence |
| Financials | statements, statistics, revenue, dividends, compare |
| Earnings | Results (earnings), Estimates/Analyst (forecast), Transcripts (transcripts) |
| Market | technicals, seasonals |
| Ownership | institutional (ownership), insider |
| Lab | lab |

The code intentionally retains the pre-existing `Analyst` wording for the Forecast child in this first routing-safe slice; relabel `Estimates` together in code and Paper after field-name review to avoid creating conflicting labels.

## Canonical Paper file and active implementation surfaces

File: [Terminal](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-9-1), id `01M3NSZGE8JWN2EZCSF0DT05RM`. The old `MASTERMIND PAGES` Earnings study links here, and is not the destination to edit.

| Paper page | Scope to reconcile |
|---|---|
| [06 · Company · Navigation + Interaction](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-9-1) | The 14 navigation spec/desktop/tablet/mobile and open-state boards, especially source artboards `76W-0`, `1-0`, `61X-0`, `4J4-0`, `MO-0`, `27A-0`, `5ML-0` |
| [Company · Production Suite · R3](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-S-0) | Eight desktop pages: Brief `1BEK-0`, Financials `1BKQ-0`, Earnings `1BQC-0`, Market `1BVY-0`, Ownership `1C1K-0`, Lab Expectations `1CD3-0`, Lab Valuation `1CIP-0`, Lab Replay `1COB-0`; plus Lab mobile `1D9K-0` |
| [07 · Research, Results + Sources](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-A-1) | 15 desktop/tablet/mobile intelligence, results, call, evidence source and verified-context states |
| [08 · Financials, Market + Ownership](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-B-1) | 11 desktop/tablet/mobile financials, earnings, market, ownership boards |
| [11 · Earnings + Dossiers](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-F-0) | Flow and four North Star desktop journeys; align any embedded Analysis header only, do not flatten distinct dossier navigation |
| [Company Intelligence R2 variants](https://app.paper.design/file/01M3NSZGE8JWN2EZCSF0DT05RM/p-1-0) | Reconcile reusable headers only where still declared active. Companion p-J-1 (mobile EN), p-K-1 (tablet), p-M-1 (ZH/320px), p-L-1 (evidence states) preserve their authored language and coverage semantics. |

**Not implementation targets:** `p-C-0` superseded archive and `p-G-0` immutable live baselines; `p-I-1` is a separate Intelligence Workspace product and must not be blindly converted to Company Analysis nav.

## Visual acceptance

1. At 1440 and 1024 wide, all seven families remain scannable with one clear active underline. Company ticker remains a functional search/switch control, and no duplicate Back button appears. Saved research/Theses retain access. No horizontal overflow.
2. At 820 / 390 / 320, family sheet, all five Financials tabs, three Earnings views, keyboard/touch access, safe-area and long localized names remain usable; the ticker stays visible.
3. The Earnings subheader is distinct from the seven family tabs, has sufficient spacing and active affordance, and does not crowd the report title. Single-view families do not leave dead header space.
4. Each active R3 artboard shows the new two-tier placement and updated page-local controls. Maintain original analytical content and evidence/trade-authority disclaimers. Avoid text-only annotation standing in for a screenshot design.
5. Page paths, ticker handoff, Esc/drawer semantics, transcript deep links and chart close stay unchanged.

## Actual Paper write gate (2026-10-17, verified)

Direct Paper reads and explicit-file target preparation of the canonical Terminal file succeed. The live Paper server reports `paper-desktop 0.5.14`, full catalog `1b9afff4c9bcf6f11f5ca2db301bf25ccdc442025344e2ec402459cedcd6a2db`. The attached bridge still expects `48b2587455d839a57b4b78f5cfdb2e75df8d530ad8059a3ad6af303c0d37224f`; `accepted_for_write=false`. The first `set_text_content` call was refused before dispatch as `UPSTREAM_SCHEMA_UNREVIEWED`, `retry_allowed=false`: **no design mutation was applied**.

Protected [Paper integration qualification](https://github.com/mastermindx-market-intelligence/Mastermind/blob/ebe2de8f0d94310241362874ec9262ba572a63d2/docs/PAPER_DESIGN_INTEGRATION.md) already documents and tests immutable v12 with this *exact* catalog (its bridge pin is `1b9aff...`). Actual next prerequisite: identify the installed **same original Paper-app seat**, reconcile any live effects and active lease, then use its reviewed owner-managed v12 Paper-only release/activation (no hand-edited pin, no carrier switch). Verify the new seat read/write admission and perform one non-destructive canary with readback **on the original app**, then update the target Paper artboards and capture screenshots.

Do not describe these Paper edits as complete until actual node mutations and screenshot/readback are recorded. Do not bypass the schema guard through Studio Direct/Remote Desktop Commander or a different ChatGPT account.
