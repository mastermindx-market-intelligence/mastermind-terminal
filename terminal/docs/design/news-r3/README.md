# News rail R3 — design exploration (boards, crops, proposals)

Three mechanism-distinct design directions for the ticker News rail, exploring the next revision
of the shipped R2 rail (BASE `32b6ba43704a5a87db2582b2b9617271382358b5` = origin/master with R2
landed). Nothing here ships; it is a design artifact for the seat to judge, import into the
Paper design file, and freeze as the R3 spec.

## Contents

| path | what |
|---|---|
| `boards/A.html` | Direction A — **Typographic ledger**: type carries hierarchy; the ladder is an unboxed sentence; the evidence view is a two-column clock table. |
| `boards/B.html` | Direction B — **Instrument strip**: flight-strip rows; fixed kind column (left), agreement glyph + label column (right); monospace clocks; evidence toggle as a strip footer. |
| `boards/C.html` | Direction C — **Editorial folio**: serif display headlines; the ladder as an italic running-footer line; hanging-indent member list; one hairline between stories. |
| `crops/` | 36 full-page PNGs: `<board>-{desktop,tablet,mobile}-{en,zh}-{dark,light}.png` @2x. |
| `render.mjs` | The renderer (see below). |
| `PROPOSALS.md` | Per direction: thesis, tokens (both themes), type pairing + scale, spacing scale, numbered delta vs R2 spec §3, states covered, computed contrast table, implementation cost, risks, the removed accessory, the avoided default. Plus the shared lexicon-fidelity table with source lines. |
| `SELF_CRITIQUE.md` | 20-line adversarial read. |

## Boards

Each board is one self-contained HTML file: inline CSS/JS, system font stacks only (grotesque /
`ui-monospace` / Georgia+Noto Serif CJK), no network requests, no images, no webfonts, no
animation (reduced-motion is trivially respected). `<html data-theme="dark|light">` and
`<html lang="en|zh">` carry theme and language; both string sets are in every file and CSS
picks one. For quick manual viewing: `open boards/A.html` or pass
`boards/A.html?lang=zh&theme=light`.

Every board renders the five fixture story shapes (agreeing 3-outlet, differing 2-outlet
expanded with its evidence view, press release with 2 items, single-report static, not-compared
2-outlet), the NEXT CHECK lines, and the `restricted` / `unavailable` (+Retry) / `degraded`
states beside the rail. All visible strings are verbatim from the shipped lexicon/COPY — the
source-line table is in PROPOSALS.md. Story titles stay EN wire copy in the ZH boards, matching
shipped feed behavior (chrome flips, third-party content does not).

## Re-render

```bash
cd terminal
node docs/design/news-r3/render.mjs
```

Writes 36 PNGs to `docs/design/news-r3/crops/` (desktop 1440×900, tablet 834×1194, mobile
390×844; en/zh × dark/light; full-page, deviceScaleFactor 2, `reducedMotion: reduce`). Boards
load by `file://` URL — no server needed. Playwright resolves from the normal module paths,
then `$PLAYWRIGHT_DIR`, then the npx cache; browsers: `npx playwright install chromium`.

## Receipts (as commissioned)

- Product-law grep (`sentiment|impact|confidence|rank|score|signal|bullish|bearish|buy|sell`,
  case-insensitive) over `boards/`: **0**.
- Accent-stripe grep (`border-left|border-right|border-inline-start` outside an explicit `:0`)
  over `boards/*.html`: **0**.
- Lexicon receipt: every commissioned string present in every board in both languages (count
  table in the return file).
- Contrast: computed table in PROPOSALS.md — body ≥4.5:1, labels ≥3:1, both themes.
