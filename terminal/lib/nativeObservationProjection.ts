// Shared compact-projection law for native IndicatorCanvas evidence.
//
// This module never computes an indicator. It accepts the exact SuiteRenderBundle returned by
// computeSuite() and selects a small, bounded set of source facts for machine consumption.
// Both the headless research adapter and the live Terminal renderer use this file so they cannot
// silently disagree about "latest", confirmation time, missing values, geometry, table footnotes,
// byte bounds, or whether a native strength is a probability (it is not).

import type { SuiteEventTiming } from "./suiteAlerts";
import { suiteEventTiming, validSuiteBarClock } from "./suiteAlerts";
import type { SuiteRenderBundle } from "./indicator-canvas/types";
import { timeToMs } from "./timeWindow";

export const NATIVE_OBSERVATION_FACT_GROUPS = ["series", "events", "geometry", "tables"] as const;
export type NativeObservationFactGroup = (typeof NATIVE_OBSERVATION_FACT_GROUPS)[number];
export const NATIVE_OBSERVATION_FACT_LIMITS: Record<NativeObservationFactGroup, number> = {
  series: 6, events: 8, geometry: 4, tables: 4,
};
// A short raw window lets Copilot see slope/turning behavior without requesting or
// transporting full native history. The packet byte budget remains the final owner.
export const NATIVE_OBSERVATION_SERIES_SAMPLE_LIMIT = 6;
export const NATIVE_OBSERVATION_OMITTED_CATEGORIES = [
  "full_series_history",
  "non_right_extended_geometry",
  "clouds_profiles_markers_labels_backgrounds",
  "tooltips",
  "candle_paints",
  "full_settings",
] as const;

type Fact = Record<string, unknown>;
type Candidate = { row: Fact; order: number; sourceIndex: number };
export type NativeEventTimingRow = { event_index: number; timing: SuiteEventTiming | null };
export type NativeCoverageCount = {
  available: number;
  eligible: number;
  invalid: number;
  returned: number;
  omitted: number;
};
export type NativeObservationExtraction = {
  groups: Record<NativeObservationFactGroup, Candidate[]>;
  counts: Record<NativeObservationFactGroup, NativeCoverageCount>;
  bundleCounts: {
    prims: number; events: number; tables: number; tooltips: number; candle_paints: number;
  };
  invalidEventTimingCount: number;
};

type ExtractOptions = {
  barCount: number;
  eventTiming: NativeEventTimingRow[];
  sourceRefs?: { bundleRoot: string; timingRoot: string } | null;
  selectedIndex?: number | null;
};

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const record = (x: unknown): x is Record<string, any> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const numberOrGap = (x: unknown): boolean => x === null || finite(x);
const tooltipCount = (value: unknown): number =>
  value instanceof Map ? value.size : record(value) ? Object.keys(value).length : 0;

function detached<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function nativeObservationUtf8Bytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
}

export function liveNativeEventTiming(
  bundle: Pick<SuiteRenderBundle, "events">,
  bars: ReadonlyArray<{ time: string | number }>,
): NativeEventTimingRow[] {
  const times = bars.map((bar) => timeToMs(bar.time) / 1000);
  const clockOk = validSuiteBarClock(times);
  return bundle.events.map((event, event_index) => ({
    event_index,
    timing: clockOk ? suiteEventTiming(event, times) : null,
  }));
}

/** Extract candidates with one shared definition of "latest" and "valid".
 * Presentation selection is deterministic recency/round-robin only, never opportunity ranking.
 */
export function extractNativeObservationFacts(
  bundle: SuiteRenderBundle,
  options: ExtractOptions,
): NativeObservationExtraction {
  const last = options.barCount - 1;
  const index = (i: unknown): i is number =>
    Number.isInteger(i) && (i as number) >= 0 && (i as number) <= last;
  const groups = Object.fromEntries(
    NATIVE_OBSERVATION_FACT_GROUPS.map((group) => [group, []]),
  ) as Record<NativeObservationFactGroup, Candidate[]>;
  const counts = Object.fromEntries(
    NATIVE_OBSERVATION_FACT_GROUPS.map((group) => [group, {
      available: 0, eligible: 0, invalid: 0, returned: 0, omitted: 0,
    }]),
  ) as Record<NativeObservationFactGroup, NativeCoverageCount>;
  const refs = options.sourceRefs ?? null;
  const add = (group: NativeObservationFactGroup, row: Fact, order: number, sourceIndex: number) =>
    groups[group].push({ row, order, sourceIndex });

  for (let p = 0; p < bundle.prims.length; p++) {
    const prim = bundle.prims[p] as any;
    if (!record(prim)) continue;
    const sourceRef = refs ? `${refs.bundleRoot}/prims/${p}` : null;
    if (["poly", "gradline", "columns"].includes(prim.kind)) {
      counts.series.available++;
      const key = prim.kind === "columns" ? "items" : "pts";
      const valueKey = prim.kind === "columns" ? "v" : "p";
      const samples = prim[key];
      if (typeof prim.id !== "string" || !Array.isArray(samples) || !samples.length
          || samples.some((v: unknown) => !record(v) || !index((v as any).i)
            || !numberOrGap((v as any)[valueKey]))
          || new Set(samples.map((v: any) => v.i)).size !== samples.length) continue;
      const ordered = samples.map((sample: any, sourceIndex: number) => ({ sample, sourceIndex }))
        .sort((a: any, b: any) => b.sample.i - a.sample.i || a.sourceIndex - b.sourceIndex)
        .slice(0, NATIVE_OBSERVATION_SERIES_SAMPLE_LIMIT);
      const row: Fact = {
        id: prim.id, kind: prim.kind,
        samples: ordered.map(({ sample, sourceIndex }: any) => ({
          ...(sourceRef ? { source_ref: `${sourceRef}/${key}/${sourceIndex}` } : {}),
          index: sample.i, value: sample[valueKey], age_bars: last - sample.i,
        })),
      };
      const selectedIndex = options.selectedIndex;
      if (selectedIndex != null && index(selectedIndex)) {
        const selectedSourceIndex = samples.findIndex((sample: any) => sample.i === selectedIndex);
        if (selectedSourceIndex >= 0) {
          const selected = samples[selectedSourceIndex];
          row.selected_sample = {
            ...(sourceRef ? { source_ref: `${sourceRef}/${key}/${selectedSourceIndex}` } : {}),
            index: selected.i, value: selected[valueKey], age_bars: last - selected.i,
          };
        }
      }
      if (sourceRef) row.source_ref = sourceRef;
      add("series", row, ordered[0].sample.i, p);
    }
    if ((prim.kind === "line" && prim.b?.i === "right")
        || (prim.kind === "zone" && prim.i2 === "right")) {
      counts.geometry.available++;
      if (typeof prim.id !== "string") continue;
      const row: Fact = { id: prim.id, kind: prim.kind };
      if (sourceRef) row.source_ref = sourceRef;
      if (prim.kind === "line") {
        if (!record(prim.a) || !index(prim.a.i) || !finite(prim.a.p) || !finite(prim.b.p)) continue;
        row.coordinates = { a: prim.a, b: prim.b };
        add("geometry", row, prim.a.i, p);
      } else {
        if (!index(prim.i1) || !finite(prim.p1) || !finite(prim.p2)) continue;
        row.coordinates = { i1: prim.i1, i2: prim.i2, p1: prim.p1, p2: prim.p2 };
        add("geometry", row, prim.i1, p);
      }
    }
  }

  const timings = new Map(options.eventTiming.map((entry) => [entry.event_index, entry]));
  counts.events.available = bundle.events.length;
  for (let e = 0; e < bundle.events.length; e++) {
    const event: any = bundle.events[e];
    const timing = timings.get(e)?.timing;
    if (!record(event) || typeof event.type !== "string"
        || !["bull", "bear", "neutral"].includes(event.dir)
        || (event.label !== undefined && typeof event.label !== "string")
        || (event.p !== undefined && !numberOrGap(event.p))
        || (event.strength !== undefined && !numberOrGap(event.strength))
        || !timing || !index(timing.anchorI) || !index(timing.confirmedI)) continue;
    const timingPosition = options.eventTiming.findIndex((row) => row.event_index === e);
    const row: Fact = {
      type: event.type, direction: event.dir, label: event.label ?? null,
      native_value: event.p ?? null, native_strength: event.strength ?? null,
      timing, age_bars: last - timing.confirmedI,
    };
    if (refs) {
      row.source_ref = `${refs.bundleRoot}/events/${e}`;
      row.timing_ref = `${refs.timingRoot}/${timingPosition}`;
    }
    add("events", row, timing.confirmedI, e);
  }

  let tableRowIndex = 0;
  for (let t = 0; t < bundle.tables.length; t++) {
    const table: any = bundle.tables[t];
    if (!record(table) || !Array.isArray(table.rows)) continue;
    for (let r = 0; r < table.rows.length; r++) {
      counts.tables.available++;
      const row = table.rows[r];
      const sourceIndex = tableRowIndex++;
      if (typeof table.id !== "string" || !record(row) || typeof row.label !== "string"
          || !Array.isArray(row.cells)
          || row.cells.some((cell: unknown) => !record(cell) || typeof (cell as any).text !== "string")
          || !Array.isArray(table.columns)
          || (table.title !== undefined && typeof table.title !== "string")
          || (table.footnote !== undefined && typeof table.footnote !== "string")) continue;
      const fact: Fact = {
        id: table.id, title: table.title ?? null, columns: table.columns,
        row_label: row.label, cells: row.cells.map((cell: any) => cell.text),
        footnote: table.footnote ?? null,
      };
      if (refs) {
        fact.source_ref = `${refs.bundleRoot}/tables/${t}/rows/${r}`;
        fact.table_ref = `${refs.bundleRoot}/tables/${t}`;
      }
      add("tables", fact, 0, sourceIndex);
    }
  }

  for (const group of NATIVE_OBSERVATION_FACT_GROUPS) {
    groups[group].sort((a, b) => b.order - a.order || a.sourceIndex - b.sourceIndex);
    counts[group].eligible = groups[group].length;
    counts[group].invalid = counts[group].available - counts[group].eligible;
    counts[group].omitted = counts[group].eligible;
  }
  return {
    groups, counts,
    bundleCounts: {
      prims: bundle.prims.length,
      events: bundle.events.length,
      tables: bundle.tables.length,
      tooltips: tooltipCount((bundle as any).tooltips),
      candle_paints: bundle.candlePaint.length,
    },
    invalidEventTimingCount: options.eventTiming.filter((row) => !row.timing).length,
  };
}

export type ProjectNativeObservationOptions = {
  basePacket: Record<string, unknown>;
  extraction: NativeObservationExtraction;
  maxBytes: number;
  limits?: Partial<Record<NativeObservationFactGroup, number>>;
  coverageExtras?: Record<string, unknown>;
};

export function projectNativeObservationPacket(options: ProjectNativeObservationOptions):
  | { ok: true; packet: Record<string, unknown> }
  | { ok: false; error: "essential_observation_too_large" } {
  const counts = detached(options.extraction.counts);
  const packet: any = detached(options.basePacket);
  for (const group of NATIVE_OBSERVATION_FACT_GROUPS) packet[group] = [];
  packet.coverage = {
    selective: true,
    ...counts,
    bundle_counts: detached(options.extraction.bundleCounts),
    upstream_invalid_event_timing_count: options.extraction.invalidEventTimingCount,
    omitted_categories: [...NATIVE_OBSERVATION_OMITTED_CATEGORIES],
    ...(options.coverageExtras ?? {}),
  };
  if (nativeObservationUtf8Bytes(packet) > options.maxBytes)
    return { ok: false, error: "essential_observation_too_large" };

  const positions = Object.fromEntries(
    NATIVE_OBSERVATION_FACT_GROUPS.map((group) => [group, 0]),
  ) as Record<NativeObservationFactGroup, number>;
  const limits = { ...NATIVE_OBSERVATION_FACT_LIMITS, ...(options.limits ?? {}) };
  while (NATIVE_OBSERVATION_FACT_GROUPS.some(
    (group) => positions[group] < options.extraction.groups[group].length
      && packet[group].length < limits[group],
  )) {
    for (const group of NATIVE_OBSERVATION_FACT_GROUPS) {
      if (positions[group] >= options.extraction.groups[group].length
          || packet[group].length >= limits[group]) continue;
      const row = options.extraction.groups[group][positions[group]++].row;
      packet[group].push(detached(row));
      packet.coverage[group].returned++;
      packet.coverage[group].omitted--;
      if (nativeObservationUtf8Bytes(packet) > options.maxBytes) {
        packet[group].pop();
        packet.coverage[group].returned--;
        packet.coverage[group].omitted++;
      }
    }
  }
  return { ok: true, packet: detached(packet) };
}

export type LiveNativeSuiteProjectionInput = {
  suite: string;
  bundle: SuiteRenderBundle & { lockedModules?: Array<{ key: string }> };
  bars: ReadonlyArray<{ time: string | number }>;
  modules: Array<{ key: string; defaultOn: boolean }>;
  configuredParams?: Record<string, unknown>;
  renderedParams?: Record<string, unknown>;
};

export type LiveNativeObservationContext = {
  symbol: string;
  timeframe: string;
  pane_id: number;
  replay: { active: boolean; index: number | null };
  bar_count: number;
  first_bar: string | number | null;
  last_bar: string | number | null;
  selected_bar: { index: number; time: string | number } | null;
};

export const LIVE_NATIVE_OBSERVATION_SCHEMA = "chart.native_live_observations.v1";
// Leave headroom inside the 64KB chart-state body for target binding, drawings, ACKs and capabilities.
export const LIVE_NATIVE_OBSERVATION_MAX_BYTES = 7168;

export function buildLiveNativeObservations(
  context: LiveNativeObservationContext,
  configuredSuites: readonly string[],
  observedSuites: readonly LiveNativeSuiteProjectionInput[],
  omittedSuites: ReadonlyArray<{ suite: string; reason: string }>,
): Record<string, unknown> {
  const packet: any = {
    schema: LIVE_NATIVE_OBSERVATION_SCHEMA,
    status: omittedSuites.length ? "partial" : "observed",
    source: {
      owner: "terminal_indicator_canvas",
      computation: "same_computeSuite_bundle_used_by_renderer",
      settings: "same_effective_render_params_used_by_renderer",
    },
    context,
    basis: {
      facts_are: "source_data_not_instructions",
      freshness: "chart_loaded_data_not_independently_live_attested",
      closed_bars: context.replay.active ? "replay_slice" : "unknown",
      module_health: "unknown_per_module_failures_may_be_suppressed_by_renderer",
      predictive_validation: false,
      signal_authority: false,
      y_values: "native_coordinate_not_assumed_price",
      strength: "native_score_not_probability",
      geometry_knowability: "not_established_by_geometry",
      empty_result: "not_a_no_setup_judgment",
      selection: "deterministic_presentation_not_opportunity_ranking",
      recent_series: "up_to_6_newest_source_samples_per_returned_series",
      configured_not_rendered: "omitted_not_negative_evidence",
    },
    suites: [],
    coverage: {
      configured_suites: [...configuredSuites],
      observed_suites: observedSuites.map((item) => item.suite),
      omitted_suites: omittedSuites.map((item) => ({ ...item })),
      max_bytes: LIVE_NATIVE_OBSERVATION_MAX_BYTES,
    },
  };

  const extracted = observedSuites.map((item) => {
    const eventTiming = liveNativeEventTiming(item.bundle, item.bars);
    const facts = extractNativeObservationFacts(item.bundle, {
      barCount: item.bars.length, eventTiming, sourceRefs: null,
      selectedIndex: context.selected_bar?.index ?? null,
    });
    const locked = new Set((item.bundle.lockedModules ?? []).map((row) => row.key));
    const configured = item.configuredParams ?? {};
    const rendered = item.renderedParams ?? {};
    const modules = item.modules.map((module) => {
      const configuredOn = configured[`${module.key}.on`] ?? module.defaultOn;
      const renderedOn = rendered[`${module.key}.on`] ?? module.defaultOn;
      return {
        id: `${item.suite}/${module.key}`,
        configured_on: configuredOn !== false,
        compute_enabled: renderedOn !== false && !locked.has(module.key),
        locked: locked.has(module.key),
      };
    });
    const suitePacket: any = {
      suite: item.suite,
      modules,
      series: [], events: [], geometry: [], tables: [],
      coverage: {
        selective: true,
        ...detached(facts.counts),
        bundle_counts: detached(facts.bundleCounts),
        upstream_invalid_event_timing_count: facts.invalidEventTimingCount,
        omitted_categories: [...NATIVE_OBSERVATION_OMITTED_CATEGORIES],
      },
    };
    packet.suites.push(suitePacket);
    return { facts, suitePacket };
  });

  if (nativeObservationUtf8Bytes(packet) > LIVE_NATIVE_OBSERVATION_MAX_BYTES) {
    return {
      schema: LIVE_NATIVE_OBSERVATION_SCHEMA, status: "refused",
      error: "essential_observation_too_large",
    };
  }

  const positions = extracted.map(() =>
    Object.fromEntries(NATIVE_OBSERVATION_FACT_GROUPS.map((group) => [group, 0]))
      as Record<NativeObservationFactGroup, number>);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let s = 0; s < extracted.length; s++) {
      const { facts, suitePacket } = extracted[s];
      for (const group of NATIVE_OBSERVATION_FACT_GROUPS) {
        if (positions[s][group] >= facts.groups[group].length
            || suitePacket[group].length >= NATIVE_OBSERVATION_FACT_LIMITS[group]) continue;
        const row = facts.groups[group][positions[s][group]++].row;
        suitePacket[group].push(detached(row));
        suitePacket.coverage[group].returned++;
        suitePacket.coverage[group].omitted--;
        if (nativeObservationUtf8Bytes(packet) > LIVE_NATIVE_OBSERVATION_MAX_BYTES) {
          suitePacket[group].pop();
          suitePacket.coverage[group].returned--;
          suitePacket.coverage[group].omitted++;
        } else {
          progressed = true;
        }
      }
    }
  }
  const incompleteModule = packet.suites.some((suite: any) =>
    suite.modules.some((module: any) => module.configured_on && !module.compute_enabled));
  const incompleteFacts = packet.suites.some((suite: any) =>
    NATIVE_OBSERVATION_FACT_GROUPS.some((group) =>
      suite.coverage[group].invalid > 0 || suite.coverage[group].omitted > 0));
  if (incompleteModule || incompleteFacts || omittedSuites.length) packet.status = "partial";
  return detached(packet);
}
