"use client";
/**
 * SurfaceView — the Surface tab: the paint field as the hub's flagship workspace.
 *
 * Layout (single view):
 *   root picker + view toggle + Style popover      ← toolbar
 *   pinned-strike chips                            ← only once something is pinned
 *   SurfacePane (the paint field, large)
 *   ReplayBar (session picker + scrubber + bands)  ← drives everything below it in time
 *   SessionFlowPane                                ← the session's premium tide, same width
 *
 * Multi-day replay: the sessions index (`surface_dates:{ROOT}`) lists the sessions R2 still
 * retains. Picking one loads that date's index and frames through the same replay engine; the
 * LIVE badge becomes an archived-session badge and every pane that can only describe the
 * present withdraws. If the index is absent or malformed the picker is not rendered at all and
 * the tab behaves exactly as it did before — today-only.
 *
 * Quad view swaps the single field for a 2×2 of Net Prem / Gamma / Vanna / Charm. All four
 * sit inside ONE ReplayProvider, so the single scrubber time-travels the whole grid, and
 * inside a SurfaceSyncProvider, so a crosshair in any cell lights the same strike-minute in
 * the other three. A greek the snapshot doesn't carry holds its slot and says "accruing"
 * rather than quietly rendering a second copy of Net Premium.
 *
 * Root honesty: only SURFACE_ROOTS are materialised, so the picker offers exactly those and
 * anything else lands on a plain "no surface for X yet" state instead of an empty chart.
 */

import React, { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { trackSearch } from "@/lib/searchTrack";
import { useFlowStream } from "@/lib/flowStream";
import { flowGet } from "@/lib/flowClientCache";
import { isSurfaceDates } from "@/lib/surfaceContract";
import { ReplayProvider, useReplay } from "./replayContext";
import { SurfacePane, type SurfaceTimeWindow } from "./SurfacePane";
import { ReplayBar } from "./ReplayBar";
import { SessionFlowPane } from "./SessionFlowPane";
import { SurfaceSyncProvider } from "./surfaceSync";
import { SurfaceStylePopover } from "./SurfaceStylePopover";
import { makeSurfaceT } from "./surfaceStrings";
import {
  surfaceThemeVars,
  loadTheme,
  saveTheme,
  themeSignature,
  effectiveContrast,
  type SurfaceTheme,
  type ContrastMode,
} from "./surfaceTheme";
import { addPin, removePin, pinId, type SurfacePin } from "./surfacePins";

// Only roots the materializer builds a surface for (Wave 1: the liquid indices).
const SURFACE_ROOTS = ["SPY", "QQQ", "IWM"];

/** The quad's four cells, in reading order. `gex` is the gamma grid's snapshot key. */
const QUAD_METRICS = ["netprem", "gex", "vanna", "charm"] as const;

type ViewMode = "single" | "quad";

interface TideLite { t: string; ncp: number; npp: number }
interface TidePayload { minutes?: TideLite[]; session_date?: string }

/**
 * The pane group under one ReplayProvider. Bound to the group ref so the replay keybinds
 * (Space / arrows / Home / End) only fire while this group is engaged.
 */
function GroupRoot({
  root, view, aggMin, timeWindow, onTimeWindow, themeSig, contrastMode, pins, onTogglePin, tideMinutes, tideDate, sessions, onSessionDate,
}: {
  root: string;
  view: ViewMode;
  aggMin: number;
  timeWindow: SurfaceTimeWindow;
  onTimeWindow: (window: SurfaceTimeWindow) => void;
  themeSig: string;
  contrastMode: ContrastMode;
  pins: SurfacePin[];
  onTogglePin: (strike: number, metric: string, value: number | null) => void;
  tideMinutes: TideLite[];
  tideDate?: string;
  sessions: string[];
  onSessionDate: (date: string | null) => void;
}) {
  const { lang } = useLang();
  const { bindGroupRef, archived, indexDate } = useReplay();
  // Surface is the primary workspace; the supporting tide stays one click away without
  // taking half the chart on first load (especially at laptop and mobile heights).
  const [sessionOpen, setSessionOpen] = useState(false);

  return (
    <div ref={bindGroupRef} tabIndex={-1} style={GROUP_ROOT}>
      {view === "single" ? (
        <SurfacePane
          root={root}
          themeSig={themeSig}
          contrastMode={contrastMode}
          pins={pins}
          onTogglePin={onTogglePin}
          timeWindow={timeWindow}
          onTimeWindowChange={onTimeWindow}
        />
      ) : (
        <SurfaceSyncProvider>
          <div className="obs-surf-quad" role="group" aria-label={makeSurfaceT(lang)("quadAria")}>
            {QUAD_METRICS.map((m) => (
              <div className="obs-surf-quad-cell" key={m}>
                <SurfacePane
                  root={root}
                  fixedMetric={m}
                  chrome="cell"
                  syncId={m}
                  aggMinOverride={aggMin}
                  themeSig={themeSig}
                  contrastMode={contrastMode}
                  pins={pins}
                  onTogglePin={onTogglePin}
                  timeWindow={timeWindow}
                  onTimeWindowChange={onTimeWindow}
                />
              </div>
            ))}
          </div>
        </SurfaceSyncProvider>
      )}

      <ReplayBar lang={lang} sessions={archived ? sessions : sessions.filter(d => d !== indexDate)} onSessionDate={onSessionDate} />

      {/* The session's premium tide, under the same scrubber. Collapsible and capped so the
          paint field — the reason this tab exists — always keeps the bulk of the height.
          It reads the replay position from the workspace bus (same as its Tide-tab twin), so
          scrubbing truncates it and an archived session makes it withdraw. Kept mounted while
          archived so the withdrawal is visible rather than the pane silently vanishing. */}
      {(tideMinutes.length > 0 || archived) && (
        <div style={SESSION_WRAP}>
          <button
            className="obs-lbl"
            style={SESSION_TOGGLE}
            aria-expanded={sessionOpen}
            onClick={() => setSessionOpen((v) => !v)}
          >
            <span style={{ transform: sessionOpen ? "rotate(90deg)" : "none", transition: "transform var(--t-fast) var(--ease-out)" }} aria-hidden>›</span>
            {makeSurfaceT(lang)("sessionTitle")}
          </button>
          {sessionOpen && (
            <SessionFlowPane minutes={tideMinutes} sessionDate={tideDate} height={150} />
          )}
        </div>
      )}
    </div>
  );
}

export function SurfaceView() {
  const { lang } = useLang();
  const t = makeSurfaceT(lang);
  const [root, setRoot] = useState("SPY");
  const [inputVal, setInputVal] = useState("SPY");
  /** A root the user asked for that has no materialised surface (honest dead-end state). */
  const [missingRoot, setMissingRoot] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("single");
  const [aggMin, setAggMin] = useState(5);
  const [timeWindow, setTimeWindow] = useState<SurfaceTimeWindow>("surface");
  const [pins, setPins] = useState<SurfacePin[]>([]);
  // Restored from localStorage in the initializer. Safe because OptionsHubView loads this
  // view with `ssr: false`, so there is no server render to mismatch against — and
  // loadTheme is SSR-safe anyway (no window → DEFAULT_THEME).
  const [theme, setTheme] = useState<SurfaceTheme>(loadTheme);
  const [styleOpen, setStyleOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // The session tide feeds the pane under the field. Same stream the Tide tab uses.
  const { data: tide } = useFlowStream<TidePayload>("tide");
  const tideMinutes = Array.isArray(tide?.minutes) ? tide!.minutes! : [];

  // ── Multi-day replay: which sessions can be replayed ─────────────────────────
  // Retained dates are enumerated here; only the replay provider owns the live
  // index. GroupRoot filters its accepted date from the archive picker. Root
  // selection resets its context synchronously, not after a late dates response.
  const [sessions, setSessions] = useState<string[]>([]);
  const [sessionDate, setSessionDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const datesRaw = await flowGet(`surface_dates:${root}`);
      if (cancelled) return;
      setSessions(isSurfaceDates(datesRaw) && datesRaw.root === root ? datesRaw.dates : []);
    })();
    return () => { cancelled = true; };
  }, [root]);

  // ── Theme → CSS custom properties on the surface root ────────────────────────
  // Applied as INLINE STYLE during render, not from an effect. React commits style before
  // running effects, and child effects run before the parent's — so an effect here would set
  // the variables AFTER the panes had already re-resolved them, and the field would keep its
  // old palette while the legend switched (which is exactly what it did). Rendering the
  // properties means the new values are on the DOM before any pane reads them.
  const themeSig = themeSignature(theme);
  const themeVars = surfaceThemeVars(theme) as React.CSSProperties;
  const contrastMode = effectiveContrast(theme);

  function commitTheme(next: SurfaceTheme) {
    setTheme(next);
    saveTheme(next);
  }

  // Plain handlers, recreated each render — cheap closures that aren't handed to a
  // memoized child or an effect dep list, so referential stability buys nothing here.
  const commit = () => {
    const r = inputVal.trim().toUpperCase();
    if (!r || r === root) return;
    // Root honesty: only the materialised roots have a field. Anything else gets told so
    // by name, rather than being switched to and left staring at an empty chart.
    if (!SURFACE_ROOTS.includes(r)) { setMissingRoot(r); return; }
    trackSearch(r, "surface");
    setMissingRoot(null);
    setSessionDate(null);
    setSessions([]);
    setPins([]);
    setRoot(r);
  };

  const selectRoot = (r: string) => {
    setMissingRoot(null);
    setInputVal(r);
    if (r === root) return;
    trackSearch(r, "surface");
    setSessionDate(null);
    setSessions([]);
    setPins([]);
    setRoot(r);
  };

  const togglePin = (strike: number, metric: string, value: number | null) => {
    setPins((prev) =>
      prev.some((p) => p.id === pinId(strike))
        ? removePin(prev, pinId(strike))
        : addPin(prev, { id: pinId(strike), strike, metric, value }),
    );
  };

  return (
    <div ref={rootRef} style={{ ...OUTER, ...themeVars }} className="obs obs-ambient">
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div style={HEAD} className="obs-surf-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={TITLE}>{t("surfaceTitle")}</span>
          <span style={SUBTITLE}>{t("surfaceSubtitle")}</span>
        </div>

        <div style={TOOLS} className="obs-surf-head-tools">
          {/* View: single field vs the 2×2 metric grid */}
          <div style={GROUP} role="group" aria-label={t("viewAria")}>
            <button className={`obs-chip${view === "single" ? " on" : ""}`} style={CHIP}
              aria-pressed={view === "single"} onClick={() => setView("single")}>
              {t("viewSingle")}
            </button>
            <button className={`obs-chip${view === "quad" ? " on" : ""}`} style={CHIP}
              aria-pressed={view === "quad"} onClick={() => setView("quad")}>
              {t("viewQuad")}
            </button>
          </div>

          {/* Quad's shared CANDLE interval (the field snapshots are never resampled). */}
          {view === "quad" && (
            <div style={GROUP} role="group" aria-label={t("aggAria")}>
              <span className="obs-lbl">{t("candleInterval")}</span>
              {[1, 5, 15, 30].map((m) => (
                <button key={m} className={`obs-chip${aggMin === m ? " on" : ""}`} style={CHIP}
                  aria-pressed={aggMin === m} onClick={() => setAggMin(m)}>
                  {t(m === 1 ? "agg1m" : m === 5 ? "agg5m" : m === 15 ? "agg15m" : "agg30m")}
                </button>
              ))}
            </div>
          )}

          {view === "quad" && (
            <div style={GROUP} role="group" aria-label={t("timeWindowAria")}>
              <span className="obs-lbl">{t("timeWindow")}</span>
              <button className={`obs-chip${timeWindow === "surface" ? " on" : ""}`} style={CHIP}
                aria-pressed={timeWindow === "surface"} onClick={() => setTimeWindow("surface")}>
                {t("timeWindowSurface")}
              </button>
              <button className={`obs-chip${timeWindow === "session" ? " on" : ""}`} style={CHIP}
                aria-pressed={timeWindow === "session"} onClick={() => setTimeWindow("session")}>
                {t("timeWindowSession")}
              </button>
            </div>
          )}

          <SurfaceStylePopover
            lang={lang}
            theme={theme}
            open={styleOpen}
            onOpenChange={setStyleOpen}
            onChange={commitTheme}
          />

          {/* Root picker — the materialised roots, plus a free-text box that tells the
              truth about anything else. */}
          <div style={TICKER_GROUP}>
            <input
              style={TICKER_INPUT}
              className="obs-surf-root-input"
              list="surface-roots"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value.toUpperCase())}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
              aria-label={t("rootPickerAria")}
              spellCheck={false}
              maxLength={12}
            />
            <datalist id="surface-roots">
              {SURFACE_ROOTS.map((r) => <option key={r} value={r} />)}
            </datalist>
            <div style={{ display: "flex", gap: "var(--sp-1)" }}>
              {SURFACE_ROOTS.map((r) => (
                <button key={r} className={`chip${root === r && !missingRoot ? " on" : ""}`}
                  style={ROOT_CHIP}
                  onClick={() => selectRoot(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Pinned strike chips ──────────────────────────────────────────────── */}
      {pins.length > 0 && (
        <div className="obs-surf-pins" role="group" aria-label={t("pinnedAria")}>
          <span className="obs-surf-pins-lbl">{t("pinnedLabel")}</span>
          {pins.map((p) => (
            <span className="obs-surf-pin-chip" key={p.id}>
              {p.strike}
              <button
                className="obs-surf-pin-x"
                onClick={() => setPins((prev) => removePin(prev, p.id))}
                aria-label={`${t("pinnedRemoveAria")} ${p.strike}`}
              >
                ×
              </button>
            </span>
          ))}
          <span className="obs-surf-pins-note">{t("pinnedSessionNote")}</span>
          <button className="obs-surf-pins-clear" onClick={() => setPins([])}>
            {t("pinnedClearAll")}
          </button>
        </div>
      )}

      {/* ── Field ────────────────────────────────────────────────────────────── */}
      {missingRoot ? (
        <div className="obs-surf-noroot">
          <div className="obs-surf-noroot-hd">
            {t("rootNoSurface").replace("{sym}", missingRoot)}
          </div>
          <div className="obs-surf-noroot-sub">{t("rootNoSurfaceHint")}</div>
          <div className="obs-surf-noroot-roots">
            {SURFACE_ROOTS.map((r) => (
              <button key={r} className="chip" style={ROOT_CHIP_LG} onClick={() => selectRoot(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Root/session changes start their own replay. A presentation-only layout
           switch remounts charts without resetting the shared selected time. */
        <ReplayProvider key={`${root}:${sessionDate ?? "live"}`} root={root} sessionDate={sessionDate}>
          <GroupRoot
            root={root}
            view={view}
            aggMin={aggMin}
            timeWindow={timeWindow}
            onTimeWindow={setTimeWindow}
            themeSig={themeSig}
            contrastMode={contrastMode}
            pins={pins}
            onTogglePin={togglePin}
            tideMinutes={tideMinutes}
            tideDate={tide?.session_date}
            sessions={sessions}
            onSessionDate={setSessionDate}
          />
        </ReplayProvider>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const OUTER: React.CSSProperties = {
  display: "flex", flexDirection: "column", flex: 1, height: "100%", overflow: "hidden", background: "var(--bg)",
};

// 16px horizontal padding is the family's shared left rail — the toolbar, the pane
// controls, the replay bar and the session strip all stack on one vertical edge.
const HEAD: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)",
  padding: "var(--sp-2) var(--sp-4)", borderBottom: "1px solid var(--line)",
  background: "var(--panel)", flexShrink: 0, flexWrap: "wrap",
};

const TOOLS: React.CSSProperties = { display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" };

const GROUP: React.CSSProperties = { display: "flex", gap: "var(--sp-1)", alignItems: "center" };

const CHIP: React.CSSProperties = {
  height: 28, minWidth: 34, justifyContent: "center",
  fontSize: "var(--fs-label)", fontWeight: 600, padding: "0 var(--sp-3)",
};

/** The materialised-root shortcuts, sized to sit level with the toolbar chips. */
const ROOT_CHIP: React.CSSProperties = {
  height: 28, fontSize: "var(--fs-label)", fontWeight: 700, letterSpacing: "0.03em",
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

/** Same chip, one step up, in the empty "no surface for X" state where it is the CTA. */
const ROOT_CHIP_LG: React.CSSProperties = {
  height: 32, fontSize: "var(--fs-ui)", fontWeight: 700, letterSpacing: "0.03em",
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

const TITLE: React.CSSProperties = {
  fontSize: "var(--fs-emph)", fontWeight: 700, color: "var(--text)", letterSpacing: "0.01em",
};

const SUBTITLE: React.CSSProperties = { fontSize: "var(--fs-micro)", color: "var(--muted)" };

const TICKER_GROUP: React.CSSProperties = { display: "flex", alignItems: "center", gap: "var(--sp-2)" };

const TICKER_INPUT: React.CSSProperties = {
  width: 110, height: 32, padding: "0 var(--sp-3)",
  background: "var(--inset)", border: "1px solid var(--line)", borderRadius: "var(--r-tile)",
  color: "var(--text)", fontSize: "var(--fs-body)", fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.06em", outline: "none",
  fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums",
};

const GROUP_ROOT: React.CSSProperties = { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, outline: "none" };

const SESSION_WRAP: React.CSSProperties = {
  flexShrink: 0, borderTop: "1px solid var(--line)", background: "var(--panel)",
};

/** .obs-lbl owns the micro-label type; this is the button reset + the shared left rail.
 *  36px keeps the collapse control on the tap-target floor. */
const SESSION_TOGGLE: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "var(--sp-2)", width: "100%", minHeight: 36,
  padding: "var(--sp-2) var(--sp-4)", border: 0, background: "none", cursor: "pointer",
  textAlign: "left",
};
