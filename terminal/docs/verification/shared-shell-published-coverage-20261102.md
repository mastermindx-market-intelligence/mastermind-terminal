# Shared Shell published document coverage — 2026-11-02

Source qualification only. Installation, actually served Macro bytes, authenticated browser acceptance and runtime release remain separate.

The Terminal catalog at protected `ed2e633852564dcd604afc26eb03eeed54954dee` still projected Macro inventory `8fda9075961737aab7539f585f40bc4bb4ca4bef`. This refresh uses the unchanged protected exporter at Macro `90e0644f9f08ab37115dfffedce2ba7939b0835d`, the exact canonical registry blob from that tree, and `--inventory-ref 90e0644f9f08ab37115dfffedce2ba7939b0835d`. The generated JSON was copied verbatim; no JSON membership or registry row was manually edited.

| Contract | Previous | Refreshed |
| --- | ---: | ---: |
| Exact legacy paths | 13,123 | 13,987 |
| Native paths | 17 | 17, unchanged |
| Directory entries | 291 | 290 |
| Tracked HTML in bound inventory | 13,153 | 14,023 |

The positive delta is 863 earnings documents plus `/stocks/HTFL.html` and `/stocks/MIAX.html`, all admitted through the existing live anonymous/public `/stocks/<id>.html` family. Example newly admitted records include `/stocks/earnings/aal-2026q3-call-record.html` and `/stocks/earnings/abbv-2026q3-call-record.html`. All 863 earnings records have inbound article links in the 70 protected earnings index/pagination documents. Company families retain the existing symbol picker; no per-instance directory entries were invented.

The sole removal is `/consumer_cyclical_plnt.html` and its directory entry. [Macro #10237](https://github.com/mastermindx-market-intelligence/macro/pull/10237), protected commit `2625ae5909ccced55fd2887a407c838d018812cd`, withdrew the fixture-only synthetic public card under Product Trust F-6. [Macro #10268](https://github.com/mastermindx-market-intelligence/macro/pull/10268), protected commit `6b77c45c6e0d2`, removed its stale canonical registry row. The exporter now honors those existing decisions. `/stocks/PLNT.html` and `/stocks/earnings/plnt-2026q2-call-record.html` remain admitted and covered by regression tests. No alias or working route was retired by this change.

The 36 exclusions remain explicit: 11 serving-policy denials, 11 HTML fragments, five lab lifecycle documents, two internal lifecycle documents and seven unregistered pages. `/gmi.html`, `/expectation_surface.html`, `/committee.html`, `/crossasset.html`, `/macro/fragments/credit.html`, private API lookalikes and unpublished earnings lookalikes stay blocked. This changes no serving policy, authentication, payload authorization, data license or native route behavior. The finite catalog remains discovery/host admission and grants no new payload rights.

Every one of the 865 added immutable documents has a title and exactly one capability block at version `20261018.1`. Both relative asset references resolve to committed `site/shared_shell.css` and `site/shared_shell_bridge.js`. This proves committed source document composition; it does not prove what a deployed host currently serves.

## Provenance

- Canonical registry SHA-256: `8d6346856bf24eb42525cfd0a7cbb6de3ff00092a907874012d8187e44623fbe`.
- Generated projection SHA-256: `2bfc0bf51e405abdd61032470d0b04cf1e1114370bd1c1f9b8e9e137d807f8cc`.
- Registry's own Macro/Terminal/Mastermind pins remain recorded separately from the newer inventory commit. Its registry generation timestamp stays intact.
- Exact canonical registry difference from the prior inventory is the removed synthetic PLNT row; no other registry changes were authored here.

## Verification

The updated membership test first failed against the old catalog: six failures, including new members and the withdrawn card. The protected exporter also passed deterministic `--check` against the exact regenerated output. With the generated catalog, all eight focused files and 160 tests pass: generated membership/real catch-all/noindex metadata, finite route contracts, native route configuration, member pages, embed headers, auth redirects, public presentation and navigation commit behavior. The shell-off test still rejects admitted members.

Command, from `terminal/`:

```sh
NODE_OPTIONS=--no-experimental-webstorage npm test -- lib/__tests__/sharedShellGeneratedMembership.test.ts lib/__tests__/sharedShellContracts.test.ts lib/__tests__/sharedShellNativeRouteConfig.test.ts lib/__tests__/sharedShellMemberPages.test.tsx lib/__tests__/sharedShellEmbedHeaders.test.ts lib/__tests__/sharedShellAuthRedirect.test.ts lib/__tests__/sharedShellPublicPresentation.test.tsx lib/__tests__/sharedShellNavigationCommit.test.tsx
```

The initial broader local run exposed Node 26.5.0's native storage shadowing jsdom (`localStorage` undefined). Disabling that experimental host API restored jsdom's normal browser storage; no product or test code was altered for it. The failing log is retained separately from the successful run.

An optional bounded Fabric admission audit returned pre-worker `REMOTE_SUB_ADMISSION_REFUSED` for `host_temperature_at_or_above_limit`, run `iw2-admission-audit-20261102-carson`, rc 75. It produced no review verdict and was not retried or accepted. Fresh nonauthor source adjudication and the protected controller remain required for landing.

The assigning parent independently checked all 865 added documents against the protected source for exact canonical URL, current document version and resolved bridge/CSS stamps (`071ef720`, `b1918cca`), with no exceptions. That proof is retained at `/Volumes/Mastermind/agent-workspaces/codex/6e18/family-acceptance/p12-published-document-source-compatibility.json`; it establishes no served or runtime claim.

Raw local proof: `/Volumes/Mastermind/evidence/iw2-admission-20261102-carson/` contains the exact protected exporter/registry/output, delta, per-added-document proof, earnings-index discovery proof and red/green logs. The assigning parent owns source acceptance; no deploy or browser/runtime effect is authorized by this source change.
