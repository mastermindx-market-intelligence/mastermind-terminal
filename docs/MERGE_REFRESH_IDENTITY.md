# Automatic CI after a protected branch refresh

The existing `merge-on-green` workflow needs a dedicated GitHub App installation
identity for its API operations. GitHub now puts `pull_request` runs triggered by
`GITHUB_TOKEN` updates into an approval-required state. A separate head-only
workflow dispatch does not clear that pending PR run. The default workflow token
cannot approve those runs itself.

The existing controller, required checks and merge gates remain authoritative.
The App token is used by the same `scripts/merge_on_green.py`; there is no second
controller or blanket workflow approver. It refreshes only the controller's armed,
ready, same-repository candidates, preserving holds, conflicts, trusted App15368
checks and SHA-pinned protected merges.

## One-time enrollment

Install an organization-owned private GitHub App on **only**
`mastermindx-market-intelligence/mastermind-terminal`. Grant repository permissions:

| Permission | Level | Existing controller operation |
| --- | --- | --- |
| Contents | Write | Protected merge and branch deletion |
| Pull requests | Write | Read candidates and update branches |
| Issues | Write | Existing merge labels and blocker comments |
| Actions | Write | Explicit CI dispatch after refresh |
| Checks | Read | Read exact-head trusted required checks |
| Metadata | Read | GitHub's mandatory repository identity access |

No administration permission, branch-protection bypass, webhook, organization-wide
installation or additional repository is needed. The job explicitly requests only
the five optional permissions above and its current repository. Its installation
token expires within one hour and is revoked after the ten-minute sweep job.

Store the new App's numeric ID and private key in the repository's approved Actions
secret store as `TERMINAL_MERGE_REFRESH_APP_ID` and
`TERMINAL_MERGE_REFRESH_APP_PRIVATE_KEY`. The pinned v3 action still supports numeric
`app-id`; its vendor recommends `client-id` for new integrations. The ID is not a
secret, but the existing two-secret contract makes partial enrollment explicit.
Never reuse a personal token or print a private key. Secret provisioning must use
an authorized secure store or stdin, never a credential in argv or a committed file.

Only enroll the App and install credentials after the operator accepts this concrete
repository scope. Do not merge this workflow change before enrollment: missing or
blank credentials produce `MERGE_REFRESH_APP_ENROLLMENT_REQUIRED` before any
controller mutation. An invalid key or missing installation also fails the token
step; there is no downgrade to `GITHUB_TOKEN` branch updates.

## Acceptance

1. Enroll the scoped App and verify the two secret names exist without reading values.
2. Merge the independently reviewed workflow change after its required CI passes.
3. Let the existing controller refresh a genuine eligible stale candidate.
4. Verify the new PR run starts without `action_required`, its head matches the
   refreshed candidate, and the existing required checks and protected merge succeed.
5. Preserve the run/head/merge receipt. Unit tests and successful token minting alone
   do not establish automatic release acceptance.

A previously blocked run is not retroactively fixed by changing identity. Treat
older approved heads as historical evidence; consume only current-head proof.
Repository source tests are `python3 -m pytest tests/test_merge_refresh_identity.py
 tests/test_merge_on_green.py -q`. They execute the actual preflight with synthetic
credentials and verify the trust, scope, failure and revocation contracts; they do
not mint a live App token.

References: [GitHub token trigger behavior](https://docs.github.com/en/actions/concepts/security/github_token),
[official App token action](https://github.com/actions/create-github-app-token), and
[default-token approval limit](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/).
