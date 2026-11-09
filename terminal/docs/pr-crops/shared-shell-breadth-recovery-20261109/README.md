# Breadth recovery and production guest qualification

Parent: Terminal #1381, WS:MARKET-OS. Operation `shared-shell-breadth-recovery-20261109-c4`. Protected input `1c0bf028cf72539a4d3fcb17fa137ee474d764f9`; procedure pin Mastermind `3652d8907df1738de551dd3032b42aa2a2acb482`.

## User behavior

The existing breadth cell can now recover a failed or expired read through one explicit keyboard/touch action, without polling or refreshing sibling readers. Duplicate activation is coalesced before React commits. Access refusal remains separate and offers no retry around that refusal. Parent scope abort removes retained values; late responses cannot cross owner/generation boundaries. Existing source-age math, source verdicts, API, identity, request deadline and server rate limit remain unchanged.

The managed-workspace acquisition returned unqualified. Its same-operation publisher/status readback established one clean original workspace/branch at the exact protected input; no acquisition was replayed or re-homed. The prior five release candidates and their queue entries are untouched.

## Source qualification

New regression baseline: 13 failed / 1 passed on the unchanged reader, confirming missing recovery/access/abort behavior. Repaired candidate: **125/125 tests across five suites**, including all 14 new reader cases, existing proxy/clock/workspace/owner-integration checks. Full TypeScript, scoped ESLint, forward-only language guard and whitespace check pass. Node26 jsdom uses `NODE_OPTIONS=--no-experimental-webstorage`; no product or guard is weakened.

`qualify.mjs` exercises actual React/readingJson/CSS under explicit HTTP and identity fixtures. It produces 1440/820/390/320, dark/light, EN/ZH cases with keyboard and touch-target hit testing, no overflow, one explicit read per action, expiration without polling, access refusal without retry and abort removal. It records exact source HEAD/digests. **Executed against product source `ca9f0fa23611c51705138614f19f588eb12c1ef8`: 16/16 browser cases, zero page errors and zero horizontal overflow.** All source digests match the retained report. Keyboard activation,44px hit targets, expiry without another fetch, denied-access state without retry and scope-abort clearing pass. The actual1440darkEN and390lightZH screenshots were visually inspected. This evidence update changes no product source.

## Separate production-mode guest proof

`production-guest-proof.json` is **13 passing actual Next production-mode checks** on the existing Today product build `b5a00479a1bd76ef09bc92ae969232aa60ef1e47`, not this new reader's build and not deployed beta. It verifies root→Today, real Today/Discover guest gates and keyboard sign-in dialogs at1440/820/390/320,44px hit targets/no overflow, and401/no private bodies for four APIs. Only dummy loopback Supabase configuration was used; external browser requests were blocked. This replaces the earlier erroneous heading expectation with the actual SignupGate contract; it does not supply real signed-in acceptance.

## Release boundary

No new network/server/auth/source clock owner, automatic retry, provider spend, installed service or release is introduced. Hosted CI, protected merge, accepted beta receipt/public identity and real signed-in journeys remain separate obligations. The current auto-release workflow has an observed missing VPS_DEPLOY_KEY preflight; machine-local SSH keys must not be exported as a shortcut. Resume parent implementation and release evidence on #1381.


## Follow-up focus hardening

A new regression caught the retry control disappearing without a stable keyboard destination. The original reader now exposes a named, programmatically focusable group and moves focus there only for the user's focused retry. It remains the same DOM cell across loading/success and never steals focus on later settlement or carries focus intent to another account.

Current source qualification: **127/127 tests across five suites**, including 16 reader-recovery cases; TypeScript, scoped ESLint, language guard and whitespace PASS. The earlier 16-cell browser report binds the preceding product source and is not silently relabeled; a refreshed exact-source capture follows this product commit.

Read-only composition with #1386 clock source `4429fc4760e05d51312a2ee46f7fa76bc2980ecc` also passed: the actual current React reader with a source already20minutes old expires after5minutes+1second, performs no expiry fetch, accepts exactly one explicit retry despite duplicate activation, retains focus on its stable cell, and clears all display on owner abort. No borrowed source file or queued branch was changed for that test.
