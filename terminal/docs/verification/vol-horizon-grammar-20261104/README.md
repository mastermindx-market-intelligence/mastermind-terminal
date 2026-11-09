# Expected-move horizon grammar: #1202 item 2

Base: `0f03615e86ed63f00ad9b294c7a5c909bad7b70a`.
Canonical operation: `terminal-vol-horizon-grammar-20261104-c2`.
This is a review candidate, not a merge, deployment or production claim.

## Bounded change

The computed one-weekday horizon now says **1 trading day** in English.
All other horizons retain **trading days**. Chinese copy is unchanged.
No date arithmetic, producer clock, default, source data, layout or confidence claim changes.
The already merged weekday-horizon repair is preserved.

Ownership release: [#1202 comment](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/1202#issuecomment-6586324270).
This adopts the earlier source-only proposal through an isolated registered workspace.
No source/layout file owned by adjacent D08B or Options workflow work is modified.

## Executed checks

- Actual component baseline: 3 pass / 1 fail; only English n=1 fails.
- Candidate: 99/99 pass in six native suites, including the genuine recaptured failure-packet evidence gate. No deselections.
- Scoped ESLint: exit 0.
- Existing dark W3 + AC40 browser packets: 12/12 pass.
- Existing light Shared Shell AC40 browser packet: 6/6 pass.
- Existing standalone volatility failure capture: all 48 states/language/viewport crops succeed.
- Focused real Options mount: 4/4 pass per theme, EN/ZH × 1/2 weekdays.
  Each case checks exact dated copy, estimate, source clock, confidence disclosure and move-section overflow at 1440×900, 820×1180 and 390×844.
- Focused browser evidence: 24 screenshots across both themes.
- `verify-evidence.py`: verifies the four actual packets (108 PNGs), all recorded source/crop hashes, focused PNG provenance and unchanged historical EVIDENCE.json.
- Independent read-only source review: no correctness finding. See REVIEW.md.

## Recapture provenance

All four required packets were genuinely regenerated from this candidate using their existing capture owners:
`options-r1-w3`, `options-ac40-tenor-asof`, `options-ac40-tenor-asof-light`, `vol-load-failure`.
Their new EVIDENCE.yml files pin candidate layout bytes and actual PNGs.
Historical EVIDENCE.json files are unchanged.

The W3 packet also regenerates unchanged-source Flow and EOD controls. Crop bytes and
grown heights are not stable between captures. These are full-packet control recaptures,
not unrelated source changes. The current master volTenorComparison hash is refreshed
in manifests without modifying that source file. No hash-only restamp was used.

Initial browser setup failed before any tests/crops because a reused node_modules symlink
was outside Turbopack's project root. The isolated workspace then received an APFS clone
of the already installed runtime; no dependency install or product/config edit was needed.
The original failed log is retained. All successful runs used the isolated runtime.

Logs show the host's local wall time; they are not UTC timestamps.
All fixtures are synthetic, not provider or live-market evidence.

## Reproduce

From terminal/:
- `node_modules/.bin/vitest run lib/__tests__/volCompareHorizonGrammar.test.tsx lib/__tests__/volCompareTenorAsofClock.test.tsx lib/__tests__/volComparePanel.test.tsx lib/__tests__/volCompareWiring.test.tsx lib/__tests__/volTenorComparison.test.ts lib/__tests__/volLoadFailureEvidence.test.ts --no-cache`
- `VOL_HORIZON_GRAMMAR_CROPS=1 TERMINAL_E2E_PORT=39741 TERMINAL_VISUAL_EVIDENCE_OPERATION=terminal-vol-horizon-grammar-20261104-c2 node_modules/.bin/playwright test e2e/vol-horizon-grammar.spec.ts --project=desktop --workers=1`
- Repeat on a fresh port with `MMX_SHARED_SHELL=1` for the light Shared Shell run.
- `python3 docs/verification/vol-horizon-grammar-20261104/verify-evidence.py`

Existing capture commands and synthetic-source declarations are in each packet's EVIDENCE.yml.

The previous failure-packet manifest, including its historical drift/restamp commentary, is retained verbatim as previous-vol-load-failure-EVIDENCE.yml. The active packet is a fresh capture rather than an extension of those historical restamp claims. Generated .last-run.json run metadata remains preserved with the successful capture outputs.
