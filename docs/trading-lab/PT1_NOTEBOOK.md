# Trading Lab PT1: original reasoning, persisted by the existing owner

Status: BUILT_NOT_PROVEN. Candidate source; not deployed or independently accepted.
Operation: trading-lab-thesis-notebook-20260912-sol-001.
Parent product/evidence: Mastermind PR #566. This is an implementation slice, not a replacement program.
Procedure pin: Mastermind@57a2672af5b9dcea282e4bae01d1a0b9d10bb1cd, Skillpack1.0.1/bootstrap1.
Source pin: mastermind-terminal@a4be9a3f4b51246200cb1b7c4f1d44730066a9a9.

## Capability

Open /trading-lab, connect the existing authenticated Mastermind account, write an independent
view, save through Thesis Objects, reopen its original version, revise without overwriting,
and resolve a lost save response by its exact request identity. Saved means recorded, never
AI approval or execution permission. The source has no AI or trading writes.

The production API is /api/theses/lab. This is a first-party transport adapter over the SAME
createClient(), applyThesisVersion(), listTheses() and readThesis() owners as /api/theses.
It adds no table, identity resolver, transcript, journal, RPC, scheduler or retry queue.
The only additional read is a user-scoped lookup of the existing unique
(user_id, client_request_id) row in thesis_versions. Only request and version identifiers leave
that read; the canonical readThesis() validates full content before client reconciliation.

## UX contract

Today / Plan / Your plans / Learn. Progressive detail; no invented portfolio prices or results.
Save an unfinished argument instead of forcing an elaborate story. The checklist measures fields
recorded, not evidence truth. Exact historical revisions remain inspectable; truncated history and
list coverage are explicit. Changes in another tab produce a comparison, not an overwrite.
A known save followed by a failed refresh cannot become a duplicate create.

One unresolved request is retained in tab-scoped sessionStorage under its authenticated user.
This is transport recovery, not a second notebook or offline outbox. Failed storage prevents a write.
Timeouts retain the original request. Check-original-save is read-only. Only a successful exact
not-found read enables a user-initiated retry of the identical request/body. A later commit racing
that read remains duplicate-safe under the existing atomic RPC. Account changes clear in-memory
private UI and cannot transfer the request to the new user. No automatic background resend.

## Security and data contract

Only exact HTTPS app.mastermind-x.com and bot.mastermind-x.com origins may submit or receive
credentialed CORS responses. POST requires JSON, an independently verified session and an expected
principal header. Browser identity is a match check, not authentication. No wildcard origins,
service-role keys, bearer extraction or cookie forwarding. All API responses are private/no-store.
The body is streamed with a 64KiB ceiling. Unexpected mutation failures are explicitly uncertain.
Canonical subject/content/effective-time validation and atomic versioning remain with Thesis Objects.
New symbol notes remain listing_scoped; no issuer identity is invented. Existing subject identity and
effectiveAt are preserved on revision. No fixture or developer identity bypass is in the native route.

## Validation

Run `node --test terminal/scripts/test_thesis_lab.mjs` from the repository root.
Native `npm test` in terminal includes the same suite via thesisLabHarness.test.ts and the separate
thesisLabRoute.test.ts wiring checks; normal Terminal typecheck must pass before release.

Local kernel/client suite: 55 tests, all passed, none skipped. These tests use a test-only owner.
Local browser exercise: 28 checks passed, including save/revise/history, conflict comparison,
response-loss read-only recovery, saved-but-unread state, account change and 16 width/view cases.
The browser harness used actual frontend source with a test transport and memory owner over IPC;
network was denied. It is NOT authenticated database or production-browser proof. An attempted
loopback HTTP browser navigation was blocked by administrator policy and was not bypassed.
Native Vitest/Next/full-repository CI are not claimed by those local results.

## Release gates and exact continuation

1. Independent source/security review and native Terminal CI on the exact integrated candidate.
2. Verify actual /api/theses authentication, current deployed database/RLS and first-party session
   cookie behavior, then deploy through the existing authorized release owner.
3. Prove in an authorized test account: create, reload, immutable revise, competing-tab conflict,
   response-loss reconciliation and other-user isolation. Preserve release/commit identity.
4. Add the discoverable bot Portfolio entry (and agreed bot-native presentation) to the SAME owner,
   not a copied plan store. This candidate alone does not claim bot navigation has changed.
5. Connect the saved thesis/version to the existing preflight and, in a separately bounded wave,
   the single-writer personal cash/order/lot transaction. No browser Save action can place an order.

The broader paper suite, AI review, private account migration, market forecasting and Macro integration
remain unfinished. No live-capital action follows from this PR. Studio listing-online did not prove a
working host channel: ping and pwd timed out during this turn. Executive admission read returned an
MCP SSE 404. No worker placement, Job, provider call or deployment is claimed.
