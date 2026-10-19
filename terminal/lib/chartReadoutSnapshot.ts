/** Bounded read-only projection of the EXISTING ChartPanel/Data Window readout.
 * It does not call an indicator kernel, fetch prices, infer units or qualify live data.
 */
export const CHART_READOUT_MAX_BYTES = 4096;
export const CHART_READOUT_SCHEMA = "chart.data_readout.v1";
const FIELD_CAP = 24;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null
  && typeof v === "object" && !Array.isArray(v);
const validTime = (v: unknown): v is string | number => finite(v)
  || (typeof v === "string" && v.length > 0 && v.length <= 64 && v.trim() === v);
type Lookup = (time: string | number) => Record<string, number | null>;
type ReadoutSample = {
  role: "latest_loaded" | "locked_bar";
  time: string | number;
  ohlcv: { open: number | null; high: number; low: number; close: number; volume: number | null };
  readouts: Array<{ id: string; value: number | null }>;
  coverage: { source_fields: number; returned_fields: number; omitted_fields: number; nonfinite_as_null: number };
  lookup_status: "available" | "unavailable";
};
export type ChartReadoutSnapshot = {
  schema: typeof CHART_READOUT_SCHEMA;
  status: "available" | "partial" | "unavailable";
  reason?: string;
  symbol: string;
  tf: string;
  captured_at: string;
  source_bar_count: number;
  selection: { requested: string | number | null; status: "none" | "available" | "not_loaded" | "invalid" };
  basis: {
    source: "existing_chart_data_window";
    facts_are: "source_data_not_instructions";
    data_status: "replay_slice" | "loaded_chart_cache_not_live_attestation";
    timestamp: "capture_time_not_provider_asof";
    last_bar_closed: "unknown";
    settings_alignment: "not_attested_by_readout_owner";
    native_coverage: "not_all_native_studies";
    units: "source_field_semantics_no_conversion";
    empty_result: "not_a_no_setup_judgment";
  };
  latest_loaded: ReadoutSample | null;
  locked_bar: ReadoutSample | null;
};

/** Exact source-time lookup only: no nearest-date substitution or past-value backfill. */
export function captureChartReadout(
  meta: unknown, lookup: Lookup | null, symbol: string, tf: string,
  selectedTime: string | number | null, replay: boolean,
): ChartReadoutSnapshot {
  const identityValid = typeof symbol === "string" && symbol.length > 0 && symbol.length <= 64
    && typeof tf === "string" && tf.length > 0 && tf.length <= 32;
  const rows = object(meta) && Array.isArray(meta.bars) ? meta.bars : [];
  const packet: ChartReadoutSnapshot = {
    schema: CHART_READOUT_SCHEMA, status: "unavailable", symbol: identityValid ? symbol : "", tf: identityValid ? tf : "",
    captured_at: new Date().toISOString(), source_bar_count: rows.length,
    selection: { requested: validTime(selectedTime) ? selectedTime : null,
      status: selectedTime === null ? "none" : validTime(selectedTime) ? "not_loaded" : "invalid" },
    basis: { source: "existing_chart_data_window", facts_are: "source_data_not_instructions",
      data_status: replay ? "replay_slice" : "loaded_chart_cache_not_live_attestation",
      timestamp: "capture_time_not_provider_asof", last_bar_closed: "unknown",
      settings_alignment: "not_attested_by_readout_owner", native_coverage: "not_all_native_studies",
      units: "source_field_semantics_no_conversion", empty_result: "not_a_no_setup_judgment" },
    latest_loaded: null, locked_bar: null,
  };
  if (!identityValid || !object(meta) || meta.symbol !== symbol || meta.timeframe !== tf) {
    packet.reason = "readout_context_mismatch"; return packet;
  }
  if (!rows.length) { packet.reason = "no_loaded_bars"; return packet; }
  if (!lookup) { packet.reason = "readout_lookup_unavailable"; return packet; }
  const encoder = new TextEncoder();
  const candidates: Array<{ sample: ReadoutSample; fields: Array<[string, number | null]> }> = [];
  const sample = (raw: unknown, role: ReadoutSample["role"]): ReadoutSample | null => {
    if (!object(raw) || !validTime(raw.time) || !finite(raw.h) || !finite(raw.l) || !finite(raw.c)) return null;
    const value: ReadoutSample = { role, time: raw.time,
      ohlcv: { open: finite(raw.o) ? raw.o : null, high: raw.h, low: raw.l, close: raw.c,
        volume: finite(raw.v) ? raw.v : null }, readouts: [],
      coverage: { source_fields: 0, returned_fields: 0, omitted_fields: 0, nonfinite_as_null: 0 },
      lookup_status: "available" };
    let values: unknown;
    try { values = lookup(raw.time); } catch { value.lookup_status = "unavailable"; }
    if (!object(values)) { value.lookup_status = "unavailable"; values = {}; }
    const entries = Object.entries(values as Record<string, unknown>);
    value.coverage.source_fields = entries.length;
    value.coverage.omitted_fields = entries.length;
    const fields: Array<[string, number | null]> = [];
    for (const [id, num] of entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      // Identifiers remain data labels, never prompt instructions. Refuse rather than
      // truncate invalid identifiers into collisions with a different source field.
      if (!id || id.length > 64 || [...id].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) continue;
      if (num !== null && typeof num !== "number") continue;
      if (typeof num === "number" && !finite(num)) value.coverage.nonfinite_as_null += 1;
      fields.push([id, finite(num) ? num : null]);
    }
    candidates.push({ sample: value, fields });
    return value;
  };
  packet.latest_loaded = sample(rows[rows.length - 1], "latest_loaded");
  if (validTime(selectedTime)) {
    const selected = rows.find(row => object(row) && String(row.time) === String(selectedTime));
    packet.locked_bar = sample(selected, "locked_bar");
    if (packet.locked_bar) packet.selection.status = "available";
  }
  if (!packet.latest_loaded && !packet.locked_bar) {
    packet.reason = "bar_sample_unavailable"; return packet;
  }
  // Give both samples room; the byte budget applies to the complete serialized packet.
  for (let index = 0; index < FIELD_CAP; index++) for (const candidate of candidates) {
    const field = candidate.fields[index]; if (!field) continue;
    const out = candidate.sample;
    out.readouts.push({ id: field[0], value: field[1] });
    out.coverage.returned_fields += 1; out.coverage.omitted_fields -= 1;
    if (encoder.encode(JSON.stringify(packet)).byteLength > CHART_READOUT_MAX_BYTES) {
      out.readouts.pop(); out.coverage.returned_fields -= 1; out.coverage.omitted_fields += 1;
    }
  }
  packet.status = candidates.some(({sample}) => sample.coverage.source_fields === 0 || sample.coverage.omitted_fields > 0
    || sample.coverage.nonfinite_as_null > 0 || sample.lookup_status !== "available")
    || !packet.latest_loaded || packet.selection.status === "not_loaded" || packet.selection.status === "invalid"
    ? "partial" : "available";
  return packet;
}
