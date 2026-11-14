# Aggregate options alert scope — C6 consumer repair

## Result and boundary

Aggregate premium-burst and 0DTE alerts now show **Scope / Covered options tape** in the real Monitor alert drawer, with the equivalent Chinese wording. They no longer render the canonical MARKET identity, an old SPY placeholder, or an unresolved root as a portfolio link. This says what the existing evaluator covers without claiming all-market coverage or a holdings join.

This is one qualified C6 slice of the full [Options completion programme](../../OPTIONS_SUITE_COMPLETION_2026-11-14.md). Source qualification is complete; protected CI, release, deployment and entitled live-browser acceptance remain separate and are not claimed here.

## Source and custody

- Operation: `options-alert-aggregate-scope-20261114-c3`.
- Branch: `sol/web-options-alert-aggregate-scope-20261114-c3`.
- Acquired Terminal base: `fe49f3b5765dd4e10721928716a6a730e78c7ae1`.
- Governing Mastermind pin: `199fd4f91ecc426b1d974eb3bf47f5162476cf24`; current Chairman full-suite assignment and Web review waiver apply.
- Design doctrine and shared product design system read at accepted Macro `45531010b236c434504b716dbe63a88a261e317a`; Terminal keeps its existing tokens, drawer, focus owner and EN/ZH presentation.
- One production file changes: `terminal/components/alerts/AlertDetail.tsx`. The preimage Git blob is `e6c0a726066c18e514ab7528fc85352be9d01d3a`; the qualified SHA-256 is `6543513d6a694ebf6885474cf944fcd6e5c274e3c8cb5459024adab5fcbbc1bf`.

The implementation calls the existing `isMarketWideOptKind` owner for only `opt_premium_burst` and `opt_0dte_spike`. It applies only to ordinary alerts, including the legacy omitted-kind shape. Root-specific options, price alerts, position events and thesis events retain their existing behavior. Persisted identities, trigger evaluation, throttling, delivery, holdings, API handlers and evidence URLs are unchanged.

The source census found no authored collision in this component with #662, #1509 or #1512. Published #1248 has the same component preimage; its unpublished effect remains unresolved and was not replayed. #804's saved-Investigation restrictions do not establish blanket ownership of every manifest input. The existing `alert-detail-keyboard.spec.ts` from the #1509 lineage was reused unchanged.

## Qualification

| Proof | Observed result | Receipt |
| --- | --- | --- |
| New regression suite against original component | 12 failed / 7 passed, exposing the aggregate identity defect | [unit-before.json](unit-before.json), [log](unit-before.log) |
| New 19-case suite plus existing options-alert and thesis-detail suites | 111 passed | [unit-after.json](unit-after.json), [log](unit-after.log) |
| Existing batch3 evidence reader | 4 passed | [batch3-reader.json](batch3-reader.json) |
| Real Monitor activity → alert drawer, plus existing keyboard suite | 31 distinct passed; 2 intentional project skips; 0 failed or flaky | [shared browser report](browser-shared.json) |
| Corrected premium fixture only | Its 12 existing premium cases passed again; not 12 additional distinct cases | [premium report](browser-premium-qualified.json) |
| Focused lint, full TypeScript and diff check | All exit 0 | [final-checks.json](final-checks.json) |
| Existing supervised full batch3 producer | 20 frames, 16 unchanged capture inputs, clean producer/server settlement | [verification](batch3-runtime/verification.json), [supervision](batch3-runtime/supervision.json), [original producer log](batch3-runtime/capture.log) |

There are **115 distinct unit/evidence passes** and **31 distinct browser passes**. The 12-case premium rerun is not added to the browser total.

The mounted regression cases cover both languages, both aggregate kinds, canonical and legacy identity shapes, omitted/explicit ordinary-alert kinds, price and root-specific alerts, null condition types, thesis/position branches, evidence links and unchanged input facts.

The browser cases enter the actual drawer from AlertsCockpit recent activity at desktop 1440×900, tablet 820×1180 and phone 390×844, in EN/ZH and supported shared-shell dark/light states. They check the scope, exact evidence URL, keyboard order and receipt disclosure, Escape/Close focus return, touch use, close target, viewport bounds, no horizontal overflow, no API mutations and no page errors. The existing keyboard suite's two intentional non-desktop skips remain explicit.

A reasoning review caught that the premium test fixture used `k: 3` where its canonical schema uses `z: 3`. Only that fixture field was corrected, after the original run completed. The premium cases were requalified; the unaffected 0DTE and existing keyboard cases were retained. Production source did not change during that correction.

## Rendered review and capture lifecycle

[The six-image index](capture-index.json) records original attachment paths, report identity and SHA-256 checks. Principal visual review inspected:

- [EN desktop, dark, premium burst](captures/desktop-en-dark-opt_premium_burst.png): readable two-column facts, correct unlinked scope, evidence and delivery state, visible focus.
- [ZH phone, light, premium burst](captures/mobile-zh-light-opt_premium_burst.png): readable stacked facts, year/date and scope wrap within the viewport, receipt and Close remain reachable.
- [ZH desktop, light, 0DTE](captures/desktop-zh-light-opt_0dte_spike.png): correct scope and fired value, clear fact hierarchy and focus.

The incumbent full batch3 producer also captures ordinary price-alert behavior alongside OptionsFlowBoard, FlowDesk, HeatmapTreemap and PineLibrary. It does not exercise the new aggregate branch; the separate real-drawer browser cases above provide that proof.

The accepted `superviseLegacy` driver was reused from the protected #898 evidence precedent with an eight-minute deadline. Capture ID: `options-alert-aggregate-scope-20261114-c3-batch3`. Producer PID 74215 and server PID 74225 settled with status 0, closed=true, serverReportedStopped=true and serverSettled=true. The native producer emitted one final receipt, wrote all 20 frames and its manifest, and completed at 2026-11-14T14:17:27.449638Z.

[The preflight](batch3-runtime/preflight.json), [launch](batch3-runtime/launch.json), [process result](batch3-runtime/process-result.json) and [verification](batch3-runtime/verification.json) bind all 16 source hashes and all 20 producer image hashes. The remaining 18 historical FlowDesk images are unchanged. The original manifest is preserved in [EVIDENCE.before.yml](batch3-runtime/EVIDENCE.before.yml). The manifest's capturedAtHead is the actual starting head; its layoutFiles hashes bind the tested working-tree source. It was not rewritten to a future commit.

The earlier, separate Flow batch1 operation `flow-receipt-pl6-control-20261114-c3` remains unresolved after its original EPERM settlement failure. This successful batch3 operation does not settle it, authorize a retry, or qualify its four retained images. No repeated signals or alternate capture carrier were used.

## Local operation recovery

The first acquisition was NOT_APPLIED because the exact protected base object was absent from the original canonical repository. After verifying its origin, that exact commit object was fetched without updating refs, index, working tree or FETCH_HEAD. The bounded same-operation acquisition then returned an adapter qualification uncertainty. Same-owner native status and publisher readback reconciled it to this exact clean workspace and base; no further acquisition was attempted.

The existing Node 22.23.4 binary was reused read-only with SHA-256 `2cc28a1880d0774616959f2210ee739bffa6ac695c887e8988a496a21271f6c0`. Child PATH was set explicitly; no HOME override or old-workspace mutation occurred.

## CI copy-routing correction

PR [#1527](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1527) was published at `531356748643ff8005fe0bfccc3a6d4fdf5abebf`, and one native protected release request was recorded. Hosted run [43604974983](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43604974983/job/132479106788) passed its source evidence captures and unit readers, then reported the new English literal as missing the required copy-helper route. The original [job receipt](ci-fanin-first-job.json) and [log](ci-fanin-first.log) are retained.

The translated phrase now uses the already imported `pick()` owner. Its visible EN/ZH text and alert behavior are unchanged. The forward-only plain-language guard, 19 affected mounted cases, focused lint and full TypeScript all pass in [copy-routing-checks.json](copy-routing-checks.json). Four existing premium desktop browser cases across EN/ZH and dark/light passed again in [copy-routing-browser.json](copy-routing-browser.json). These are requalifications within the original 115 unit/evidence and 31 browser totals, not additional distinct tests.

Because the component's bound source bytes changed, the original full batch3 producer ran again for this new source under capture ID `options-alert-aggregate-scope-20261114-c3-batch3-copy-routing`. Producer 77228 and server 77247 settled successfully at 2026-11-14T14:45:16.673368Z. [The current verification](batch3-copy-routing-runtime/verification.json) binds all 16 current inputs, all 20 frames and all 18 preserved historical images; [the current evidence reader](copy-routing-evidence-reader.json) passes four cases. The original capture and its receipts remain as history. The latest manifest SHA-256 is `6e25958d7f73a463316708d7e00a10638fd3972dca9dc8a524e815db50e0709f`, captured from actual starting head `531356748643ff8005fe0bfccc3a6d4fdf5abebf`.

[Two fresh render attachments](copy-routing-capture-index.json) preserve EN dark and ZH light desktop results. Principal visual review rechecked [the ZH light result](captures/copy-routing-desktop-zh-light-opt_premium_burst.png), confirming the same readable scope, facts and visible Close focus. Unchanged mobile, keyboard and other-alert proof is retained with its original reports. The existing native auto request is preserved; no second enrollment or failed-run replay is issued.

## Next acceptance

Consume the existing protected CI and release owners for this exact source. Verify the deployed aggregate-alert drawer with admitted account data and retain the actual deployment generation. Continue the next independent Flow Desk expiry-identity/recovery slice and the original held Paper carriers. Neither this receipt nor a green build completes C1–C7.
