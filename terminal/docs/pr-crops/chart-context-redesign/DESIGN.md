# Chart Context redesign — 18 October 2026

## Design authority

The user requested a complete redesign and relocation of Terminal’s text-heavy Chart Context, which covered the newest candles and indicator panes in the supplied screenshots.

[Open the desktop and mobile Paper designs](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-21-0).

- File: MASTERMIND PAGES, 01M2WGNCX9475G79JRKJTCM08P.
- Page: p-21-0, Terminal · Chart Context · R1 · 2026-10-18.
- Desktop: 6I32-0, 1440 × 900, right-sidebar reader.
- Mobile: 6IYY-0, 390px-wide scroll layout below the chart.
- Exact reader JSX: paper-reader.jsx.txt, exported from Paper node 6I6T-0.
- Mockup metric values reproduce the supplied screenshot; its drawn price history is explicitly illustrative.
- Browser captures use repository fixtures, not production market data.

## Placement and hierarchy

Context joins Overview and Options in the existing right rail. A compact entry sits in the chart toolbar, outside the plotting canvas. Opening Context covers the prior rail view while preserving its mounted content; closing returns to that view.

At the 860px single-column breakpoint, Context becomes an inline section after the entire chart body, indicator panes and phone control strip. Fullscreen and native chart shells use this inline destination with bounded scrolling. Mobile’s visible chart follows the active pane so its identity matches Context. At phone widths (640px and below), access lives in More → Analysis hub → Chart context, beside Symbol details. The closed reader consumes no chart height. Tablet keeps its toolbar entry. Native chart shells use the existing chart menu.

The primary view presents symbol, timeframe, selected-bar date, Previous / Next / Latest controls, a descriptive headline, and four cards:

1. Bar move, measured from raw open to raw close for this chart timeframe.
2. Trend, with price and the existing EMA 20 / EMA 50 values.
3. Momentum, independent of candle-color mode, with RSI 14 and its existing 40 / 60 thresholds.
4. Volume percentile, shown out of 100 with the actual count of earlier usable observations.

Range and company events, chart layers, and methodology are three native expandable sections. Data timing and unavailable values remain explicit. The redesign adds no forecast, confidence score, trading instruction, indicator calculation or data source.

## Interaction contract

Chart clicks and panning do not close Context. Moving from chart to reader retains the selected bar. Latest clears explicit selection so new bars can be followed. Only the active chart supplies the reader; its symbol, timeframe and replay identity must match before facts render.

The React portal moves presentation only. The existing per-chart analysis and preference writer remain authoritative. Portal pointer capture cannot activate a chart pane, and reader keys cannot invoke drawing shortcuts. Escape closes only when focus is inside Context. Opening from a control focuses the reader’s Close button and reveals the inline header. Ordinary Close restores a visible persistent launcher, including More after resizing to a phone; Candle settings receives focus without a scheduled return behind its dialog.

Disabled Context has an explicit Enable action through the existing preference. Research/table modes suspend the reader and show the prior rail view. Historical inspection and replay continue to withhold current company-calendar knowledge.

## Verification

The original 30-case bilingual Visual Intelligence suite remains the compatibility gate. The separate chart-context-dock.spec.ts proves selected values, zero-overlap geometry, keyboard isolation, disabled-setting recovery, and a desktop → mobile → fullscreen multi-pane identity sequence. ChartPanel-bound visual packets are regenerated from integrated source instead of merely updating hashes.
