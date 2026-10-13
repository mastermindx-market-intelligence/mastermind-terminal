// Mastermind Chart Engine — mount/fallback telemetry glue (P03).
//
// Two rules shape this module (see docs/CHART_ENGINE_MASTERPLAN.md P4 "flip default,
// keep LWC as fallback" — the flip is only shippable if we can SEE what it did):
//   1. ONE mount event per mount. reportEngineMount() is called exactly once per
//      chart engine mount, after the engine object exists, with what the selection
//      logic decided (impl + source) and whether the mount ended in a fallback (with
//      the refusal reason that caused it, if any).
//   2. ONE fallback event per refusal. reportEngineFallback() fires every time a
//      requested "mm" mount was refused and the caller had to re-create on "lwc" —
//      today the F-13 bridge guard and constructor throws in ChartPanel's mount
//      block. A mount that fell back therefore emits one chart_engine_fallback event
//      followed by one chart_engine_mount event with `fallback: true`; a clean mount
//      emits only the mount event.
//
// Privacy by shape: `meta` carries ONLY the selection fields below — no symbol, no
// price, no drawing data, no URL, no user data (the session id / path enrichment
// lives in lib/analytics, outside this lane). Refusal reasons are renderer error
// strings; they are truncated to 200 chars to bound the payload. Both helpers wrap
// their entire body in try/catch and NEVER throw: telemetry must not take down a
// chart. This module reads no browser globals either — it delegates transport to
// track() from "@/lib/analytics".

import { track } from "@/lib/analytics";
import type { EngineImplId, EngineSelectionSource } from "./select";

/** Upper bound for a refusal reason inside an event (kept short on purpose). */
const MAX_REFUSAL_CHARS = 200;

export type EngineMountReport = {
  impl: EngineImplId;
  source: EngineSelectionSource;
  fallback: boolean;
  refusal: string | null;
};

export type EngineFallbackReport = {
  requested: EngineImplId;
  impl: EngineImplId;
  refusal: string | null;
};

/** refusal as it may enter an event: null stays null, anything else is capped. */
function refusalField(refusal: string | null): string | null {
  return refusal === null ? null : refusal.slice(0, MAX_REFUSAL_CHARS);
}

/** Emit the single per-mount "chart_engine_mount" event. Never throws. */
export function reportEngineMount(report: EngineMountReport): void {
  try {
    track({
      type: "chart_engine_mount",
      meta: {
        impl: report.impl,
        source: report.source,
        fallback: report.fallback,
        refusal: refusalField(report.refusal),
      },
    });
  } catch {
    /* fail-silent: analytics must never break a chart mount */
  }
}

/** Emit one "chart_engine_fallback" event for one refusal. Never throws. */
export function reportEngineFallback(report: EngineFallbackReport): void {
  try {
    track({
      type: "chart_engine_fallback",
      meta: {
        requested: report.requested,
        impl: report.impl,
        refusal: refusalField(report.refusal),
      },
    });
  } catch {
    /* fail-silent: analytics must never break a chart mount */
  }
}
