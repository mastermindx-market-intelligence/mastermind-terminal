"use client";
// Presentational overlay layer drawn on top of a ChartPanel chart. It renders, per chart pane:
//   • a top-left legend listing the indicators plotted in that pane (price pane = overlay indicators,
//     each sub-pane = its single indicator), each with the TradingView-style hover menu
//     (eye / settings / source / remove / more) + 0.5s tooltips + hidden styling + a fixed crossed-eye
//     quick-toggle, and a "^" collapse control on the price-pane legend.
//   • a top-right pane-ops menu (sub-panes only), revealed on pane hover: move up / move down /
//     remove / collapse / maximize, with active-state highlighting.
// It owns NO chart logic — every action is a callback into ChartPanel, which holds the chart refs.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

export type LegendEntry = {
  key: string;          // "ema" | "bb" | … | "pine" | "cmp:SYM"
  label: string;
  kind: "overlay" | "pane";
  hidden: boolean;
  isPine: boolean;
  isCompare?: boolean;  // compare symbol pseudo-indicator — no read-only source view
  noParams?: boolean;   // signal-style row (e.g. Golden Oracle) — no Settings / Source, just eye + remove
  noSource?: boolean;   // premium suite row — Settings works but there is no pseudo-Pine source view
  color?: string;       // line color (used for the compare row's swatch dot)
};

export type PaneInfo = {
  key: string;          // stable pane identity ("__price__" | indicator key) — survives reorder
  /** Optional group key used by the pane-level trash action (individual rows keep their own keys). */
  removeKey?: string;
  paneIndex: number;
  isPrice: boolean;
  top: number;          // px, relative to the chart-wrap
  height: number;
  collapsed: boolean;
  maximized: boolean;
  entries: LegendEntry[];
};

export type OverlayActions = {
  onEye: (key: string) => void;
  onSettings: (key: string) => void;
  onSource: (key: string) => void;
  onRemove: (key: string) => void;
  onMoveUp: (paneIndex: number) => void;
  onMoveDown: (paneIndex: number) => void;
  onCollapse: (paneIndex: number) => void;
  onMaximize: (paneIndex: number) => void;
  canMoveUp: (paneIndex: number) => boolean;
  canMoveDown: (paneIndex: number) => boolean;
};

// B5 icon sizing: width/height removed from inline style so CSS (.lg-ic svg, .po-ic svg) can scale them.
const I = (d: string, sw = 1.7) => (
  <svg viewBox="0 0 24 24" className="lgsvg" style={{ stroke: "currentColor", fill: "none", strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d={d} />
  </svg>
);
const EYE = "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z";
const EYE_OFF = "M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8M9.4 5.2A10.6 10.6 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.1 6.2A18 18 0 0 0 1 12s4 7 11 7a10.6 10.6 0 0 0 3-.4";

// B5: width/height removed from EyeIcon so CSS can scale it per context
function EyeIcon({ off }: { off: boolean }) {
  const base = { stroke: "currentColor", fill: "none", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return off
    ? <svg viewBox="0 0 24 24" className="lgsvg" style={base}><path d={EYE_OFF} /></svg>
    : <svg viewBox="0 0 24 24" className="lgsvg" style={base}><path d={EYE} /><circle cx="12" cy="12" r="3" /></svg>;
}

const ICONS = {
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 14H4.5a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 6 7.1L5.9 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4.6V4.5a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9z",
  source: "M8 6l-5 6 5 6M16 6l5 6-5 6",
  remove: "M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  collapse: "M7 4l5 5 5-5M7 20l5-5 5 5",
  maximize: "M4 9V4h5M20 9V4h-5M15 20h5v-5M9 20H4v-5",
};

type MoreState = { key: string; label: string; paneIndex: number; isPane: boolean; hidden: boolean; isCompare: boolean; noParams: boolean; noSource: boolean; x: number; y: number; rowTop: number };

export default function ChartOverlays(props: {
  panes: PaneInfo[];
  hoveredKey: string | null;
  legendOpen: boolean;
  onToggleLegend: () => void;
  coarse?: boolean;
  showTitles?: boolean;
  backgroundOpacity?: number;
  paneButtons?: "always" | "hover" | "never";
} & OverlayActions) {
  const coarse = !!props.coarse;
  const t = useT();
  const [more, setMore] = useState<MoreState | null>(null);
  const [flip, setFlip] = useState<{ key: string; n: number } | null>(null);
  // Static Legend (touch): tapping a row's name ARMS it — the icon strip appears INSIDE the same
  // box (no geometry change, no action fired). Only one row armed at a time; a pointerdown outside
  // disarms. `armedKey` tracks the armed row.
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const armedRowRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  // bump `n` (a monotonic nonce) so the flipped icon remounts and the CSS animation replays on every click
  const doFlip = (key: string) => setFlip((f) => ({ key, n: (f?.n ?? 0) + 1 }));
  // close the More dropdown on outside pointerdown / Escape (desktop AND coarse — the coarse More is
  // now the same .lg-more object anchored under the row, not a bottom sheet). The dropdown stops
  // propagation on its own pointerdown so taps inside it don't self-close.
  useEffect(() => {
    if (!more) return;
    const close = () => { setMore(null); setArmedKey(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMore(null); setArmedKey(null); } };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey); };
  }, [more]);
  // Clamp the dropdown inside the viewport after it measures — useLayoutEffect so the clamp lands
  // before paint (no one-frame off-position flash on narrow phones). Anchored to the row's left edge
  // and its bottom edge; on a narrow phone the raw left could push it off the right edge, and a row
  // in the lowest sub-pane could push the bottom rows (incl. danger "Remove") below the fold.
  //   • x: 8px ≤ x ≤ vw − width − 8px.
  //   • y: prefer below the row; if it won't fit, flip ABOVE the row; if the menu is taller than the
  //     whole viewport (rare) it caps at 8px and the CSS max-height/overflow scroll takes over.
  useLayoutEffect(() => {
    if (!more) return;
    const el = moreRef.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = Math.max(8, Math.min(more.x, vw - w - 8));
    // more.y anchors the menu below the row (row bottom + 4). more.rowTop is the row's top edge.
    let y = more.y;
    if (y + h > vh - 8) {
      // not enough room below — try flipping ABOVE the row (menu bottom 4px above the row top)
      const above = more.rowTop - 4 - h;
      y = above >= 8 ? above : Math.max(8, vh - 8 - h);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [more]);
  // Static Legend: pointerdown outside the armed row disarms it (mirrors the More closer). Skipped
  // while a More dropdown is open on coarse — that popover owns its own outside-click dismissal
  // and disarming here would also close More on the same tap.
  useEffect(() => {
    if (!coarse || armedKey == null || more) return;
    const onDown = (e: PointerEvent) => {
      if (armedRowRef.current && armedRowRef.current.contains(e.target as Node)) return;
      setArmedKey(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [coarse, armedKey, more]);

  const stop = (fn: () => void) => (ev: React.MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); fn(); };
  const openMore = (e: LegendEntry, paneIndex: number, rect: DOMRect) =>
    setMore({ key: e.key, label: e.label, paneIndex, isPane: e.kind === "pane", hidden: e.hidden, isCompare: !!e.isCompare, noParams: !!e.noParams, noSource: !!e.noSource, x: rect.left, y: rect.bottom + 4, rowTop: rect.top });

  // B5: total entries count across all panes (for the count chip)
  const totalEntries = props.panes.reduce((s, p) => s + p.entries.length, 0);

  return (
    <div className="chart-overlays">
      {props.panes.map((p) => {
        const legendTop = p.top + (p.isPrice ? 38 : 4);   // price legend clears the OHLC status line; sub-panes hug the corner (TV-tight)
        const primaryKey = p.entries[0]?.key;
        const paneRemoveKey = p.removeKey ?? primaryKey;
        const showOps = !p.isPrice && primaryKey != null;
        // B5: on coarse, pane-ops only visible when collapsed or maximized (restore affordance)
        // a maximized PRICE pane renders a restore-only ops strip (it is reachable via double-click/tap,
        // and without this there is no visible way back — the flattened sub-panes show no ops of their own)
        const priceRestoreOnly = p.isPrice && p.maximized;
        const paneButtons = props.paneButtons ?? "hover";
        const showPaneOps = priceRestoreOnly || (showOps && (
          p.collapsed ||
          p.maximized ||
          paneButtons === "always" ||
          (paneButtons === "hover" && !coarse && props.hoveredKey === p.key)
        ));
        // B5: entry row visibility — price pane gated by legendOpen; sub-pane gated by legendOpen on coarse only
        const entriesVisible = p.isPrice ? props.legendOpen : (coarse ? props.legendOpen : true);
        // B5: render the price-pane lg-block even on coarse when it has no entries (so the count chip always shows)
        const showBlock = props.showTitles !== false && (p.entries.length > 0 || (p.isPrice && coarse));
        return (
          <div key={p.key}>
            {showBlock && (
              <div className="lg-block" style={{ top: legendTop, left: 8 }}>
                {p.entries.map((e) => {
                  const visible = entriesVisible;
                  const isArmed = coarse && armedKey === e.key;
                  return (
                    <div
                      key={e.key}
                      ref={isArmed ? armedRowRef : undefined}
                      className={`lg-row${e.hidden ? " is-hidden" : ""}${e.isCompare ? " is-cmp" : ""}${isArmed ? " is-armed" : ""}`}
                      style={visible
                        ? { background: `rgba(6,9,14,${Math.max(0, Math.min(100, props.backgroundOpacity ?? 70)) * 0.0054})` }
                        : { display: "none" }}
                    >
                      {e.isCompare && <span className="lg-dot" style={{ background: e.color || "currentColor" }} />}
                      {/* Static Legend: tapping the name area on touch ARMS the row (fires no action) */}
                      <span
                        className="lg-name"
                        onClick={coarse && !isArmed ? (ev) => { ev.stopPropagation(); setArmedKey(e.key); } : undefined}
                      >{e.label}</span>
                      {/* Touch armed strip: icons appear INSIDE the same box — same .lg-menu as desktop,
                          no separate pill, no geometry change. Eye is the fixed first slot. */}
                      {coarse && isArmed ? (
                        <span className="lg-menu">
                          <button className="lg-ic eye" aria-label={e.hidden ? t("lgShow") : t("lgHide")} onClick={stop(() => { props.onEye(e.key); setArmedKey(null); })}><EyeIcon off={e.hidden} /></button>
                          {!e.noParams && <button className="lg-ic" aria-label={t("lgSettings")} onClick={stop(() => { props.onSettings(e.key); setArmedKey(null); })}>{I(ICONS.settings, 1.6)}</button>}
                          <button className="lg-ic" aria-label={t("lgRemove")} onClick={stop(() => { props.onRemove(e.key); setArmedKey(null); })}>{I(ICONS.remove)}</button>
                          {/* More → dropdown anchored under the armed row's left edge (conforms on coarse too) */}
                          <button className="lg-ic" aria-label={t("lgMore")} onClick={(ev) => {
                            ev.stopPropagation(); ev.preventDefault();
                            const rowEl = (ev.currentTarget as HTMLElement).closest(".lg-row") as HTMLElement | null;
                            const r = (rowEl ?? (ev.currentTarget as HTMLElement)).getBoundingClientRect();
                            setMore({ key: e.key, label: e.label, paneIndex: p.paneIndex, isPane: e.kind === "pane", hidden: e.hidden, isCompare: !!e.isCompare, noParams: !!e.noParams, noSource: !!e.noSource, x: r.left, y: r.bottom + 4, rowTop: r.top });
                          }}>{I(ICONS.more, 2.4)}</button>
                        </span>
                      ) : !coarse ? (
                        <span className="lg-menu">
                          <button className="lg-ic eye" data-tip={e.hidden ? t("lgShow") : t("lgHide")} onClick={stop(() => props.onEye(e.key))} aria-label={e.hidden ? t("lgShow") : t("lgHide")}><EyeIcon off={e.hidden} /></button>
                          {!e.noParams && <button className="lg-ic" data-tip={t("lgSettings")} onClick={stop(() => props.onSettings(e.key))} aria-label={t("lgSettings")}>{I(ICONS.settings, 1.6)}</button>}
                          {!e.isCompare && !e.noParams && !e.noSource && <button className="lg-ic" data-tip={t("pmSourceCode")} onClick={stop(() => props.onSource(e.key))} aria-label={t("pmSourceCode")}>{I(ICONS.source)}</button>}
                          <button className="lg-ic" data-tip={t("lgRemove")} onClick={stop(() => props.onRemove(e.key))} aria-label={t("lgRemove")}>{I(ICONS.remove)}</button>
                          <button className="lg-ic" data-tip={t("lgMore")} onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); openMore(e, p.paneIndex, (ev.currentTarget as HTMLElement).getBoundingClientRect()); }} aria-label={t("lgMore")}>{I(ICONS.more, 2.4)}</button>
                        </span>
                      ) : e.hidden ? (
                        // C1 coarse: hidden indicator keeps a persistent crossed-eye in the pill's eye
                        // slot (right after the name) — one tap un-hides without opening the pill
                        <span className="lg-menu">
                          <button className="lg-ic eye" aria-label={t("lgShow")} onClick={stop(() => props.onEye(e.key))}><EyeIcon off /></button>
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {/* B5: count chip on the collapse button — shows total entry count on coarse */}
                {p.isPrice && (
                  <button className="lg-collapse" title={props.legendOpen ? t("lgMinimizeList") : t("lgShowList")} onClick={stop(() => { setArmedKey(null); props.onToggleLegend(); })}>
                    <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", transform: props.legendOpen ? "none" : "rotate(180deg)" }}><path d="M6 15l6-6 6 6" /></svg>
                    {coarse && totalEntries > 0 && <span className="lg-cnt">{totalEntries}</span>}
                  </button>
                )}
              </div>
            )}

            {showPaneOps && (
              <div className="pane-ops" style={{ top: p.top + 3, right: 10 }}>
                {/* on coarse, hide move/remove — only restore affordance (collapse/maximize) */}
                {!coarse && !priceRestoreOnly && <>
                  <button className="po-ic" data-tip={t("pmMovePaneUp")} disabled={!props.canMoveUp(p.paneIndex)} onClick={stop(() => { props.onMoveUp(p.paneIndex); doFlip(p.paneIndex + ":up"); })} aria-label={t("pmMovePaneUp")}>{flip?.key === p.paneIndex + ":up" ? <span key={flip.n} className="po-flip">{I(ICONS.up)}</span> : I(ICONS.up)}</button>
                  <button className="po-ic" data-tip={t("pmMovePaneDown")} disabled={!props.canMoveDown(p.paneIndex)} onClick={stop(() => { props.onMoveDown(p.paneIndex); doFlip(p.paneIndex + ":down"); })} aria-label={t("pmMovePaneDown")}>{flip?.key === p.paneIndex + ":down" ? <span key={flip.n} className="po-flip">{I(ICONS.down)}</span> : I(ICONS.down)}</button>
                  <button className="po-ic" data-tip={t("pmRemovePane")} onClick={stop(() => props.onRemove(paneRemoveKey!))} aria-label={t("pmRemovePane")}>{I(ICONS.remove)}</button>
                </>}
                {!priceRestoreOnly && <button className={`po-ic${p.collapsed ? " on" : ""}`} data-tip={p.collapsed ? t("pmRestorePane") : t("pmCollapsePane")} onClick={stop(() => props.onCollapse(p.paneIndex))} aria-label={p.collapsed ? t("pmRestorePane") : t("pmCollapsePane")}>{I(ICONS.collapse)}</button>}
                <button className={`po-ic${p.maximized ? " on" : ""}`} data-tip={p.maximized ? t("pmRestorePane") : t("pmMaximizePane")} onClick={stop(() => props.onMaximize(p.paneIndex))} aria-label={p.maximized ? t("pmRestorePane") : t("pmMaximizePane")}>{I(ICONS.maximize)}</button>
              </div>
            )}
          </div>
        );
      })}

      {/* More dropdown — one conforming object for desktop AND touch: deep-scrim bg + hairline
          border, anchored flush under the row's left edge, viewport-clamped (effect above). */}
      {more && (() => { const done = () => { setMore(null); setArmedKey(null); }; return (
        <div ref={moreRef} className="lg-more" style={{ left: more.x, top: more.y }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="lg-more-row" onClick={stop(() => { props.onEye(more.key); done(); })}><span className="mi"><EyeIcon off={more.hidden} /></span>{more.hidden ? t("lgShow") : t("lgHide")}</div>
          {!more.noParams && <div className="lg-more-row" onClick={stop(() => { props.onSettings(more.key); done(); })}><span className="mi">{I(ICONS.settings, 1.6)}</span>{t("lgSettingsMore")}</div>}
          {!more.isCompare && !more.noParams && !more.noSource && <div className="lg-more-row" onClick={stop(() => { props.onSource(more.key); done(); })}><span className="mi">{I(ICONS.source)}</span>{t("pmSourceCodeMore")}</div>}
          {more.isPane && <>
            <div className="lg-more-sep" />
            <div className={`lg-more-row${props.canMoveUp(more.paneIndex) ? "" : " dis"}`} onClick={stop(() => { if (props.canMoveUp(more.paneIndex)) { props.onMoveUp(more.paneIndex); done(); } })}><span className="mi">{I(ICONS.up)}</span>{t("pmMovePaneUp")}</div>
            <div className={`lg-more-row${props.canMoveDown(more.paneIndex) ? "" : " dis"}`} onClick={stop(() => { if (props.canMoveDown(more.paneIndex)) { props.onMoveDown(more.paneIndex); done(); } })}><span className="mi">{I(ICONS.down)}</span>{t("pmMovePaneDown")}</div>
            <div className="lg-more-row" onClick={stop(() => { props.onCollapse(more.paneIndex); done(); })}><span className="mi">{I(ICONS.collapse)}</span>{t("pmCollapsePane")}</div>
            <div className="lg-more-row" onClick={stop(() => { props.onMaximize(more.paneIndex); done(); })}><span className="mi">{I(ICONS.maximize)}</span>{t("pmMaximizePane")}</div>
          </>}
          <div className="lg-more-sep" />
          <div className="lg-more-row danger" onClick={stop(() => { props.onRemove(more.key); done(); })}><span className="mi">{I(ICONS.remove)}</span>{t("lgRemove")}</div>
        </div>
      ); })()}
    </div>
  );
}
