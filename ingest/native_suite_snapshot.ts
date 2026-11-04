/** Node-only research adapter over the actual Terminal renderer kernel.
 * No browser, remote data, account store, event ledger, scheduling or indicator maths.
 * This observes the renderer's bounded bundle, not an independently qualified signal.
 */
import { createHash } from "node:crypto";
import { readNativeSuiteParams } from "../terminal/lib/chartIndicatorParams";
import { SUITE_ORDER, suiteDefaults } from "../terminal/lib/suites/meta";
import { ensureSuiteRuntime } from "../terminal/lib/suites/compute";
import { computeSuite, resolveSuiteColors, type SuiteHostInput } from "../terminal/lib/indicator-canvas/host";
import { suiteEventTiming, validSuiteBarClock } from "../terminal/lib/suiteAlerts";
import type { SuiteTier } from "../terminal/lib/indicator-canvas/types";

export const NATIVE_SNAPSHOT_MAX_INPUT_BYTES = 1048576;
export const NATIVE_SNAPSHOT_MAX_OUTPUT_BYTES = 262144;
export const NATIVE_SNAPSHOT_MAX_BARS = 2000;
const REQUEST_KEYS = ["schema", "suite", "symbol", "timeframe", "data_revision", "bar_state", "params", "bars"];
const BAR_KEYS = ["time", "o", "h", "l", "c", "v"];
const SCHEMA = "chart.native_snapshot.v1";
export type SnapshotHost = { tier: SuiteTier; code_sha256: string };
export type SnapshotRefusal = { schema: typeof SCHEMA; status: "refused"; error: string };
const refuse = (error: string): SnapshotRefusal => ({ schema: SCHEMA, status: "refused", error });
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === null || proto === Object.prototype)
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(d => "value" in d)
    && Object.getOwnPropertySymbols(value).length === 0;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** JSON-safe projection; a null visual coordinate denotes a missing number, never zero.
 * Maps and typed series occur in real render bundles. Sorted keys give order-independent
 * fingerprints. Consumers receive detached objects, never the host's shared memo entries.
 */
function normalize(value: unknown, gaps: { count: number }): any {
  if (typeof value === "number" && !Number.isFinite(value)) { gaps.count++; return null; }
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<unknown>, v => normalize(v, gaps));
  if (Array.isArray(value)) return value.map(v => normalize(v, gaps));
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Object.fromEntries(entries.sort(([a], [b]) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
    .map(([key, v]) => [key, normalize(v, gaps)]));
}
export function stableNativeJson(value: unknown): string {
  return JSON.stringify(normalize(value, { count: 0 }));
}

/** Host context is supplied outside the model/request object. The CLI derives its own
 * executable fingerprint and defaults to free. This is not a customer entitlement API.
 */
export async function nativeSuiteSnapshot(request: unknown, host: unknown) {
  if (!record(host) || !exactKeys(host, ["tier", "code_sha256"])
      || !["free", "essential", "pro"].includes(String(host.tier))
      || typeof host.code_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(host.code_sha256))
    return refuse("unbound_host_context");
  if (!record(request) || !exactKeys(request, REQUEST_KEYS)) return refuse("bad_request_shape");
  if (request.schema !== "chart.native_snapshot_request.v1") return refuse("unsupported_schema");
  if (typeof request.suite !== "string" || !(SUITE_ORDER as readonly string[]).includes(request.suite)) return refuse("unknown_suite");
  if (request.timeframe !== "D") return refuse("unsupported_timeframe");
  if (request.bar_state !== "declared_closed") return refuse("closed_bar_declaration_required");
  if (typeof request.symbol !== "string" || !/^[A-Za-z0-9._:^/-]{1,64}$/.test(request.symbol)) return refuse("bad_symbol");
  if (typeof request.data_revision !== "string" || !request.data_revision.length || request.data_revision.length > 128
      || /[\u0000-\u001f\u007f]/.test(request.data_revision)) return refuse("bad_data_revision");
  if (!record(request.params)) return refuse("bad_native_params");
  const validated = readNativeSuiteParams(request.suite, request.params);
  if (!validated.ok) return refuse(validated.error);
  if (!Array.isArray(request.bars) || !request.bars.length || request.bars.length > NATIVE_SNAPSHOT_MAX_BARS)
    return refuse("bad_bar_count");
  const bars: SuiteHostInput["bars"] = [];
  const times: number[] = [];
  for (const row of request.bars) {
    if (!record(row) || !exactKeys(row, BAR_KEYS) || typeof row.time !== "string"
        || !/^\d{4}-\d{2}-\d{2}$/.test(row.time)) return refuse("bad_daily_bar");
    const t = Date.parse(row.time + "T00:00:00.000Z");
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== row.time) return refuse("bad_calendar_date");
    if (![row.o, row.h, row.l, row.c].every(n => finite(n) && n > 0)
        || !finite(row.v) || row.v < 0) return refuse("bad_ohlcv");
    const { o, h, l, c, v } = row as { o: number; h: number; l: number; c: number; v: number };
    if (l > Math.min(o, c) || h < Math.max(o, c) || l > h) return refuse("bad_ohlc_geometry");
    bars.push({ time: row.time, o, h, l, c, v }); times.push(t / 1000);
  }
  if (!validSuiteBarClock(times)) return refuse("unordered_or_duplicate_bars");
  // Bound direct API calls as well as the CLI wire reader.
  if (Buffer.byteLength(stableNativeJson(request), "utf8") > NATIVE_SNAPSHOT_MAX_INPUT_BYTES)
    return refuse("input_too_large");
  const settings = { ...suiteDefaults(request.suite), ...validated.params };
  const runtime = await ensureSuiteRuntime(request.suite);
  if (!runtime) return refuse("native_runtime_unavailable");
  const colors = resolveSuiteColors();
  const input: SuiteHostInput = { bars, symbol: request.symbol, tf: "D", isIntraday: false, lang: "en" };
  try {
    const raw = computeSuite(runtime, settings, input, host.tier as SuiteTier, colors);
    const gaps = { count: 0 };
    const bundle = normalize(raw, gaps);
    const eventTiming = raw.events.map((event, event_index) => ({ event_index,
      timing: suiteEventTiming(event, times) }));
    const response = {
      schema: SCHEMA, status: "observed" as const,
      basis: { scope: "native_renderer_bundle", module_health: "unknown", warmup: "unknown",
        closed_bars: "caller_asserted", data_revision: "caller_asserted", knowledge_time: null,
        predictive_validation: false, signal_authority: false,
        geometry: "native_renderer_caps_apply", history: "not_a_complete_event_ledger",
        nonfinite_numbers: "null_not_zero", nonfinite_number_count: gaps.count,
        event_time: "source_bar_identity_not_wall_clock_arrival", strength: "native_score_not_probability" },
      input: { suite: request.suite, symbol: request.symbol, timeframe: "D", data_revision: request.data_revision,
        bar_count: bars.length, first_bar: bars[0].time, last_bar: bars[bars.length - 1].time },
      host: { tier: host.tier, code_sha256: host.code_sha256, colors, lang: "en" },
      settings, event_timing: eventTiming, invalid_event_timing_count: eventTiming.filter(e => !e.timing).length,
      fingerprints: { input_sha256: digest(stableNativeJson({ input, data_revision: request.data_revision })),
        settings_sha256: digest(stableNativeJson(settings)), result_sha256: digest(stableNativeJson(bundle)) },
      bundle,
    };
    if (Buffer.byteLength(stableNativeJson(response), "utf8") > NATIVE_SNAPSHOT_MAX_OUTPUT_BYTES)
      return refuse("output_too_large");
    return response;
  } catch {
    // A host-level failure is not a neutral market observation. Per-module suppression
    // inside the unmodified renderer remains explicitly unknown in every observation.
    return refuse("native_observation_failed");
  }
}
