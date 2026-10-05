import { describe, expect, it } from "vitest";
import {
  captureChartReadout,
  CHART_READOUT_MAX_BYTES,
  CHART_READOUT_SCHEMA,
} from "../chartReadoutSnapshot";

const bars = [
  { time: "2026-09-22", o: 100, h: 103, l: 99, c: 102, v: 1000 },
  { time: "2026-09-23", o: 102, h: 106, l: 101, c: 105, v: 1100 },
  { time: "2026-09-24", o: 105, h: 108, l: 104, c: 107, v: 1200 },
];

describe("chart Data Window readout snapshot", () => {
  it("reads exact latest and selected source bars without nearest-date substitution", () => {
    const lookup = (time: string | number) => ({
      "rsi.value": String(time) === "2026-09-24" ? 61.25 : 54.5,
      "macd.value": String(time) === "2026-09-24" ? 0.8 : 0.2,
    });
    const packet = captureChartReadout(
      { symbol: "NVDA", timeframe: "D", bars },
      lookup, "NVDA", "D", "2026-09-23", false,
    );
    expect(packet.schema).toBe(CHART_READOUT_SCHEMA);
    expect(packet.status).toBe("available");
    expect(packet.latest_loaded?.time).toBe("2026-09-24");
    expect(packet.locked_bar?.time).toBe("2026-09-23");
    expect(packet.locked_bar?.readouts).toContainEqual({ id: "rsi.value", value: 54.5 });
    expect(packet.basis.last_bar_closed).toBe("unknown");
    expect(packet.basis.data_status).toBe("loaded_chart_cache_not_live_attestation");
    expect(packet.basis.native_coverage).toBe("not_all_native_studies");
  });

  it("does not backfill a selected time absent from the loaded chart", () => {
    const packet = captureChartReadout(
      { symbol: "NVDA", timeframe: "D", bars },
      () => ({ "rsi.value": 55 }),
      "NVDA", "D", "2026-09-21", false,
    );
    expect(packet.selection).toEqual({
      requested: "2026-09-21",
      status: "not_loaded",
    });
    expect(packet.locked_bar).toBeNull();
    expect(packet.status).toBe("partial");
  });

  it("refuses a stale symbol or timeframe owner instead of relabeling values", () => {
    const wrongSymbol = captureChartReadout(
      { symbol: "AAPL", timeframe: "D", bars },
      () => ({ x: 1 }), "NVDA", "D", null, false,
    );
    expect(wrongSymbol).toMatchObject({
      status: "unavailable",
      reason: "readout_context_mismatch",
      symbol: "NVDA",
      tf: "D",
    });
    const wrongTf = captureChartReadout(
      { symbol: "NVDA", timeframe: "W", bars },
      () => ({ x: 1 }), "NVDA", "D", null, false,
    );
    expect(wrongTf.reason).toBe("readout_context_mismatch");
  });

  it("preserves missing/nonfinite values as null and marks partial", () => {
    const packet = captureChartReadout(
      { symbol: "NVDA", timeframe: "D", bars },
      () => ({
        finite: 12.5,
        missing: null,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
        wrong_type: "55",
      } as any),
      "NVDA", "D", null, false,
    );
    const values = Object.fromEntries(
      (packet.latest_loaded?.readouts ?? []).map(row => [row.id, row.value]),
    );
    expect(values.finite).toBe(12.5);
    expect(values.missing).toBeNull();
    expect(values.nan).toBeNull();
    expect(values.inf).toBeNull();
    expect(values).not.toHaveProperty("wrong_type");
    expect(packet.latest_loaded?.coverage.nonfinite_as_null).toBe(2);
    expect(packet.status).toBe("partial");
    expect(packet.basis.empty_result).toBe("not_a_no_setup_judgment");
  });
  it("labels replay without upgrading freshness or provider as-of", () => {
    const packet = captureChartReadout(
      { symbol: "NVDA", timeframe: "D", bars },
      () => ({ x: 1 }), "NVDA", "D", null, true,
    );
    expect(packet.basis.data_status).toBe("replay_slice");
    expect(packet.basis.timestamp).toBe("capture_time_not_provider_asof");
    expect(packet.basis.settings_alignment).toBe("not_attested_by_readout_owner");
  });

  it("bounds the complete serialized packet under the published byte ceiling", () => {
    const lookup = () => Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [
        "field_" + String(i).padStart(3, "0") + "_" + "x".repeat(48),
        i + 0.125,
      ]),
    );
    const packet = captureChartReadout(
      { symbol: "NVDA", timeframe: "D", bars },
      lookup, "NVDA", "D", "2026-09-23", false,
    );
    const bytes = new TextEncoder().encode(JSON.stringify(packet)).byteLength;
    expect(bytes).toBeLessThanOrEqual(CHART_READOUT_MAX_BYTES);
    expect(packet.latest_loaded!.coverage.omitted_fields).toBeGreaterThan(0);
    expect(packet.locked_bar!.coverage.omitted_fields).toBeGreaterThan(0);
    expect(packet.status).toBe("partial");
  });
});
