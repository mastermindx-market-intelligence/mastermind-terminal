> Repository copy (2026-10-22) of the R2 session design pin. The Paper page named below stays the geometry and colour source of truth; this copy exists so a later session can rebuild the same contract without the original chat. Added with the R2 wiring PR.

# Design pin: Options Exposure Intelligence R2 (Paper page `p-V-0`, 2026-10-20)

Status: PINNED. This is the builder spec for the Terminal Exposure Map redesign (PR-2) and
the visual contract that later waves (Replay, Compare, Discover, 3D lab, Scenarios, Session
review) extend. Source of truth for geometry and colour is the Paper page
"Options · Exposure Intelligence · R2 · 2026-10-20" in file `01M3NSZGE8JWN2EZCSF0DT05RM`
(nine boards: 01 Exposure Map Desktop 1440, 02 Price context, 03 Replay, 04 Compare,
05 Discover, 06 3D lab, 07 Scenarios, 08 Session review, 09 Exposure Map Mobile 390).
The Astra mockups on page `p-T-0` are reference only and are superseded by this page.

Every number printed on the boards is ILLUSTRATIVE design data scoped to a display
window (e.g. "600 +622M", "runner-up 595 0.76×"). Implementation fixtures follow the F1
DESIGN book in `F1_CONTRACT_FREEZE.md` §4 (600 = −621M dominant, runner-up tie 598/602).
Builders never copy board numbers into fixtures, strings, or tests.

## 1. Component mapping

| Board | Terminal owner | PR |
| --- | --- | --- |
| 01 Exposure Map Desktop, 09 Mobile | `components/exposure-map/ExposureMap.tsx`, `ExposureMap.module.css`, `exposureMapStrings.ts` | PR-2 |
| 01 stat strip (contested bar, clocks) | same component; values from `lib/exposureWorkspace.describeExposure` + `lib/marketStructure.exposureNodes`; DEX from `lib/exposureMapProjection.qualifiedDeltaExtension` (PR-1) | PR-2 |
| 04 Compare, 05 Discover | `components/exposure-map/ExposureBoard.tsx`, `ExposureScanner.tsx` (restyle only, no new data) | PR-2 (shell tokens) / follow-up |
| 02 Price context | existing `ChartPanel` embed inside ExposureMap (`.chartColumn`) | PR-2 |
| 03 Replay, 06 3D lab, 07 Scenarios, 08 Session review | `GexMarketMemory`, `SurfaceView`, `ResearchScene`, `investigations.ts` | follow-up PRs; PR-2 ships honest held states only |

Keep every existing `data-testid`, `aria-pressed`, `aria-selected`, `id="exposure-source-details"`,
and string key. New strings are added, never renamed.

## 2. Tokens (exact)

Use Terminal `app/globals.css` tokens. Module-local fallbacks mirror them so the
component renders identically inside `/terminal` (dark only) and the Options route.

| Role | Token | Value |
| --- | --- | --- |
| page bg | `--bg` | `#0a0b0e` |
| panel | `--panel` | `#0d0f13` |
| panel 2 / chip bg | `--panel-2` | `#15171d` |
| panel 3 | `--panel-3` | `#1f222b` |
| inset | `--inset` | `#08090c` |
| line | `--line` | `#23262f` |
| hairline | `--line-2` | `#1a1d24` |
| strong line / chip border | `--line-3` | `#33373f` |
| text | `--text` | `#d6dae3` |
| text 2 | `--text-2` | `#9ba3b4` |
| muted / eyebrow | `--muted` | `#717a8e` |
| dim | `--text-dim` | `#4a5468` |
| signed exposure positive | `--exposure-positive` | `#4cc6cc` (cyan) |
| signed exposure negative | `--exposure-negative` | `#d896f0` (violet) |
| candle up / down | `--up` / `--down` | `#26c281` / `#f0566b` (east/west flip applies to price ONLY) |
| warn / contested | `--warn` | `#e8a33d` |
| info / active tab / EM band | (literal) | `#5B9BF0` |
| selection gold (ring, spot needle, current frame, threshold tick, pinned level) | (literal) | `#D4A017` fill, `#D5BD84` ring |
| ink on strong cells | (literal) | `#0a0b0e` |

Rules. Signed exposure colour is locale-invariant and never swaps under the east/west
price preference. Never hardcode green/red for exposure. Gold is reserved for the
"selected / current / pinned" meaning and nothing else.

Module-local variables to declare on `.map`:
`--ex-positive: var(--exposure-positive, #4cc6cc); --ex-negative: var(--exposure-negative, #d896f0);
--ex-gold: #D4A017; --ex-gold-ring: #D5BD84; --ex-info: #5B9BF0; --ex-ink: #0a0b0e;`

## 3. Type

Inter for UI, IBM Plex Mono (fallback JetBrains Mono via `--font-code`) for numerals,
strikes, clocks, identity strings. Tabular numerals everywhere (`font-variant-numeric: tabular-nums`).

| Role | Spec |
| --- | --- |
| Display (root symbol in title band) | Inter 800, 34px desktop / 28px mobile, letter-spacing −.04em, line-height 1 |
| View title (e.g. "Exposure map") | Inter 600, 17px, −.02em |
| Section titles | Inter 600, 14px, −.01em |
| Eyebrows / table headers | Inter 600, 10px (9px in dense places), letter-spacing +.09em, uppercase, `--muted` |
| Body / notes | Inter 400, 12.5px, line-height 1.55, `--text-2` |
| Stat value | Plex Mono 600, 22px, −.02em |
| Stat sub-value | Plex Mono 500, 11px, `--text-2` |
| Chip / segment label | Plex Mono 600, 11px (chart chips) / Inter 600 11px (view tabs, buttons) |
| Replay frame-kind labels | Inter 600, 8px, +.02em, uppercase |
| Identity line (`SEC:US-ARCX-SPY · v2`) | Plex Mono 500, 11px, `--text-2` |

## 4. Desktop shell anatomy (board 01, 1440 wide)

Top to bottom inside `<section class="map">` (the Terminal topbar is owned by the shell
and is NOT re-implemented here):

1. **View tab row** (`.workspaceNav`, 44px). Left: symbol input (80px, Plex Mono 650) with
   datalist. Then tabs rendered as buttons with `aria-pressed`: Structure, Compare, Scanner
   (existing) and the Tools disclosure. Active tab: `color: var(--text); border-bottom: 2px solid #5B9BF0`.
   Inactive: `color: var(--muted); border-bottom: 2px solid transparent`. No pill backgrounds.
   Right-aligned: data-quality readout `Data quality 12,212 / 13,104` (Plex Mono 11px, `--text-2`)
   and the existing `OPTIONS INTELLIGENCE` eyebrow becomes `Learn the view ?` link style
   (eyebrow 9px). Row border-bottom `1px solid var(--line-2)`.
2. **Breadcrumb eyebrow** (10px, `--muted`): `OPTIONS · EXPOSURE · {ROOT}`.
3. **Title band** (`.overviewBar`): left block = root display (Inter 800 34px) + view title
   ("Exposure map") + identity line (`{security_id} · v2`, or `legacy book` when no projection)
   + reference line (`600.24 reference spot · Oct 16 16:00:02 ET / book Oct 16 · 33 expiries · 491 strikes`,
   Plex Mono 11px) + one-sentence honesty note (12.5px `--text-2`, existing `model` / `coveredQualified`
   strings). Right block = metric segmented control + actions.
4. **Metric segmented control** (`.segment`, 32px high, `--panel-2` bg, `--line-3` border, radius 6):
   Gamma | Delta `EXT` | Vanna | Charm | Combined. Active segment: `--text` text on `--panel-3`.
   Unavailable metric (joint not admitted, dated non-gamma, DEX refused): disabled look
   `opacity .48` plus a lock glyph and `title` = reason string; never hidden, never removed.
   `Delta` carries a superscript tag `EXT` (Inter 600 8px, +.06em) meaning "compatible extension".
   Scope select stays to the right of the control with the existing options.
5. **Actions**: ghost button `Sources & coverage ↗` (scrolls to `#exposure-source-details`) and
   primary button `Save investigation` (light: `--text` bg, `--bg` ink, Inter 600 11px, 32px high,
   radius 6). Primary is the ONLY light button on the page.
6. **Stat strip** (`.leaders`, 5 cells, grid `1.1fr 1.2fr 1.2fr 1fr 1fr`, `--panel` bg, `--line` border, radius 10):
   - COVERED BOOK NET: value `−1,383M` with `data-sign`; sub `$mn · per +1% spot` (or the metric unit).
   - DOMINANT NODE: strike (Plex Mono 22px) + signed value + `23.0% of gross 2,703M`; button → selects node.
   - CONTESTED · RUNNER-UP: strike + ratio `0.76×`; a 4px bar (track `--line-2`, fill `--text-2`,
     threshold tick at 0.90 in gold `#D4A017`, fill turns `--warn` when contested ≥ 0.90).
     Sub shows `threshold 0.90 · runner-up-ratio/v1`. Null ratio → pill `n/a · single node`.
   - QUALIFIED CONTRACTS: `12,212 / 13,104` + `892 without identity` (or `Not supplied` for legacy).
   - CLOCKS: `Observed 16:00:02 ET · OI as of Oct 16 · published Oct 17 03:52` (Plex Mono 11px, wraps to 2 lines).
   Cell: padding 12px 14px, eyebrow 10px above, value 22px, sub 11px. Hover `--hover`.
7. **Workspace** (`.workspace`, grid `minmax(0,1fr) 328px`, gap 16px):
   - Chart column (`.chartColumn`): tools row 36px with timeframe chips (28px high, `--panel-2` bg,
     `--line-3` border, Plex Mono 11px/600, active chip adds an 8px `#5B9BF0` dot), MA toggle, reset.
     Chart 390px tall (ChartPanel). Pinned exposure level drawn in gold. Caption row 28px (9px, `--muted`).
   - Inspector (`.inspector`, 328px, `--panel`, `--line`, radius 10, padding 16px): see §6.
8. **Analytics** (`.analytics`): section head (Inter 600 14px) + detail segment (Expiries / Values / Changes).
   Expiries detail renders the **field** (§5). Values/Changes keep the existing table/memory views restyled.
9. **Source & coverage** (`details.source`): unchanged structure, restyled dl (10px/11px).
10. **Footer session timeline**: rendered ONLY when `historySlot` (stored snapshots) exists.
    Dots: observed = filled `--text-2` 6px; reconstructed = 1px `--text-2` outline; current = filled gold.
    Labels Plex Mono 10px. Legend right-aligned. No timeline is invented from the current book.

## 5. Field (expiry × strike cells)

Columns = expiries (nearest first, max 12 desktop / 6 tablet / 4 mobile), rows = strikes
(covered window, spot row marked with a gold 1px left needle). Header eyebrows Inter 10px/600 +.09em.
Row height 32px desktop, 36px coarse pointer. Cell content Plex Mono 11px, signed, `−` not `-`.

Alpha tiers by |value| in $mn (fill = positive cyan / negative violet at the stated alpha; ink as stated):

| |value| | alpha | ink |
| --- | --- | --- |
| ≥ 200 | .85 | `#0a0b0e` |
| 100–199 | .62 | `#0a0b0e` |
| 50–99 | .40 | `#d6dae3` |
| 20–49 | .22 | `#d6dae3` |
| 8–19 | .11 | `#9ba3b4` |
| 0–7 | .05 | `#717a8e` |

Unknown / withheld cell: no fill, `--text-dim` em dash, `title` = reason (`Not supplied`, `payload limit`,
`source unqualified`). Never zero-fill. Dominant cell per column: `box-shadow: inset 0 0 0 1px rgba(214,218,227,.7)`.
Selected cell: `box-shadow: 0 0 0 2px #D5BD84` (gold ring) and the row gets `background: rgba(255,255,255,.03); border-radius: 4px`.
Clipping to the display window never changes totals, leaders, or shares (they come from the reducer).

## 6. Inspector (328px)

Order: eyebrow `NODE INVESTIGATION` → h3 strike (Plex Mono 600 20px) with `data-sign` value →
`.routeHero` (distance in points / percent, 20px) → `<dl>` (distance, net, gross, share; 11px rows,
dt `--text-2`, dd right-aligned Plex Mono) → implied-volatility distance block (existing) →
intervening strikes list (buttons 32px, `--bg` bg, hover `--hover`) → actions (primary
`Pin reference on chart`, ghost `Open on main chart`, ghost `Close`) → `LARGEST NET NODES`
top-5 with `data-sign` and gross share → model note (10px `--muted`).
Status pills inside the inspector: candidate `rgba(76,198,204,.16)` bg + `#4cc6cc` ink;
contested `rgba(232,163,61,.16)` + `#e8a33d`; null-reason pills `--panel-2` + `--muted`
(`not scanned`, `insufficient coverage`, `single node`).

## 7. Chart (board 02 embedded)

Candles use `--up` / `--down` (price direction; east/west preference applies). Expected-move band
`rgba(91,155,240,.06)` with dashed `#5B9BF0` edges (`stroke-dasharray 3 4`, opacity .45) and the label
`EXPECTED MOVE 1σ ±x.xx%` (Inter 600 10px +.06em). Exposure levels drawn by `lib/exposureMapPrimitive.ts`
use `--ex-positive` / `--ex-negative`; the pinned level is gold. Any inline SVG data chart in this
suite builds on `components/charts/svgChart.ts` (`useChartWidth`, `niceTicks`, `padDomain`,
`thinByPixelGap`); never `preserveAspectRatio="none"`; never hand-rolled axes.

## 8. Mobile (board 09, 390 wide)

- View tabs become a horizontally scrollable row; symbol input 67px; the data-quality readout moves
  under the title band as a 10px line.
- Title band stacks: root 28px, view title 15px, identity + reference lines 10px.
- Metric control is full width (5 equal segments, 10px labels, lock glyph only).
- Stat strip becomes a 2-column grid (cells 1–4) with CLOCKS spanning both columns.
- Chart 360px; field shows 4 expiry columns with horizontal scroll; row height 36px.
- Build deviation (PR-2, 2026-10-21): phones render the chart first, then the stat strip, then the
  field. The board draws the stat strip above the chart; the chart-reachability contract
  (canvas top within the first 700px) wins on a 390-wide phone, so the flex order places the
  workspace before the strip at ≤640px.
- Inspector is the existing `MobileSheet` with detents `[60, 94]`, sticky action row.
- Touch targets ≥ 44px (`@media (pointer: coarse)`).

## 9. Honesty states (must render, never collapse to blank)

- Vanna / Charm locked when joint cells are not admitted: lock glyph + reason tooltip; Gamma stays live.
- Delta `EXT` only when `qualifiedDeltaExtension` qualifies; otherwise locked with the refusal reason
  (`absent`, `payload_limit`, `source_unqualified`, `provenance_unqualified`, …) rendered through a string key.
- Partial coverage: existing `exposure-partial-coverage` note stays; stat strip shows `MEASURED NET · INCOMPLETE`.
- Reconstructed frames are always flagged (outline dot + `RECONSTRUCTED` 8px label); never shown as observed.
- No hold-rate, touch-probability, or forecast wording anywhere (see memory `level-hold-rates-no-edge`).
- Legacy book (no projection): identity line reads `legacy book`, contracts cell reads `Not supplied`,
  rankings keep the `provisional` note.

## 10. New string keys (EN / ZH) for `exposureMapStrings.ts`

```
dataQuality: ["Data quality", "数据质量"]
learnTheView: ["Learn the view", "了解此视图"]
exposureMapView: ["Exposure map", "敞口地图"]
legacyBook: ["legacy book", "旧版账簿"]
referenceSpot: ["reference spot", "参考现价"]
expiriesCount: ["expiries", "个到期日"]
strikesCount: ["strikes", "个行权价"]
sourcesAndCoverage: ["Sources & coverage", "来源与覆盖"]
saveInvestigation: ["Save investigation", "保存调查"]
dominantNode: ["DOMINANT NODE", "主导节点"]
ofGross: ["of gross", "占总值"]
contestedRunnerUp: ["CONTESTED · RUNNER-UP", "相近 · 第二节点"]
threshold: ["threshold", "阈值"]
singleNode: ["single node", "单一节点"]
qualifiedContracts: ["QUALIFIED CONTRACTS", "合格合约"]
withoutIdentity: ["without identity", "无合约标识"]
clocksLabel: ["CLOCKS", "时钟"]
observed: ["Observed", "观测"]
oiAsOf: ["OI as of", "持仓量截至"]
published: ["published", "发布"]
deltaExtension: ["EXT", "扩展"]
deltaExtensionNote: ["Compatible per-cell Delta extension; the parent Gamma book is unchanged.", "兼容的逐单元 Delta 扩展；父级 Gamma 账簿保持不变。"]
metricLocked: ["Not admitted for this book", "此账簿未开放该指标"]
deltaRefused: ["Delta extension withheld", "Delta 扩展未提供"]
notScanned: ["not scanned", "未扫描"]
insufficientCoverage: ["insufficient coverage", "覆盖不足"]
candidate: ["candidate", "候选"]
reconstructed: ["RECONSTRUCTED", "重建"]
observedFrame: ["OBSERVED", "观测"]
currentFrame: ["CURRENT", "当前"]
```

## 11. Laws the builder must honour

1. Pin first, then build: this document plus the Paper boards are the spec; no new design decisions in code.
2. `svg-chart-hygiene-law` and `chart-directional-color-law` (memory) apply to every chart.
3. Palette never inverts sign under locale or east/west preference.
4. Every UI PR carries screenshots (dark + zh at minimum; `/terminal` has no light theme) at 1440×900, 820×1180, 390×844, and `npm run test:e2e:responsive` passes in a fresh server.
5. Existing test ids, aria state and string keys are preserved; vitest + eslint green.
6. `.claude/launch.json` is tracked: restore it before committing.
7. Board numbers are illustrative; fixtures follow F1 §4.

## 12. Addendum — Replay (board 03, pinned 2026-10-22)

Built as `components/exposure-map/ExposureReplay.tsx` + `lib/exposureReplayFrames.ts` (lane R2-PR3);
the parent wires it as the map's `replay` detail tab after #1098 lands.
- Shell: toolbar 44px (transport 28px squares, play 36px wide / `--panel-3` while playing; eyebrow
  `FRAME k / n` over kind dot + `Oct 15 · observed · 16:00:04 ET` Plex Mono 11/600; chips `1.5 s / frame`,
  `Loop`, `±4% window`), range scrubber (gold thumb, ←/→ Home/End), strike × frame table, footer 36px
  (legend square, `Leader path …`, `No interpolation · frames are stored books`), inspector 328px.
- Frames = stored `gex_at:{ROOT}:{DATE}` books (newest 6 before the live session + the live book = 7).
  Kind from the projection reader: qualified → OBSERVED, dated → RECONSTRUCTED (outline dot + 8px label),
  legacy by_strike → AGGREGATE, unreadable → MISSING column with reason. Nothing is interpolated.
- Cells reuse the map's `data-sign` / `data-tier` ladder (relative to the frame SET's max |value|).
  Dominant cell per frame: inset 1px ring. Active frame column `rgba(255,255,255,.03)`; current frame
  header gold; selected strike in the active frame: gold ring.
- Inspector: frame head, strike h3, `−520M · dominant at this frame`, dl (Frame kind, Runner-up with
  contested pill ≥ .9, Next frame, Contracts matched, Clocks), `FRAME PROVENANCE` into the next frame
  (`runner-up → leader` / `leader held` / `new leader`), caveat, actions `Jump to current frame` and
  `Open this session's book`. Deviations from the board: no value-mode dropdown (strike nets only);
  no `Share frame` (sharing belongs to the Recap slice, board 08).
- Mobile ≤ 640px: horizontal table scroll with sticky strike column; inspector stacks; 44px controls.

## 13. Addendum — Session review (board 08, pinned 2026-10-22)

Built as `components/exposure-map/ExposureSessionReview.tsx` + `lib/exposureSessionReview.ts` (lane R2-PR4);
the parent passes the replay frame set's per-frame dominant levels and wires the `review` detail tab.
- Measurement: one `/api/intraday?sym=ROOT&tf=10m&ext=0` read, bucketed by ET session from the display
  epoch; a touch = a 10-minute bar whose [low, high] includes the stored level (inclusive). Levels are
  stored per frame and never recomputed. Reconstructed/aggregate touches never join the observed total.
- Shell: toolbar 44px (mode chips `Dominant at frame` / `Pinned {level} only`; static `Touch = bar range
  crosses level`, `10m bars`; totals line; `Observed touches` / `Reconstructed` counters), table
  SESSION · FRAME · LEVEL AT FRAME · TOUCHES · FIRST · LAST ET · MAX EXCURSION · CLOSE VS LEVEL · SESSION STRIP
  (a CSS range strip, not a chart), footer `NO HOLD-RATE CLAIM` + the two disclaimers, inspector 328px
  (touch count, dl, `MEASUREMENT`, caveat, `Open {date} price context`).
- Deviations from the board: no bars-timeframe dropdown (10m fixed); no `Export touches` / `Share review`
  (sharing belongs to the Recap share step). Gold = selected / current / pinned only; no green/red.

## 14. Addendum — Local scenario (board 07, pinned 2026-10-22)

Built as `components/exposure-map/ExposureScenario.tsx` + `lib/exposureScenario.ts` (lane R2-PR6); the
parent builds `ScenarioBasis` from `readScope(lens, greek).summary.netTotalMn` (GEX / VEX / CEX), the
moves owner's 1σ expected move, and the projection qualification, then wires the `scenario` detail tab.
- Math: engine contract `local_scenario = −GEX·(ΔS/S ÷ 1%) − VEX·(Δσ ÷ 1%) − CEX·days` evaluated through
  the existing owner `scenarioGrid` (lib/marketStructure.ts L280); terms are the linear decomposition and
  must reconcile to the owner's cell. The move fraction is never rounded (golden +184.702M vs 184.68M).
  A non-zero weight on a null summary is a refusal (`summary_unavailable`), never 0; dated / legacy books
  are `not-admitted`; the owner's bounds (±3% · ±5 pt · ≤ 5 d) hold. DEX is never a term; JOINT not admitted.
- Shell: toolbar 44px (`Local linear` · `Repriced curve · held` disabled · `Reset to spot`), controls column
  272px (SPOT MOVE `600.24 → 600.00` / `−0.039984%`, VOL SHIFT absolute · all tenors, TIME calendar; −/+
  steppers 0.25 + direct input), ADMITTED SUMMARY block, headline `+184.702M` gold + terms strip (SPOT ·
  VOL · TIME · JOINT), SVG curve on svgChart.ts (three Δσ series, selected gold, EM band ±1σ, selected dot
  + label), footer formula sentence + `oracle 499/499`, inspector 328px with `SCENARIO` / `WORKED` tabs.
- Deviations from the board: `Worked example ▾` becomes the WORKED inspector tab (live self-check of the
  golden); no `Save scenario` / `Share` (no persistence owner; sharing belongs to the Recap share step).
- Mobile ≤ 640px: controls stack above the chart; chart ≥ 220px; inspector stacks; 44px controls.

## 15. Addendum — Surface (board 06, pinned 2026-10-22)

Built as `components/exposure-map/ExposureSurface.tsx` + `lib/exposureSurface.ts` (lane R2-PR7); the
parent passes the qualified projection (+ the prior session's projection when the dated plane has it)
and wires the `surface` detail tab.
- Cells are the projection's own strike × expiry cells selected through `selectedProjectionCells` (the
  lens owner). Window (±2/4/8 %) and expiry cap (5/9/15 nearest) only choose which cells are shown; the
  tier ladder is relative to the BOOK max |net| so clipping never changes a surviving cell's value or tier.
  Null cells are labelled absences, never zero columns; Vanna · Charm unavailable is a legend row and a
  locked chip, never a 0 surface.
- Shell: toolbar 44px (`Net` / `Gross` / `|Net|`, `Rotate ⟳` quarter turns, `Elevation 30°` cycling
  20/30/45/60, `±4% window ▾`, `9 expiries ▾`, selected pill `600 × Oct 17`, `Spot plane`, `Vanna · locked`),
  ONE SVG on svgChart.ts drawing three-face isometric prisms painted back → front (sign palette, never
  green/red, never inverted), gold selected column + floating label, translucent gold spot plane, axis
  labels thinned by pixel gap, corner caption `STRIKE ↗ · EXPIRY ↖`; legend with the real $M thresholds,
  `reference spot`, `UNAVAILABLE`, `WINDOW {shown} cells of {total} · ±w% · e of E expiries`; footer
  "Column height is the cell's net gamma from the {session} projection. Nothing is smoothed; clipping the
  window never changes a cell." + `exposure_projection/v2 · {identity} · sha …`; inspector 328px (CELL,
  big net, Strike net · all N, Expiry net, Gross in cell, Dated identity, CELL PROVENANCE matched change
  vs prior on equal population ids, caveat, `Pin`, `Open in Exposure ↗`).
- Deviations from the board: no `Share surface`; "same 611 contracts" → "same contracts" (population ids
  carry no count). No WebGL / new dependency: the surface is SVG.
- Mobile ≤ 640px: toolbar wraps; field ≥ 260px; legend below in two columns; inspector stacks; 44px controls.

## 16. Addendum — Discover scan table (board 05, pinned 2026-10-22)

Built as `components/exposure-map/ExposureScanTable.tsx` + `lib/exposureScan.ts` (lane R2-PR5, cut from the
PR-1 head 52aa270aa because it ranks through `reduceExposureNodes` + `scannerScore`); the parent mounts it on
the Discover board beside the existing glance scanner once PR-1 is on master.
- Scope: books are loaded only for the rollout roots SPY · QQQ · SPXW · IWM · NDXP; every other preset is an
  `identity unadmitted` row without a fetch. The counts line is `{presets} presets · {scored} scored ·
  {unscored} unscored` — never "51 scanned"; unadmitted rows carry their own number in the footer.
- Rank and distance come from the SAME reduction (population id, input sha, snapshot ref on the row). A null
  score is a typed reason rendered as a sentence, never a zero; partial books rank nowhere; Delta is not
  scanned in v1 (`metric_not_scanned`). Within-horizon eligibility 0.1 < d ≤ 2.0 EM; far nodes keep their
  dominant / share / contested values in the row (`outside horizon`).
- Freeze: the first completed scan is the ORIGINAL (deep-frozen record, rev 1); `Refresh` appends a revision
  and the FLAGS column shows `node moved a → b`, `contested ↑/↓`, `score Δ`; the inspector's REVISIONS block
  lists every revision with that row's strike and score; the original row never edits.
- Shell: toolbar 44px (chips Gamma · All expiries · Admitted identity only · Sort select · Refresh · counts ·
  `Scanner e7-reconstruction/v1 · rev n`), table PRESET · METRIC·SCOPE · DOMINANT · SHARE · CONTESTED ·
  DISTANCE·EM · SCORE · STATUS · FLAGS (36px rows, Plex Mono 11px, U+2212, `data-sign`), footer 36px
  (`A null score is a reason, never a zero…` + rollout order), inspector 328px (CANDIDATE k / n, score 28px
  gold when candidate, dl Dominance / Concentration / Strength / Distance fit / Regime, SCANNER e7/v1 ·
  gamma only · whole-population basis, caveat, actions Open in Exposure / Watch).
- Deviations from the board: no `Share scan`; scheduled 09:35 / 15:50 snapshots are a producer-side record
  (P48 HELD) — the slice freezes whatever scan the client ran. Gold = selected / candidate only; no green/red.
- Mobile ≤ 640px: horizontal table scroll with sticky PRESET column; inspector stacks; controls ≥ 44px.
