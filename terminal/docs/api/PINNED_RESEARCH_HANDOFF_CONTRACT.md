# Pinned research handoffs

This MO-PAID-052 / MO-DELTA-041 slice lets an owner share one saved Investigation's
question and next steps with a named account. It uses the existing Investigation
aggregate and resource-grant ledger. Scenario sharing, coverage sharing, shared
authoring and the wider team catalyst workflow remain separate work.

## User path

Open Settings → Sharing → Shared research handoffs. Choose a saved research title
and its displayed revision, enter the recipient's account ID, and intentionally
share that revision. The recipient opens the same section to read the handoff.
The owner can revoke it there.

Only that revision's title, question and continuation are shared. Charts,
reference identifiers and contents, reviews, fire identifiers, and mutation
receipts are excluded. Newer revisions are not automatically included. Reading
a handoff does not grant permission to edit, re-share, or read its attachments.

## Authenticated interface

`/api/research-handoffs` uses the existing signed-in cookie session. Every request
asserts the page's immutable account ID in `x-mm-handoff-owner`; the server checks
it against the authenticated account before any read or mutation. This assertion
does not select an account or grant authority. An absent or changed owner returns
`409 owner_changed`, without disclosing the session's current account ID.

| Request | Meaning |
| --- | --- |
| `GET` | Read eligible owned revisions and current sent/received handoffs. |
| `GET ?grant_id=<UUID>` | Read one explicitly granted pinned handoff as its recipient. |
| `POST {investigation_id, revision, grantee_user_id}` | Share one owned revision with a named account. |
| `DELETE {grant_id}` | Withdraw an owned Investigation handoff. |

Unknown fields, selectors, and duplicate query keys are refused. Every response,
including errors, uses `Cache-Control: private, no-store` and `Vary: Cookie`.
The client does not automatically retry a mutation after a lost response.

The successful read projects `mm.research_handoff.v1` with its grant ID,
Investigation ID, pinned revision, sharing author, committed time, title/question,
and optional next question/observation. It does not expose a raw manifest or the
owner's current revision number. Denied, absent and revoked handoffs have the same
non-disclosing `not_found` response. Storage, schema and malformed-result failures
remain `unavailable`; they are never presented as an empty collection. Bounded
lists refuse incomplete reads instead of silently truncating them.

## Revision and availability behavior

The same live share and revision converge on the existing grant. Attempting to
replace a live share with another revision returns `share_conflict`; revoke the
old share explicitly before creating another. A grant cannot be re-pointed.

Removing an Investigation makes its handoff unavailable through the common
`not_found` result. Removal is source availability, not a claim that the grant was
revoked. Restoring the source can make the same original pinned revision readable
while its grant remains live. Explicit revocation is terminal: restoration cannot
revive a revoked grant. The historical grant record is retained.

## Source and release boundary

Migration `0041_pinned_research_handoffs.sql` is source only until separately
qualified and applied through the existing migration procedure. Deploying an
application build does not apply it. No production application or live two-account
acceptance is implied by isolated PostgreSQL, HTTP, or component tests.

The extension preserves existing owner-only Investigation policies and RPCs,
exactly-once mutation receipts, watchlist grants, and team chart workspaces.
The new kind uses an explicit revision discriminator in `resource_grants`; it
creates no alternate research store. The owner and recipient are checked again
at the database boundary. No server-side owner impersonation or transitive
reference access is permitted.
