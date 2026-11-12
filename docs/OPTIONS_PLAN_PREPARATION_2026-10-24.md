# Exact-contract Plan preparation

This is source preparation for the existing Investigation owner's explicit `investigation_manifest.v3` optional `option_plan` integration. It is not admitted persistence, a shipped Plan journey or a valuation. No Investigation/API/outbox/SQL/Lab/Exposure source is changed. The standalone editor is intentionally unmounted until that composition is ready; it offers Apply draft, not a working account Save.

## Contract and integration seam

`lib/optionsPlanDraft.ts` exports `OPTIONS_PLAN_DRAFT_SCHEMA`, `OptionsPlanDraft`, `PlanDraftResult`, `createOptionsPlanDraft(pins)` and `validateOptionsPlanDraft(raw)`. The strict inner payload is `{schema:'options_plan_draft.v1',legs:[{snapshot,assumptions}],research:{thesis,invalidation,horizon}}`. Each snapshot is a detached, deeply frozen exact `ShortlistPin` and is revalidated with incumbent `buildPin` / `ContractIdentity`. Its original row, source/session/asof/schema/null terms/stale flag and exact root survive. It records an internally consistent retained observation, not authenticated provider bytes or a fresh original-list ambiguity check. No missing clock is invented.

One to four legs share one exact root. True contract identities cannot repeat; supplied adjusted terms distinguish identities. Per-leg side and quantity are separate; quantity is null or a positive safe integer up to1,000,000 contracts. Entry is null or an explicitly authored finite nonnegative premium per unit with `kind:'user_assumption'` and denomination USD; zero is meaningful. No source mark prefills an assumption. Thesis/invalidation preserve up to4,000 Unicode scalars each; authored horizon preserves up to160 and is independent of expiry. Blank research and null assumptions are valid incomplete drafts.

Rows retain bounded data-only JSON (8KiB each, depth8); the full draft is64KiB with a2,048-node bound. Accessors, unsafe/inherited object shapes, cycles, nonfinite numbers, unsupported text and unknown typed fields refuse. Returned graphs are frozen and detached. A future outer manifest must still fit its existing128KiB limit and route132KiB limit.

`OptionsPlanDraftEditor` receives `{draft,lang,onApply,onClose}`. The integration owner mounts it with a new key only when the person explicitly replaces the source draft. It shows frozen reference marks, missing executable quote/size and contract terms using incumbent `buildComparison` / `CompareCell`; editable text/side/quantity/entry remain separate. `onApply` receives a validated immutable inner draft; it does not save. Numeric invalid text and an entry lacking denomination block Apply visibly. There is no fetch, storage, quote fill, payoff or PnL. EN/ZH copy and incumbent tray/tokens are reused.

The existing Investigation owner owns v3 envelope admission, explicit intent mapping, canonical full-command digest/equality, CAS, same-key recovery, versioned read/reopen and Review composition. Never normalize already-sent v2 operations, encode Plan in a note/reference, introduce a second cloud store or claim the held0030/T03k operations are cleared. The final milestone is durable Plan→Compare→Review through that existing action, not this preparation artifact.

## Executed checks and remaining acceptance

45 focused checks pass:18 pure Plan contract,3 isolated editor behaviors and24 incumbent shortlist cases. TypeScript and changed-file ESLint pass. The shared fixture `lib/__tests__/fixtures/options_plan_draft_v1.json` is explicitly synthetic, includes an adjusted root, unknown terms/schema, a null entry and a distinct explicit zero assumption. No live-source/rights qualification is implied.

The editor is not mounted in a customer route and has no responsive/browser or production acceptance claim. On integrated mounting, require exact source retention after source refresh; source-vs-assumption comparison; valid/invalid/null/zero entry cases; original v2 recovery; same-record saved revision reopen after head changes; EN/ZH desktop1440×900/tablet820×1180/mobile390×844; keyboard focus and degraded source/Save states. Product dark-only theme remains the current Terminal limitation.

## Fabric result

New normal run `fable-exact-plan-validator-20261024` was admitted after the prior429's1,800s cooldown expired. Actual root/child ancestry was verified; normal routing selected Qwen3.8Flash/m1, lease and verified transport succeeded, launchattempt1 settled rc1/result497bytes with Ryan429/QWEN_FINAL_RESPONSE_UNCONFIRMED. The same result was consumed, no code returned, no acceptance/replacement/provider forcing occurred. This candidate is authorized direct coordinator integration, not a relabeled worker result.
