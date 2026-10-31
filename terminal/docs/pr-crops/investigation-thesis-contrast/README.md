# Retained Thesis metadata contrast

The 13px Catalysts, Falsifiers, Risks and Version recorded labels rendered at
3.7015:1 on the dark card (`#717a8e` on `#1e222a`). The original real-browser
contrast assertion failed. The shared Thesis version renderer now gives those
labels the existing secondary-text token, scoped to its metadata list. The
picker and retained reader share this presentation; other workspace labels and
global tokens are unchanged.

Checks on the working tree based on `ccd51f9c8`:

- EN/ZH at 1440×900, 820×1180 and 390×844: six cases, each covering explicit Light,
  Auto at local noon and Auto at 22:00. All pass, with 6.7274:1 in light and
  6.2937:1 in dark. Colors come from computed styles, including CSS `color(srgb)`.
- Each case seeds an isolated Thesis fixture owner with v1 and newer v2, then
  opens the retained v1 through Saved Research. The complete owner record and
  manifest remain exact; no Thesis, Investigation or authentication writes occur
  during observation. Timestamp and pinned content remain v1 in all modes.
- The existing picker/save/read/missing-reference journey passes six EN/ZH
  desktop/tablet/mobile cases with contrast assertions on both consumers.
- Five component tests and TypeScript pass. Lint has seven errors/two warnings,
  all identical to the parent; zero added diagnostics. Whitespace check passes.

Twelve unique crops were visually reviewed. The six explicit-Light crops are
byte-identical to their Auto-day counterparts and reused. `results.json` records
the tested source hashes, measured colors and exact owner/version assertions;
`original-dark-contrast.json` retains the original failure measurements.

The first color-only patch attempt did not attach the new class, so its six
failures are retained outside Git. The completed candidate initially passed four
theme cases; two ZH cases met transient duplicate roots before the saved record
settled. Those two alone passed after the harness required the saved-question
heading and exactly one root. No product lifecycle repair is claimed.

This is actual mounted local-browser evidence with synthetic account metadata,
an isolated Thesis fixture owner, and Investigation transport fixtures. Auto uses
the browser clock at a declared local time; neither HTML nor workspace theme
attributes are forced. It does not establish standalone Thesis/Screener theme
support, native text zoom, full-page accessibility, real principals or production.
The old image corpus is unchanged. All release/schema/live holds remain.

The normal-text threshold is from [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
