"use client";
// CMX W3 — the Conductor overlay. The Brain's chart work, made visible + narrated.
//
// Mounted inside the chart pane container (.chart-body, position:relative) as an absolute overlay that
// spans the pane and NEVER intercepts pointer events — only the orb, plate, and rail are interactive,
// so the chart stays fully usable underneath. It subscribes to the CMX W1 CommandQueue (lib/chartBus:
// onBatchStart / on(step) / onDrain — the last two added in W3) and turns that stream into one
// orchestrated moment: a drawing draws itself while a plain caption says why.
//
// All transition/caption/count logic lives in the DOM-free lib/conductorState.ts state machine (unit-
// tested in the repo's pure-vitest idiom); this file is the thin view — it feeds queue events into the
// reducer, owns the wall-clock timers (pace, done-settle, done-window, orb-linger) the machine can't,
// drives the ghost cursor + the <html data-cmx-anim> flag ChartPanel reads for stroke animations, and
// renders orb / plate / rail / cursor / frame per the design.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CommandQueue, QueueStep } from "@/lib/chartBus";
import {
  conductorReducer, initialConductorState, opFamily, type OpFamily,
  PACE_MS, DONE_SETTLE_MS, DONE_WINDOW_MS, ORB_LINGER_MS,
} from "@/lib/conductorState";
import { getActivePaneCoords } from "@/lib/paneCoords";
import { useLang, useT } from "@/lib/i18n";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// 1.8px-stroke SVG glyphs per op family — line / zone / fib / label / chart-op / ai / scene.
const FAMILY_ICON: Record<OpFamily, React.ReactNode> = {
  line: <svg viewBox="0 0 16 16"><path d="M2 13L14 3" /><circle cx="2" cy="13" r="1.4" /><circle cx="14" cy="3" r="1.4" /></svg>,
  zone: <svg viewBox="0 0 16 16"><rect x="2.5" y="4.5" width="11" height="7" rx="1" /></svg>,
  fib: <svg viewBox="0 0 16 16"><path d="M2 4h12M2 7h12M2 10h12M2 13h12" /></svg>,
  label: <svg viewBox="0 0 16 16"><path d="M2.5 2.5h7l4 4v7h-11z" /><path d="M9.5 2.5v4h4" /></svg>,
  chart: <svg viewBox="0 0 16 16"><path d="M2 14V2M2 14h12M5 11l3-4 2 2 3-5" /></svg>,
  ai: <svg viewBox="0 0 16 16"><path d="M8 2.5v11M2.5 8h11" /><circle cx="8" cy="8" r="5.2" /></svg>,
  scene: <svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1" /><path d="M2.5 6.5h11" /></svg>,
};

export type ChartConductorProps = {
  queue: CommandQueue;    // the CMX W1 command queue (the emitter we conduct)
  count: number;          // live AI object count on the active symbol (for the done "N on chart" line)
};

export default function ChartConductor({ queue, count }: ChartConductorProps) {
  const { lang } = useLang();
  const t = useT();
  const [state, dispatch] = useReducer(conductorReducer, undefined, initialConductorState);
  const [railOpen, setRailOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [dockBR, setDockBR] = useState(false); // orb/plate/rail dock bottom-right (OHLC-readout collision)
  // orb visibility lingers past the done window (12s) then fades; the frame/plate follow the machine.
  const [orbVisible, setOrbVisible] = useState(false);
  // The overlay root is rendered whenever there's anything to show. `rendered` gates the ResizeObserver
  // effect so it re-attaches when the root mounts (the root is null between sessions → an on-mount-only
  // RO would never observe it). Derived early so the effects below can depend on it.
  const active = state.phase !== "idle";
  const rendered = active || orbVisible || railOpen;
  // a per-op "acting" pulse: `pulseKey` re-triggers the 180ms animation (via the orb's React key),
  // `pulsing` overlays is-acting for that window then clears so the orb settles back to the breathe.
  const [pulseKey, setPulseKey] = useState(0);
  const [pulsing, setPulsing] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const railBodyRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const langRef = useRef(lang); langRef.current = lang;
  // Whether THIS session animates (motion on): false under reduced-motion. Set at each batch-start.
  const animatingRef = useRef(false);
  // Timers we own (the machine is timer-free). Cleared on unmount / new session.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = useCallback(() => {
    for (const r of [settleTimer, windowTimer, lingerTimer]) { if (r.current) { clearTimeout(r.current); r.current = null; } }
  }, []);

  // Keep a live handle on the latest count so the drain handler reads the true on-chart total.
  const countRef = useRef(count); countRef.current = count;

  // ── the <html data-cmx-anim> flag ChartPanel's shape() reads to gate stroke animations ──
  const setAnimFlag = useCallback((on: boolean) => {
    if (typeof document === "undefined") return;
    if (on) document.documentElement.setAttribute("data-cmx-anim", "on");
    else document.documentElement.removeAttribute("data-cmx-anim");
  }, []);

  // ── ghost cursor: glide to the op's first anchor (in pane pixels) as its stroke is about to draw ──
  // The step carries {anchor:{t,p}} (chartBus W3); the active pane's resolver maps it to pane pixels via
  // the exact DrawLayer transform. We then map that pane-local point into the overlay root's own box.
  // A miss (no resolver, off-screen point, no anchor) → skip the glide; the stroke is the real signal.
  const glideCursor = useCallback((step: QueueStep) => {
    if (!animatingRef.current) return;                 // no cursor under reduced-motion / pace 0
    if (!step.ok || !step.anchor) return;
    const el = cursorRef.current, root = rootRef.current; if (!el || !root) return;
    const coords = getActivePaneCoords();
    const px = coords?.toPx(step.anchor.t, step.anchor.p);
    const paneRect = coords?.rect();
    if (!px || !paneRect) return;
    const rr = root.getBoundingClientRect();
    // pane-local px → overlay-root-local (pane rect and root rect coincide in the single-pane case)
    const tx = (paneRect.left - rr.left) + px.x;
    const ty = (paneRect.top - rr.top) + px.y;
    el.style.left = tx + "px"; el.style.top = ty + "px";
    el.classList.add("on");
    if (cursorTimer.current) clearTimeout(cursorTimer.current);
    // fade out ~260ms after arrival, as the stroke begins
    cursorTimer.current = setTimeout(() => { el.classList.remove("on"); }, 260);
  }, []);

  // ── subscribe to the queue lifecycle + step stream ──
  useEffect(() => {
    const offStart = queue.onBatchStart(() => {
      clearTimers();
      // Reduced motion is detected at the START edge (before the overlay root mounts for this session,
      // so rootRef is still null here). Check the real OS query AND the harness's .cmx-rm simulation
      // anywhere in the document (the harness wrapper exists pre-session).
      const reduced = prefersReducedMotion() || (typeof document !== "undefined" && !!document.querySelector(".cmx-rm"));
      const motion = !reduced;
      animatingRef.current = motion;
      queue.delayMs = motion ? PACE_MS : 0;   // pace the session (or instant under reduced-motion)
      setAnimFlag(motion);
      setOrbVisible(true);
      dispatch({ type: "start" });
    });
    const offStep = queue.on((step) => {
      dispatch({ type: "step", step, lang: langRef.current });
      if (step.ok) { setPulseKey((k) => k + 1); setPulsing(true); glideCursor(step); }
    });
    const offDrain = queue.onDrain(() => {
      setAnimFlag(false);
      // done-settle: wait 1.2s for a follow-on batch; if none, the machine goes to "done".
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        dispatch({ type: "drain" });
        // done plate shows for its window, then collapses (machine → idle); orb lingers then fades.
        if (windowTimer.current) clearTimeout(windowTimer.current);
        windowTimer.current = setTimeout(() => dispatch({ type: "doneWindowElapsed" }), DONE_WINDOW_MS);
        if (lingerTimer.current) clearTimeout(lingerTimer.current);
        lingerTimer.current = setTimeout(() => setOrbVisible(false), DONE_WINDOW_MS + ORB_LINGER_MS);
      }, DONE_SETTLE_MS);
    });
    return () => { offStart(); offStep(); offDrain(); };
  }, [queue, clearTimers, setAnimFlag, glideCursor]);

  // clean up all timers + the html flag on unmount
  useEffect(() => () => { clearTimers(); if (cursorTimer.current) clearTimeout(cursorTimer.current); setAnimFlag(false); }, [clearTimers, setAnimFlag]);

  // ── narrow detection (≤480px pane) + orb dock-collision measurement ──
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    const measure = () => {
      const w = root.clientWidth;
      setNarrow(w > 0 && w <= 480);
      // Dock-collision: if the top-right corner (where the orb wants to sit) is occupied by the OHLC
      // legend / pane-ops readout, dock bottom-right instead. Probe the orb's target center point.
      try {
        const r = root.getBoundingClientRect();
        const probeX = r.right - 10 - 17; // orb center ≈ inset 10 + radius 17
        const probeY = r.top + 10 + 17;
        const hit = document.elementFromPoint(probeX, probeY) as HTMLElement | null;
        const occluded = !!hit && !hit.closest(".cmx") && !!hit.closest(".lg-block, .pane-ops, .lg-more");
        setDockBR(occluded);
      } catch { /* elementFromPoint unavailable — keep default top-right */ }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [rendered]);

  // clear the per-op pulse after its 180ms window so the orb settles back to the breathe
  useEffect(() => {
    if (!pulsing) return;
    const id = setTimeout(() => setPulsing(false), 180);
    return () => clearTimeout(id);
  }, [pulsing, pulseKey]);

  // auto-follow the rail to the newest row
  useEffect(() => {
    if (railOpen && railBodyRef.current) railBodyRef.current.scrollTop = railBodyRef.current.scrollHeight;
  }, [state.rows.length, railOpen]);

  // ESC closes the rail only (never the whole overlay)
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setRailOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [railOpen]);

  const skip = useCallback(() => {
    animatingRef.current = false;
    queue.delayMs = 0;
    queue.applyInstantly();
    setAnimFlag(false);
  }, [queue, setAnimFlag]);

  const doneLine = useMemo(
    () => t("cmxDone").replace("{n}", String(countRef.current || state.applied)),
    [t, state.phase, state.applied],
  );
  // plate copy: the current caption, or the done line while in done phase.
  const plateText = state.phase === "done" ? doneLine : state.caption;
  const plateShow = active && (!!plateText || state.phase === "done");

  // orb phase class. Priority: a transient per-op pulse overrides everything for its 180ms; otherwise
  // the orb blooms on the first summoned frame, settles to done when finished, and breathes (thinking)
  // for the rest of a live session — so between paced draws the orb breathes, and each applied op pulses.
  const orbPhase = pulsing ? "is-acting"
    : state.phase === "summoned" ? "is-summoned"
    : state.phase === "done" ? "is-done"
    : active ? "is-thinking"
    : "is-done"; // idle-but-lingering after done → stay settled (no breathe)

  const dockCls = dockBR ? " dock-br" : "";

  // Nothing rendered while fully idle AND the orb has faded AND the rail is closed — keeps the DOM
  // clean between sessions. The rail may linger open (with the last session's rows) past the orb fade.
  if (!rendered) { if (typeof document !== "undefined") setAnimFlag(false); return null; }

  return (
    <div ref={rootRef} className={`cmx${active ? " is-active" : ""}${narrow ? " narrow" : ""}`} aria-hidden={false}>
      {/* Frame — inset ring + corner vignette while the session is live */}
      <div className="cmx-frame" aria-hidden="true" />

      {/* Ghost cursor */}
      <div ref={cursorRef} className="cmx-cursor" aria-hidden="true" />

      {/* Orb — click toggles the rail */}
      {orbVisible && (
        <button
          type="button"
          className={`cmx-orb ${orbPhase}${dockCls}`}
          key={pulsing ? `pulse-${pulseKey}` : "orb"}
          title="Mastermind AI"
          aria-label="Mastermind AI"
          aria-expanded={railOpen}
          onClick={() => setRailOpen((o) => !o)}
        />
      )}

      {/* Caption plate — extends left from the orb; Skip + rail-chevron on the right edge */}
      {orbVisible && (
        <div className={`cmx-plate${plateShow ? " show" : ""}${dockCls}`} aria-live="polite">
          <span className="cmx-plate-text">
            {/* keyed by the swap counter so each caption change re-runs the crossfade/slide-up */}
            <span className="cmx-cap" key={state.captionSwapKey}>{plateText}</span>
          </span>
          <span className="cmx-plate-ctl">
            <button type="button" className="cmx-btn cmx-skip" onClick={skip} title={t("cmxSkipAnim")} aria-label={t("cmxSkip")}>
              <span className="chv" aria-hidden="true">»</span>{t("cmxSkip")}
            </button>
            <button
              type="button"
              className="cmx-btn"
              onClick={() => setRailOpen((o) => !o)}
              title={railOpen ? t("cmxHideSteps") : t("cmxToggleSteps")}
              aria-label={railOpen ? t("cmxHideSteps") : t("cmxToggleSteps")}
              aria-expanded={railOpen}
            >
              <svg className={`cmx-chev${railOpen ? " open" : ""}`} viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" /></svg>
            </button>
          </span>
        </div>
      )}

      {/* Step rail — thinking in full view. Stays openable while the orb lingers or rows remain from a
          just-finished session, so a rail opened after the sequence still shows what was drawn. */}
      {railOpen && (orbVisible || state.rows.length > 0) && (
        <div className={`cmx-rail${dockCls}`} role="log" aria-label={t("cmxLiveSteps")}>
          <div className="cmx-rail-hd">
            <span className="dot" aria-hidden="true" />
            {t("cmxLiveSteps")}
            <span className="n">{state.rows.length}</span>
          </div>
          <div className="cmx-rail-body" ref={railBodyRef}>
            {state.rows.map((r) => (
              <div className={`cmx-row${r.ok ? "" : " rej"}`} key={r.seq}>
                <span className="ico" aria-hidden="true">{FAMILY_ICON[r.family] ?? FAMILY_ICON.line}</span>
                <span className="cap">{r.caption}</span>
                {r.fit && (
                  <span className="fit">{r.fit.touches} touches · {r.fit.max_dev_atr} ATR</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
