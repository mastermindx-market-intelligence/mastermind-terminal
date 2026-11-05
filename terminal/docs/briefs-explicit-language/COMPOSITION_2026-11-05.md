# Briefs language consumer composition — Terminal #1033

## Source and scope

Original PR: https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1033

Original head `6b452634aa2ec475b5e6d04f8b5b52617bd551fd`, branch
`sol/web-gmi-brief-language-contract-20261017-astra-01a1468f`, composed onto
protected master `50713efda7cbd06c60b6dce2f88b31cea5c005a2`.

This is the consumer/API source phase. `producerActivation=false` and
`productionAcceptance=false` remain. The original three production owners
and four test files are retained and composed; an additional delivery
ownership suite exercises the established race. Current master layout,
always-mounted `/alerts` inbox, sharing predicate, subscription controls,
route-local name lookup and navigation remain. #662's unmerged scheduling UI,
subscription mutation machinery and scheduler activation are not included.

## Resulting consumer behavior

The decoder retains paired historical nonempty language strings, permits
explicit available Chinese, and admits nullable Chinese only as the exact
`sentence_zh:null` plus `translation_status:unavailable` combination. Missing,
empty, contradictory or unknown forms remain invalid. Recursive forbidden
fields and numeric-judgment guards remain binding.

Coverage describes every passage in the body, including passages beyond the
two-sentence preview. In Chinese, an unavailable passage retains its labelled
English original. The exact historical English-plus-pending-marker form is
adapted for display without changing stored bytes or inventing a cause,
quality judgment or retry schedule. Delivery readiness and language
availability remain separate.

Supported requests acknowledge `briefs.explicit-language.v1`. Unknown
contracts receive 400 after ordinary authentication. A legacy request
selecting an owned, valid body outside the old decoder's capabilities receives
a typed 409 requiring page refresh, before body normalization can discard
usable content. Another owner's rows and invalid/forbidden bodies do not
become upgrade requirements.

The narrow watchlist target decoder correction already implemented on #662
is reused: watchlists accept explicit null or a nonempty version/as-of value;
theses still require a nonempty version. Missing/empty values remain invalid.
The actual Macro producer source at
`d08e1d0646bfa6a7d142412122eff247c4411c1f` emits null watchlist versions. This
source fact does not prove producer activation. Compatibility gating covers
this admitted null target version even when Chinese is complete, since old
decoders require a string there too. Supported clients retain the body;
legacy clients receive the explicit upgrade response.

## Delivery read ownership

The mounted/generation mechanism from #662's delivery reader is applied only
to this existing reader. Each read owns its fetch, successful JSON, 409 JSON,
catch and final loading settlement. A retired response cannot replace newer
partial-language rows, clear a newer failure/upgrade action, or end a newer
loading state. Unmount retires the read. Existing rows remain while a new read
is pending.

A current 401 is unavailable rather than a fabricated empty inbox. Row
envelopes are validated independently from body decoding. Invalid ready
content retains the row's identity/date with localized unavailable copy;
it is not labelled as a missed run or allowed to expose a sharing link.
Valid partial content with an actual UUID retains the current source-owned
team-sharing link. The native mounted and E2E fixtures now assert that
positive UUID case.

## Executed verification

- 24 actual native body-test cases passed through a local source assertion
  adapter, including strict language combinations, full-body coverage,
  historical display adaptation, target versions and forbidden fields.
- 12 actual delivery-route test cases passed against the production GET
  source using the native suite's Supabase query mock and a Response JSON
  port. These cover owned-row filtering, compatibility, preservation,
  invalid payloads, authentication ordering and existing name projection.
  Nine unrelated subscription mutation tests were explicitly excluded;
  no subscription-route stub was invoked.
- 23 actual inbox callback probes passed with controlled hook/state/fetch
  ports. They cover the six older-response outcomes, delayed successful and
  409 JSON, loading ownership, current 401, malformed envelopes, invalid
  ready bodies, pending row preservation, unmount, StrictMode cleanup and
  watchlist-null acknowledgement.
- Five non-JSX TypeScript syntax checks and diff whitespace review passed.

These executions are not native Vitest, React, Next.js, Playwright,
PostgreSQL or the full TypeScript compiler. The committed native delivery
ownership suite contains 38 EN/ZH cases, retaining the relevant existing
ownership cases and adding typed-upgrade ordering. Existing mounted tests,
subscription controls and the explicit dormant-surface guard remain. Native
current-head CI is still required; unavailable local execution is explicitly
deferred under the Chairman's instruction.

## Exact remaining recurring-capture gate

The old unit job at
https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/39032614383/job/117395975927
reported one failed test and 12,217 passing tests. Its failure is the native
B-F11-7 recurring-Briefs source lock, not the separate language capture packet.

The current master producer and reader require twelve crops:
`list`, `empty`, `subscribe` × EN/ZH × 1440/390. Their five source members
include BriefSubscribeControls. The subscribe producer visits the existing
thesis route and waits for `[data-testid="brief-subscribe"]`.

Current master intentionally does not mount that control. The native
`BriefsInbox.test.tsx` guard explicitly requires it to remain absent from
ThesisWorkspace and TerminalShell until the producer is live. The current
ThesisWorkspace satisfies that guard. Consequently a lifecycle or selector
repair cannot honestly produce the dormant subscribe quartet from this route.
Substituting #662's schedule images or restoring its hidden UI would exceed
this consumer scope and contradict that guard.

The reader, producer, historical manifest and historical crops remain
unchanged. No eight-new/four-old packet is represented as a fresh full matrix,
and no source hash is restamped to manufacture qualification. The expected
source-lock failure remains an explicit required gate until an accepted,
lawfully available recurring-Briefs path and its coherent evidence contract
are available. This source publication is not a claim that all CI is healed.

The separate language producer remains the incumbent `languageCrop()` in
`e2e/briefs-inbox.spec.ts`, gated by `BRIEFS_LANGUAGE_CROPS=1`. It has twelve
PNG/JSON pairs: partial and upgrade × EN/ZH × 1440/820/390, with six actual
source hashes. The original 25 evidence blobs remain byte-preserved as
historical evidence. New language/browser capture is unexecuted here; the
native upgrade test still checks the actual reload after its screenshot.

## Release boundary

Source repair does not lift #662 HOLD5748354119 or enable a recurring
producer. Nullable publication still requires deployed BFF/client receipts
for every serving instance, mixed-language and cross-version coverage,
explicit old-client handling, and decoder/guard retention while nullable
rows survive rollback. No SQL, credentials, scheduler, transport, deployment,
subscription write or production effect was performed.

This original PR remains a source carrier with a named qualification gate.
No merge-on-green admission, approval or native self-merge is justified by
the local adapter results. Continue independent Terminal PR work while the
recurring-capture lane retains its exact prerequisite.
