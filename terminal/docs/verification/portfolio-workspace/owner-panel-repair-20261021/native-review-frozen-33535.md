# Portfolio PR1044 — independent native review

## Verdict and provenance

**HOLD — two HIGH, release-blocking owner-display isolation defects.**

Reviewed semantic head: `33535adb1ef8d087449cab9e67cde8d068ec9257`.
Repository: `mastermindx-market-intelligence/mastermind-terminal`, PR1044.
Frozen tree: `0b8620a5a78e04346861f5f9db03ea01abf1893a`.

This is the explicitly user-authorized native independent review. It is not a Fabric014/015 retry or return. The reviewer independently inspected source, designed the synthetic probes, read the raw outcomes and adjudicated this verdict. Parent executed the supplied probes mechanically after child-side connector calls stalled; the original source worktree remained clean at the frozen head. No product/source publication, real-account write, migration, deployment or runtime change was performed by this reviewer.

Protected procedure pin: `d3537d6dd1cf63178a1493eb70fa2eccc6c01fe0`; INDEX schema `mastermind.sol_skillpack.v1`, version `1.0.1`, minimum bootstrap major `1`. Root and terminal AGENTS, terminal CLAUDE, exact-pin INDEX, REVIEW_RETURN and relevant universal companion provisions were read. Procedure provenance is retained in `procedure-source.json`.

## Blocking findings

### N1 — HIGH: another account's brief survives an owner transition

PortfolioView line 658 supplies PortfolioBriefPanel without an owner key or owner prop. PortfolioWorkspace lines 153–179 retains its nonempty-book child subtree across two distinct nonempty books. PortfolioBriefPanel lines 43–88 owns the ready state and request controller, while its loading effect depends only on a stable callback. Neither settled content nor a pending response is retired when the immutable account changes.

Reproduction: render A with one open position, resolve A's private brief, then rerender the same page root as B with a distinct nonempty B seed. A's brief remains. In the second case, hold A's brief response, transition to B, then resolve A: A's brief appears under B. The corrected-envelope probe accepted the canonical positions reads and the DOM explicitly reported “Holdings checked.” Both invariants failed. Matching cases with an owner key on the page passed, including a fresh B request and removal/retirement of A content.

The `/api/portfolio-brief` source describes and implements a per-user brief with token-specific caching. This is account content, not a globally interchangeable market summary. The tests use synthetic markers and do not establish that a real production disclosure has occurred.

### N2 — HIGH: another account's event/position response survives the same transition

PortfolioView line 659 supplies EventImpactPanel without an owner boundary. EventImpactPanel lines 130–190 fetches and assigns response state without cancellation or a generation check. Its effect depends on `holdingsUnreadable` and `positions.length`, so equal-size A/B books do not trigger a new read. Its rendered event rows carry the response's position details.

The separate Event probe reproduced both settled A events retained under B and late A events first appearing after B's canonical read. Both unkeyed invariants failed; the two owner-keyed controls passed. The raw result contains both `OWNER_A_PRIVATE_EVENT` and `record-a` beneath the B view.

Smallest acceptable repair: scope the composed workspace or both personalized children to the immutable owner. Remounting the whole PortfolioWorkspace on owner changes also retires its selected record, filter and search state. Preserve state on same-owner refreshes. Add permanent regressions with real components, accepted canonical envelopes and real payload fixtures, covering settled and pending A responses, B's new request/content, and the same-owner negative control. No planned repair is accepted by this report.

## Other scope assessed

No additional blocking write-path defect was established. The source includes both original011 F1 draft-state repairs; layout-phase row timer cancellation; owner scope captured at the keystroke; permanently retired page/row lifetime tokens; owner generation checks for A→B→A; a serialized position/target write chain; originating raw owner ID carried in mutation bodies; typed never-dispatched versus sent-uncertain results; fixed owner-mismatch refusal copy; canonical readback/postcondition checks; newer draft preservation; and owner-scoped quote polling/miss counters/currency fallback.

The same-reference owner tests reset analysis and start a new canonical read. They do not establish that an old seed can be displayed safely while a new owner's read fails. The production page binds its owner and seed in one server response, and the blocking reproductions above use distinct B seeds. The conditional same-reference seed question is therefore not an additional release blocker in this report.

## Executed proof

All execution used `/tmp/portfolio-pr1044-native-review-20261021`, an exact git archive with independently copied node_modules; no test ran in the original source workspace.

| Test | Actual result | Duration |
| --- | --- | --- |
| Unmodified portfolioWorkspaceController.test.tsx | 49 passed | 792 ms |
| Original brief probe | 2 unkeyed failures, 2 keyed controls passed | 614 ms |
| Brief probe with corrected canonical book-key import | 2 unkeyed failures, 2 keyed controls passed | 593 ms |
| Event owner probe with accepted canonical envelope | 2 unkeyed failures, 2 keyed controls passed | 585 ms |

The original brief probe imported portfolioBookKey from the wrong module, so its canonical read was rejected; that artifact was preserved unchanged. The corrected copy imports it from portfolioSnapshot.server and removes that qualification. Both probes use actual PortfolioView, PortfolioWorkspace and the respective panel; pure response/presentation helpers are mocked to isolate lifecycle. They are not full API schema or real-account acceptance tests. The 49-test controller suite mocks both personalized panels to null, explaining the coverage gap. No mutant kill is claimed.

Raw log SHA256s:

- Original brief: `4be7553e3e5e07bb02218e74ca39a2fa7c75e6541de5947e28b276518bd9d55c`
- Corrected brief: `cd8fcb530e2d91920f7fc3da325a878b2e0fa40800d584ce2b96a908def96282`
- Event: `3f303427df2e1c240127ad22cb5147c2d56c5b46dfbe2e3289c3e7c41a34cae1`
- Controller baseline: `6e954ef1c6b86d15d03f06fbeb2e9bd04e7a755a5172e07fb4e60af035de6843`

## Reviewed blob identities

| Path below terminal/ | Git blob |
| --- | --- |
| components/PortfolioView.tsx | `8b1d35f62f8f83f0acc4b41b35a77f85f6ac2b2a` |
| components/PortfolioWorkspace.tsx | `3ee4f5e3165b7aa9222169102526a38597cb714b` |
| components/PositionModal.tsx | `6c07f488fa8b63b5c0aea121bfd936cfd58b5253` |
| components/PortfolioBriefPanel.tsx | `7ca6f9d346c92d6a5b21384abe54382cbcfa45d1` |
| components/EventImpactPanel.tsx | `dde9f2271200c4ec44824427de65192d4365df5f` |
| components/mounts/PortfolioViewMount.tsx | `68c6fe45c430db8717a8991a009b9079f96ae7e7` |
| app/(shell)/portfolio/page.tsx | `c3bf1da4622bc9ca57fba0466ffdf50a4edda845` |
| lib/accountIdentity.ts | `40828e5118b848365e0db2479739315d4068a3e0` |
| lib/portfolioMutation.ts | `e62b7dfc8964faa47d40c7ad53e7abd8e76a76a2` |
| lib/portfolioAnalysisRead.ts | `f1d24b02378115b1662eb9a911d2b1750dd78ad4` |
| lib/__tests__/portfolioWorkspaceController.test.tsx | `aa1b780496f1a70a6d8d74c36974cb51f6ac438d` |

## Acceptance boundary and continuation

The accepted independent013 backend/Risk review of its four unchanged blobs remains separate and was not duplicated. Parent reported all 20 exact-head checks green, including CI39538920188; this reviewer did not independently rerun hosted CI or certify latest-base integration. No production save/reopen, visual capture, historical-feed or live-data acceptance is claimed; the pngjs/capture changes are outside this completed semantic verdict.

Review reuse: the frozen head remains HOLD. Any repair touching these owner semantics/prior findings requires review of the new exact semantic head; no planned change inherits a PASS. Disjoint protected-base movement alone does not invalidate this frozen finding or require a cosmetic rebase.

Next action: parent implements the bounded owner boundary and real-component regressions, returns exact source/test delta and results for independent adjudication, then performs the remaining release gates. This reviewer has no running process, pending test or watcher. Dialogue is native parent/child, not watcher-enabled; watcher state NOT_APPLICABLE. Failed Fabric014/015 remain untouched.
