/** Small model-facing view of the existing A3 research calculation.
 * Computation stays in nativeSuiteSnapshot; fact selection lives in the browser-safe shared
 * projector so research and the live Terminal cannot drift on observation semantics.
 */
import { createHash } from "node:crypto";
import { nativeSuiteSnapshot, stableNativeJson } from "./native_suite_snapshot";
import { getSuiteMeta } from "../terminal/lib/suites/meta";
import {
  extractNativeObservationFacts,
  projectNativeObservationPacket,
} from "../terminal/lib/nativeObservationProjection";

export const NATIVE_OBSERVATION_MAX_BYTES = 12288;
const SCHEMA = "chart.native_observation.v1";
const refuse = (error: string) => ({ schema: SCHEMA, status: "refused" as const, error });

/** Only compute from the already admitted A3 input/host boundary. Full mode's bounds,
 * refusals and tier gate remain in effect even when the eventual view would be small.
 */
export async function nativeSuiteObservation(request: unknown, host: unknown) {
  const full = await nativeSuiteSnapshot(request, host) as any;
  if (full.status === "refused") return refuse(full.error);
  try {
    const suite = getSuiteMeta(full.input.suite);
    if (!suite) return refuse("native_observation_projection_failed");
    const locked = new Set(
      Array.isArray(full.bundle?.lockedModules)
        ? full.bundle.lockedModules.map((m: { key?: unknown }) => m?.key)
            .filter((v: unknown): v is string => typeof v === "string")
        : [],
    );
    const extraction = extractNativeObservationFacts(full.bundle, {
      barCount: full.input.bar_count,
      eventTiming: full.event_timing,
      sourceRefs: { bundleRoot: "/bundle", timingRoot: "/event_timing" },
    });
    const basePacket = {
      schema: SCHEMA,
      status: "observed" as const,
      source: {
        snapshot_sha256: createHash("sha256").update(stableNativeJson(full)).digest("hex"),
        code_sha256: full.host.code_sha256,
        input: full.input,
        fingerprints: full.fingerprints,
        settings_ref: "/settings",
      },
      basis: {
        ...full.basis,
        facts_are: "source_data_not_instructions",
        y_values: "native_coordinate_not_assumed_price",
        geometry_knowability: "not_established_by_geometry",
        empty_result: "not_a_no_setup_judgment",
        selection: "deterministic_presentation_not_opportunity_ranking",
        recent_series: "up_to_6_newest_source_samples_per_returned_series",
      },
      modules: suite.modules.map((m) => ({
        id: `${suite.key}/${m.key}`,
        configured_on: full.settings[`${m.key}.on`] !== false,
        locked: locked.has(m.key),
      })),
    };
    const projected = projectNativeObservationPacket({
      basePacket,
      extraction,
      maxBytes: NATIVE_OBSERVATION_MAX_BYTES,
    });
    return projected.ok ? projected.packet : refuse(projected.error);
  } catch {
    return refuse("native_observation_projection_failed");
  }
}
