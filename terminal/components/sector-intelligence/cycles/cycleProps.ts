import type { CycleFamily } from "@/lib/sectorCycleRecord";
import type { CycleApplyOutcome, CycleViewSnapshot } from "@/lib/sectorCycleView";

/* Props-only contracts shared by the Cycles sub-components. The controller
 * (SectorCycleLens) is the only stateful owner; every child receives plain
 * values and callbacks, so each piece stays path-disjoint and testable. */

export type CycleFeedState =
  | "ready"
  | "loading"
  | "stale"
  | "unavailable"
  | "denied"
  | "unauthenticated";

export interface SectorCycleFeed {
  state: CycleFeedState;
  data?: unknown;
}

export type SectorCycleFeedName = "cycles" | "history" | "events";

export interface SectorCycleNavigate {
  kind: "dossier" | "members";
  family: CycleFamily;
  id: string;
  asOf: string;
}

/** Imperative capture/apply surface handed to the owning route (#10707). */
export interface SectorCycleCaptureHandle {
  captureView(): CycleViewSnapshot | null;
  applyView(raw: unknown): CycleApplyOutcome;
}

/** A comparable series on the chart: one key of one subject. */
export interface CycleSeriesKey {
  subjectId: string;
  key: "rs21" | "rs63" | "osc";
}

export interface CycleChartWindow {
  /** Visible time domain in source ms coordinates; null = full extent. */
  range: [number, number] | null;
}
