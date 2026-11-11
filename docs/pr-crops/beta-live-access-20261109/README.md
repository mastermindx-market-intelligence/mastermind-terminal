# Beta access release and live browser proof — 2026-11-09

This records deployment and public-browser acceptance of Terminal [PR #1362](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1362). It is separate from the source-only Analysis recovery change carrying this evidence.

## Deployed identity

- Accepted beta commit: `e33a4c3dd9f0965e7879fc5397175f6f49b0d751`.
- Previous accepted beta commit: `8390cc4ad41b1c0773e979198c80e742852c01dc`.
- Existing ordinary owner: `/opt/terminal/terminal-build.sh --target beta --target-sha e33a4c3dd9f0965e7879fc5397175f6f49b0d751`.
- Exactly one launch; original process completed with exit 0.
- Acceptance generated: `2026-11-09T10:11:19.938500Z`.
- Acceptance attempt: `10dbc5fc91264384800a637436ff06fb`.
- Accepted record: `2891692be28a4cd679eecdbb4d552d2ebbc03c6fa3494ae32c4cc2a15d5b55f8`.
- CLEAN release receipt: `17973e82df87df5a668bc662e229eac17b611da7bfa072ee7562f4851ba6fa0e`.
- Source audit receipt: `dbfe2d20a207945d6fed985f0050aa17ac3dd4c2dd35553f0762110101bfb8b4`.

The accepted pointer resolves to
`/var/lib/mastermind-terminal-beta/source-provisioned/runtime-accepted-e33a4c3dd9f0965e7879fc5397175f6f49b0d751-2891692be28a4cd6.json`.
Its SHA256 is `80f432b97f950819127f30ace8ae08b14b76751923456c107bd03752cea27e48`.

A fresh read at 10:12:21 UTC confirmed that receipt, deployment marker, canonical source HEAD, local origin/master, loopback status and [public HTTPS status](https://beta.mastermind-x.com/api/shared-shell/status) agree. Beta was active/running/enabled, PID 3465755, active since 10:10:57. Pending marker, build locks, builder processes and staging directories were absent.

Runtime contract: enabled `mmx.shared-shell.v1`; bridge and document versions `20261018.1`; registry digest `8d6346856bf24eb42525cfd0a7cbb6de3ff00092a907874012d8187e44623fbe`. The reused build ID `build-TfctsWXpff2fKS` is not treated as the source identity.

Production retained its existing marker `db06eacd8938cf44588d3906bca95bfd7122b74b`, process 1518248 and November 3 active-since time. The Investigation API remained explicitly closed before authentication/I/O. No owner replacement, protected release shortcut, production deploy, new trigger or gate activation occurred.

## Actual public browser journey

Fresh public Chromium session, 1363 × 936, dark/English:

1. Before release, the Analysis guest sign-in action measured **180.46875 × 16.671875 px**.
2. After the completed e33 release and a normal page reload, the same action measured **390 × 44 px**.
3. Opened **Create your free account** and observed the signup form. Closed it without entering or submitting any data.
4. Opened **Already have an account? Sign in** and observed the **Welcome back** sign-in form. The previous signup mode did not remain selected.
5. Closed the form and used the actual Discover navigation link. Discover rendered its guest gate, where the sign-in action also measured **390 × 44 px**.

Exact visited pages:
- https://beta.mastermind-x.com/analysis
- https://beta.mastermind-x.com/discover

No credentials, account creation or authentication submission were used. Discover's member-only workflow controls were not reachable in this guest session. Their earlier local fixture proof remains local; this evidence does not claim authenticated deployed acceptance or a live responsive matrix.

The connected local Chrome tab could navigate but inspection was blocked by another extension UI. The public browser session was independently required to verify the deployed site. No extension settings or authentication controls were changed.

## Unedited browser captures

The browser returned JPEG bytes; files use the matching extension. Transfer to this repository was verified by exact byte length and SHA256.

| Capture | Bytes | SHA256 |
|---|---:|---|
| [Before: Analysis guest action](beta-before-access-8390.jpg) | 51875 | `ecb10585bdb90aee7539f97a6b0b0e5a000efc9561efc05f4c2db465dca8621b` |
| [After: Analysis guest action](beta-after-access-e33.jpg) | 54476 | `9b12cac260708b642d39bf13cc8c280dfbb032f6f8ee1c0696b51bf8008de83f` |
| [Reopened sign-in mode](beta-signin-reopened-e33.jpg) | 37097 | `40792d097952ae7e0671eb0fc6fc3d9908382903f0c27a8575e3ff3570233ca4` |
| [Discover guest action](beta-discover-guest-e33.jpg) | 51539 | `55491856e95a0814608fa17dbc1fbbc03c54b2366bfa58eeb67e531ce007609e` |

## Connection correction and release semantics

The Chairman's correction is authoritative: **Studio Direct defaults to local M2. Do not select M2 before using it.** The existing verified VPS alias is reached from that default connection. Canonical source confirms this in the [same-pinned Studio Direct routing README](https://github.com/mastermindx-market-intelligence/Mastermind/blob/ff6d5ab67c3535056d69f603fac0d95c058baad8/integrations/studio_direct_mcp/README.md#local-m2-versus-remote-routes).

Native auto-merge/queue enrollment is distinct from deployment. This release was performed by the existing ordinary beta owner after protected source merged; auto-merge alone is not evidence that beta automatically deployed.
