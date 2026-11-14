# Flow Desk expiry identity and recovery

## Result

The Flow Desk now shows the year on expiry controls and keeps a saved, exact expiry visible when it disappears from the loaded feed. The retained choice is labelled **Selected expiry** / **已选到期日** and remains pressed. The existing **All expirations** action clears only that date, preserving the trader's other filters.

Expiry controls have a scoped 44-pixel minimum target on coarse pointers and widths up to 860px. Desktop keeps the existing compact chip layout. The current feed and persistence owners remain authoritative; there is no automatic retargeting, silent filter reset, new store or claim that a missing loaded date is unavailable across the market.

This advances C3's exact filtering and C7's responsive consumer requirements in the [Options completion plan](../../OPTIONS_SUITE_COMPLETION_2026-11-14.md). The full programme and production acceptance remain open.

## Source and custody

- Operation: `options-flow-expiry-identity-20261114-c3`.
- Branch: `sol/web-options-flow-expiry-identity-20261114-c3`.
- Acquired protected base: `62315b351dbadd85db29ff77809af823d7251b1c`.
- Governing Mastermind pin: `199fd4f91ecc426b1d974eb3bf47f5162476cf24`; current Chairman assignment and Web review waiver apply.
- Design doctrine and shared product system: accepted Macro `45531010b236c434504b716dbe63a88a261e317a`. Existing Terminal chip, spacing, typography, theme and translation owners are reused.
- FiltersPanel preimage Git blob: `e2d9ab999a7891856f54b6f4f1577db28789609c`.
- Qualified component SHA-256: `2f68855c34a3628675af317a43a6a68e8a314d9cb0e20adb56d282409a900913`.
- Scoped CSS SHA-256: `bbc99648bb51fbb702be09f65d3fc78e9ee781824ec0d68cf06c1a9b1645cfa2`.

The component is byte-identical at the inspected base and published #1248/#804 heads. No authored competing filter change was identified. #1248 already authors FlowCard keyboard inspection; that work was deliberately left on its original carrier. #1266, #1509 and #1512 source and effects remain intact.

Parallel owned PR #1527 changes AlertDetail and shares the legacy batch3 evidence packet. This independent slice is qualified from its actual protected base. When the two accepted changes compose, preserve both component changes and the full 17-input packet; a shared manifest is not blanket ownership of unrelated product files. Do not overwrite either qualified source or claim this packet already contains the still-unmerged other PR.

## Implementation

`FiltersPanel.tsx` builds one keyed list containing loaded expiries and, when needed, the exact retained selection. One keyed list preserves the focused button when a date disappears or returns. All dates use the existing full `fmtDate` format; the retained prefix uses the existing `pick` translation helper. The original controlled callbacks and `flowdesk.filters.v1` persistence are unchanged.

`FiltersPanel.module.css` applies the target-size floor only to this expiry row at coarse-pointer/narrow widths. The row's existing wrapping and spacing remain. The global token root and other controls are untouched.

The three date selectors in the existing W3A expiry/reload browser cases now name the full date. A new mounted regression suite and real-consumer browser spec exercise source changes, focus, storage and explicit recovery. The existing batch3 producer and reader each add the new CSS file to their input list, extending the source binding from 16 to 17 files.

## Qualification

| Proof | Result | Receipt |
| --- | --- | --- |
| New suite against the original component | 8 failed / 4 passed, exposing indistinguishable years and hidden retained selections | [unit-before.json](unit-before.json) |
| New mounted consumer suite | 12 passed; named empty/omitted option-list inputs, focus and exact callbacks included | [latest unit report](unit-after-touch.json) |
| Existing plain-label call-site suite | 60 passed | [plain-labels.json](plain-labels.json) |
| Existing batch3 source/image reader | 4 passed against the 17-source packet | [batch3-reader.json](batch3-reader.json) |
| Full shared-shell browser matrix | Initial 10 passed / 8 failed at the measured 26px touch target | [original report](browser-shared.json) |
| Affected tablet/phone requalification | All 8 passed after the scoped 44px floor | [touch report](browser-touch-qualified.json) |
| Plain-language guard, focused lint and full TypeScript | All exit 0 | [touch-source-checks.json](touch-source-checks.json) |
| Native supervised full batch3 capture | 20 frames, 17 stable input hashes, 18 historical images preserved, clean server/producer settlement | [verification](batch3-runtime/verification.json) |

There are **76 distinct unit/evidence passes** and **18 distinct browser passes**. The final browser total combines the ten unaffected successful cases with the eight requalified touch cases; reruns are not counted twice. Four original browser cases cover desktop EN/ZH and dark/light; six existing W3A cases cover expiry filtering/coverage and reload across three viewports. The eight new touch cases cover both languages and themes on tablet and phone. No final qualified case is failed, skipped or flaky.

The first browser run demonstrated a real 26px target-size defect. The existing 44px assertion was retained, a scoped product fix was applied, and only the affected eight cases were rerun. No assertion was weakened. Desktop has no matching new CSS declaration; the original desktop proof is retained. The latest mounted tests also verify the unchanged visible text after routing it through `pick()`.

## Real consumer behavior proved

The browser spec uses the real `/options?tab=desk` FlowDesk/FeedPane and existing REST/SSE hook. The fixture is explicit test data; it does not establish production feed access or market coverage.

1. Two expiries with the same month/day and different years have distinct visible and accessible names.
2. The user selects a date and Call-only filtering; the exact requested value is stored and unfiltered coverage stays unchanged.
3. The native EventSource reconnect reads a changed fixture without the selected date. The same selected button stays focused and pressed, the exact date remains in storage, and the feed remains filtered to zero rows.
4. Reload preserves that retained choice and Call-only filtering.
5. All expirations restores the other-date Call row, clears only `exp`, retains the other filter fields and leaves the unfiltered coverage totals unchanged.
6. Date controls fit the viewport and provide 44px targets on touch; there are no page errors or Flow API writes.

The mounted proof also covers an empty or omitted expiry list, reappearance without a duplicate button, and choosing another available date explicitly. Source-list changes never call the parent's filter setter.

## Rendered review and evidence

[The capture index](capture-index.json) binds six successful render attachments to their original report, viewport, language, theme and SHA-256. Principal visual review inspected:

- [EN dark desktop](captures/desktop-en-dark-retained-expiry.png): the complete year-bearing choice and retained-selection prefix are readable within the original compact row.
- [ZH light phone](captures/mobile-zh-light-retained-expiry.png): the selected date remains visible, controls wrap within 390px, and the larger target retains clear selected state.

The original full batch3 producer ran under its existing `superviseLegacy` owner, with capture ID `options-flow-expiry-identity-20261114-c3-batch3`. Producer PID 12550 and server PID 12567 settled with status 0, closed=true, serverReportedStopped=true and serverSettled=true at 2026-11-14T14:54:11.569920Z. It emitted the original final receipt and all 20 expected frames.

[Preflight](batch3-runtime/preflight.json), [launch](batch3-runtime/launch.json), [supervision](batch3-runtime/supervision.json), [process result](batch3-runtime/process-result.json) and [verification](batch3-runtime/verification.json) retain the actual execution. The manifest SHA-256 is `a85488af5edfbbc49da0f75c94dc1448ee853dc56f8b99b5014d6307ea45913e`. Its informational capturedAtHead is the actual starting head; layoutFiles bind the working-tree source. All 18 additional historical FlowDesk images remain byte-identical.

## Operation recovery and release

The initial adapter acquire reported WORKSPACE_ACQUISITION_UNQUALIFIED. Same-owner native status reconciled that exact operation to the clean expected workspace and protected base; publisher status agreed. No second acquisition was attempted. Root instructions, application instructions, package manifest and lockfile matched the previously read base. The existing Node 22.23.4 binary and dependency owner were reused with child PATH only.

Only the named current source and tests were edited. Original unknown publication effects and the separate Flow batch1 EPERM settlement were not retried or reclassified. Required exact-head CI, protected release and actual deployed-user acceptance are still owed. Continue with the next qualified Paper contract slice while existing release owners run.
