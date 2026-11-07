/**
 * R2 bridge from the incumbent R1 rotation measurement to the local causal
 * opening-range preview. Reuses its shared benchmark endpoint and calendar.
 * This is not an observation/event writer, forecast, alert or trade signal.
 */
import type { RotationMonitorReport } from "./rotationMonitor";
import { buildPivotWatchPreview, type PivotPreviewReport } from "./pivotWatchPreview";

export type RotationPivotSession = {
  date: string;
  open: boolean;
  start: number;  // ET display-epoch seconds, never a UTC timestamp.
  end: number;
};
export type RotationPivotProjectionReason =
  | "session_unavailable" | "session_mismatch" | "symbol_unavailable"
  | "common_interval_unavailable" | "source_unqualified";
export type RotationPivotProjection = {
  schema: "terminal.rotation_pivot_projection.v1";
  authority: "reconstructed_descriptive_only";
  symbol: string;
  state: "available" | "unavailable";
  reason: RotationPivotProjectionReason | null;
  commonEndpointDisplayEpoch: number | null;
  preview: PivotPreviewReport | null;
};

/**
 * No new fetches. A pivot can be shown only when the existing rotation source
 * admits this symbol at SPY's SAME completed five-minute endpoint.
 * A reconstructed confirmation's historical timestamp is not an as-issued event.
 */
export function buildRotationPivotProjection(args: {
  monitor: RotationMonitorReport;
  history: unknown;
  symbol: string;
  session: RotationPivotSession | null;
}): RotationPivotProjection {
  const { monitor, history, symbol, session } = args;
  const common = monitor.barEndpointDisplayEpoch;
  const base = { schema: "terminal.rotation_pivot_projection.v1" as const,
    authority: "reconstructed_descriptive_only" as const, symbol,
    commonEndpointDisplayEpoch: common };
  const unavailable = (reason: RotationPivotProjectionReason): RotationPivotProjection =>
    ({ ...base, state: "unavailable", reason, preview: null });

  if (!session || !Number.isSafeInteger(session.start) || !Number.isSafeInteger(session.end)
    || session.start <= 0 || session.end <= session.start || (session.end - session.start) % 300 !== 0) return unavailable("session_unavailable");
  if (monitor.schema !== "terminal.rotation_monitor.v1" || monitor.authority !== "descriptive_only"
    || monitor.benchmark !== "SPY" || monitor.sessionDate !== session.date
    || monitor.sessionOpen !== session.open) return unavailable("session_mismatch");
  // The population is the incumbent R1 report, not a new membership authority.
  const row = monitor.rows.find(candidate => candidate.symbol === symbol);
  if (!row || symbol === "SPY" || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))
    return unavailable("symbol_unavailable");
  const window = row.windows[5];
  if (common === null || !Number.isSafeInteger(common) || common <= session.start || common > session.end
    || (!session.open && common !== session.end)
    || window.state !== "measured" || window.reason !== null
    || (session.open && (monitor.barEndpointAgeSeconds === null || !Number.isFinite(monitor.barEndpointAgeSeconds)
      || monitor.barEndpointAgeSeconds < 0
      || monitor.barEndpointAgeSeconds > 20 * 60))
    || window.authority !== "descriptive_bar_geometry"
    || window.horizonMinutes !== 5 || window.fromDisplayEpoch !== common - 300
    || window.toDisplayEpoch !== common
    || window.expectedSlots !== 2 || window.matchedSlots !== 2
    || window.relativePct === null || !Number.isFinite(window.relativePct))
    return unavailable("common_interval_unavailable");
  const preview = buildPivotWatchPreview({
    history, symbol, sessionStartDisplayEpoch: session.start,
    sessionEndDisplayEpoch: session.end, cutoffDisplayEpoch: common,
  });
  // An invalid source cannot get a user-facing 'watching' label even if the
  // calendar, benchmark and selected history happen to look numerically valid.
  if (!preview.sourceQualified || preview.rows.some(row => row.state === "unavailable"))
    return unavailable("source_unqualified");
  return { ...base, state: "available", reason: null, preview };
}
