# News Intelligence rail — R2/R3 evidence-ladder crops (R2 §7 matrix + R3 §5 matrix)

Produced by `e2e/news-flow-responsive.spec.ts` › `test.describe("R2 evidence ladder")`
(R3 build lane, port 3124 run on `claude/news-r3-build`). Every crop is a
`panel.screenshot()` of the live rail at the project viewport, dark theme, taken
before the cell's assertion block. Fixture snapshot: six R2/R3 stories on NVDA
(`ev2_r2_agree`, `ev2_r2_differ`, `ev2_r2_press`, `ev2_r2_single`,
`ev2_r2_notcompared`, and the R3 §4 comparison-limited row `ev2_r3_limited`); the
`ev2_` prefix is required by the tree's story-id contract (`asStoryId`).

## R3 §5 evidence matrix (E1–E7)

| R3 cell | viewport | lang | crop |
|---|---|---|---|
| E1 | 1440 | en | `R2-desktop-en-collapsed.png` |
| E2 | 1440 | zh | `R2-desktop-zh-collapsed.png` |
| E3 | 1440 | en | `R2-desktop-en-expanded.png` |
| E4 | 820 | en | `R2-tablet-en-collapsed.png` (wrap cell pins the press row's ladder) |
| E5 | 390 | zh | `R2-mobile-zh-collapsed.png` |
| E6 | 1440 | en | `R3-desktop-en-limited.png` |
| E7 | 1440 | en | `R2-desktop-en-restricted.png` + `R2-desktop-en-unavailable.png` |

The `R2-<project>-en-static.png` crops are screenshots of the static 1-report ROW element, not the whole panel at scroll 0, so they differ from the `-collapsed.png` panel crops at every width.

- E1 — collapsed agree row: 15px/21px headline, ladder sentence underlined, no chip
  border, no row hover fill, no NEXT CHECK on the agree row under live.
- E2 — the same row in ZH; the meta row may wrap the topic, never the time.
- E3 — expanded differ row: hairline-topped evidence block, clock label/value grid,
  group note, member grid, "Show 1 more report", NEXT CHECK label/line, Mark
  reviewed last on its own line.
- E4 — tablet press row: the ladder wraps at a step boundary, nothing clipped,
  "– Not compared" fully visible (the `wrap cell (mobile)` test pins the same
  no-clip condition by geometry at 390 px).
- E5 — mobile ZH agree row: 15/21 headline, ladder ≥40px, Mark reviewed ≥44px and
  on its own line.
- E6 — limited row: "Reporting › 2 outlets › 2 reports › ~ Comparison limited" with
  the `~ Comparison limited` step in `--text-2`. The frozen lexicon's rule 2 gives a
  `comparison_limited` row `next.limited` in any snapshot state, so the line is
  present in the crop (see the R3 build return, DEVIATIONS).
- E7 — restricted (no Retry) and unavailable (Retry) states unchanged.
- Underline placement (R3 repair 1): the persistent underline is carried by the
  ladder steps only (`.ladder .step`), never the `›` separators; hover recolors
  the same step underlines.
- Light theme: the news flow ships dark only (D-W1, lib/__tests__/newsFlowTokens.test.ts);
  the light `--warn` value #7d5922 in the R3 spec is specimen documentation and is
  not shipped in the panel CSS.

## R2 §7 cells (still served by the same crops)

| §7 cell | viewport | lang | crop |
|---|---|---|---|
| R1 | 1440 | en | `R2-desktop-en-collapsed.png` |
| R2 | 1440 | zh | `R2-desktop-zh-collapsed.png` |
| R3 | 1440 | en | `R2-desktop-en-expanded.png` |
| R4 | 820 (tablet project; inside the max-width:860px branch) | en | `R2-tablet-en-collapsed.png` |
| R5 | 390 | zh | `R2-mobile-zh-collapsed.png` |
| R6 | 1440 | en | `R2-desktop-en-static.png` |
| R7 | 1440 | en | `R2-desktop-en-restricted.png` + `R2-desktop-en-unavailable.png` |

R3 geometry supersedes the R2 pins: the headline is 15px/21px at ALL projects and
the ladder floor is 24px fine-pointer / ≥40px at max-width:860px or coarse pointer,
measured with `>=`.

## Extra cells beyond the two matrices

`R2-{desktop,tablet,mobile}-zh-collapsed.png`, `R2-{desktop,tablet,mobile}-{en,zh}-expanded.png`,
`R2-{tablet,mobile}-en-static.png`, `R2-{desktop,tablet,mobile}-en-catchup.png`
(catching-up snapshot: `ev2_r2_press` keeps `next.announcement`, `ev2_r2_notcompared`
earns `next.catchup`), `R2-desktop-zh-restricted.png` / `R2-desktop-zh-unavailable.png`,
`R3-{desktop,tablet,mobile}-{en,zh}-limited.png` (R3 §4 sixth fixture: ladder text
pinned per lang, `data-agreement="comparison_limited"`, `next.limited`), and the
`wrap cell (mobile)` run (no crop; pins `scrollWidth <= clientWidth` and the ladder's
right edge ≤ panel right − 11 at 390 px). Every lang-loop cell of the describe block
runs in all three projects; restricted/unavailable are desktop-only by design.
