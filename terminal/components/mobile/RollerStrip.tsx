"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import styles from "./RollerStrip.module.css";

/**
 * The phone chart's bottom strip — a port of apps/ios/MastermindTerminal/RollerStrip.swift, whose
 * geometry is measured off TradingView iOS: 51.7px tall on pure black with a single top hairline,
 * `[ FIXED: symbol wheel · interval wheel ] [ 16px fade ] [ SCROLLABLE icon cluster ]`. The wheels
 * are anchored — scrolling the cluster never moves them, and the cluster's leading edge dissolves
 * under the fade so an icon scrolling out cannot crowd the interval label.
 *
 * Wheel mechanics (RollerStrip.swift WheelMetrics): 23px row pitch, the neighbours ghosted at 34%
 * and FULL size, the value committing live per detent rather than on release, and a flick coasting
 * on its predicted end position. Tapping the selected symbol chamber opens search — TV's verb;
 * there is deliberately no separate search button.
 *
 * Not rendered in native shell mode: the installable app brings its own native strip.
 */

const ROW = 23;
const GHOST = 0.34;
const TAP_SLOP = 4;
/** Flick projection, in ms of coasting applied to the release velocity. */
const FLICK_MS = 90;

type WheelProps = {
  items: string[];
  value: string;
  width: number;
  label: string;
  testId: string;
  onPick: (value: string) => void;
  /** Symbol wheel only: a tap (not a roll) on the centre chamber opens search. */
  onCentreTap?: () => void;
};

function Wheel({ items, value, width, label, testId, onPick, onCentreTap }: WheelProps) {
  const index = Math.max(0, items.indexOf(value));
  const [centre, setCentre] = useState<number | null>(null);
  // Rolling is render state (it suspends the settle transition), so it cannot live on the ref.
  const [rolling, setRolling] = useState(false);
  const drag = useRef<{ startY: number; origin: number; id: number; lastY: number; lastT: number; v: number } | null>(null);
  const at = centre ?? index;

  const commit = (next: number) => {
    const clamped = Math.min(items.length - 1, Math.max(0, next));
    if (items[clamped] !== undefined && items[clamped] !== value) onPick(items[clamped]);
  };

  function onDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || !items.length) return;
    drag.current = { startY: event.clientY, origin: index, id: event.pointerId, lastY: event.clientY, lastT: performance.now(), v: 0 };
    setRolling(true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* gesture arbitration */ }
  }

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - state.lastT);
    state.v = (event.clientY - state.lastY) / dt;
    state.lastY = event.clientY;
    state.lastT = now;
    const travelled = (event.clientY - state.startY) / ROW;
    const next = Math.min(items.length - 1, Math.max(0, state.origin - travelled));
    setCentre(next);
    // The value commits live, per detent — the chart hot-swaps under the finger.
    commit(Math.round(next));
  }

  function onUp(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    setRolling(false);
    const dy = event.clientY - state.startY;
    setCentre(null);
    if (Math.abs(dy) < TAP_SLOP) {
      const box = event.currentTarget.getBoundingClientRect();
      const onCentreRow = Math.abs(event.clientY - (box.top + box.height / 2)) <= ROW / 2 + 3;
      if (onCentreRow) onCentreTap?.();
      return;
    }
    // UIKit-style projection: a flick that should coast three rows must not die at the fingertip.
    commit(Math.round(state.origin - (dy + state.v * FLICK_MS) / ROW));
  }

  return (
    <div
      className={`mrs-wheel${rolling ? " is-dragging" : ""}`}
      style={{ width }}
      data-testid={testId}
      role="slider"
      aria-label={label}
      aria-valuetext={value}
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, items.length - 1)}
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => { drag.current = null; setRolling(false); setCentre(null); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") { event.preventDefault(); commit(index - 1); }
        else if (event.key === "ArrowDown") { event.preventDefault(); commit(index + 1); }
        else if (event.key === "Enter" && onCentreTap) { event.preventDefault(); onCentreTap(); }
      }}
    >
      <div className="mrs-wheel-track" style={{ transform: `translateY(${-at * ROW}px)` }}>
        {items.map((item, i) => (
          <span
            key={`${item}-${i}`}
            className={`mrs-wheel-item${i === Math.round(at) ? " on" : ""}`}
            style={{ top: i * ROW - ROW / 2, opacity: 1 - (1 - GHOST) * Math.min(Math.abs(i - at), 1) }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export type RollerStripProps = {
  symbols: string[];
  symbol: string;
  onSymbol: (sym: string) => void;
  onTapSymbol: () => void;
  timeframes: string[];
  timeframe: string;
  onTimeframe: (tf: string) => void;
  onDraw: () => void;
  drawActive: boolean;
  onMore: () => void;
  moreBadge: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export default function RollerStrip({
  symbols, symbol, onSymbol, onTapSymbol,
  timeframes, timeframe, onTimeframe,
  onDraw, drawActive, onMore, moreBadge, onUndo, onRedo, canUndo, canRedo,
}: RollerStripProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function share() {
    const url = `${window.location.origin}/terminal?symbol=${encodeURIComponent(symbol)}`;
    try {
      if (navigator.share) { await navigator.share({ title: symbol, url }); return; }
    } catch { /* the user dismissed the OS sheet */ return; }
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* clipboard denied */ }
  }

  return (
    <div className="mrs" data-testid="roller-strip" role="toolbar" aria-label={t("stripLabel")}>
      <div className="mrs-wheels">
        <Wheel
          items={symbols}
          value={symbol}
          width={83.4}
          label={t("stripSymbol")}
          testId="roller-symbol"
          onPick={onSymbol}
          onCentreTap={onTapSymbol}
        />
        <Wheel
          items={timeframes}
          value={timeframe}
          width={54}
          label={t("stripInterval")}
          testId="roller-interval"
          onPick={onTimeframe}
        />
      </div>
      <div className="mrs-cluster" data-testid="roller-cluster">
        <div className={`mrs-cluster-row ${styles.clusterRow}`}>
          <button className={`mrs-ic ${styles.action}${drawActive ? " on" : ""}`} onClick={onDraw} aria-label={t("stripDraw")} data-testid="roller-draw">
            <span className={styles.actionSurface} data-roller-visual="true">
              <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3M15 7l3 3" /></svg>
            </span>
          </button>
          <button className={`mrs-ic ${styles.action}`} onClick={onMore} aria-label={t("stripMore")} data-testid="roller-more">
            <span className={styles.actionSurface} data-roller-visual="true">
              <svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="18.5" cy="12" r="1.9" /></svg>
              {moreBadge && <i className="mrs-dot" data-testid="roller-more-badge" />}
            </span>
          </button>
          <span className="mrs-div" aria-hidden="true" />
          <button className={`mrs-ic ${styles.action}`} onClick={onUndo} disabled={!canUndo} aria-label={t("stripUndo")} data-testid="roller-undo">
            <span className={styles.actionSurface} data-roller-visual="true">
              <svg viewBox="0 0 24 24"><path d="M9 7L4 12l5 5M4 12h9a6 6 0 0 1 0 12h-1" /></svg>
            </span>
          </button>
          <button className={`mrs-ic ${styles.action}`} onClick={onRedo} disabled={!canRedo} aria-label={t("stripRedo")} data-testid="roller-redo">
            <span className={styles.actionSurface} data-roller-visual="true">
              <svg viewBox="0 0 24 24"><path d="M15 7l5 5-5 5M20 12h-9a6 6 0 0 0 0 12h1" /></svg>
            </span>
          </button>
          <button className={`mrs-ic ${styles.action}`} onClick={share} aria-label={t("stripShare")} data-testid="roller-share">
            <span className={styles.actionSurface} data-roller-visual="true">
              <svg viewBox="0 0 24 24"><path d="M12 16V4M8 8l4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" /></svg>
            </span>
          </button>
        </div>
      </div>
      {copied && <span className="mrs-toast" role="status">{t("stripLinkCopied")}</span>}
    </div>
  );
}
