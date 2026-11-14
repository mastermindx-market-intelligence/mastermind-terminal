# Economy reading hierarchy and browser qualification

## Scope, source and concurrent custody

This is a bounded implementation contribution to the existing native Macro / Market Ontology mission, WS:MARKET-OS and Macro #6819. The parent outcome in `PLAN.md` remains open. No independent programme, release carrier, registry, data owner, scheduler or runtime is created.

Base: Terminal integration PR #1524, commit `166a0c79456cb8edd64f76faec2edf3c8ff982a3`, tree `5ba203f6b72d24e624ae751a52ee4b2d150e33e9`. That commit was authored by `mastermindxryan` at 2026-11-14T15:16:20Z and records a successor session continuing the Paper/native design work. Its only delta from `751fd566cf06d9a616ede61e6efb367197ef26f6` is the 73-line plan continuation. The original session discovered that movement before attempting any update to the shared branch.

This contribution therefore uses isolated additive branch `sol/native-economy-reading-qualification-20261114-c3`, targeting the existing integration branch. It preserves the successor's plan, Paper frames and active Rates provenance work. It does not update, reset, rebase, release or take over PR #1524. No change is made to `MacroEconomicCurve`, `MacroEconomicEvidence`, the economic payload decoder, the daily dashboard, the API owners or the generated admission catalogue. Any later integration must reconcile the then-current parent and its live writer before advancing its ref.

The source law remains the compatible protected Mastermind pin `199fd4f91ecc426b1d974eb3bf47f5162476cf24`. A complete 84-path comparison to observed protected master `df641640e6dc1ce5bc7717fa458b49ba4cb0e052` changed none of the applicable governing laws; `ACTIVE_EXECUTION.md` remains blob `0dfdfb2306df7efcfa34f8b510be0ef6422ff988`. The current session-target projection returned no addressable target, and the Executive state reader returned `backend_unavailable`; neither observation establishes a durable runtime handoff or a stopped successor. No new message, worker, observer, retry or control-plane record was created.

## Consumer changes

Inflation now opens with four existing published rate measures: headline/core year-on-year and month-on-month CPI. Plain labels explain the comparison periods and the exclusion of food and energy. Every value retains its published reference period, freshness and source action. Zero remains a number; missing current rates remain unavailable even when index history exists. The default historical chart is explicitly named Price levels. The browser calculates no new inflation rate from those indices.

An owner's explicit `state_descriptive` or `state_unavailable` explanation appears before chart exploration. All remaining implication entries and their evidence qualifications remain available under Context & limitations. Internal composition history is not promoted as a consumer headline. A missing assessment in a workspace that actually has axes is labelled unavailable; Rates continues to use its qualified curve-shape reading, and workspaces without an axis model retain their own presentation.

History pointer selection now maps rendered CSS pixels into SVG coordinates, matching the existing payroll chart's conversion. A scaled chart therefore selects the actual plotted observation. Coarse-pointer chart/table controls and the observation slider retain a 44-pixel target height.

## Existing hosted regression repaired

The predecessor's serial browser shard failed two retained-company-event cases (English and Chinese): [run 43606116892, job 132481287157](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43606116892/job/132481287157). Its captured page already contained the single Terminal rail action with the exact AAPL symbol and full retained-event return URL. The imported Analysis test still expected the previous topbar action.

Both obsolete desktop selectors now target `.shared-shell .appnav a[data-shell-terminal]`. Visibility, single-action count, exact symbol/return URL, actual Terminal navigation, chart symbol, Back navigation and restored event identity are preserved. Mobile drawer/focus checks are unchanged. No timeout, skip, reduced assertion or duplicate UI action is introduced. The original artifact's checkout commit was `b47e1df89850ad4585532fefe73361ff041e580f`; its bound tree `0552108fd4b2dc20a2ac0713617c7129de28e8e8` exactly matches integration head `751fd566…`. This is CI fixture evidence, not beta acceptance.

## Browser evidence being added

`e2e/native-macro-economy.spec.ts` uses the repository's existing synthetic-component test approach. It bundles the real market boundary, Route, Reader, decoder, charts and evidence components. Next navigation and verified identity are explicit test boundaries; fixture responses use the existing producer-shaped overview, workspace and payroll JSON. There is no production route, auth bypass or public fixture endpoint.

The suite exercises English/Chinese and dark/light combinations in the existing desktop/tablet/mobile projects. It captures the overview, money workspace, evidence panel, unavailable Inflation rates with populated index history, selected historical observation/table, dated Rates comparison and retained payroll revisions. It checks scaled-chart pointer selection, URL/table agreement, evidence focus/return, study Back continuity, absence of iframes, overflow and clearing private readings on sign-out. A separate clearly synthetic rate variant checks populated values and zero without modifying fixture files. Each image attachment records checkout, original fixture digests, viewport, content width, route, language and theme; that variant's filename explicitly identifies its synthetic values.

These are source component and interaction artifacts. They do not establish Paper completion, server authentication, a served production generation or a deployed native route. They are not an alternate carrier for the earlier denied local preview. The existing hosted repository workflow remains the execution owner.

## Verification and remaining work

Local qualification:

- Four existing Economy consumer/route/payload/page suites: **201 tests passed**. The consumer suite was rerun after the final unavailable-assessment wording: **31 passed**.
- New browser-spec/component graph: TypeScript qualification passed with the explicit fixture aliases, incumbent Next CSS declarations and available Playwright 1.62.1 types. This is not the locked-repository full typecheck.
- The browser specimen bundles with **zero errors and zero warnings**.
- Existing plain-language guard, exact nine-code-file added diff: **56 scanned files, zero blocking findings, zero waivers**. One previously documented legacy directive report remains.

Browser execution, screenshots and exact-head hosted qualification are still pending at this source save. The entire parent programme and all release/catalogue holds remain open. The next action is to consume this child's actual hosted result, repair any concrete failure, review the bound screenshots, and integrate the qualified delta with the active parent writer. Parent #1524 must retain the genuine current-head check and admission requirements.

Related independent work is saved in Macro [PR #11269](https://github.com/mastermindx-market-intelligence/macro/pull/11269), exact head `66a8e4cf15ebcb9c3a470d182fce5c0e15cacf3e`: the bounded internal two-yield Rates calculator passes 225 tests. Its endpoint, public schema and all execution flags remain unchanged. That source phase is not an executable scenario journey. It does not overlap the successor's selected-tenor source-provenance work.

The source record reports the successor's new Paper frames but this contribution has not inspected them. Original Paper and browser-effect records remain intact. No consumer, Paper, scenario, deployment or parent-completion claim follows from this patch.
