# P4 — native complete candidate pool

## Scope and source bindings

This packet implements the complete eligible US candidate population and a source-bound candidate detail inside the existing `/prophet` workspace. It is the first bounded P4 migration slice. It does not establish complete Prophet parity or authorize retirement of `/us_stocks.html`.

The underlying owner is Macro `engine/us_candidate_lanes.py`, `project_candidate_visibility`, at protected source `d8a12a7e4ca01628a5c45835458d13da2181fb34`. The engine was not modified. [Macro PR11248](https://github.com/mastermindx-market-intelligence/macro/pull/11248), head `8a45c12ee4d9379beefda8c18552847a0a45371e`, exposes that projection through the existing authenticated Daily Brief router at `/api/prophet/candidates/v1`. [Its contract and source evidence](https://github.com/mastermindx-market-intelligence/macro/blob/8a45c12ee4d9379beefda8c18552847a0a45371e/docs/beta-shell-native-prophet-candidates-20261114.md) describe the fixed file, admission, bounded reads and final byte equality. No archive enrichment, new ranking or selection algorithm is added.

The Terminal slice is stacked on owned [PR1495](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1495), repaired head `627b87e1f0655cdf60999daa99ddf8c797627449`. This dependency supplies the shared market boundary and native Intelligence account mount. The stack has the same writer; no held or uncertain donor is adopted. The normal CI workflow explicitly runs its full suite for a non-default PR base. No release opt-in is attached to this stack.

## One workspace, distinct research objects

| Existing concept | Native presentation | Preserved meaning |
|---|---|---|
| Prophet Today | Incumbent Today lane | The existing research selection, including its own sector-index/member contracts |
| Complete eligible pool | New Candidates lane | Every row in the accepted projection, in published order; source counts remain complete when search narrows the list |
| Screening position | Candidate row and detail | The supplied `pool_rank`, including valid numeric-string representation; not final rank |
| Main-list membership | Row and detail label | The supplied `in_buy_lane`; membership is separate from a score |
| Final score | Supplied numeric value or “Not scored” | A genuine zero renders `0.0`; off-cohort candidates remain visible and unscored |
| Model plans | Incumbent Plans lane | Generic browsing, with stale plan/symbol/filter cleared; no fabricated candidate-to-plan join |
| Options and Issue Desk | Incumbent secondary lanes | Existing engines and caches; compact More in the native shell, legacy Options labeling preserved |

The detailed reading reports recorded source decisions using the same bilingual dictionary as Macro's candidate pool template. Unknown codes remain explicitly unlabelled with their raw code; the UI does not invent an interpretation. The wording refers to inclusion in the accepted publication, not an assertion that eligibility was reassessed now.

## Paper binding and visual contract

The existing [PROPHET file, P4 Candidate pool page](https://app.paper.design/file/01M3NT5Y3G5HTJHVR0K5W2MDJM/p-L-0) contains four new owned boards:

| Board | Purpose |
|---|---|
| `29W6-0` | 1440px light English complete population |
| `2A11-0` | 390px dark Chinese population |
| `2A19-0` | 390px light English candidate detail |
| `2A50-0` | Verified empty, search with no matches, unavailable, access limited, unsupported market and requested candidate absent |

Desktop, phone and state screenshots were inspected after correction. Dark text colors, the Inspect label, generic model-plan wording and source-consistent availability actions were corrected in Paper. The access action is the real “Back to Prophet Today” path, with no invented billing route. All owned working indicators were released after readback. Existing designs and held nodes were preserved.

Paper observation guard `70db82f8829d2a563d28e6fad0fd97cddaa0dd6db9bb8f989521f9db8ab0daa2`, token hash `640746f9`, binds the adapter's active-file/page observation. It is not a content hash of every newly created board. The new page is `p-L-0`; the pre-existing active page remains `p-F-0`.

The implemented design uses the existing product tokens, one outer Prophet heading, a quiet lane bar, a complete ordered list, restrained numeric hierarchy, one scrolling candidate workspace and source details at useful depth. At narrow widths, rows become readable company/decision/score groups with 44px controls. Source hashes wrap. Language and theme remain owned by the existing shell controls.

## Identity, URL and request ownership

- `IntelligenceToolWorkspace` supplies its already verified `useReadingScope` to the native Prophet composition. No second identity lifecycle is created. The legacy Options mount does not fetch private candidates; a candidate deep link there points to the canonical workspace.
- `/api/shared-shell/prophet-candidates` uses the incumbent `readingProxy`: verified identity, fixed upstream, no forwarded query, bounded private response, no cookies/redirect propagation. The existing 4MiB response bound remains; the Macro raw-source limit is separately 8MiB.
- `readingJson` now honors a consumer AbortSignal as well as the account generation. Leaving Candidates aborts that read without ending the account scope. Refresh clears accepted data before starting its next request. Completion checks both exact request and account generation; a late result or401 cannot affect a newer lifetime.
- Search, candidate identity, detail/back and browser history use `prophetUrlState` and `useProphetUrlState`. Committed search admits EN/ZH text through the existing `prophetQ`; no request is made per keystroke or per selected candidate. The candidate grammar rejects control characters including a final newline. Departing to another lane normalizes that lane's narrower existing query grammar before any read.
- Explicit Back and browser Back restore the visible opener and list scroll. An absent or removed candidate is a distinct state; Back falls back to the list heading when the opener no longer exists. Source inspection opens and focuses the actual disclosure. More returns focus to its visible control when a phone's secondary menu closes.
- Market switching uses the incumbent global owner. `tab=candidates` survives; US-specific symbol/search context is cleared. Unsupported regional consumers stay unmounted, with a truthful coverage page and the existing regional destinations. No US population is relabelled as another country.

## Source truth and failure states

The decoder accepts or rejects a complete envelope. It never drops malformed rows or truncates a population to manufacture coverage. It checks schema, US market, exact source path, bounded byte count, exact digest shapes, ticker identity, valid source date, cohort/score relationship, unique population and counts equal to all rows.

Ready and empty require the owner's valid ISO date. A claimed-ready envelope with a null date is invalid. A legitimate unavailable projection can have a null date and is labelled “Date unavailable”; its counts remain unknown. Verified zero, no search matches, a missing candidate, unavailable source,403 and401 remain distinct. The full Prophet workspace remains reachable while native depth is incomplete.

Raw source SHA-256 and normalized display digest identify different objects. Neither establishes a Today selection receipt, an immutable archive generation, an entry assessment or an exact model-plan relationship. Production proof must confirm that the complete real projected response fits the existing response bound; oversize fails closed.

## Qualification and remaining work

The original synthetic four-name fixture was produced by the unchanged Macro projector. Its raw-input SHA-256 is `8611ad3b474beb599920be4bf15d6948e38eba2ee452a07a7c82c48070617dc4`, input size2060 bytes and display digest `947a6877ef663c5fe79e01974990a04618ee4ed67c5c70b8e4c5d882c33303f0`. It contains a real zero, an unscored off-cohort row and a Chinese company name. No private source capture was imported.

Local focused qualification:167 tests passed across the candidate decoder, actual candidate/lane/URL journeys, proxy, request cancellation, account mount and incumbent Today-case return. The UI journeys exercise complete counts, local search, Unicode departure, invalid-search clearing, detail/back/popstate/focus, absent selection, sources, generic plan navigation, verified empty versus unavailable,403,401, old-account completion and departing-lane abort. Targeted lint, syntax and the forward-only language guard are checked before publication. Full local TypeScript is not retried after the earlier memory-capacity result; hosted type/build evidence remains required.

The existing authenticated `qualify_shared_shell_intelligence.cjs` is extended, not replaced by another runner. It records exact source hashes and tests native Candidates at1440/820/320px, EN/ZH, light/dark, actual browser history/reload/focus, the compact More menu, source disclosure, market isolation and materially different availability states. These are original synthetic presentation/interaction specimens. State variants deliberately mutate that synthetic envelope and do not claim another real publication generation. Hosted results and visual readback remain pending on this candidate.

Release order: qualify and release Macro11248 through its incumbent controller; verify the served authenticated complete projection; qualify this Terminal stack and its PR1495 dependency; then use permitted Terminal release and prove the production consumer. Macro11246's Liquidity backend has separately been enrolled in its normal controller after exact-head binding checks passed; its label readback is not a merge/deploy receipt. No legacy route or engine is retired by this packet.

Parent completion remains open: full Prophet lifecycle/detail/assessment depth, non-US engines, remaining Macro/Cycle parity and P5–P17 are still required. The next safe presentation slice is the existing Today desk: promote its source-authored market reading, distinguish account work, remove repeated market navigation and preserve the stable reader holders and saved comparison baseline. No accepted portfolio population or private source history is replaced with mock activity.
