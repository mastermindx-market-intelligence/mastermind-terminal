# News reading sidebar — fixture evidence (sol/web-terminal-news-sidebar-20261018-c4)

Captured by `terminal/e2e/news-sidebar-reading.spec.ts` against a routed local
fixture feed at the commit pinned in `EVIDENCE.yml` (`capturedAtHead`). These are
local test-fixture screenshots, **not** production live-data proof. Hashes of every
crop and of the layout files the panel depends on are in `EVIDENCE.yml`.

## What the cells show

- `desktop|tablet|mobile-{en,zh}-{dark,light}.png` — the 12 theme/language/viewport
  cells (1440×900, 820×1180, 390×844 × EN/ZH × dark/light): compact header (News +
  ticker + live indicator + source select), date separators, readable
  source/time/headline/teaser rows.
- `source-filtered-desktop-en-dark.png` — the source select narrowed to one publisher.
- `grouped-open-desktop-en-dark.png` — a grouped story expanded through
  `/api/news/stories/:id` with its +/- disclosure open.
- `full-height-scrolling-desktop-en-dark.png` — the board filling the rail body's
  remaining height with the list scrolling inside (`scrollHeight > clientHeight`).
- `unavailable-{desktop,mobile}-{en,zh}-dark.png` — a failed snapshot renders the
  unavailable status with no rows and no stale chrome.

## Notes a reviewer needs

- Dark and light cells are byte-identical (same SHA256 per pair). The Terminal
  shell is dark-only at this commit (`app/layout.tsx` renders `data-theme="dark"`;
  `:root` carries the only token set), so forcing `data-theme="light"` restyles
  nothing in the panel. The pairs pin that the theme attribute does not corrupt
  the reading surface.
- The live indicator (role=img, localized "Live"/实时) is present in every live
  cell but is **not visible in the crops**: the redesign removed the `.liveDot`
  rule from `TickerNewsPanel.module.css` while `NewsLiveDot` still renders
  `styles.liveDot`, so the dot paints unstyled (computed background
  `rgba(0, 0, 0, 0)`). Reproducer: `npx vitest run lib/__tests__/newsFlowTokens.test.ts`
  and E1 in `e2e/news-flow-responsive.spec.ts` (both red at this commit). This is
  reported to the parent as a product defect; the fix belongs in production CSS,
  not in these tests.
- Fixture story times are pinned to `America/New_York` so date separators do not
  depend on the host zone.
