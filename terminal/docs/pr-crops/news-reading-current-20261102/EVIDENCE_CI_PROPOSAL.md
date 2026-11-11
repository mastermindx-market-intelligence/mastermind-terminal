# News recovery — explicit CI evidence-selection proposal

Status: **proposal only; CI is unchanged**. Prepared for Terminal PR #1207 on
2026-11-02 against source candidate `5c9269d207e4cef89a60c39752d3233fbcb2fdc7`
and master `bf9826e3d52d84458e7498a95c88ea609c14428b`.

## The release problem

The scoped News change edits two locations in `TerminalShell.tsx`. Two existing
visual-evidence unit tests compare the whole shell file with historical source
hashes, so they correctly report that those historical captures no longer prove
the current shell.

The existing prospective owner, `terminal/e2e/tools/visualEvidence.cjs`, already
supports truthful new records without overwriting historical evidence. Its two
readers use one explicit composition selected by `TERMINAL_EVIDENCE_COMPOSITION`.
Without selection they retain the incumbent historical checks. A valid selection
requires all 20 PL6 and all 30 distinct Visual Intelligence cases, compatible
profiles, actual passed executions with no retry, and matching current sources.

The parent is producing current-code records through that existing owner.
Their existence alone does not activate them in GitHub CI or satisfy a failed
required check.

## Exact proposed workflow change

After the proposed composition exists and both unchanged readers validate it,
the minimal activation is in the existing `terminal-unit` job in
`.github/workflows/ci.yml`:

```diff
       - run: npx next typegen
       - run: npx tsc --noEmit
       - run: npm test
+        env:
+          TERMINAL_EVIDENCE_COMPOSITION: terminal/docs/pr-crops/b-pl-6-batch-1/news-reading-20261102-c4-proof-001.composition.json
```

This is not an applied patch. The ID above names the intended new composition;
it is not evidence of capture completion. The final verification record must
supply the real operation paths, hashes and validation result before this
proposal can be used.

No change is proposed to branch protection, required check names, test commands,
reader behavior, source membership, case requirements, legacy files or
retry/merge authority.

## Why this is a repository-wide operating decision

The source contract is broader than the visual files directly changed here.
`visualEvidenceFs.py` seeds an explicit source list and recursively discovers
runtime and e2e files under `terminal/app`, `terminal/components`,
`terminal/lib` and `terminal/e2e`, plus the existing configuration inputs.
On this candidate the contract covers **1,761 files**, with source digest
`250ec240c087a91a1e2544468f4a39f5912971d5dd12bc9c05a724061ce9d4f9`.

Consequences of permanently activating this selector:

- A later change to any locked runtime/e2e/config input, or its source membership,
  invalidates the selected composition even if it is unrelated to News.
- The next candidate needs new compatible actual records covering all 50 cases.
  Cases can be composed from existing operations only when the full source
  snapshot and profile still match; a stale operation cannot be restamped.
- Concurrent PRs can invalidate each other's evidence when source changes are
  combined. Integration and capture must use the same final source snapshot.
- The selected profile is explicit: fixture `terminal-e2e.v1`, `next-dev`,
  dark theme, shared-shell flag 0 and investor-preview flag 0. It is not
  authenticated production or live-feed proof.
- Invalid or incomplete selection fails closed; there is no fallback to the
  historical mode after explicit selection.

The workflow file itself is outside the currently locked source set. Applying
only the exact selector diff does not change the captured runtime snapshot;
any intervening locked-source change still requires requalification.

## Decision and boundaries

The scoped News recovery can complete its implementation, responsive proof,
independent review and immutable captures without changing the CI default.
Activating the default changes the future delivery obligation across Terminal,
so it is presented explicitly rather than hidden inside this UI change.

Until that operating-policy decision is made and required CI succeeds, PR #1207
stays Draft with auto-merge off. Local evidence is not a waiver. Do not restamp
legacy captures, edit the guards to suppress failures, narrow the source/case
set, add a PR-specific exemption, or bypass protected merge.

The original thermal-refused worker remains a separate settled failed attempt;
this CI proposal changes no controller, thermal rule, execution receipt or
runtime installation.
