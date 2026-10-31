/**
 * exposureReplayFrames.ts — DOM-free frame reducer for the Exposure map's Replay
 * slice. A frame is ONE stored session book read through the desk's existing
 * reader; a gap is a listed session whose book is unavailable or refused. The
 * date index is best-effort and may have holes, so a hole stays a labelled gap
 * column — never an interpolation between frames and never today's book wearing
 * an archived label.
 */

import { createExposureMapReader, type ExposureMapMetric, type ExposureMapRead } from "./exposureMap";
import { readCompanionGexSnapshot, type CompanionGexSnapshot } from "./optionsCompanion";
import { gexSessionOf, isGexSessionDate } from "./gexSessions";
import { describeExposure } from "./exposureWorkspace";
import type { ExposureLens } from "./exposureMapProjection";

export const REPLAY_FRAMES_VERSION = "exposure-replay-frames/v1";
/** Stored frames + the current book. */
export const REPLAY_MAX_FRAMES = 7;
/** ± percent of the reference spot a strike must sit inside to join the set. */
export const REPLAY_WINDOWS = [2, 4, 8] as const;

export type ReplayFrameKind = "observed" | "reconstructed" | "aggregate";
export type ReplayGapReason = "unavailable" | "refused" | "identity" | "session" | "scope" | "malformed";

export interface ReplayFrame {
  session: string;
  kind: ReplayFrameKind;
  current: boolean;
  spot: number | null;
  /** Strike → net $mn for the requested metric; null = unknown, never zero. */
  values: ReadonlyMap<number, number | null>;
  dominant: number | null;
  runnerUp: number | null;
  runnerUpRatio: number | null;
  contested: boolean | null;
  coverage: { expected: number | null; qualified: number | null } | null;
  clocks: Record<string, string | null> | null;
  sourceRef: string | null;
}

export interface ReplayGap { session: string; reason: ReplayGapReason }
export type ReplayColumn = { kind: "frame"; frame: ReplayFrame } | { kind: "gap"; gap: ReplayGap };

/** Change of the NEXT frame's dominant strike, measured at that strike. */
export interface ReplayProvenance {
  strike: number;
  changeMn: number | null;
  relation: "runner_up_to_leader" | "leader_held" | "new_leader";
}

export interface ReplayFrameSet {
  version: typeof REPLAY_FRAMES_VERSION;
  root: string;
  metric: string;
  lens: string;
  windowPct: number;
  referenceSpot: number | null;
  /** Descending strike axis shared by every column. */
  strikes: number[];
  /** Oldest stored frame → the current book, gaps kept in place. */
  columns: ReplayColumn[];
  maxAbsMn: number;
  /** Per column, the dominant strike; null for a gap. */
  leaderPath: (number | null)[];
  /** Per column, the change into the NEXT column; null for a gap pair or the last. */
  provenance: (ReplayProvenance | null)[];
}

const TIER_THRESHOLDS = [0.7, 0.45, 0.25, 0.12, 0.04] as const;

/** Identical rule to the map's cell shading: |value| / the frame SET's max |value|. */
export function replayTier(valueMn: number | null, maxAbsMn: number): "u" | "0" | "1" | "2" | "3" | "4" | "5" {
  if (valueMn == null || !Number.isFinite(valueMn)) return "u";
  if (!(maxAbsMn > 0) || !Number.isFinite(maxAbsMn)) return "u";
  const ratio = Math.abs(valueMn) / maxAbsMn;
  for (let tier = 0; tier < TIER_THRESHOLDS.length; tier++) {
    if (ratio >= TIER_THRESHOLDS[tier]) return String(TIER_THRESHOLDS.length - tier) as "1" | "2" | "3" | "4" | "5";
  }
  return "0";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v);

/**
 * The newest (max−1) sessions strictly before the live book's session, oldest
 * first. The index is newest-first and may carry holes — holes are tolerated,
 * not filled; the live session itself is excluded.
 */
export function selectReplaySessions(dates: readonly string[], currentSession: string | null, max = REPLAY_MAX_FRAMES): string[] {
  if (!Number.isFinite(max) || max < 1) return [];
  const eligible = dates.filter((d) => isGexSessionDate(d) && (currentSession == null || d < currentSession));
  const unique = [...new Set(eligible)].sort().reverse();
  return unique.slice(0, Math.max(0, max - 1)).reverse();
}

const gap = (session: string, reason: ReplayGapReason): ReplayColumn => ({ kind: "gap", gap: { session, reason } });

function frameFromRead(session: string, current: boolean, kind: ReplayFrameKind, read: ExposureMapRead): ReplayColumn {
  const values = new Map<number, number | null>();
  for (const node of read.summary.nodes) values.set(node.strike, node.netMn);
  const desc = describeExposure(read.summary.nodes, read.spot, null);
  return { kind: "frame", frame: {
    session, kind, current, spot: read.spot, values,
    dominant: desc.ranked[0]?.strike ?? null, runnerUp: desc.ranked[1]?.strike ?? null,
    runnerUpRatio: desc.runnerUpRatio, contested: desc.contested,
    coverage: read.coverage ? { expected: read.coverage.expected, qualified: read.coverage.qualified } : null,
    clocks: read.clocks, sourceRef: read.sourceRef,
  } };
}

function frameFromCompanion(session: string, current: boolean, value: CompanionGexSnapshot): ReplayColumn {
  const values = new Map<number, number | null>();
  for (const row of value.rows) values.set(row.strike, row.gammaMn);
  const nodes = value.rows.map((row) => ({ strike: row.strike, netMn: row.gammaMn, grossMn: null, grossShare: null }));
  const desc = describeExposure(nodes, value.spot, null);
  return { kind: "frame", frame: {
    session, kind: "aggregate", current, spot: value.spot, values,
    dominant: desc.ranked[0]?.strike ?? null, runnerUp: desc.ranked[1]?.strike ?? null,
    runnerUpRatio: desc.runnerUpRatio, contested: desc.contested,
    coverage: null, clocks: null, sourceRef: null,
  } };
}

/**
 * Reduce ONE stored book into a replay column. A qualified dated book is an
 * observed frame; a dated-provider capture is a reconstructed frame, always
 * labelled. Anything the desk's reader refuses falls to the legacy aggregate
 * rows (gamma, all-expiry only) and then to a typed gap — never a zero value.
 */
export function reduceReplayFrame(raw: unknown, root: string, session: string, metric: ExposureMapMetric,
  lens: ExposureLens, today: string, now: number, current = false): ReplayColumn {
  if (!isRecord(raw)) return gap(session, "unavailable");
  if (raw.root !== root) return gap(session, "identity");
  const bookSession = gexSessionOf(raw.asof);
  if (bookSession == null) return gap(session, "malformed");
  if (bookSession !== session) return gap(session, "session");
  const read = createExposureMapReader(raw, root, null, today, now)(lens, metric);
  if (read.state === "data") {
    if (read.qualification === "qualified") return frameFromRead(session, current, "observed", read);
    if (read.qualification === "dated") return frameFromRead(session, current, "reconstructed", read);
  }
  // The aggregate rows only ever carry gamma nets over all supplied expiries.
  if (metric !== "gamma" || lens.kind !== "all") return gap(session, "scope");
  const companion = readCompanionGexSnapshot(raw, root, now, { kind: "all" });
  return companion.ok ? frameFromCompanion(session, current, companion.value)
    : gap(session, companion.reason as ReplayGapReason);
}

const frameOf = (column: ReplayColumn): ReplayFrame | null => (column.kind === "frame" ? column.frame : null);

/**
 * Assemble the shared strike axis and per-column derivations. The axis is the
 * union of every frame's strikes inside ± windowPct of the reference spot
 * (fallback: the newest frame's spot), descending, so a colour tier compares
 * across frames rather than within one.
 */
export function buildReplayFrameSet(columns: ReplayColumn[], o: {
  root: string; metric: string; lens: string; windowPct: number; referenceSpot: number | null;
}): ReplayFrameSet {
  const fallback = [...columns].reverse().map(frameOf).find((f) => f?.spot != null)?.spot ?? null;
  const reference = o.referenceSpot != null && Number.isFinite(o.referenceSpot) && o.referenceSpot > 0
    ? o.referenceSpot : fallback;
  const spread = reference != null && Number.isFinite(o.windowPct) && o.windowPct >= 0 ? reference * (o.windowPct / 100) : null;
  const strikes = [...new Set(columns.flatMap((column) => {
    const frame = frameOf(column);
    if (!frame || spread == null || reference == null) return [];
    return [...frame.values.keys()].filter((strike) => Number.isFinite(strike) && Math.abs(strike - reference) <= spread);
  }))].sort((a, b) => b - a);
  let maxAbsMn = 0;
  for (const column of columns) {
    const frame = frameOf(column);
    if (!frame) continue;
    for (const strike of strikes) {
      const value = frame.values.get(strike);
      if (value != null && Number.isFinite(value) && Math.abs(value) > maxAbsMn) maxAbsMn = Math.abs(value);
    }
  }
  const leaderPath = columns.map((column) => frameOf(column)?.dominant ?? null);
  const provenance = columns.map((column, k) => {
    if (k === columns.length - 1) return null;
    const here = frameOf(column), next = frameOf(columns[k + 1]);
    if (!here || !next || next.dominant == null) return null;
    const before = here.values.get(next.dominant);
    return {
      strike: next.dominant,
      changeMn: next.values.get(next.dominant) != null && before != null ? next.values.get(next.dominant)! - before : null,
      relation: next.dominant === here.dominant ? "leader_held" as const
        : next.dominant === here.runnerUp ? "runner_up_to_leader" as const : "new_leader" as const,
    };
  });
  return { version: REPLAY_FRAMES_VERSION, root: o.root, metric: o.metric, lens: o.lens,
    windowPct: o.windowPct, referenceSpot: reference, strikes, columns, maxAbsMn, leaderPath, provenance };
}






