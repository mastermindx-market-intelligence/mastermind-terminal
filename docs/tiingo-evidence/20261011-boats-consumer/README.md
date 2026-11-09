# BOATS consumer source acceptance, 2026-10-11

This change extends the incumbent Quote Hub and Terminal display. The public
`/api/ext-quote` projection admits only fresh qualified BOATS trades. Its internal
source selector shares the Hub's existing demand/LRU ownership and requires
explicit BOATS eligibility. Mixed legacy providers remain internal to their
existing owner; `/api/quote` excludes BOATS extension fields at both fresh and
keep-good cache boundaries. The regular-session price and close remain separate.

The Hub validates the full replacement envelope after fetch receipt, retains
capture/generation/publication ordering even for empty snapshots, rejects replay
and generation rollback, clears expired or invalid BOATS data, and guards an
in-flight callback after stop. The browser accepts monotonic poll results, so a
late positive response cannot undo a newer authoritative null. Event, arrival,
publication and expiry clocks remain separate. English and Chinese labels state
latest qualifying BOATS trade, single venue; mobile/watchlist expose provenance
and age. BOATS quotes never imply NBBO or completed canonical candles.

The independent review initially HOLDed three P2 ordering/receipt-clock defects.
The red report is preserved. The repaired PASS and comment-only current-hash
addendum bind every source/test file in the manifest. Reviewers ran no tests;
execution evidence is separately retained: 116 affected Hub passes, 13 responsive
passes with two existing tablet/mobile rail skips, three regular-authority passes,
six EN/ZH label/expiry screenshot passes, and TypeScript rc=0. The final focused
public-route/freshness test log records its own count. The unchanged-chart
source/evidence checks passed 10 cases after unused type declarations were removed,
restoring the canonical ChartPanel and intradaySources bytes without restamping.

All six PNGs are SOURCE_SYNTHETIC: real browser rendering over intercepted test
responses and the existing test fixtures, never vendor live market receipt or
production consumer acceptance. They cover 1440 desktop, 820 tablet and 390 mobile
in EN/ZH. No presentation stylesheet, navigation, new service, socket, credential,
provider purchase or persistent producer schedule is introduced.

Protected hosted CI, merge, source installation and the incumbent VPS release
must still be established for this change. Quote Hub process selection requires
real release verification because its module changed. An authentic overnight
BOATS archive-to-R2-to-Hub-to-API-to-browser observation remains a separate gate.
The original combined publisher/launchd scheduling refusal is not cleared by
these source checks. Terminal #945's d0973ef6 release is only the prior provenance
prerequisite; this carrier starts from that merged revision.
