"use client";
/**
 * ReplayBar — the global-to-the-pane-group replay scrubber.
 *
 * session picker · ⏮ ◀ ▶(Space) ⏭ · speeds 1x/2x/4x/8x · scrubber (with session-structure
 * bands) · frame counter · LIVE badge (pulsing obs-live-dot at the head of the live session)
 * or an archived-session badge. All state lives in replayContext (lib/replayEngine reducer);
 * keyboard Home/End/Space/←/→ are bound in the provider. This component is pure display +
 * dispatch — no timers of its own.
 *
 * The session picker is rendered only when the caller supplies archived sessions (i.e. the
 * sessions index resolved and lists a day behind today). With no index the bar is byte-for-byte
 * the today-only control it always was.
 */

import React, { useState } from "react";
import ui from "./SurfaceWorkspace.module.css";
import { useReplay } from "./replayContext";
import { makeSurfaceT } from "./surfaceStrings";
import {
  REPLAY_SPEEDS,
  fmtStamp,
  frameClockPositions,
  frameGapStats,
  sessionBands,
} from "@/lib/replayEngine";
import type { Lang } from "@/lib/i18n";

function fmtGap(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds >= 60) {
    const mins = seconds / 60;
    return `${Number.isInteger(mins) ? mins.toFixed(0) : mins.toFixed(1)}m`;
  }
  return `${Math.round(seconds)}s`;
}

export function ReplayBar({
  lang,
  sessions = [],
  onSessionDate,
}: {
  lang: Lang;
  /** Archived session dates, newest first. Empty → no picker (today-only, unchanged). */
  sessions?: string[];
  onSessionDate?: (date: string | null) => void;
}) {
  const t = makeSurfaceT(lang);
  // `sessionDate` comes from the context, not a prop, so the picker's value and the badge
  // can never disagree about which session is actually loaded.
  const { state, dispatch, asOfStamp, live, archived, sessionDate, indexError } = useReplay();
  const { stamps, frame, playing, speed } = state;
  const hasFrames = stamps.length > 0;
  const hasSelection = asOfStamp != null;
  const positions = frameClockPositions(stamps);
  const gaps = frameGapStats(stamps);
  const [dragStamp, setDragStamp] = useState<string | null>(null);
  const previewFrame = dragStamp == null ? -1 : stamps.indexOf(dragStamp);
  const displayFrame = previewFrame < 0 ? frame : previewFrame;
  const currentPosition = positions[displayFrame] ?? 0;
  const canSeek = stamps.length > 1;
  function frameAtPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    let nearest = 0;
    positions.forEach((position, index) => {
      if (Math.abs(position - fraction) < Math.abs(positions[nearest] - fraction)) nearest = index;
    });
    return nearest;
  }
  const showPicker = sessions.length > 0 && !!onSessionDate;
  // Transport geometry, dimmed when there is nothing to step through. The .obs-chip
  // primitive has no :disabled state of its own, so the affordance is carried here.
  const btn: React.CSSProperties = hasFrames ? ICON_BTN : { ...ICON_BTN, ...ICON_BTN_OFF };

  return (
    <div style={BAR} className={`obs-surf-replay ${ui.replay}`} role="group" aria-label={t("replayTitle")}>
      {/* Session picker — multi-day replay. A native select keeps the keyboard and the
          mobile pickers for free, and stays out of the replay keybinds (the provider
          ignores keys while a form control has focus). */}
      {showPicker && (
        <select
          style={SESSION_SELECT}
          className="num obs-surf-replay-session"
          aria-label={t("sessionPickerAria")}
          value={sessionDate ?? ""}
          onChange={(e) => onSessionDate!(e.target.value || null)}
        >
          <option value="">{t("sessionToday")}</option>
          {sessions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      )}

      {/* Transport buttons — .obs-chip shell at a 36px tap target. Play carries the
          primary-action tint at rest and goes fully brand-filled (.on) while running,
          so "is it playing?" is answerable from across the desk. */}
      <div style={BTN_GROUP} className="obs-surf-replay-transport">
        <button className="obs-chip" style={btn} aria-label={t("replayFirst")} disabled={!canSeek || (frame === 0 && !state.missingStamp)}
          onClick={() => dispatch({ type: "toFirst" })}>
          <Icon d="M18 6l-6 6 6 6M8 6v12" />
        </button>
        <button className="obs-chip" style={btn} aria-label={t("replayPrev")} disabled={!canSeek || frame === 0}
          onClick={() => dispatch({ type: "stepBack" })}>
          <Icon d="M15 6l-6 6 6 6" />
        </button>
        <button className={`obs-chip${playing ? " on" : ""}`}
          style={{ ...btn, ...(playing ? undefined : PLAY_BTN) }}
          aria-label={playing ? t("replayPause") : t("replayPlay")}
          disabled={!canSeek} onClick={() => dispatch({ type: "togglePlay" })}>
          {playing ? <Icon d="M7 5h3v14H7zM14 5h3v14h-3z" fill /> : <Icon d="M7 5l12 7-12 7z" fill />}
        </button>
        <button className="obs-chip" style={btn} aria-label={t("replayNext")} disabled={!canSeek || frame === stamps.length - 1}
          onClick={() => dispatch({ type: "stepFwd" })}>
          <Icon d="M9 6l6 6-6 6" />
        </button>
        <button className="obs-chip" style={btn} aria-label={t("replayLast")} disabled={!canSeek && !state.missingStamp}
          onClick={() => dispatch({ type: "toLast" })}>
          <Icon d="M6 6l6 6-6 6M16 6v12" />
        </button>
      </div>

      <label className={`obs-surf-replay-speeds ${ui.speed}`}>
        <span>{t("replaySpeedAria")}</span>
        <select aria-label={t("replaySpeedAria")} disabled={!canSeek} value={speed}
          onChange={(event) => dispatch({ type: "setSpeed", speed: Number(event.target.value) as typeof speed })}>
          {REPLAY_SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
        </select>
      </label>

      {/* Observed-frame rail. Dots sit at their real wall-clock positions, so a missing
          interval becomes a visible gap instead of one innocent-looking range-input notch. */}
      <div style={SCRUB_WRAP} className="obs-surf-replay-rail-wrap">
        <div className="obs-surf-replay-rail-head">
          <strong>{t("replayTitle")}</strong>
          {gaps.medianSec != null && (
            <span className={gaps.irregular ? "is-irregular" : ""}>
              {gaps.irregular ? t("frameGapIrregular") : t("frameGapRegular")} · {fmtGap(gaps.medianSec)}
            </span>
          )}
        </div>
        <div
          className={`obs-surf-frame-rail ${ui.rail}${canSeek ? "" : " is-disabled"}`}
          role="slider"
          tabIndex={canSeek ? 0 : -1}
          aria-disabled={!canSeek}
          aria-valuemin={1}
          aria-valuemax={Math.max(1, stamps.length)}
          aria-valuenow={hasFrames ? displayFrame + 1 : 1}
          aria-valuetext={state.missingStamp ? `${fmtStamp(state.missingStamp)} · ${t("replaySelectionUnavailable")}` : hasFrames ? `${fmtStamp(stamps[displayFrame])} ET · ${displayFrame + 1}/${stamps.length}` : t("replayNoFrames")}
          aria-label={t("frameRailAria")}
          onPointerDown={(event) => {
            if (!canSeek || !event.isPrimary || event.button !== 0) return;
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            if (playing) dispatch({ type: "pause" });
            setDragStamp(stamps[frameAtPointer(event)]);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) setDragStamp(stamps[frameAtPointer(event)]);
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            if (canSeek) dispatch({ type: "setFrame", frame: frameAtPointer(event) });
            event.currentTarget.releasePointerCapture(event.pointerId);
            setDragStamp(null);
          }}
          onLostPointerCapture={() => setDragStamp(null)}
          onPointerCancel={() => setDragStamp(null)}
        >
          {sessionBands(stamps).map((band) => (
            <span key={band.key} className={ui.landmark}
              title={t(band.key === "power" ? "bandPowerAria" : band.key === "open" ? "bandOpenAria" : "bandCloseAria")}
              style={{ left: `${band.from * 100}%`, width: `${(band.to - band.from) * 100}%` }} />
          ))}
          <span className="obs-surf-frame-track" aria-hidden />
          <span className="obs-surf-frame-progress" style={{ width: `${currentPosition * 100}%` }} aria-hidden />
          {stamps.map((stamp, i) => (
            <span
              key={`${stamp}:${i}`}
              className={`obs-surf-frame-dot${hasSelection && i === displayFrame ? " is-current" : i < displayFrame ? " is-past" : ""}`}
              style={{ left: `${(positions[i] ?? 0) * 100}%` }}
              aria-hidden
              data-frame-position={(positions[i] ?? 0).toFixed(4)}
            />
          ))}
        </div>
        {hasFrames && <div className={ui.endpoints}>
          <span>{fmtStamp(stamps[0])} ET</span>
          {canSeek && (previewFrame >= 0 ? <strong>{t("releaseToView")} {fmtStamp(stamps[previewFrame])} ET</strong> : <span>{t("dragToSelect")}</span>)}
          {stamps.length > 1 && <span>{fmtStamp(stamps[stamps.length - 1])} ET</span>}
        </div>}
      </div>

      {/* Time + frame counter + LIVE / archived-session badge */}
      <div style={READOUT} className="obs-surf-replay-readout">
        {state.missingStamp ? (
          <span role="status">{fmtStamp(state.missingStamp)} · {t("replaySelectionUnavailable")}</span>
        ) : hasFrames ? (
          <>
            <label className={ui.observation}>
              <span>{t("observation")}</span>
              <select aria-label={t("observation")} value={asOfStamp ?? ""} disabled={!canSeek}
                onChange={(event) => dispatch({ type: "setFrame", frame: stamps.indexOf(event.target.value) })}>
                {stamps.map((stamp) => <option key={stamp} value={stamp}>{fmtStamp(stamp)} ET</option>)}
              </select>
            </label>
            <span style={FRAME_TXT} className="num">
              {frame + 1}/{stamps.length} {t("replayFrameOf")}
            </span>
            {/* An archived session is never LIVE, at its head or anywhere else — the badge
                names the day being replayed instead of claiming the present. */}
            {archived ? (
              <span className="obs-tag" style={ARCHIVED_BADGE}>
                <span className="num" style={{ fontWeight: 800 }}>{sessionDate}</span>
                <span style={ARCHIVED_WORD}>{t("sessionArchived")}</span>
              </span>
            ) : live ? (
              <span className="obs-tag" style={LIVE_BADGE}>
                {t("replayLive")}
              </span>
            ) : null}
          </>
        ) : (
          /* Honest empty: name the state AND why the scrubber has nothing to move over.
             An index that never loaded is a READ FAILURE, so it must not borrow the
             "this root has none for the selected day" copy, which asserts absence. */
          <span style={NO_FRAMES}>
            <span style={{ ...FRAME_TXT, color: "var(--text-2)", fontWeight: 600 }}>
              {indexError ? t("replayIndexFailed") : archived ? t("sessionEmptyArchive") : t("replayNoFrames")}
            </span>
            <span style={NO_FRAMES_WHY}>
              {indexError ? t("replayIndexFailedWhy") : t("replayNoFramesWhy")}
            </span>
          </span>
        )}
      </div>
      {/* Retention is only claimable when something was actually admitted and kept. */}
      {indexError && hasFrames && (
        <span role="status" className="obs-surf-replay-error">{t("replayRefreshFailed")}</span>
      )}
    </div>
  );
}

function Icon({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16"
      fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// The bar shares the family's 16px left rail with the toolbar above it and the session
// strip below, so the whole tab stacks on one vertical edge.
const BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-3)",
  padding: "var(--sp-2) var(--sp-4)",
  borderTop: "1px solid var(--line)",
  background: "var(--panel)",
  flexShrink: 0,
  flexWrap: "wrap",
};

const BTN_GROUP: React.CSSProperties = { display: "flex", alignItems: "center", gap: "var(--sp-1)" };

/** 36px square: the transport is the one control on this bar people hit repeatedly and
 *  on a trackpad mid-scrub, so it clears the tap-target floor rather than sitting at it. */
const ICON_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  padding: 0,
  borderRadius: "var(--r-tile)",
  cursor: "pointer",
};

const ICON_BTN_OFF: React.CSSProperties = { opacity: 0.38, cursor: "not-allowed" };

/** Resting play: brand-tinted primary action (not a white fill — see doctrine). */
const PLAY_BTN: React.CSSProperties = {
  color: "var(--brand-2)",
  background: "color-mix(in srgb, var(--brand) 17%, transparent)",
  borderColor: "color-mix(in srgb, var(--brand) 36%, transparent)",
};

/* Playing needs no override — .obs-chip.on carries the full brand fill. */



const SESSION_SELECT: React.CSSProperties = {
  height: 32,
  maxWidth: 152,
  padding: "0 var(--sp-2)",
  background: "var(--inset)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-tile)",
  color: "var(--text)",
  fontSize: "var(--fs-label)",
  fontWeight: 600,
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
  cursor: "pointer",
};

const SCRUB_WRAP: React.CSSProperties = {
  flex: 1,
  minWidth: 160,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};


/** A zero-width landmark (open / close): a hairline tick with its label beside it. */

/** A spanned window (power hour): a tinted block across its share of the track. */


const READOUT: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--sp-2)",
  fontSize: "var(--fs-label)",
  whiteSpace: "nowrap",
};

/** The replay clock is the readout's anchor: tabular, in the numeral face, one step up. */

const FRAME_TXT: React.CSSProperties = {
  color: "var(--text-2)",
  fontFamily: "var(--font-num)",
  fontVariantNumeric: "tabular-nums",
};

const NO_FRAMES: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2, whiteSpace: "normal", maxWidth: 300,
};

const NO_FRAMES_WHY: React.CSSProperties = {
  fontSize: "var(--fs-micro)", lineHeight: 1.45, color: "var(--muted)",
};

/** Tint tag on --up: the one place on this bar where direction colour is the meaning
 *  (a live feed), and it rides the token so east-mode flips it with everything else. */
const LIVE_BADGE: React.CSSProperties = {
  "--c": "var(--up)",
  fontWeight: 800,
  letterSpacing: "0.08em",
} as React.CSSProperties;

/** Replaces the LIVE badge while a past session is loaded. Deliberately NOT a direction
 *  colour — a replayed day is neither up nor down, and --up/--down flip by language. */
const ARCHIVED_BADGE: React.CSSProperties = {
  "--c": "var(--muted)",
  color: "var(--text-2)",
  gap: "var(--sp-1)",
} as React.CSSProperties;

const ARCHIVED_WORD: React.CSSProperties = {
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--muted)",
};
