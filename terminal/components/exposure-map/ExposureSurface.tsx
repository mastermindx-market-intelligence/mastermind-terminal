"use client";
/**
 * ExposureSurface — isometric strike × expiry columns over a qualified
 * projection. Cells come only from the projection through the existing lens
 * owner; heights are the cells' own values, nothing smoothed, and a missing
 * value is a labelled absence, never a zero column.
 */
import { useMemo, useRef, useState } from "react";
import { useChartWidth, thinLabels, MIN_CHART_H } from "../charts/svgChart";
import { buildExposureSurface, daysToExpiry, projectSurfacePoint, tierBoundsMn,
  SURFACE_ELEVATIONS, SURFACE_EXPIRY_CAPS, SURFACE_WINDOWS,
  type ExposureSurface, type IsoFrame, type SurfaceCell, type SurfaceMode } from "../../lib/exposureSurface";
import type { ExposureLens, QualifiedProjection } from "../../lib/exposureMapProjection";
import { exposureSurfaceT } from "./exposureSurfaceStrings";
import styles from "./ExposureSurface.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUS = "−";
const shortDate = (iso: string | null, zh: boolean): string => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return !m ? "—" : zh ? `${Number(m[2])}月${Number(m[3])}日` : `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
};
const magnitude = (v: number): string => (Math.abs(v) >= 1000 ? `${(Math.abs(v) / 1000).toFixed(3)}B` : `${Math.round(Math.abs(v))}M`);
const signedMn = (v: number | null): string => v == null || !Number.isFinite(v) ? "—" : `${v < 0 ? MINUS : v > 0 ? "+" : ""}${magnitude(v)}`;
const unsignedMn = (v: number | null): string => v == null || !Number.isFinite(v) ? "—" : magnitude(v);
const localeCount = (n: number, zh: boolean): string => n.toLocaleString(zh ? "zh-Hans-CN" : "en-US");
const strikeLabel = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
// The corner caption's direction arrows follow the rotation state.
const ARROWS: Record<number, [string, string]> = { 0: ["↗", "↖"], 90: ["↘", "↗"], 180: ["↙", "↘"], 270: ["↖", "↙"] };
const axisCaption = (base: string, rotation: number): string => base.replace("↗", ARROWS[rotation]![0]).replace("↖", ARROWS[rotation]![1]);
/** Legend ranges straight from the real tier bounds, integers with en dashes. */
const tierRanges = (bounds: number[]): string[] => {
  const d = bounds.map((b) => Math.max(1, Math.round(b)));
  return [`≥ ${d[0]}`, ...d.slice(1).map((b, i) => `${b}–${d[i]! - 1}`)];
};

export interface ExposureSurfaceProps {
  projection: QualifiedProjection | null;
  prior?: QualifiedProjection | null;
  lens: ExposureLens;
  referenceSpot: number | null;
  lang: "en" | "zh";
  now?: number;
  focusCell?: { strike: number; expiry: string } | null;
  onPinCell?: (cell: { strike: number; expiry: string }) => void;
  onOpenInMap?: (cell: { strike: number; expiry: string }) => void;
}

export default function ExposureSurface({ projection, prior, lens, referenceSpot, lang, now, focusCell, onPinCell, onOpenInMap }: ExposureSurfaceProps) {
  const t = exposureSurfaceT(lang);
  const zh = lang === "zh";
  const [mode, setMode] = useState<SurfaceMode>("net");
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [elevation, setElevation] = useState<number>(30);
  const [windowPct, setWindowPct] = useState<number>(4);
  const [expiryCap, setExpiryCap] = useState<number>(9);
  const [spotPlane, setSpotPlane] = useState(true);
  const [selected, setSelected] = useState<{ strike: number; expiry: string } | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const width = useChartWidth(field, 720);
  const surface = useMemo(() => (projection
    ? buildExposureSurface(projection, { lens, mode, windowPct, expiryCap, referenceSpot, now, prior })
    : null), [projection, lens, mode, windowPct, expiryCap, referenceSpot, now, prior]);
  const status = !projection ? "no-projection" : !surface || surface.totals.cellsShown === 0 ? "empty-window" : "ready";
  const dominant = useMemo(() => {
    if (!surface) return null;
    let best: SurfaceCell | null = null;
    for (const c of surface.cells) if (c.valueMn != null && (!best || Math.abs(c.valueMn) > Math.abs(best.valueMn!))) best = c;
    return best;
  }, [surface]);
  const focus = useMemo(() => {
    if (!surface) return null;
    const hit = (key: { strike: number; expiry: string } | null | undefined) =>
      key ? surface.cells.find((c) => c.strike === key.strike && c.expiry === key.expiry) ?? null : null;
    return hit(selected) ?? hit(focusCell) ?? dominant;
  }, [surface, selected, focusCell, dominant]);
  const geo = useMemo(() => {
    if (!surface || status !== "ready") return null;
    const cols = Math.max(1, surface.expiries.length), rows = Math.max(1, surface.strikes.length);
    const h = Math.min(560, Math.max(260, width * 0.62));
    const heightPx = h * 0.5;
    const k = Math.sin((elevation * Math.PI) / 180) / 0.5;
    const span = cols + rows;
    const cellW = Math.max(8, Math.min(34, (width * 0.88) / span / Math.cos(Math.PI / 6)));
    const cellD = Math.max(6, Math.min(cellW, (h - heightPx - 64) / (span * 0.5 * k)));
    return { frame: { rotation, elevationDeg: elevation, cellW, cellD, heightPx }, h, cols, rows };
  }, [surface, status, width, rotation, elevation]);
  const pill = focus ? `${strikeLabel(focus.strike)} × ${shortDate(focus.expiry, zh)}` : "—";
  const cellTag = pill;
  const stepWindow = () => setWindowPct(SURFACE_WINDOWS[(SURFACE_WINDOWS.indexOf(windowPct as 2 | 4 | 8) + 1) % SURFACE_WINDOWS.length]);
  const chip = (key: SurfaceMode, label: string) => (
    <button key={key} type="button" className={styles.chip} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>
  );
  const footer = mode === "net" ? t("footerNet", { session: shortDate(surface?.session ?? null, zh) })
    : mode === "gross" ? t("footerGross", { session: shortDate(surface?.session ?? null, zh) })
    : t("footerAbs", { session: shortDate(surface?.session ?? null, zh) });
  const sha = surface ? `${surface.sourceRef.slice(0, 4)}…${surface.sourceRef.slice(-4)}` : "";
  return (
    <section className={styles.surface} data-surface-status={status} data-surface-identity={surface?.identity}
      data-surface-rotation={rotation} data-surface-mode={mode}>
      <div className={styles.toolbar}>
        <div className={styles.segment}>
          {chip("net", t("net"))}{chip("gross", t("gross"))}{chip("abs", t("abs"))}
        </div>
        <button type="button" className={styles.tool} onClick={() => setRotation(((rotation + 90) % 360) as 0 | 90 | 180 | 270)}>{t("rotate")}</button>
        <button type="button" className={styles.tool} onClick={() => setElevation(SURFACE_ELEVATIONS[(SURFACE_ELEVATIONS.indexOf(elevation as 20 | 30 | 45 | 60) + 1) % SURFACE_ELEVATIONS.length])}>
          {t("elevation", { deg: elevation })}
        </button>
        <label className={styles.pick}>
          <select value={windowPct} onChange={(e) => setWindowPct(Number(e.target.value))} aria-label={t("window", { w: windowPct })}>
            {SURFACE_WINDOWS.map((w) => <option key={w} value={w}>{t("window", { w })}</option>)}
          </select>
        </label>
        <label className={styles.pick}>
          <select value={expiryCap} onChange={(e) => setExpiryCap(Number(e.target.value))} aria-label={t("expiries", { n: expiryCap })}>
            {SURFACE_EXPIRY_CAPS.map((n) => <option key={n} value={n}>{t("expiries", { n })}</option>)}
          </select>
        </label>
        <span className={styles.pill} data-testid="surface-pill">{pill}</span>
        <button type="button" className={styles.chip} aria-pressed={spotPlane} onClick={() => setSpotPlane((v) => !v)}>{t("spotPlane")}</button>
        {surface && surface.unavailable.length > 0 && (
          <button type="button" className={styles.locked} disabled title={t("vannaLockedTitle")}>{t("vannaLocked")}</button>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.fieldWrap} ref={field} style={{ minHeight: MIN_CHART_H.axis }}>
          {status === "ready" && geo && surface ? <SurfaceField surface={surface} geo={geo} width={width} t={t} zh={zh}
            mode={mode} spotPlane={spotPlane} focus={focus} onSelect={setSelected} />
          : <div className={styles.empty} data-testid="surface-empty">
              {status === "no-projection" ? <>
                <p className={styles.emptyTitle}>{t("noProjectionTitle")}</p>
                <p className={styles.emptyBody}>{t("noProjectionBody")}</p>
              </> : <>
                <p className={styles.emptyTitle}>{t("emptyWindow", { w: windowPct })}</p>
                <button type="button" className={styles.tool} onClick={stepWindow}>{t("widenWindow")}</button>
              </>}
            </div>}
        </div>
        {status === "ready" && surface && (
          <aside className={styles.legend} data-testid="surface-legend">
            <span className={styles.eyebrow}>{mode === "net" ? t("legendNet") : mode === "gross" ? t("legendGross") : t("legendAbs")}</span>
            {tierRanges(tierBoundsMn(surface.bookMaxAbsMn)).map((range, i) => (
              <span key={range} className={styles.legendRow} data-tier={5 - i}>
                <span className={styles.swatches}><i data-sign="positive" data-tier={5 - i} /><i data-sign="negative" data-tier={5 - i} /></span>
                <span>{range}</span>
              </span>
            ))}
            {surface.referenceSpot != null && (
              <span className={styles.legendRow}>{t("referenceSpot", { spot: surface.referenceSpot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</span>
            )}
            {surface.unavailable.length > 0 && <>
              <span className={styles.eyebrow}>{t("unavailable")}</span>
              <span className={styles.legendRow}>{t("notDrawnAsZero")}</span>
            </>}
            <span className={styles.eyebrow}>{t("windowEyebrow")}</span>
            <span className={styles.legendRow} data-testid="surface-window-line">
              {t("windowLine", { shown: localeCount(surface.totals.cellsShown, zh), total: localeCount(surface.totals.cellsInLens, zh),
                w: windowPct, e: localeCount(surface.totals.expiriesShown, zh), eTotal: localeCount(surface.totals.expiriesInLens, zh) })}
            </span>
          </aside>
        )}
        {status === "ready" && surface && focus && (
          <aside className={styles.inspector} data-testid="surface-inspector">
            <span className={styles.eyebrow}>{t("cell")}</span>
            <h3>{strikeLabel(focus.strike)} × {shortDate(focus.expiry, zh).toUpperCase()}</h3>
            <p className={styles.cellLine}>
              {strikeLabel(focus.strike)} · × {shortDate(focus.expiry, zh)}
              {(() => { const d = daysToExpiry(focus.expiry, surface.session); return d == null ? null : ` · ${t(d === 1 ? "days" : "daysPlural", { n: localeCount(d, zh) })}`; })()}
            </p>
            <div className={styles.hero} data-sign={mode === "gross" ? undefined : focus.netMn == null ? undefined : focus.netMn >= 0 ? "positive" : "negative"}>
              <strong>{mode === "gross" ? unsignedMn(focus.grossMn) : signedMn(focus.netMn)}</strong>
              <span>{mode === "gross" ? t("oneCellGross") : t("oneCell")}</span>
            </div>
            <dl>
              <dt>{t("strikeNet")}</dt><dd>{signedMn(surface.strikeNetMn.get(focus.strike) ?? null)} · {t("allExpiries", { n: localeCount(surface.totals.expiriesInLens, zh) })}</dd>
              <dt>{t("expiryNet")}</dt><dd>{signedMn(surface.expiryNetMn.get(focus.expiry) ?? null)} · {shortDate(focus.expiry, zh)}</dd>
              <dt>{t("grossInCell")}</dt><dd>{unsignedMn(focus.grossMn)}</dd>
              <dt>{t("datedIdentity")}</dt><dd>{surface.identity === "provider_approximation" ? t("providerApprox") : t("providerObserved")}</dd>
              {surface.unavailable.length > 0 && <><dt>{t("vannaCharm")}</dt><dd>{t("unavailableLower")}</dd></>}
            </dl>
            <span className={styles.eyebrow}>{t("provenance")}</span>
            <p className={styles.change} data-sign={focus.changeMn == null ? undefined : focus.changeMn >= 0 ? "positive" : "negative"}>
              <strong>{focus.changeMn == null ? "—" : signedMn(focus.changeMn)}</strong>
              <span>{focus.changeMn == null ? t("changeUnavailable") : t("matchedChange", { session: shortDate(surface.priorSession, zh) })}</span>
            </p>
            <p className={styles.caveat}>
              {t("caveatCells")}{surface.unavailable.length > 0 ? ` ${t("caveatVanna")}` : ""}
            </p>
            {(onPinCell || onOpenInMap) && <div className={styles.actions}>
              {onPinCell && <button type="button" className={styles.tool} onClick={() => onPinCell({ strike: focus.strike, expiry: focus.expiry })}>
                {t("pinCell", { cell: cellTag })}</button>}
              {onOpenInMap && <button type="button" className={styles.tool} onClick={() => onOpenInMap({ strike: focus.strike, expiry: focus.expiry })}>
                {t("openInExposure")}</button>}
            </div>}
          </aside>
        )}
      </div>
      {status === "ready" && surface && (
        <footer className={styles.footer}>
          <span>{footer}</span>
          <span className={styles.sourceTag}>{t("sourceTag", { identity: surface.identity === "provider_approximation" ? t("identityApprox") : t("identityObserved"), sha })}</span>
        </footer>
      )}
    </section>
  );
}

type SurfaceT = ReturnType<typeof exposureSurfaceT>;
interface Geo { frame: IsoFrame; h: number; cols: number; rows: number }

/** The measured-width isometric field: one svg, viewBox 1:1 with CSS pixels. */
function SurfaceField({ surface, geo, width, t, zh, mode, spotPlane, focus, onSelect }: {
  surface: ExposureSurface; geo: Geo; width: number; t: SurfaceT; zh: boolean; mode: SurfaceMode;
  spotPlane: boolean; focus: SurfaceCell | null; onSelect: (cell: { strike: number; expiry: string }) => void;
}) {
  const { frame, h, cols, rows } = geo;
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const pt = (c: number, r: number, height: number) => projectSurfacePoint(c - cx, r - cy, height, frame);
  const colOf = new Map(surface.expiries.map((e, i) => [e, i] as const));
  const rowOf = new Map(surface.strikes.map((s, i) => [s, i] as const));
  const poly = (ps: { x: number; y: number }[]) => ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const signOf = (cell: SurfaceCell) => mode === "abs" ? "abs"
    : ((mode === "gross" ? cell.grossMn : cell.netMn) ?? 0) >= 0 ? "positive" : "negative";
  const painted = surface.cells.map((cell) => {
    const c = colOf.get(cell.expiry) ?? 0, r = rowOf.get(cell.strike) ?? 0;
    const hgt = surface.bookMaxAbsMn > 0 && cell.valueMn != null ? Math.abs(cell.valueMn) / surface.bookMaxAbsMn * frame.heightPx : 0;
    return { cell, c, r, hgt, depth: projectSurfacePoint(c - cx + 0.5, r - cy + 0.5, 0, frame).depth };
  }).sort((a, b) => a.depth - b.depth);
  // Grid floor: light lines along both axes.
  const floorLines: { x: number; y: number }[][] = [];
  for (let r = 0; r <= rows; r++) floorLines.push([pt(0, r, 0), pt(cols, r, 0)]);
  for (let c = 0; c <= cols; c++) floorLines.push([pt(c, 0, 0), pt(c, rows, 0)]);
  // Reference-spot plane between the two surrounding strike rows.
  const spot = surface.referenceSpot;
  let rSpot: number | null = null;
  if (spot != null && surface.strikes.length) {
    rSpot = spot > surface.strikes[0] ? -0.5 : rows - 0.5;
    for (let i = 0; i < surface.strikes.length - 1; i++) {
      const hi = surface.strikes[i]!, lo = surface.strikes[i + 1]!;
      if (spot <= hi && spot >= lo) { rSpot = i + (hi - spot) / (hi - lo || 1); break; }
    }
  }
  const plane = spotPlane && rSpot != null ? (() => {
    const r = rSpot - cy;
    const corners = [pt(0, r, 0), pt(cols, r, 0), pt(cols, r, frame.heightPx), pt(0, r, frame.heightPx)];
    const label = pt(cols, r, frame.heightPx);
    return { corners, label, text: t("referenceSpot", { spot: spot!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }) };
  })() : null;
  const strikeTicks = thinLabels(
    surface.strikes.map((strike, i) => ({ strike, p: pt(cols, i + 0.5, 0) })).sort((a, b) => a.p.x - b.p.x),
    (item) => item.p.x, 26);
  const expiryTicks = thinLabels(
    surface.expiries.map((expiry, j) => ({ expiry, p: pt(j + 0.5, rows, 0) })).sort((a, b) => a.p.x - b.p.x),
    (item) => item.p.x, 26);
  let focusLabel = null;
  if (focus && focus.valueMn != null) {
    const c = colOf.get(focus.expiry) ?? 0, r = rowOf.get(focus.strike) ?? 0;
    const hgt = surface.bookMaxAbsMn > 0 ? Math.abs(focus.valueMn) / surface.bookMaxAbsMn * frame.heightPx : 0;
    const p = pt(c + 0.5, r + 0.5, hgt);
    const label = `${strikeLabel(focus.strike)} × ${shortDate(focus.expiry, zh)} · ${mode === "gross" ? unsignedMn(focus.grossMn) : signedMn(focus.netMn)}`;
    const w = label.length * 6.4 + 12;
    focusLabel = (
      <g className={styles.focusLabel} data-testid="surface-focus-label">
        <rect x={p.x - w / 2} y={p.y - 26} width={w} height={18} rx={4} />
        <text x={p.x} y={p.y - 13} textAnchor="middle">{label}</text>
      </g>
    );
  }
  return (
    <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} className={styles.field} data-testid="surface-field"
      role="img" aria-label={mode === "net" ? t("legendNet") : mode === "gross" ? t("legendGross") : t("legendAbs")}>
      <g className={styles.floor}>
        {floorLines.map((pair, i) => <line key={i} x1={pair[0]!.x} y1={pair[0]!.y} x2={pair[1]!.x} y2={pair[1]!.y} />)}
      </g>
      {plane && <g className={styles.spotPlane} data-testid="surface-spot-plane">
        <polygon points={poly(plane.corners)} />
        <text x={plane.label.x + 6} y={plane.label.y - 6} className={styles.planeLabel}>{plane.text}</text>
      </g>}
      {painted.map(({ cell, c, r, hgt }) => cell.valueMn == null ? (
        <circle key={`${cell.expiry}|${cell.strike}`} className={styles.absentMark} data-tier="u"
          cx={pt(c + 0.5, r + 0.5, 0).x} cy={pt(c + 0.5, r + 0.5, 0).y} r={2} />
      ) : (
        <g key={`${cell.expiry}|${cell.strike}`} data-surface-cell data-strike={cell.strike} data-expiry={cell.expiry}
          data-tier={cell.tier} data-sign={signOf(cell)}
          className={focus && focus.strike === cell.strike && focus.expiry === cell.expiry ? `${styles.prism} ${styles.selected}` : styles.prism}
          onClick={() => onSelect({ strike: cell.strike, expiry: cell.expiry })}>
          <polygon className={styles.faceLeft} points={poly([pt(c, r + 1, hgt), pt(c + 1, r + 1, hgt), pt(c + 1, r + 1, 0), pt(c, r + 1, 0)])} />
          <polygon className={styles.faceRight} points={poly([pt(c + 1, r, hgt), pt(c + 1, r + 1, hgt), pt(c + 1, r + 1, 0), pt(c + 1, r, 0)])} />
          <polygon className={styles.faceTop} points={poly([pt(c, r, hgt), pt(c + 1, r, hgt), pt(c + 1, r + 1, hgt), pt(c, r + 1, hgt)])} />
        </g>
      ))}
      <g className={styles.ticks}>
        {strikeTicks.map(({ strike, p }) => <text key={`s${strike}`} className={styles.tick} x={p.x + 6} y={p.y + 3} textAnchor="start">{strikeLabel(strike)}</text>)}
        {expiryTicks.map(({ expiry, p }) => <text key={`e${expiry}`} className={styles.tick} x={p.x} y={p.y + 14} textAnchor="middle">{shortDate(expiry, zh)}</text>)}
      </g>
      <text className={styles.axisCaption} x={10} y={16}>{axisCaption(t("axisCaption"), frame.rotation)}</text>
      {focusLabel}
    </svg>
  );
}
