# D08C — implemented research-scenario comparison

## Outcome and exact scope

This is the Chairman-authorized implementation continuation of [D08C design Draft #10687](https://github.com/mastermindx-market-intelligence/macro/pull/10687), returned to the existing [D08 integration #10649](https://github.com/mastermindx-market-intelligence/macro/pull/10649). It implements an explicit, in-memory baseline → revised-assumptions comparison in the **existing Options shortlist/Plan component tree**, not a new route, valuation engine, persistence store, alert service or trading interface.

Original managed operation: `d08c-plan-compare-20261104-c3`. Branch: `sol/web-d08c-plan-compare-20261104-c3`. Protected source base: `f528a219cc5d73e94e058575e3df83d689632bf9`. The original workspace was recovered rather than recreated. Original design packet `291f21aa8e9d757466412549a8d6537d889ab4d8` and B→C qualification `22f64bd142754b42d85df9fa90346b2f0e47b861` are unchanged. This implementation consumes D08-OPTIONS/1.0.0; it does not amend its source families or promote aggregate exposure coordinates into contracts.

**Production state: BUILT_NOT_PROVEN.** Source publication, hosted CI, formal release approval where binding, merge, deployment and authenticated customer acceptance are distinct. This continuation performs no merge, Ready/un-draft, enqueue, held relabel, deployment, SQL migration, production Save/watch or uncertain-operation replay.

## Working path

1. In `/options?tab=screener`, pin an exact contract from the incumbent source list and open Plan. The existing source adapter, full-list ambiguity checks, detached source row, original session/as-of and stale flag remain authoritative.
2. Author side, quantity and entry. Dated reference marks never prefill those assumptions. Calculate through the existing `/api/options/plan/expiry` owner and its request-bound response validator.
3. Explicitly **Pin baseline** after a qualified result. This retains an in-memory result and its exact validated draft only. It neither saves research nor creates a watch.
4. Edit the current assumptions. The current calculation is cleared, outstanding requests are invalidated, and the explicitly pinned baseline remains. Calculate the revised hypothesis explicitly.
5. A comparison is shown only for the same exact leg observations, qualified dated reference and identical actual price samples. Different source dates/digests, terms, identities or axes withhold the numerical comparison rather than silently normalizing or interpolating.
6. Read the focused chart, actual sampled outcome, leg-by-leg authored changes and full unrounded values table. The full sampled range is reachable explicitly. Clear removes the local baseline and returns keyboard focus to the comparison heading; closing Plan returns to the original shortlist trigger.

The existing scope-keyed Plan lifetime owns all local state. No account storage, operation identity, retry loop, source fetcher, score, quote, order, holding or Save/watch owner is introduced. A successful shape check is still not provider authenticity; the B→C full-list/source custody qualification remains binding.

## Numerical and evidence contract

`lib/optionsPlanScenarioCompare.ts` uses `preparePlanExpiryRequest` and `readPlanPayoff` for both sides. It preserves exact root/right/expiry/strike/terms identity, source pin key, raw as-of, stale marker, schema, hot-list provenance and copied source row. The reference root, reference and installed-observation digests, reference date/capture time, coverage and expiries must match.

The comparison consumes **actual API samples**, never a second pricing model. Its difference is revised P/L minus baseline P/L at the same sampled underlying price. A summary point is selected from the actual shared sample grid nearest the first strike; a strike or break-even annotation cannot create a new P/L sample. Focus mode selects a subset of existing indices around strikes/breakevens; Full restores every sample. Lines connect sampled points visually but do not produce interpolated numerical results.

The exact table uses the API's represented numeric values without rounding them to cents; this deliberately preserves tiny nonzero values and floating-point representation details. Rounded currency summaries are separate. Original signed worst/best outcomes and `UNBOUNDED` semantics remain in the incumbent payoff result; the finite comparison viewport does not establish global risk limits. Fees, early exercise, assignment, current quotes and trading execution remain excluded.

The baseline and revised result retain their separate calculation timestamps. Authored quantity remains a hypothetical contract count, never an actual holding. Per-leg premiums remain distinct; no net-debit shortcut replaces them. Chinese side/right labels are localized without parsing or normalizing an identity string.

## Source and visual reference

The exact native Paper target was actually reread through the original **Mastermind Paper** app during this continuation:

- File `01M3NSZGE8JWN2EZCSF0DT05RM` (Terminal), candidate page `p-13-0`.
- C02 comparison artboard `1OGC-0`, actual screenshot inspected; C01–C10 identities remain present.
- Read-me page `p-15-0`, C00 `1S0R-0` is retained from the original manifest.
- Observed token hash `55dd37b7`; live per-tool catalog was compatible. No Paper writes were made.

C02 informs exact-leg authored differences, before-cost qualifiers, readable comparison and an equivalent values path. The delivered component is a baseline plus one revised calculation within the actual existing host. It is not asserted to reproduce every three-column or saved-research state in the broader Paper programme.

## Repairs demonstrated before publication

| Finding | Correction and proof |
| --- | --- |
| Exact table rounded tiny nonzero P/L to zero | Added failing component regression; render raw API numeric values in the exact table. Summary formatting remains separate. |
| Comparison declared both scenarios unsaved, even when an incumbent reader may supply saved research | Added failing regression; copy now says pinning sends no Save/watch and leaves existing saved research unchanged. |
| Chinese comparison displayed raw `buy`/`sell` and abbreviated contract right | Added failing regression; use explicit contract identity and localized side/right labels. |
| Clear removed its own focused control | Added failing regression; focus returns to the persistent comparison heading. |
| First mounted fixture expected the raw source row without the incumbent DOI preset | Inspected `optionsScreener.ts`; the existing adapter adds `preset:"doi"`. Corrected exact fixture expectation, without changing product source or weakening it to a partial match. |
| A requested light attribute did not activate a light theme in legacy Terminal | Visual inspection identified the gap. Legacy Terminal is qualified as dark; actual light qualification uses the existing Shared Shell owner and computed colors, not an injected theme claim. |
| Full Node 26 test run exposed missing experimental global webstorage | The existing repository capture wrapper already uses `--no-experimental-webstorage`. Matching that runtime behavior passed all 106 affected tests plus 25 D08C tests, without product edits. |
| Two legacy source-evidence locks do not match the protected base | Preserve original manifests and guards. Use new source-bound immutable PL6/VI captures through the incumbent owners and explicit validated composition. Never restamp hashes or reuse another workstream's held captures. |

Detailed commands and actual returns are retained in `logs/`. Initial RED receipts and old captures remain historical; they are not silently relabelled as current passing evidence.

## Verification inventory

Final local result: **18,453 unit tests passed, zero failed; 47 existing skips and four todo cases** across 1,076 passing test files and five skipped files. The final full log is preserved losslessly in `logs/d08c-full-unit-final.log.gz`. Twenty-six focused D08C tests pass. The existing lifecycle guard separately passes all 28 tests after log packaging; its source and expected-file assertions are unchanged.

The final frozen candidate also passes **24 ordinary-Terminal browser cases plus 12 actual Shared Shell cases**, zero retries, production build, TypeScript, scoped ESLint (zero warnings/errors), and the forward-only plain-language guard (zero new blocking findings). The existing evidence owner validates **50 required cases** from 24 PL6 and 30 VI actual captures. `legacy_terminal_captures/` contains 34 final ordinary-host images; `shared_shell_captures/` contains 28 current, theme-qualified viewport images.

The first broad run's Node-storage and legacy-source mismatches are retained. A subsequent run found only a test-log self-inclusion in the repository's all-extension source census; both historical full logs were archived losslessly with before/after hashes, and live final output was written to the already-excluded `.next` diagnostic directory. No product guard, expected hash, test assertion, skip or quarantine was changed to obtain a pass.

The final result inventory is recorded in `VERIFICATION.json` at publication. It distinguishes focused tests, full repository tests, source-bound evidence composition, ordinary Terminal versus Shared Shell browser runs, lint, production compilation and source integrity. Only completed processes with observed exit results count as passed.

Browser tests use the actual Next/React component tree with explicit local auth/source/API fixtures. They do not prove a provider's authenticity, current exchange quotes, live contract-reference coverage, production entitlement or authenticated customer persistence. Assertions cover exact retained source rows, stale markers, per-leg entry, actual sampled values, two explicit calculation requests, zero persistence/alert/order mutations, 44px controls, keyboard focus, labelled two-dimensional scrolling and no document overflow. Desktop/tablet/phone and 320px reduced-motion checks are retained. Screen-reader and native 400% zoom acceptance are not inferred from these fixtures.

Screenshot directories:

- `captures/`: first implementation captures, prior to focused-range repair.
- `captures_final/`: improved range captures from the earlier pass; not final current-source attribution.
- `captures_current/`: first mounted browser pass. Its light-named legacy frames **do not prove light theme**, and element screenshots clipped by the host scroller are not whole-component visual acceptance.
- Later qualified viewport captures and their manifest are identified by the final verification inventory; they show the actual theme owner and reachable controls/graph rather than assuming a tall element screenshot captures its scroll contents.

## D23/#804 compatibility and protected ownership

Original Terminal [#804](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/804), branch `claude/iw2-g5-thesis-references-20261004`, was freshly read at `27df56d997df0ae94a17b6b8e2d14867431bb394`. Its Draft/HOLD, release hold5989604142, original T03k/effect and exact-0030 conditions remain with that owner. This implementation does not import or activate its persistence branch.

The precise integration delta matters: #804's `OptionsPlanPayoffPanel` adds the synchronous `isScopeCurrent` callback, checked before calculation and after every asynchronous response/JSON boundary; `OptionsShortlistPlan` supplies the incumbent `OptionsPlanResearchBridge` and current draft callback. **An eventual source integrator must retain those guards and bridge, not replace the held panel wholesale with this protected-base copy.** When native lifetime retires, comparison state must retire with the same owner. The existing scope-key remount behavior here is not claimed to qualify all #804 lifetimes.

D23 retains exact Save/readback/watch/revisit custody. D22 retains actual holdings. Known Save commitment cannot be downgraded by readback failure, and unknown outcomes must retain the original operation. No local baseline status claims anything about account persistence.

## Remaining programme boundaries

The original 47 future acceptance scenarios are not blanket passed by this slice. Current local proof qualifies the comparison, current Plan regressions and actual shortlist entry/return. Native Save/readback/watch/firing/revisit paths remain with #804/D23 and their original release and authenticated acceptance gates. F01/F02 final foundation acceptance, actual source qualification and final programme acceptance are separate.

A host command explicitly refused an additional Restore-baseline/risk-outcome extension and its proposed extra tests before dispatch. Same-carrier readback showed the original test files unchanged. That action was not retried, decomposed or moved to another carrier; the proposed extension is **not implemented or claimed tested**. The independent already-implemented comparison, numerical/copy repairs and their verification proceeded. No uncertain publication or Paper effect is manufactured from that refusal.

Original Executive/Fabric root discovery returned `backend_unavailable` with request-not-sent; no worker, review approval, START or background continuation is claimed. This work uses the existing principal workspace with self-QA, not an optional reviewer waiting room.

## Integration action and rollback

Consume this exact implementation with the unchanged D08C design and B→C qualification. Keep the actual mounted route, source/API owners and #804 lifetime guards when integrating. Required current-head CI, any binding non-author source approval and protected release remain the existing owner's actions. No release transition is performed here.

Rollback is removal of this bounded comparison addition through the normal reviewed source path; there are no persisted objects, migrations, alert subscriptions or holdings to unwind. Preserve the original Plan/editor/source contracts and all independent incumbent changes.
