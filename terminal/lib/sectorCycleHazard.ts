import { object, text } from "./sectorIntelligence";

/* ────────────────────────────────────────────────────────────────────────────
 * Hazard qualification and clock disagreement (donor SC_FACE + #10707).
 *
 * MODEL vs PRIOR is explicit wherever a modelled value is shown:
 *  - pass  = source MODEL, cell_verdict PASS, estimate_kinds.hazard[key] ===
 *            "qualified_model_cell", model_cell_current_claim === "parity_holds".
 *            A MODEL claim additionally requires exact parity/epoch/cohort/
 *            direction/basis/horizon agreement — all carried by the record.
 *  - muted = a MODEL cell whose live parity is not established; shown weakly
 *            with the parity reason, never as a current claim.
 *  - prior = a PRIOR base rate (KM), a separate population, labelled as such.
 *  - gap   = no calibrated cell; a gap, never zero.
 * An inverted curve (hazard direction/turn disagrees with the phase leg) is
 * withheld WHOLE, not partially redrawn.
 * ──────────────────────────────────────────────────────────────────────────── */

import type { TurnKind } from "./sectorCycleRhythm";

export const HAZARD_HORIZONS = ["1m", "3m", "6m"] as const;
export type HazardHorizon = (typeof HAZARD_HORIZONS)[number];

export const LEG_OF: Record<string, ["up" | "down", TurnKind]> = {
  Recovery: ["up", "peak"],
  Expansion: ["up", "peak"],
  Peak: ["up", "peak"],
  Trough: ["down", "trough"],
  Downturn: ["down", "trough"],
};

export type CellState = "pass" | "muted" | "prior" | "gap";

export interface HazardCell {
  p?: unknown;
  source?: unknown;
  cell_verdict?: unknown;
}
export interface EstimateKinds {
  hazard?: Record<string, unknown>;
  model_cell_current_claim?: unknown;
  live_feature_parity?: { verdict?: unknown; failing?: unknown };
}

export function hazardPass(
  cell: HazardCell | null | undefined,
  estimateKinds: EstimateKinds | null | undefined,
  key: HazardHorizon,
): boolean {
  return !!cell &&
    typeof cell.p === "number" && Number.isFinite(cell.p) &&
    cell.source === "MODEL" &&
    cell.cell_verdict === "PASS" &&
    !!estimateKinds && !!estimateKinds.hazard &&
    estimateKinds.hazard[key] === "qualified_model_cell" &&
    estimateKinds.model_cell_current_claim === "parity_holds";
}

export function cellState(
  hazard: unknown,
  estimateKinds: EstimateKinds | null | undefined,
  key: HazardHorizon,
): CellState {
  const h = object(hazard);
  const c = object(h[key]) as HazardCell;
  if (
    !h || h.unavailable === true || !c ||
    typeof c.p !== "number" || !Number.isFinite(c.p) ||
    estimateKinds?.hazard?.[key] === "missing_estimate"
  ) return "gap";
  if (hazardPass(c, estimateKinds, key)) return "pass";
  if (c.source === "MODEL") return "muted";
  if (c.source === "PRIOR") return "prior";
  return "gap";
}

export type ParityQualification =
  | "parity_failed"
  | "parity_holds"
  | "parity_not_established";

/** PARITY_FAILS anywhere (record-local, meta-global or the current-claim flag)
 * mutes every current claim; parity_holds requires all three to hold. */
export function parityQualification(
  record: unknown,
  meta: unknown,
): ParityQualification {
  const e = object(object(record).estimate_kinds);
  const local = object(e.live_feature_parity).verdict ?? null;
  const global = object(object(meta).live_hazard_parity).verdict ?? null;
  if (
    e.model_cell_current_claim === "parity_failed" ||
    local === "PARITY_FAILS" ||
    global === "PARITY_FAILS"
  ) return "parity_failed";
  if (
    e.model_cell_current_claim === "parity_holds" &&
    local === "PARITY_HOLDS" &&
    global === "PARITY_HOLDS"
  ) return "parity_holds";
  return "parity_not_established";
}

export interface LegFamily {
  direction: "up" | "down" | null;
  turn: TurnKind | null;
  hazardAgrees: boolean | null;
  rhythmAgrees: boolean | null;
}

/** The leg the phase clock says is open, plus whether the hazard and rhythm
 * clocks agree with it. Disagreement withholds the whole sub-clock. */
export function legFamily(record: unknown): LegFamily {
  const rec = object(record);
  const now = object(rec.now);
  const leg = LEG_OF[String(now.phase_v2)];
  const out: LegFamily = { direction: null, turn: null, hazardAgrees: null, rhythmAgrees: null };
  if (!leg) return out;
  out.direction = leg[0];
  out.turn = leg[1];
  const h = object(now.hazard);
  if (h.direction && h.turn_kind) {
    out.hazardAgrees = h.direction === leg[0] && h.turn_kind === leg[1];
  }
  const r = object(rec.rhythm);
  const pj = object(rec.proj);
  if (r.next_turn) {
    out.rhythmAgrees =
      r.next_turn === leg[1] && (!pj || !pj.nextTurn || pj.nextTurn === leg[1]);
  }
  return out;
}

/* ── Clock disagreement lines (SC_FACE clockLines) ─────────────────────────── */

export const STATE_DISPLAY: Record<string, [string, string]> = {
  "BOTTOM WATCH": ["NEARING A LOW", "接近低点"],
  "CONFIRMING TURN": ["TURN IN PROGRESS", "转向进行中"],
  "COUNTERTREND BOUNCE": ["UNCONFIRMED TURN", "未确认转向"],
  DECLINE: ["DOWNTREND", "下跌趋势"],
  "FRESH BUY": ["BUY ZONE", "买入区"],
  "RALLY ON": ["UPTREND", "上涨趋势"],
  "ROLLING OVER": ["TOPPING", "做顶中"],
  "TOP WATCH": ["NEARING A HIGH", "接近高点"],
  "TURN SIGNALED": ["BOTTOMING", "筑底中"],
};

export type ClockKind = "ladder" | "hazard" | "rhythm" | "read";
export interface ClockDisagreement {
  clock: ClockKind;
}

/** Which optional clocks disagree with the phase clock for this record. */
export function clockDisagreements(record: unknown): ClockKind[] {
  const rec = object(record);
  const now = object(rec.now);
  const leg = legFamily(rec);
  const out: ClockKind[] = [];
  if (!LEG_OF[String(now.phase_v2)]) return out;
  if (now.divergence === true && object(now.clocks).ladder && STATE_DISPLAY[String(object(now.clocks).ladder)]) {
    out.push("ladder");
  }
  if (leg.hazardAgrees === false) out.push("hazard");
  if (leg.rhythmAgrees === false) out.push("rhythm");
  if (
    typeof now.phase === "string" &&
    typeof now.phase_v2 === "string" &&
    now.phase !== now.phase_v2
  ) {
    out.push("read");
  }
  return out;
}

/** Phase labels (SC_FACE PHASES + PHASE_CHIP short labels). */
export const CYCLE_PHASE_LABELS: Record<
  string,
  { label: [string, string]; short: [string, string] }
> = {
  Downturn: { label: ["Downturn", "下行"], short: ["Rolling over", "回落中"] },
  Expansion: { label: ["Expansion", "扩张"], short: ["Trending", "上行中"] },
  Peak: { label: ["Peak", "顶部"], short: ["Topping · late", "见顶 · 晚期"] },
  Recovery: { label: ["Recovery", "复苏"], short: ["Prime entry", "入场良机"] },
  Trough: { label: ["Trough", "底部"], short: ["Bottoming", "筑底中"] },
};

/** Open-leg session count over a reconstructed session series: the number of
 * session points strictly after the last confirmed pivot date. Reconstructed
 * and labelled as such — it is not the phase clock (see phaseAge). */
export function openLegSessions(
  points: readonly { date: string }[],
  pivotDate: string | null,
): number | null {
  if (pivotDate === null || points.length === 0) return null;
  let count = 0;
  for (const p of points) if (p.date > pivotDate) count++;
  return count;
}

export const hazardEpoch = (record: unknown): string | null => {
  const value = text(object(object(object(record).now).hazard).epoch);
  return value.length > 0 && value.length <= 64 ? value : null;
};
