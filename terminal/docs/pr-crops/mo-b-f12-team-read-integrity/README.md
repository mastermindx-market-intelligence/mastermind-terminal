# Team account and read integrity

The Team section now scopes its state to the canonical account owner and retires reads when that owner or roster generation changes. A pending or failed roster refresh removes stale permission controls and settings. Late responses cannot restore them. The one-time invitation URL remains available through a refresh of the same team or a failed refresh. A successful no-team or different-team read clears it; an account change clears it with the rest of the prior account state.

Reproduce the 12 controlled browser cases from `terminal/`:

```sh
MO_TEAM_CAPTURE=1 TERMINAL_E2E_PORT=3647 npm run test:e2e:responsive -- e2e/team-read-integrity.spec.ts --workers=1
```

English/Chinese × desktop 1440×900, tablet 820×1180, mobile 390×844 × successful/refused reload all pass on the source commit in `manifest.json`. The old settings read is held until the new roster and settings settle (or the roster fails), then released. The browser checks stale controls disappear during the pending refresh, old settings do not overwrite the new values, the invitation URL survives, and the document does not overflow horizontally. All writes are intercepted local fixture actions; no real team or invitation is created.

The combined mounted regression suite fails 27 of 31 new cases on the original source and passes all 117 cases including 77 existing neighbors on the repair. It covers account A-to-B switching at teams/members/invitations/settings fetch and JSON boundaries, late success/error responses, guest reset, email-only continuity, independent settings writes and same-team reloads. Six additional failures on the first candidate exposed stale role/ownership completions and delayed transfer retries after roster reload. Those tests pass after guarding each completion and retry against the current roster generation. Pending refresh also clears confirmation dialogs and busy state. Three paid-review findings reproduced pending-state and invitation-link leaks; those regressions pass after tracking each settings control independently and binding links to their issuing team. Guest-to-account continuity also passes. TypeScript and scoped ESLint pass.

The parent inspected all 12 real crops. The existing Terminal dark shell is retained. The four inherited F12 capture packs are regenerated using their unchanged original producers because they bind this source file. These local controls establish source behavior; authenticated production acceptance is recorded separately by the existing release owner.
