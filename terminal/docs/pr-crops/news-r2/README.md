# News Intelligence rail — R2 evidence-ladder crops (spec §7 matrix)

Produced by `e2e/news-flow-responsive.spec.ts` › `test.describe("R2 evidence ladder")`
(commit run on BASE `32b6ba43704a5a87db2582b2b9617271382358b5` + this lane's spec
extension). Every crop is a `panel.screenshot()` of the live rail at the project
viewport, dark theme, taken before the cell's assertion block. Fixture snapshot:
five R2 stories on NVDA (`ev2_r2_agree`, `ev2_r2_differ`, `ev2_r2_press`,
`ev2_r2_single`, `ev2_r2_notcompared`); the `ev2_` prefix is required by the
tree's story-id contract (`asStoryId`).

## Spec §7 cells

| §7 cell | viewport | lang | crop |
|---|---|---|---|
| R1 | 1440 | en | `R2-desktop-en-collapsed.png` |
| R2 | 1440 | zh | `R2-desktop-zh-collapsed.png` |
| R3 | 1440 | en | `R2-desktop-en-expanded.png` |
| R4 | 768 | en | `R2-tablet-en-collapsed.png` |
| R5 | 390 | zh | `R2-mobile-zh-collapsed.png` |
| R6 | 1440 | en | `R2-desktop-en-static.png` |
| R7 | 1440 | en | `R2-desktop-en-restricted.png` + `R2-desktop-en-unavailable.png` |

- R1 — collapsed row: meta with topic slot ("Guidance"), 13px/18px headline, 24px
  ladder chip "Reporting › 3 outlets › 3 reports › Reports agree", NEXT CHECK lines
  on the differ/announcement rows, Mark reviewed.
- R2 — the same row in ZH ("业绩指引", chip "媒体报道 › 3 家媒体 › 3 条报道 › 报道一致").
- R3 — expanded evidence view: Published/Updated/Received clocks, group note, two
  member reports, "Show 1 more report", NEXT CHECK below (on `ev2_r2_differ`),
  Mark reviewed last.
- R4 — tablet: ladder chip ≥40px tall, wrapped cleanly.
- R5 — mobile ZH: 15px/20px headline, ≥40px chip, 44px Mark reviewed target.
- R6 — 1-report row: static chain "Reporting › 1 outlet › 1 report", no NEXT CHECK,
  not a button.
- R7 — restricted EmptyState (`此账户或新闻源暂无新闻访问权限。`, no Retry) and
  unavailable EmptyState (重试 button, kept per #1105).

## Extra cells beyond the matrix

`R2-{desktop,tablet,mobile}-zh-collapsed.png`, `R2-{desktop,tablet,mobile}-{en,zh}-expanded.png`,
`R2-{tablet,mobile}-en-static.png`, `R2-{desktop,tablet,mobile}-en-catchup.png`
(catching-up snapshot: `ev2_r2_press` keeps `next.announcement`, `ev2_r2_notcompared`
earns `next.catchup`), and `R2-desktop-zh-restricted.png` / `R2-desktop-zh-unavailable.png`.
Every cell of the describe block runs in all three projects; restricted/unavailable
are desktop-only by design.
