# Investigation watchlist certainty — local qualification

Scope: P16.T1, Options Alpha investigation UI. Baseline is Terminal
`9d54e960e6e048c982d9e455a39e4ea30dfa7f74`. Source changes only the mounted
investigation's save state and rejection copy. The watchlist API, authentication,
server membership service and database remain unchanged.

A lost POST response followed by an absent membership read previously showed
“Save not confirmed,” but selecting a different list and returning reset that
state and exposed another Add button. The repair retains certainty per list and
symbol while the investigation is mounted. Other lists remain usable. Positive
owned-list membership confirms membership; it does not prove that the original
request caused it. Absence or a failed read cannot disprove the prior write.

The API's explicit 400/401 responses reject before `addSymbols`; the UI now keeps
these separate from an unknown write. A failed follow-up read preserves the known
rejection. After an explicit Check succeeds with no membership, another explicit
user action may try a known-rejected save. No automatic POST retry is introduced.

Closing the dialog unmounts this state. This repair makes no cross-dialog,
cross-session or server exactly-once guarantee. The existing service deduplicates
membership and uses a unique-conflict upsert when the database migration exists;
its legacy missing-index fallback has separate concurrency limits. No live database
migration or duplicate-membership behavior was tested or claimed here.

## Verification

- Baseline component run: **2 failed, 2 passed**, with the switch-away/back test
  failing because Check watchlist disappeared, and the POST401 test failing because
  a known refusal was displayed as unknown. This was run before modifying the
  component, using the real exported component under jsdom.
- Repaired focused run: **35 passed** (5 component tests plus all 30 existing
  watchlist service tests). Covers lost response/empty read, independent target,
  positive membership, failed checks, authentication loss, explicit POST401 refusal,
  and POST400 refusal → failed check → explicit successful absent check.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Targeted ESLint reports the same two pre-existing `no-html-link-for-pages`
  findings on baseline and candidate (`/login` and `/terminal` anchors). No new
  lint findings. No unrelated navigation rewrite is included.
- Responsive investigation browser qualification: **48 distinct cases**. The
  original run passed 45 and failed three newly added Chinese setup cases because
  the test looked for another shell's language control. Only the six new EN/ZH
  cases were rerun after correcting the locale fixture setup: **6/6 passed**.
  The 42 unchanged existing cases were reused; the application source was unchanged.
  This is 48 qualified distinct cases, not a claim of a fresh all-green full run.
- Locale uses the suite's existing `data-lang` + `mm:lang` seam. These are actual
  mounted Chromium interactions in EN/ZH, not account preference persistence or
  real Settings-control qualification. Viewports: 1440×900, 820×1180, 390×844.
- Six retained dialog screenshots: [desktop EN](desktop-en.png),
  [desktop ZH](desktop-zh.png), [tablet EN](tablet-en.png),
  [tablet ZH](tablet-zh.png), [mobile EN](mobile-en.png), [mobile ZH](mobile-zh.png).
  They capture the unresolved original target after an independent target save.
  There is no document overflow; positive membership then disables Add without
  issuing another POST. The dialog is scrollable on the smaller viewports.

The existing responsive browser suite includes a delayed initial GET regression;
no separate new deferred-response coverage is claimed by the component tests.
New EN/ZH browser cases use intercepted fixture watchlists only and assert the
original target remains unwritable after switching and an absent Check, while a
second list saves and a positive Check confirms membership.

## Delegation and custody

Native coordinator `01a1ae70-25d3-79f2-8adb-fd463e3f463f` is an actual child of
original root `01a10340-ddc1-7e41-9b42-9c8543c28c3d`. Fabric stable operation
`options-watchlist-p16t1-20261105-r1` retained those identities. Its terminal result
was consumed: rc75, remote host admission refusal
`host_temperature_at_or_above_limit`. No worker START or quality acceptance was
established. The operation was not retried, replaced or moved to another host.
`NO_ELIGIBLE_PRE_EFFECT_WORKER` justified direct principal integration and local
qualification within the existing assignment. No native labor child was spawned.

Review is `SELF_REVIEWED`, with source integration findings adjudicated by the
commissioning parent. This is not formal non-author GitHub approval. Source/local
fixture qualification is separate from hosted CI, protected merge, installation,
activation and live customer acceptance. No live watchlist mutation was performed.
