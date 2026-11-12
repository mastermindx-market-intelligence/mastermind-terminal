import { object } from "./sectorIntelligence";
import { strictDay } from "./sectorCycleRhythm";

/* ────────────────────────────────────────────────────────────────────────────
 * Phase age (Round 3 §6.4, donor #10707 phaseAge + SC_FACE phaseAge). Age is
 * measured in ACTUAL trading sessions from the phase-forward log, never in
 * calendar days. A record whose history starts after the phase began can only
 * support a LOWER BOUND — "at least N sessions (history starts {date})" — which
 * is a different, weaker statement than a measurement and renders as such.
 *
 * Cross-field agreement is required: the structured block (phase_v2_age.status/
 * .sessions) must equal the denormalized fields (phase_v2_age_status/
 * phase_v2_age_sessions). A disagreement is a corrupt record, not a smaller
 * number. The phase clock is separate from the open-leg duration, which is a
 * pivot-based clock owned by the rhythm/leg modules.
 * ──────────────────────────────────────────────────────────────────────────── */

export type PhaseAgeStatus = "measured" | "lower_bound" | "unavailable";
export type PhaseAgeReason =
  | "insufficient_history"
  | "missing"
  | "unknown_phase"
  | "not_logged"
  | "freq_mismatch"
  | "cross_field_mismatch"
  | null;

export interface PhaseAgeReading {
  value: number | null;
  status: PhaseAgeStatus;
  /** First observed session date; present only for lower bounds. */
  observedFrom: string | null;
  /** Provenance for the unavailable case; never shown as the reading itself. */
  reason: PhaseAgeReason;
}

const UNAVAILABLE = (reason: PhaseAgeReason): PhaseAgeReading => ({
  value: null,
  status: "unavailable",
  observedFrom: null,
  reason,
});

/** Session-count validation: a real count, ≥ 1, integer. Zero is not an age. */
function countOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

export function phaseAge(now: unknown, phaseKnown = true): PhaseAgeReading {
  const n = object(now);
  const block = object(n.phase_v2_age);
  if (!block.status && n.phase_v2_age_status === undefined && n.phase_v2_age_sessions === undefined) {
    return UNAVAILABLE(phaseKnown ? "not_logged" : "unknown_phase");
  }
  if (!phaseKnown) return UNAVAILABLE("unknown_phase");
  const status = block.status ?? n.phase_v2_age_status;
  const sessions = countOf(block.sessions ?? n.phase_v2_age_sessions);
  // Weekend restamps must not add sessions: only a daily forward log qualifies.
  if (n.freq !== undefined && n.freq !== null && n.freq !== "D") {
    return UNAVAILABLE("freq_mismatch");
  }
  if (
    typeof status !== "string" ||
    (status !== "measured" && status !== "lower_bound")
  ) {
    return UNAVAILABLE(
      status === "insufficient_history" ? "insufficient_history" : "not_logged",
    );
  }
  if (sessions === null) return UNAVAILABLE("not_logged");
  // Cross-field agreement: the denormalized pair must say the same thing.
  if (
    n.phase_v2_age_status !== undefined && n.phase_v2_age_status !== status ||
    n.phase_v2_age_sessions !== undefined && n.phase_v2_age_sessions !== sessions
  ) {
    return UNAVAILABLE("cross_field_mismatch");
  }
  if (status === "lower_bound") {
    const observedFrom = strictDay(block.observed_from);
    // A lower bound without its history-start date cannot be stated honestly.
    if (observedFrom === null) return UNAVAILABLE("insufficient_history");
    return { value: sessions, status: "lower_bound", observedFrom, reason: null };
  }
  return { value: sessions, status: "measured", observedFrom: null, reason: null };
}
