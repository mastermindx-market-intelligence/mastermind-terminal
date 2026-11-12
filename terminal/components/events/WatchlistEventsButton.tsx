"use client";
/**
 * Opener for the watchlist event planner (E14). Two placements, one behavior:
 *   - "rail": a watchlist header action beside Add/Settings (desktop); inherits `.wl-acts button`.
 *   - "symbar": the phone/tablet symbol bar, where the rail's watchlist header is hidden. It stops
 *     the click from reaching the bar (whose own tap opens search).
 */
import { useEventPlannerT } from "@/lib/watchlistEventPlannerLex";
import styles from "./WatchlistEventsButton.module.css";

export default function WatchlistEventsButton({ variant, onOpen }: { variant: "rail" | "symbar"; onOpen: () => void }) {
  const t = useEventPlannerT();
  const label = t("wepOpen");
  return (
    <button
      type="button"
      className={variant === "symbar" ? styles.symbar : undefined}
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      data-testid={variant === "symbar" ? "m-events-open" : "wl-events-open"}
      onClick={(event) => { event.stopPropagation(); onOpen(); }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" />
      </svg>
    </button>
  );
}
