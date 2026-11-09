# Evidence-to-Thesis continuation — 22 September 2026

Status: **INCOMPLETE / integration blocked**. This is the implementation packet
for the existing MAS-152 / WS:MARKET-OS F11 / MO-PAID-031 work, not another
workstream, authority map, scheduler, or research store. The user directly asked
this Codex task to start and continue the attached handoff.

## Carrier and ownership

- Terminal carrier: [PR #719](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/719), DRAFT. No auto-merge or merge-on-green label.
- Branch: `claude/ssd-evidence-to-thesis-assistant-20260922-f94ed6b48f237c25`.
- External SSD worktree: `/Volumes/Mastermind/agent-workspaces/claude/5600d31ffa29643a/evidence-to-thesis-assistant-20260922-f94ed6b48f237c25`.
- Native session: `01a0c82a-a741-7d42-a242-120151e2d54b`. Worktree was created with the required storage helper; both shared primary checkouts are preserved.
- Base: Terminal `7f98bfd9868a7a71dfd7a0b90c482793dc13f1b6`. Protected master observed on this continuation: `3b488ce96f2633613e1bd9d873e96693aef20314` (`git ls-remote origin refs/heads/master`). The branch has not been rebased or reset.
- Existing backend carrier: [Macro #7100](https://github.com/mastermindx-market-intelligence/macro/pull/7100), branch `claude/mo-b-f11-6-grounded-research-mode`, OPEN/DRAFT at `18d9ca11cb9f934e85323efea9aa08af17892a60`. Its body contains older head values; use `gh pr view --json headRefOid,files,state,isDraft` instead.
- #7100 already owns MO-PAID-031 changes to `app/main.py` and `engine/neuralweb/brain_gateway.py`. No second writer or replacement backend has been created. This packet does not claim that #7100 has accepted the additional requirement.
- Terminal #677 owns other Thesis workspace edits; this change does not modify that workspace or `/api/theses`.

## Verified integration blocker

Read protected Macro main `dd973910e95ea3ad99118fbbc2c83473fe8f1c80` with
`gh api repos/mastermindx-market-intelligence/macro/git/ref/heads/main`, then read
`contents/app/main.py?ref=<sha>` and `contents/engine/neuralweb/brain_gateway.py?ref=<sha>`.

At that source, `BrainChatRequest` has a 2,000-character message limit and no
non-persistent operation. Signed-in `chat()` calls `_ensure_thread` even when
`thread_id` is absent, then `_append_message` for both question and answer.
The exact-source attachment excludes resolved source bodies from stored chat,
but does not make the generated answer temporary. The request shape on #7100's
actual head was also read and still has no non-persistence field.

The former #719 implementation at `41e8b0b4b4af26edfe8bf4dfb3d79d34dcd0be6d`
inlined evidence excerpts into that generic message. A small mocked model test
did not exercise its real size limit, persistence, entitlement, or output
contract. Independent review found these release blockers:

1. Generation persisted the supposedly temporary draft and source-containing prompt.
2. Normal multi-passage prompts exceeded the real message limit.
3. A valid citation ID was treated as proof of factual support; invented quantities could pass.
4. Saving discarded claim mappings and complete source locators, truncating the remainder into a revision note.
5. Reopening could not reconstruct evidence or show corrections; no save-time reference revalidation existed.
6. A changed symbol could combine one company's generated answer with another company's Thesis baseline.
7. A lost save response or failed reread could lead to a fresh request ID and an unsafe retry.

The unsafe paths are removed, not hidden behind a feature flag. The current
preflight has no model adapter, ready-draft state, Thesis write, or save button.
It authenticates each request, validates a closed bounded input, uses the
existing revision-verified transcript reader, and reports coverage/locator
metadata with generation explicitly unavailable. It does not return excerpts or
redistribute transcript bodies. The corpus ingestion points to defeatbeta/Yahoo;
public reachability alone is not a rights determination for this new use.

## Frozen acceptance for resumption

Use one approved signed-in QA researcher and a company/question selected from a
rights-approved canonical source set. Do not use real customer Thesis objects.

1. Ask one company question and get a typed, source-bound temporary draft. Verify no chat/thread/draft store write occurred before explicit save.
2. Source facts are extractive or independently verified against exact references. Model inference, uncertainty, and user-authored judgment remain distinct. A valid span ID alone cannot validate a claim. Generated numerical facts, event clocks, and confidence probabilities must not be invented.
3. Select an existing Thesis explicitly and show its exact subject and baseline version. Do not select an arbitrary first Thesis. Draft, sources, account, subject, and baseline must agree.
4. Review and explicitly save through the existing Thesis version/concurrency owner. A changed baseline returns a conflict without a silent overwrite. An ambiguous response retains the exact request ID/payload until the effect is reconciled; it must not create a second request.
5. Persist complete immutable locators, claims, claim-to-source mappings, uncertainty, and provenance using the existing Thesis extension contract. A truncated revision note is insufficient. Coordinate any schema requirement with the incumbent Thesis owner.
6. Reopen the saved revision by its ID in a new page load and recover the full artifact from durable Thesis state. Preserve historical source revisions; visibly distinguish a corrected, stale, unavailable, and unchanged current source.
7. Revalidate exact references at save time. A source corrected between generation and save prevents silent acceptance. A correction after save is visible on reopen without rewriting history.
8. An insufficient-evidence question returns a plain explanation of missing coverage, without model certainty. Test missing/unreadable/stale documents and bounded/truncated searches.
9. An unrelated approved QA identity cannot read or mutate the first researcher's Thesis, references, or saved judgment. Unit authentication mocks are not two-user production proof.
10. Obtain current theme-contract evidence in EN/ZH at desktop 1440×900, tablet 820×1180, and mobile 390×844. Local typechecking and generic responsive CI do not constitute this route's signed-in acceptance.

## Required backend contract — proposal for the incumbent, not a new API

No endpoint, configuration switch, provider client, or persistence flag is invented
by this packet. Before enabling generation, the existing Macro owner must expose
and prove a canonical non-persistent operation with these properties:

- Verify the caller and applicable entitlement/source rights before retrieval or model spend.
- Accept a bounded question and closed exact-source references, not copied source text in a generic chat message.
- Resolve canonical source hashes, segment identities and UTF-8 coordinates server-side. Preserve complete receipts, including the authoritative corpus revision.
- Disable chat/thread/history writes and unrelated retrieval tools for the operation. Keep source bytes and unaccepted output out of durable chat/log/memory state.
- Return a validated typed draft plus claim-level provenance, uncertainty, and immutable exact-source receipts, or a typed abstention.
- Provide a compatible save-time reference-revalidation boundary for the existing Thesis owner. Revalidation and expectedVersion must not be replaced by browser-only checks.

After that contract is available, continue on this same Terminal branch/PR.
Refresh exact protected source, #7100 owner/head, Thesis owner, and live custody
before implementation. Do not merge this preflight as if it were the complete
assistant. No deployment or service restart has been performed for this PR.

## Validation and remaining proof

The focused regression suite exercises only preflight, route, and temporary UI
state contracts. It includes a recursive metadata allowlist, 4 MiB response and
16 MiB operation byte limits, request/archive cancellation, all-stale diagnostics,
and account-switch rejection of late browser responses:

```sh
cd terminal
./node_modules/.bin/vitest run lib/__tests__/evidenceToThesis.test.ts lib/__tests__/researchAssistantRoute.test.ts lib/__tests__/EvidenceToThesisWorkspace.test.tsx --maxWorkers=1 --minWorkers=1
./node_modules/.bin/tsc --noEmit
```

The final validation result and exact pushed head are recorded in PR #719 after
the checks finish. Previous green builds and generic E2E jobs at `41e8b0b4...`
do not prove the withdrawn generated-save flow or the replacement preflight.
Independent review first rejected the former generated-save implementation,
then found four preflight boundary issues; all four were repaired and received a
scope-limited static PASS. That review was not a browser or live acceptance.
No real signed-in model→review→save→reload journey, two-user QA, source correction
display, merge, deployment, or live acceptance is claimed.

The host was verified as Mac14,14, boot 2026-08-29, with elevated load during the
continuation. Only bounded single-worker tests are used; no new production build,
local browser server, broad test fan-out, or external model call is launched.
There is no new watcher/automation and no claim of background execution.
