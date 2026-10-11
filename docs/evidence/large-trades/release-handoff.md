# Large Trades & Absorption — release handoff

Prepared on **2026-10-11** for the existing Terminal release owner and Macro artifact owner. This is an operational handoff for the remaining production work; the capability has **not** achieved full release acceptance.

## Verified source and remaining production state

The independently reviewed engine, native IEX decoder, reproducible real-data verifier, protocol, and sanitized evidence are included in component commit [`389b946232ba86db291a65d676d794e41102b50e`](https://github.com/mastermindx-market-intelligence/mastermind-terminal/commit/389b946232ba86db291a65d676d794e41102b50e). That component commit is a source witness. The release intent is the actual GitHub `mergeCommit.oid` of [PR 929](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/929), after that PR merges. Verify that exact full SHA against a fresh protected-ref capture and reconcile the currently served generation before deploying it.

| Evidence | Established result | Acceptance boundary |
| --- | --- | --- |
| [Real-data receipt](real-data-verification.json) and [reproduction guide](README.md) | Seven IEX historical envelopes; 1,685 native execution reports; 141,057 executed shares; 2,966 deterministic prefix comparisons; zero visible quantity before archive acquisition | A bounded partial-session cohort, with no qualified quote path or verified tick metadata |
| [Independent review](independent-review.json) | Accepted core and decoder hashes, adversarial review scope, and two resolved decoder conservation defects are recorded | Review and deterministic evidence do not establish production behavior or predictive efficacy |
| [Frozen implementation and research protocol](../../LARGE_TRADES_ABSORPTION.md) | Transaction schema, causal evidence rules, admitted source, and research protocol | Out-of-sample result remains `NOT_ESTIMABLE` |
| Historical public-production observations | At **2026-10-11 09:48 UTC**, production HTML advertised `34d52545ac04692ab642942972b29b1379a44a08` and the large-trades API returned **404**. At **11:33 UTC**, an actual production browser search for Large trades returned zero indicator results | These observations preceded the repaired release candidate. Authentication was not established, and neither observation proves feature deployment or a ready feed |

The earlier locally verified chart integration is recorded in source commit [`95a7cac298a99671eb392ff0050fb7b9223ead4e`](https://github.com/mastermindx-market-intelligence/mastermind-terminal/commit/95a7cac298a99671eb392ff0050fb7b9223ead4e). Its [integrated browser packet](../../../terminal/docs/pr-crops/large-trades-integrated/README.md) and [independent review](../../../terminal/docs/pr-crops/large-trades-integrated/review.json) establish local pane ownership, responsive controls, causal replay, and native PNG export on the exact recorded source bytes. The full feature matrix passed 46 project/test instances with 14 intentional skips of desktop-specific cases on tablet and mobile, zero failures and zero retries. This source/browser receipt does not certify hosted CI, protected integration, deployment, or production authentication; the final release intent must be resolved from [PR 929](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/929)'s actual merge commit, with fresh protected-ref containment and served-generation checks.

The frozen protocol SHA256 is `2e00fdb6563abd00b993130e102536d9f4ecabaf973ab9c9a8c627020b84bf29`. The real-data receipt records the exact reviewed engine, decoder, envelope, native-sidecar, and decode-receipt identities. Keep these evidence files unchanged unless their documented reproduction procedure is intentionally rerun against matching source and inputs.

## Subsequent protected chart integration

Protected chart change [#940](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/940) added phone status wrapping and legacy pane readiness. Its integration at `5c16b7b7d7533102a47c71bb651b274905b7740b` exposed a combined-source defect: the Large Trades inspector covered 10.875 pixels of the painted change/volume row in all four tested English/Chinese phone normal/fullscreen states. The Replay chip and actual Close/fullscreen actions remained available.

Repair commit `be4b16f40e24f400217a3320b9deb9c14405bb52` uses the chart-owned measured header bottom for controls admission and the existing statusline observer for repositioning. It preserves price-pane ownership, marker projection, clipping, the 198×88 control footprint, exact quantities, native export composition, and source admission. The current affected verification is recorded in [the protected chart integration receipt](protected-chart-integration.json). Test commit `70b4778936bf90f8177c587b3de77b1b571339c9` corrects the narrow-pane setup to measure the wrapped header while preserving the 88-pixel control minimum, full pointer targets, and two-pixel admit/reject separation. Earlier source and CI receipts retain their original identities and limits.

The current `70b4778` browser matrix passed **48 Large Trades cases with 18 planned project skips**, **3 separate real-SPY historical inspection cases**, **6 English/Chinese Replay cases**, and **3 legacy drawing migration cases**, with no failures, flaky results, or retries. All four groups retained the same 1,716-file selected-source digest. The [current screenshot and proof packet](../../../terminal/docs/pr-crops/large-trades-protected-integration/README.md) keeps this evidence separate from the earlier source-95 packet. Fresh legacy chart captures, full local gates, and the final independent ruling are recorded in the integration receipt; hosted CI and production still require their own exact-source evidence.

The current SPY witness contains **302 native execution reports totaling 26,121 shares**. Three native PNG exports and three separate inspection flows consume the same admitted envelope (`c8f3acd1…`); neither replaces the earlier seven-symbol cohort. The complete application screenshots run in a deterministic test shell, whose quote/watchlist/research-card values are outside the IEX archive proof. Native exports provide the clearest execution-only evidence. Dense marker labels can overlap; inspection preserves exact quantities. All market evidence remains historical, venue-only and partial, with archive acquisition later than exchange events.

## 1. Restore the canonical release owner

The last canonical VPS/root access attempt ended in `Permission denied (publickey)`; a successful reconciliation has not been evidenced. The first production action belongs to the existing infrastructure/credential custodian: restore access for the **same canonical VPS and root identity** documented in [DEPLOY.md](../../../DEPLOY.md), then establish that the session is on that canonical machine. The documented identity is `root@146.190.142.17`.

Access restoration must preserve the existing release ownership. A different host, user, key source, CI publisher, or direct runtime edit would require its own source and custody adjudication; none is provided by this handoff. No credential material or speculative authentication command is included here.

The current deployment contract is implemented in [ops/terminal-build.sh](../../../ops/terminal-build.sh) and [Terminal Release Preflight](../../../ops/TERMINAL_RELEASE_PREFLIGHT.md). Their exact-target and integrated-preflight rules supersede older no-argument deployment examples in the general deployment guide.

## 2. Admit and deploy the exact accepted source

After canonical access is restored:

1. Complete the existing protected-source review and required hosted CI for the exact candidate. Read **PR 929's actual GitHub `mergeCommit.oid`** after integration as the full, accepted 40-character release intent. Capture a fresh protected `origin/master` and verify that the requested SHA resolves exactly and is contained in that captured ref. Reconcile the currently served generation separately so the operation does not roll back a newer accepted release. Record the intended SHA, protected-ref capture, constituent changes and matching CI evidence; an unrelated newest tip is not a replacement release intent.
2. Establish that the incumbent release owner has the trusted, complete preflight script/policy/audit bundle required by the current procedure. Retain the volume admission guard at `/usr/local/sbin/terminal-volume-guard`. If the installed owner requires its documented first-adoption path, use that existing owner procedure with one exact protected artifact; do not assemble an alternate deployment program.
3. Invoke the canonical owner with the accepted full SHA:

   ```sh
   /opt/terminal/terminal-build.sh --target-sha <accepted-full-40-character-SHA>
   ```

   The placeholder must be replaced with the recorded lowercase hexadecimal commit. This is the release command; this handoff adds no preflight flags.
4. Require the owner to admit retained storage and obtain a trusted **current-generation `CLEAN` preflight** before its fetch, reset, clean, dependency, build, synchronization, or service effects. Bind the immutable receipt to the current deployment marker and the reviewed policy digest. A nonzero or unresolved preflight blocks release; resolve the cause through the existing owner rather than changing source or data to manufacture a clean result.
5. Let the owner fetch protected `master`, admit the exact target, and perform its existing release lifecycle. Preserve its receipt, target identity, service result, and any failure/recovery evidence. A `CLEAN` entrance receipt alone is not deployment, build, health, rollback, or browser proof.

The retained-volume guard runs before preflight in the current owner source. Existing runtime data and Macro publication custody remain with their incumbent owners throughout this sequence.

## 3. Publish the admitted historical source through Macro

The **existing admitted Macro artifact owner** must authenticate, validate, and publish only the approved per-symbol envelopes. The Terminal route is a read-only consumer; the decoder is an offline input producer.

The publication destination is:

```text
MACRO_LIVE_DIR/large_trades/SYMBOL.json
```

Here `SYMBOL` is the canonical uppercase symbol. The existing default `MACRO_LIVE_DIR` is `/var/lib/macro-live/public/live`. Use the already owned artifact mechanism and atomic publication; its trusted parent-directory ownership remains part of the contract.

| Required property | Release check |
| --- | --- |
| Valid artifact | The file passes `mastermind.large_trades.v1` validation and matches its filename/requested symbol; it is a bounded regular JSON file |
| Admitted source | Provider `IEX`, dataset `HIST DEEP+ 1.0`, venue `IEX`, venue scope, equity instrument, and share quantities |
| Timing and evidence | `historical` data mode, `HISTORICAL_REPLAY`, archive-acquisition receipt basis, and explicit exchange, capture, and acquisition clocks |
| Native execution basis | `L`/`T` executions and `B` corrections, with exact quantities and declared source hash; no candle-volume conversion or assumed order count |
| Provenance and rights notice | Exact required IEX attribution and [IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms) URL |
| Publisher integrity | Publisher checks the private decode receipt, envelope hashes, source identity, and intended cohort before promotion, and records the exact bytes published |

The route's [source-admission policy](../../../terminal/lib/largeTrades/sourceAdmission.ts) requires a declared source hash; it does not authenticate a source merely because a hash-shaped value is present. That authenticity check belongs to the incumbent publisher.

Keep **raw captures, decode receipts, native-record provenance sidecars, diagnostics, private paths, and credentials outside the public root**. Publish the selected, validated per-symbol JSON envelopes only. Never point the decoder's `--output-dir` at the public root or copy an entire decode directory into it. Preserve the bounded cohort's partial coverage and unknown-side quantities. Its original capture clocks do not make an archive acquired later available to Terminal at capture time.

The current source admission is IEX historical equity data only. Other vendors, CME futures, live modes, and broader redistribution must pass the existing source and entitlement review before being admitted.

## 4. Prove the user-facing production path

Record the following evidence against the **same accepted release SHA** and the exact publisher artifact bytes. Use the genuine authenticated production path and authorized market data.

| Gate | Required proof |
| --- | --- |
| Source and release | Protected accepted SHA and required CI; trusted current-generation `CLEAN` receipt; retained-volume admission; canonical deployment result and actual installed source identity |
| HTTP release identity | Production HTML `data-dpl-id` and/or `/_next/static/*?dpl=<full-SHA>` agrees with the release target; actual code/asset content independently agrees. The constant Next `BUILD_ID` is insufficient as the release witness |
| Authenticated feed | A signed-in request to `/api/large-trades?sym=SPY` returns `state: "ready"`, the expected historical envelope, and `artifactSha256` matching the publisher's exact file bytes |
| Source provenance | Inspector and API show IEX venue-only historical coverage, shares, archive acquisition, exact native attribution, and qualified versus unknown side. The partial real cohort stays partial |
| Chart behavior | Actual chart markers and numerical quantities, settings and persistence, visibility controls, pan/zoom/timeframe positioning, symbol and pane ownership, marker inspection, and replay behave together on the production chart |
| Responsive proof | Capture the actual production desktop, tablet, and mobile journeys, including an opened inspector and settings interaction. Record viewport, URL, release identity, artifact hash, and observed result; inspect clipping, overlap, focus, and chart interaction |
| Causal evidence | Replay excludes information before availability; corrections and marker changes follow the recorded clocks. Missing qualified quotes/tick metadata and partial coverage produce abstention, with no absorption, failed-continuation, trapped-trader, or live-data claim |
| Native PNG export | Local verification includes the execution overlay, exact quantities, pane labels, source/units, archive caveats and full IEX attribution/terms. Production must reproduce the accepted native export on the deployed source; local/intercepted images do not satisfy that production gate |

The [production API implementation](../../../terminal/app/api/large-trades/route.ts) distinguishes authentication, publication, and source admission. An unauthenticated request can return **401**. A deployed route with no artifact returns HTTP **200**, `state: "unavailable"`, `reason: "feed_not_published"`. These are different from the observed pre-feature **404**, and none establishes a ready feed. A development fixture or intercepted response cannot satisfy this production gate.

The [ChartPanel snapshot path](../../../terminal/components/ChartPanel.tsx) now includes the execution overlay. It flushes the native bitmap, synchronously measures the current pane layout, repaints coordinates and freezes the admitted marker frame and other metadata before asynchronous SVG completion. The integrated packet contains actual downloaded PNGs across all three viewports, a byte-identical asynchronous state-change comparison, and the repaired pending-layout case; the pre-repair counterexample remains in private review custody. These local export results remain distinct from the production proof owed after deployment.

## Offline CME implementation added during protected integration

The [CME admission guide](../../CME_LARGE_TRADES_ADMISSION.md) and [source verification receipt](cme-source-verification.json) document two accepted offline components: an exact DBN trade observation normalizer and a separate synthetic decoded-native correction ledger. The repository check passes 229 tests plus 176 subtests, including the existing IEX decoder. Independent review covers 21 DBN and 27 native-ledger controls, with both original ledger counterexamples preserved and repaired.

DBN quantities remain gross as reported with unsupported corrections; the native ledger is fixture-only. Neither component expands public source admission. Actual export framing, instrument definitions, native correction targeting, source completeness, rights, and consumer knowledge still need verification before any CME feed is published. The frozen research protocol and its IEX real-data receipt remain unchanged.

### Bounded DBN container framing addition

The [container reader](../../CME_DBN_CONTAINER.md) adds a strict, bounded uncompressed DBN v3 import profile around the unchanged private record normalizer. It verifies the full supplied container SHA256, header-and-metadata SHA256, declared metadata boundaries and exact original record offsets. The bridge requires an explicit half-open query range indexed by ts_recv; unknown and split-file range semantics are unsupported by this bridge. Its [source verification](cme-dbn-container-verification.json) preserves author and independent synthetic results, the original malformed test-vector failure and the integrated repository check.

This closes the offline structural-reader gap. Actual export authenticity, dated trusted definitions, acquisition and knowledge provenance, native correction coverage, completeness and licensing remain separate admission requirements. No provider, public consumer or runtime publisher is activated by the reader. Current protected CI, actual merge, canonical deployment and authenticated production proof must still bind the final release source; an earlier CI result cannot certify this added module.

## 5. Exact CME/MNQ commercial approval still needed

No commercial CME/MNQ entitlement or approved payable amount has been established. The pending approval is for a **written commercial quote and usage-rights grant covering `GLBX.MDP3` native MNQ trades and qualified quotes**, for Mastermind Terminal's actual deployment and audience.

The quote must specify:

- The dataset, MNQ contract/symbology and rollover treatment, trade and quote schemas, history range, and live or delayed mode. MBO/replenishment evidence requires its own explicit scope if proposed.
- Commercial web display/redistribution, internal use, server-side/non-display analytics, storage and retention, derived outputs, and downstream user access.
- User and device counts, professional/nonprofessional classifications where relevant, application/feed counts, and which vendor or exchange charges attach to each use.
- Currency, itemized recurring and one-time charges, contract term, renewal, activation conditions, and tax treatment. Approval must name the final quoted amount and exact rights, not a price inferred by summing unrelated categories.

These published prices are **indicative reference categories**, observed on 2026-10-11:

| Primary source | Published example | Quote implication |
| --- | --- | --- |
| [Databento pricing](https://databento.com/pricing/) | Standard: USD 199/month; personal use, up to two devices, license fees included | Personal-plan pricing does not establish a commercial multiuser Terminal grant |
| [Databento pricing](https://databento.com/pricing/) | Plus: USD 1,750/month plus license fees; annual contract; external distribution | Confirm the exact product, application rights, and exchange fees in writing |
| [CME fee list, effective June 1, 2026](https://www.cmegroup.com/market-data/files/june-2026-market-data-fee-list.pdf) | Real-time distribution: USD 29,280/year per licensee group, per exchange | Applicability must be established for the proposed distribution model |
| [Same CME fee list](https://www.cmegroup.com/market-data/files/june-2026-market-data-fee-list.pdf) | Real-time data feed: USD 610/month per data feed, per exchange | Determine whether and where the proposed carrier assigns this fee |
| [Same CME fee list](https://www.cmegroup.com/market-data/files/june-2026-market-data-fee-list.pdf) | Category C basic non-display: USD 363/month for one application, per exchange | Classify Terminal server analytics and identify the applicable rights and charges |

The table is not an all-in quote and the rows must not be summed into a Mastermind price. No vendor outreach, purchase, subscription, new credentials, or new feed activation is authorized or performed by this handoff. Continue independent fixture and admitted-feed work while the exact commercial approval remains pending.

## 6. Remaining acceptance holds and next action

| Hold | Evidence or action that resolves it |
| --- | --- |
| Canonical production access | Existing custodian restores and proves the same VPS/root owner after the public-key refusal |
| Deployment and source publication | Canonical owner deploys the fresh accepted SHA; incumbent Macro owner publishes the validated IEX historical envelopes; the authenticated and responsive gates above pass |
| Missing mission attachment | Recover `MASTERMIND_LARGE_TRADES_PRO_HANDOFF.zip` and its two original Skylit ATLAS screenshots, then verify screenshot-specific requirements. The value `1301` must not be treated as 1,301 distinct orders |
| Production native PNG export | Reproduce the locally accepted quantities, owner geometry, replay admission, labels and complete source attribution through the authenticated deployed chart |
| CME/MNQ | Approve the final written commercial quote and rights above, then qualify actual export framing, definitions, native corrections, completeness and provenance under the existing data owner. The offline modules are documented in the CME admission guide; they do not establish a usable feed |
| Out-of-sample efficacy | Execute the frozen chronological research protocol on sufficiently broad, licensed transaction and qualified-quote data. The current one-session partial cohort supports `NOT_ESTIMABLE`, with no fitted-parameter, success-rate, or alpha claim |

**Exact next production action:** the existing infrastructure/credential custodian restores the canonical VPS/root release owner and returns verified custody to the incumbent release process. That process then reads PR 929's actual accepted full merge SHA, verifies fresh protected-ref containment and the currently served generation, and runs the canonical command with its retained-volume and current-generation preflight gates. Macro publication and authenticated chart proof complete the historical IEX path. Full mission completion remains held until the applicable source, deployment, user-facing, attachment, export, feed-rights, and research acceptance gaps above are actually resolved.
