# News rail R3 — three mechanism-distinct directions

RUN news-r3-design · BASE `32b6ba43704a5a87db2582b2b9617271382358b5` (origin/master, the shipped
R2 rail) · 2026-10-22. Boards: `boards/A.html`, `boards/B.html`, `boards/C.html`; crops:
`crops/<A|B|C>-{desktop,tablet,mobile}-{en,zh}-{dark,light}.png` (36, full-page, @2x).

Every visible string on every board is copied verbatim from the shipped lexicon and COPY
(`lib/newsLadderLex.ts`, `components/news/TickerNewsPanel.tsx` `COPY`, `lib/newsCatchupLex.ts`,
`lib/newsFlowLex.ts`, `lib/newsEditorialLex.ts`, display helpers in `lib/newsDisplay.ts`). Story
titles and teasers stay EN wire copy in ZH boards — that is the shipped feed behavior (chrome
flips, third-party content does not). The five fixture rows are the spec §7 shapes:

| row | shape | ladder reads (EN) | NEXT CHECK |
|---|---|---|---|
| R1 | agreeing story, 3 outlets / 3 reports | Reporting › 3 outlets › 3 reports › = Reports agree | — (none under the rules) |
| R2 | differing story, 2 outlets / 3 reports, **expanded** | Reporting › 2 outlets › 3 reports › ≠ Reports differ | Compare outlets before relying on one report |
| R3 | press release, 1 outlet / 2 items | Company announcement › 1 outlet › 2 reports › – Not compared | Read the company announcement first |
| R4 | single-report story | Reporting › 1 outlet › 1 report (static) | never (1-report row) |
| R5 | not-compared reporting story, 2 outlets / 2 reports | Reporting › 2 outlets › 2 reports › – Not compared | — (live snapshot; rule 4 needs catching_up/degraded) |

R2 carries the one expanded evidence view (clocks · group note · 2 members · "Show 1 more
report") and its NEXT CHECK sits after the evidence view, before Mark reviewed, per spec §3.7.

**Shared token base (all three directions).** Surfaces and ink are the shared-shell values the
rail actually renders under today (`components/chrome/shared-shell/shared-shell.css`), so a
direction changes anatomy and type, not the house palette. One deliberate token delta: light
`--warn` is `#7d5922` (the Lab light value) instead of dark's `#e8a33d`, which fails contrast on
white. `--flow-muted` is the shipped `color-mix(in srgb, var(--muted) 75%, var(--text-2))`,
resolved: **`#959dab`** dark, **`#647185`** light.

| surface | dark | light |
|---|---|---|
| `--bg` (page) | `#0f1115` | `#f7f8fa` |
| `--panel` (rail board) | `#181b21` | `#ffffff` |
| `--panel-2` (quiet fill) | `#1e222a` | `#eef1f6` |
| `--panel-3` | `#282e38` | `#e7ecf3` |
| `--line` / `--line-2` / `--line-3` | `#2b323d` / `#222833` / `#3a4150` | `#e2e5eb` / `#eceef2` / `#cbd1dc` |
| `--text` | `#d7dce3` | `#202632` |
| `--text-2` | `#b2bbc9` | `#546174` |
| `--muted` | `#8b93a1` | `#69768a` |
| `--text-dim` (separators only) | `#697587` | `#8c96a6` |
| `--brand` / `--brand-2` | `#316be8` / `#7aa7e0` | `#245bda` / `#3168df` |
| `--warn` (differ ink, labeled) | `#e8a33d` | `#7d5922` |
| `--flow-muted` (resolved mix) | `#959dab` | `#647185` |

**Computed contrast (WCAG 2.1, script output verbatim — `~/lanes/tmp/news-r3-design/contrast.mjs`; every
direction draws its ink from this one table).**

```text
=== DARK — flow-muted resolves to #959DAB (color-mix(in srgb, muted 75%, text-2)) ===
#d7dce3 on #181b21   12.51 : 1   PASS ≥4.5   body text / headline   (--text on panel)
#b2bbc9 on #181b21    8.91 : 1   PASS ≥4.5   body copy, teaser      (--text-2 on panel)
#959DAB on #181b21    6.31 : 1   PASS ≥4.5   meta, labels, clocks   (--flow-muted on panel)
#959DAB on #181b21    6.31 : 1   PASS ≥3   micro labels ≥3:1      (--flow-muted on panel)
#7aa7e0 on #181b21    6.92 : 1   PASS ≥4.5   links, show-more       (--brand-2 on panel)
#e8a33d on #181b21    8.00 : 1   PASS ≥3   differ state ink       (--warn on panel)
#697587 on #181b21    3.69 : 1   decorative   separators › · ·       (--text-dim on panel, decorative)
#b2bbc9 on #1e222a    8.23 : 1   PASS ≥4.5   member title           (--text-2 on evidence fill)
#959DAB on #1e222a    5.84 : 1   PASS ≥3   labels on hover fill   (--flow-muted on panel-2)
#959DAB on #0f1115    6.92 : 1   PASS ≥3   caption on page bg     (--flow-muted on bg)

=== LIGHT — flow-muted resolves to #647185 (color-mix(in srgb, muted 75%, text-2)) ===
#202632 on #ffffff   15.17 : 1   PASS ≥4.5   body text / headline   (--text on panel)
#546174 on #ffffff    6.29 : 1   PASS ≥4.5   body copy, teaser      (--text-2 on panel)
#647185 on #ffffff    4.95 : 1   PASS ≥4.5   meta, labels, clocks   (--flow-muted on panel)
#647185 on #ffffff    4.95 : 1   PASS ≥3   micro labels ≥3:1      (--flow-muted on panel)
#3168df on #ffffff    5.03 : 1   PASS ≥4.5   links, show-more       (--brand-2 on panel)
#7d5922 on #ffffff    6.32 : 1   PASS ≥3   differ state ink       (--warn on panel)
#8c96a6 on #ffffff    2.99 : 1   decorative   separators › · ·       (--text-dim on panel, decorative)
#546174 on #eef1f6    5.55 : 1   PASS ≥4.5   member title           (--text-2 on evidence fill)
#647185 on #eef1f6    4.37 : 1   PASS ≥3   labels on hover fill   (--flow-muted on panel-2)
#647185 on #f7f8fa    4.66 : 1   PASS ≥3   caption on page bg     (--flow-muted on bg)
```

Body ink is ≥4.5:1 in both themes; every label ink is ≥3:1 (light hover-fill labels 4.37, the
tightest pair, still clear). `--text-dim` colours only `aria-hidden` decorative separators
(`›`, `·`) — pure decoration, exempt from text contrast; the paired text always sits next to it
at ≥4.5. State is never colour-alone: every `≠`/`–`/`=`/`~` glyph renders with its verbatim
lexicon label, and `New`/`Updated`/`Reviewed` tags are words, not dots. Motion: **none** in any
board — nothing to gate behind `prefers-reduced-motion`. Focus: every interactive element keeps
the shipped 2px `--brand-2` outline (offset 2 outside, or −2 inside B's strips); one focused
ladder is drawn per board (`.demo-focus` on R2). Touch: ladders, Mark reviewed, show-more and
Retry are ≥44px at mobile/coarse. Doctrine: no container has an accent edge on any side —
separation is surface, whitespace, type and even hairlines only (grep receipt: 0).

Lexicon fidelity receipt (source lines, quoted from the shipped files; each string appears in
every board in both languages — counts table further down):

| string (EN / ZH) | source |
|---|---|
| `Show the reports behind this story` / `查看这条新闻背后的报道` | `lib/newsLadderLex.ts:32` `ladder.open` |
| `Hide the reports` / `收起报道` | `lib/newsLadderLex.ts:33` `ladder.close` |
| `Company announcement` / `公司公告` | `lib/newsLadderLex.ts:17` `kind.press_release` |
| `Reporting` / `媒体报道` | `lib/newsLadderLex.ts:18` `kind.reporting` |
| `1 outlet` / `1 家媒体`; `{k} outlets` / `{k} 家媒体` | `lib/newsLadderLex.ts:20-21` `outlets.*` |
| `1 report` / `1 条报道`; `{n} reports` / `{n} 条报道` | `lib/newsLadderLex.ts:23-24` `reports.*` |
| `Reports agree` / `报道一致`; `Reports differ` / `报道有出入`; `Comparison limited` / `比对受限`; `Not compared` / `未比对` | `lib/newsLadderLex.ts:27-30` `agree.*` |
| `Published`/`发布`, `Updated`/`更新`, `Received`/`接收` | `lib/newsLadderLex.ts:35-37` `clock.*` |
| `Show {n} more {n?report\|reports}` / `再显示 {n} 条报道` | `lib/newsLadderLex.ts:38` `more.reports` |
| `Next check` / `下一步核对` | `lib/newsLadderLex.ts:41` `next.label` |
| `Compare outlets before relying on one report` / `依赖单一报道前先比对各媒体` | `lib/newsLadderLex.ts:42` `next.differ` |
| `Read the company announcement first` / `先读公司公告` | `lib/newsLadderLex.ts:44` `next.announcement` |
| glyphs `= ≠ ~ –` | `lib/newsLadderLex.ts:109-114` `AGREEMENT_GLYPH` |
| `News access is unavailable for this account or feed.` / `此账户或新闻源暂无新闻访问权限。` | `TickerNewsPanel.tsx:49,64` `COPY.restricted` |
| `News is temporarily unavailable.` / `新闻暂时不可用。` | `TickerNewsPanel.tsx:50,65` `COPY.unavailable` |
| `Retry` / `重试` | `TickerNewsPanel.tsx:51,66` `COPY.retry` |
| `Live updates are degraded. Showing the latest verified read.` / `实时更新降级，显示最近一次已核实读取。` | `TickerNewsPanel.tsx:52,67` `COPY.degraded` |
| `News` / `新闻`; `{n} reports` aria | `TickerNewsPanel.tsx:44,59` `COPY.title`; `:54,69` `COPY.reports` |
| `New`/`新`, `Updated`/`更新`, `Reviewed`/`已读`, `All`/`全部` | `lib/newsCatchupLex.ts:12-15` |
| `Mark reviewed` / `标为已读`; `Mark shown as reviewed` / `将显示的标为已读` | `lib/newsCatchupLex.ts:19,22` |
| `2 new · 1 updated` / `2 条新 · 1 条更新` | `lib/newsCatchupLex.ts:23` `ncSummary` shape |
| `1 more report since your review` / `阅读后新增 1 条报道` | `lib/newsCatchupLex.ts:18` `ncMoreReport` |
| `Live` / `实时` | `lib/newsFlowLex.ts:21` `live.label` |
| group note (both) | `lib/newsFlowLex.ts:67-69` `row.groupNote` |
| `News & announcements` / `新闻与公告`; curated description (both) | `lib/newsEditorialLex.ts` `view.news`, `description.news` |
| publisher labels `Reuters`, `Bloomberg`, `Business Wire`, `CNBC`, `Financial Times` | `lib/newsDisplay.ts:10-17` `PUBLISHER_LABELS` |
| times `02:26 PM` / `14:26` | `lib/newsDisplay.ts:38-46` `formatRailTime` (verified: `toLocaleTimeString` en-US / zh-CN, hour+minute 2-digit) |

---

## Direction A — Typographic ledger

**Thesis.** The row is a typeset ledger entry: hierarchy is carried entirely by type scale,
weight, width and tabular numerals — the ladder is one unboxed sentence and the evidence view is
a two-column clock table; there is not a single box inside the rail.

**Type pairing** (system stacks only): display+body = the house grotesque
(`-apple-system, …, "Noto Sans CJK SC"`, i.e. `--font-ui`); numerals = the same face with
`font-variant-numeric: tabular-nums` (the shipped `--font-num` discipline). **Scale (px):** meta
9.5 caps `.09em` · headline 15/21 w680 `-.008em` · teaser 12.5/18.5 w450 · ladder sentence
12/17 w600 (agreement step w700) · clock labels 9.5 caps · clock values 12/14 tabular · members
12/16 · group note 11/15.5 · NEXT CHECK label 9.5 caps `.12em`, line 12.5/17 w600 · Mark
reviewed 10.5. **Spacing scale:** 4px base — row 15/16/14, meta→headline 7, headline→teaser 6,
teaser→ladder 9, ladder→evidence 11, evidence rows 9, NEXT CHECK 10 above.

**Ink roles (5).** `ledger-text` `--text` (headline, `=` agree step) · `ledger-body` `--text-2`
(teaser, counts, clock values, member titles, NEXT CHECK line) · `ledger-label` `--flow-muted`
(meta, clock labels, static ladder, NEXT CHECK label) · `ledger-accent` `--brand-2` (links,
show-more, focus) · `ledger-state` `--warn` (the `≠` differ step, glyph+label together).

**Delta vs R2 anatomy (spec §3):**
1. meta — unchanged content (tag · source · topic · time); time now justifies to the right
   margin as the ledger's amount column; tags lose the pill box and set as small caps words.
2. headline — same size (13/18 fine-pointer per spec; 15/20 coarse)… raised one step to 15/21
   at ALL widths: in a ledger the entry line is the loudest type after the numerals column.
3. teaser — keeps the 2-line clamp.
4. review change — unchanged string, set as a quiet ledger annotation line.
5. ladder — the chip's border, padding and 24px box are REMOVED; the button is the sentence
   itself (hover: underline; focus: the full 2px outline at offset 3). Static 1-report chain
   identical, muted. Separators `›` stay `--text-dim`; the agreement step is the only weighted
   ink on the line.
6. evidence view — the `.sourceList` box becomes an open block under one hairline: the clock
   row becomes a true two-column table (label column left, tabular values right), group note
   under it, members as a 88px-publisher grid, "Show n more" as underlined text.
7. NEXT CHECK — label-above-line stack, whitespace only, no fill; unchanged placement rules.
8. Mark reviewed — unchanged control, quiet 1px border, 26px (44px coarse).

**States covered:** all five fixture rows; expanded evidence on R2; NEXT CHECK on R2 + R3;
restricted, unavailable (+Retry 44px), degraded note beside the rail.

**Implementation cost.** `TickerNewsPanel.tsx`: clocks row → label/value pairs (~10 lines),
tag/ladder className changes (~8); `TickerNewsPanel.module.css`: rewrite `.meta .tag .ladder
.ladderStatic .evidence .clocks .nextCheck` blocks (~55–70 of the file's 67 lines); `fin.css`:
unchanged. Total ≈ 85 lines, one file pair.

**Risks.** (1) Without the chip box, affordance rests on hover/focus alone — first-session
users may not see the sentence as a button; mitigate with the aria-label and a persistent
underline on hover only if testing demands it. (2) Right-justified time column wraps under ZH
publisher names at 320px — needs the coarse wrap check. (3) Weight-based agreement emphasis is
quieter than R2's coloured chip; the differ state leans on `--warn` ink + label.

**Chanel pass — the one accessory removed:** the row hover fill. A ledger does not change paper
because the eye passes over it; rows are separated by hairlines and type alone (hover survives
only on links and the ladder sentence).

**Not the generic default.** The avoided default is exactly the shipped R2 row and its genre:
meta chips + a bordered "chip" button + a boxed detail card — the SaaS-admin list row. A keeps
every string of that anatomy and deletes its containers.

---

## Direction B — Instrument strip

**Thesis.** The rail reads like a flight-strip board: each story is one strip with a fixed left
column for the content kind, a fixed right column for the agreement glyph over its small-caps
label, monospace clocks, and the evidence toggle as a full-width strip footer — dense, tabular,
scannable top-to-bottom.

**Type pairing:** body/meta = the house grotesque (`--font-ui`); clocks, counts, times, summary
= the monospace utility stack (`ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", …`
— the `--font-code` family, used only for character-cell content here: clocks and counts).
**Scale (px):** kind label 8.5 caps `.08em` · meta 9 caps · time 9.5 mono · headline 13/17.5
w650 (15/20 coarse) · teaser 10.5/14.5 clamp 2 · agreement glyph 15 mono, label 7.5 caps ·
strip footer 10.5 mono · clock labels 9 mono caps · clock values 10.5/13 mono · members 10.5/14
· NEXT CHECK label 8 mono caps, line 10.5/14. **Spacing:** 8px grid — strips in a 10px-padded
column with 6px gaps; strip padding 9/10; kind slot 10/6/10/9; footer 5/10; evidence 9/10.

**Ink roles (5).** `strip-text` `--text` (headline) · `strip-body` `--text-2` (teaser, member
titles, footer counts, NEXT CHECK line) · `strip-label` `--flow-muted` (kind, meta, clock
labels, static footer, uncompared cell) · `strip-accent` `--brand-2` (links, show-more, focus,
New tag) · `strip-state` `--warn` (differ cell + Updated tag). Surfaces: strip = `--panel`,
kind slot = 62% `--panel-2` fill, footer/evidence = 40–55% `--panel-2` fill — neutral surface
hierarchy, no edge ink anywhere.

**Delta vs R2 anatomy (spec §3):**
1. meta — same content; time moves to monospace and right-aligns inside the body column.
2. headline — 13/17.5 fine-pointer (spec size), tighter to serve the strip's density.
3. teaser — keeps the 2-line clamp.
4. review change — unchanged string, one quiet line under the teaser.
5. ladder — DECOMPOSED into the strip: kind is the left column label; the footer button carries
   `outlets › reports` (the two count steps, `›` separators); the agreement step moves to the
   right column as glyph (15px) over its verbatim small-caps label — a glyph is never rendered
   without its label. The footer button keeps `aria-label` = `ladder.open/close`, so the toggle
   keeps one accessible name; the 1-report strip renders a static footer, empty right cell.
6. evidence view — opens inside the strip as a full-width band: a mono clock table (label
   column, tabular values), group note, members as an 82px publisher grid, "Show n more".
7. NEXT CHECK — a full-width sub-strip under the footer on a quiet `--panel-3` fill (fill, not
   an edge), mono `NEXT CHECK` label + line; unchanged placement rules.
8. Mark reviewed — unchanged control, docked to the strip's bottom-left, 24px (44px coarse).

**States covered:** all five rows; expanded evidence on R2 (its footer button is the drawn
focus state, `aria-expanded="true"`); NEXT CHECK on R2 + R3; restricted / unavailable (+Retry) /
degraded beside the rail.

**Implementation cost.** `TickerNewsPanel.tsx`: row article → strip grid (kind slot, body,
agreement slot, footer button, evidence/next bands) ≈ 55–70 lines restructured; module.css
≈ 100–120 lines; `fin.css` unchanged (the mono stack is declared on the panel root).
Total ≈ 170 lines, one file pair — the costliest direction.

**Risks.** (1) Three fixed columns eat ~128px of the 360px rail: ZH kind labels
(`公司公告`) fit, but the right column's EN small-caps label wraps to two lines at 7.5px —
readable but the smallest type in the product; must be height-checked against four-state
strings. (2) Decomposing the ladder weakens the R2 unit-test mapping (steps no longer all sit
inside the button's text content) — L2 tests would need a stated anatomy revision. (3) Mono at
small sizes is the coldest of the three; light theme needs the mono fallback checked on Windows.

**Chanel pass — the one accessory removed:** the hover fill on strips (shipped rows tint on
hover). A strip board signals the pointer with the footer button's own hover and the hairline
lifting one step (`--line-3`); the row itself never floods.

**Not the generic default.** The avoided default is the acid-accent "hacker terminal": near-black
panels, neon green/amber columns, uppercase everything, zebra rows. B keeps the tabular rhythm
but stays on the house slate/ink palette, keeps sentence-case body strings, and state lives in
labeled ink — not in glowing columns.

---

## Direction C — Editorial folio

**Thesis.** The rail reads like a printed news folio: serif display headlines at generous
measure, the ladder as an italic running-footer line, the evidence view as a hanging-indent
member list with publisher first — whitespace does the separating, one hairline between
stories, no rule or box anywhere inside the rail.

**Type pairing:** display+body = the system serif stack
(`Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", "Noto Serif CJK SC", …`);
utility (meta, clock labels, tags, controls) = the house grotesque `--font-ui` in caps. No
webfonts. **Scale (px):** masthead 19 serif · meta 9 caps `.12em` · headline 17/23.5 serif w600
· teaser 12.5/19 serif, clamp raised to 3 lines · change note 11 serif italic · ladder 12/17
serif italic (agreement w700) · clocks 9.5 caps with tabular values · group note 11.5/17 serif
italic · members 12.5/18 serif with 9.5-caps publisher · NEXT CHECK label 9 caps `.14em`, line
13/18.5 serif. **Spacing:** 12px base — row 17/18/15, running head→headline 8, headline→teaser
8, teaser→footer ladder 11, evidence 12 above with 9 between entries, NEXT CHECK 12 above.
ZH renders in Noto Serif CJK SC (宋体) — the editorial register survives translation.

**Ink roles (5).** `folio-display` `--text` (headlines, masthead, `=` agree step) ·
`folio-body` `--text-2` (teaser, member titles, counts, NEXT CHECK line) · `folio-label`
`--flow-muted` (running head, ladder at rest, clock labels, group note) · `folio-accent`
`--brand-2` (links, show-more, focus) · `folio-state` `--warn` (differ step) · plus the neutral
`folio-rule` `--line-2` used exactly once per pair of stories.

**Delta vs R2 anatomy (spec §3):**
1. meta — same content as a folio running head; time right-aligns at the margin.
2. headline — the direction's signature: serif 17/23.5 (up from 13/18), measure ~34 characters,
   optical left alignment (−1px).
3. teaser — serif, clamp raised 2 → 3 lines: a folio gives the standfirst room.
4. review change — unchanged string, serif italic annotation.
5. ladder — the chip becomes the running footer line: italic serif, `›` separators, agreement
   step weighted and state-inked; static 1-report chain identical in muted ink. Focus keeps the
   full outline; hover underlines.
6. evidence view — NO top rule, no box: clocks run as one caps line with `·` separators (the
   shipped R2 clock row, re-set), group note in italic, then members as a hanging-indent list —
   publisher first in caps outdented by an 86px indent, title wrapping under the indent.
7. NEXT CHECK — a footnote stack: small-caps label, serif line; whitespace only.
8. Mark reviewed — a quiet pill (999px radius), last, unchanged behavior.

**States covered:** all five rows; expanded evidence on R2 (its ladder is the drawn focus
state); NEXT CHECK on R2 + R3; restricted / unavailable (+Retry) / degraded beside the rail.

**Implementation cost.** `TickerNewsPanel.tsx`: masthead + member/ladder markup tweaks ≈ 20–25
lines; module.css ≈ 80–95 lines (declares `--font-serif` on the panel root, so `fin.css` can
stay untouched — or move the stack to `fin.css` for +3 lines if the serif is reused elsewhere).

**Risks.** (1) Serif at 17px in a 360px column costs ~28% more row height than R2 — the rail
shows fewer stories per screen; measured on the boards: the five-fixture rail grows from ~1500px
(A) to ~1900px (C) at desktop. (2) Georgia has no true small caps — the caps are synthesized at
9px, acceptable but soft; a real small-caps face would need a webfont (excluded by constraint).
(3) Editorial register must not drift into warmth: the paper stays `#ffffff`/`#f7f8fa`, ink
stays the house slate — the serif and whitespace carry the genre, not cream or terracotta.

**Chanel pass — the one accessory removed:** the row hover fill AND the focus-adjacent chrome
around Mark reviewed — the row is pure paper; only links and controls react. (Kept exactly one
control border — the Mark reviewed pill — because a borderless button next to body serif reads
as decoration, not action.)

**Not the generic default.** The avoided default is the warm-cream serif + terracotta
"premium editorial" template (the Substack/Notion-broadsheet look with hairline rules
everywhere). C refuses the cream paper, the second accent hue, and the decorative rules; its
folios-ness is serif + whitespace + one hairline, on the house neutral surfaces.

---

## Choosing in ten minutes

- **A — Typographic ledger** if the seat wants the smallest diff from shipped R2 that still
  reads as a redesign: same palette, same content, containers deleted. Lowest risk, lowest
  cost (~85 lines), and the most legible at 390px.
- **B — Instrument strip** if scan speed is the product goal: state visible per-strip without
  reading, clocks monospaced, counts aligned. Highest cost (~170 lines) and the L2 test
  contract needs its anatomy clause revised.
- **C — Editorial folio** if the rail should feel like reading, not monitoring: the award-level
  risk pick, the tallest rows, and the one that most needs the Chairman's eye on light theme.

All three keep every product law: no sentiment/impact/confidence/rank/score/call vocabulary
(grep receipt 0), lexicon verbatim in EN+ZH, no accent edges (grep receipt 0), labeled state
ink, full focus outlines, ≥44px touch targets, no motion, body ≥4.5 / labels ≥3 contrast in
both themes.
