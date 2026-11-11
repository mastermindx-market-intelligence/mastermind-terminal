# Today daily desk integration proof — 10 November 2026

## Exact source

- Captured product commit: `a57bd879088d4b35789939935fe932ecbf4a340c`.
- Captured tree: `578923cf493dd73122149299f98cd326dc4ee9ff`.
- Parents: original PR #1381 `5bbc6c25b4bbba49de31e2b8837d6404726b5a3a` and protected Terminal master `2fe2f02f07d1df8c855388bc556383cd74de44fd`.
- The sole manual source resolution preserves both `TodayDeskDestinations` and `TodayIntelligenceEntry`. The Intelligence entry remains immediately after the page header, with its original bilingual copy, `/intelligence` destination and `prefetch={false}`. Other incoming files retain their accepted bytes.

## Reproduction and scope

This packet uses the existing actual-component producer from `../../shared-shell-daily-desk-20261109/today/capture.mjs`, copied into a new dated packet so the original images, report and source identity remain unchanged. The capture mechanics, state fixtures, timeouts, disclosure tests and storage-owner checks are retained. Added checks require exactly one bilingual Intelligence entry and no Intelligence source request. Added metadata binds the producer, captured source tree and 40 local source/configuration inputs; inputs are hashed before and after the browser matrix.

From `terminal/` at the captured product commit, with this packet's producer present:

```sh
CAPTURE_SOURCE_HEAD=a57bd879088d4b35789939935fe932ecbf4a340c CAPTURE_SOURCE_TREE=578923cf493dd73122149299f98cd326dc4ee9ff node docs/pr-crops/shared-shell-daily-desk-integration-20261110/today/capture.mjs
```

The producer bundles the actual Today workspace and imported components. It uses explicit local source-shaped HTTP fixtures, a mocked SDK identity/onboarding boundary and an anchor replacement for Next Link. External network requests are aborted. No authenticated deployment, live-source acceptance, production release, Paper/F01 acceptance or Research publication is claimed. The breadth fallback visible in these fixtures does not claim live breadth availability. System font fallback is used; no optional external font chunk was supplied.

## Results

- 23 cases passed: ready state at 1440, 820 and 390 pixels in both themes and languages; one 320-pixel light Chinese stress case; overflow, first visit, quiet, teaser and unavailable states at 1440 dark English and 390 light Chinese.
- 25 fresh screenshots: one per case plus both collapsed overflow states.
- Every case has exactly one main landmark, no page exception and no horizontal overflow. Both language labels and the Intelligence destination are verified.
- Existing source/comparison disclosure keyboard checks, exact prior/current dates, no duplicate disclosure reads, account storage isolation, change payloads, first-visit marker, in-place overflow expansion/focus, teaser access boundary and unavailable retry/marker checks passed unchanged.
- Visual inspection: `1440-dark-en-ready.png`, `390-light-zh-ready.png` and `320-light-zh-ready.png`. The entry and daily desk remain readable; narrow text wraps within the viewport and the desktop/two-column and narrow/stacked layouts remain coherent.
- Local focused qualification before capture: 202 tests in 11 files passed; Next type generation, full TypeScript, TodayWorkspace ESLint, language guard self-check and enforce-added check passed. The Node 26 local unit process used `--no-experimental-webstorage`; no repository runtime setting changed.

`report.json` contains every browser case and its observations. `input-manifest.json` contains the exact source input hashes. `sha256sums.json` binds the packet files. The subsequent evidence-only commit does not change the captured product source identity.

## Disjoint queued change

At qualification time, PR #1346's exact group `cc3e633ce5e70da5a493830ee50fe769dfc5d393` had parent `2fe2f02f07d1df8c855388bc556383cd74de44fd` and 14 changed paths, with zero overlap with the 45 PR #1381-owned paths or this capture's inputs. Its AlertBulkManager/E18 changes do not change Today reader, owner, style or callback contracts. This statement is an applicability check; these images remain attributed to the captured commit above.
