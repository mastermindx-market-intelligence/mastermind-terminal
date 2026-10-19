import { describe, expect, it } from "vitest";
import { decodeProphetObservations, prophetObservationSummary } from "../prophetObservations";
import { prophetFixture } from "./prophetObservationsFixture";
import nativeSource from "../../test-fixtures/prophet_wmko_observations_fixture.json";

const digest = "f".repeat(64);
function covered(ticker = "KO", state = "VERIFIED_SOURCE_PARTITION", empty = false) {
  const raw = prophetFixture(ticker);
  if (empty) { raw.rows = []; raw.counts.matched = 0; raw.counts.returned = 0; }
  return {
    ...raw,
    universe_coverage: {
      state: "VERIFIED_SOURCE_PARTITION", reason: null,
      selection_era: "anticipation-v1-2026-08-08", tickers_sha256: digest,
      published_proof_sha256: "c".repeat(64), source_session: "2026-10-16",
    },
    subject_coverage: { ticker, state, reason: null },
  };
}
function timing(asof: string | null = "2026-10-16") {
  return {
    asof, close: 93.9, reset_low: 85.65, reset_low_date: "2026-10-02",
    off_reset_low_pct: 9.63, slow_tier_eligible: true, slow_tier_tier: "T2",
    slow_tier_bars_to_cross_3d: null, slow_tier_blocking: [],
    slow_tier_evaluated: true, slow_tier_above_200dma: true,
  };
}
const view = (raw: unknown, ticker = "KO", zh = false) =>
  prophetObservationSummary({ symbol: ticker, account: "reader-a", status: "ready",
    data: decodeProphetObservations(raw, ticker) }, zh);

describe("source-bound coverage and row timing in the real Prophet projection", () => {
  it("shows WM non-coverage without fabricating an observation or a negative setup", () => {
    const raw = covered("WM", "NOT_IN_UNIVERSE", true);
    const data = decodeProphetObservations(raw, "WM");
    expect(data?.rows).toEqual([]);
    expect(data?.subject_coverage?.state).toBe("NOT_IN_UNIVERSE");
    expect(view(raw, "WM").label).toBe("Not monitored by this scan");
    expect(view(raw, "WM", true).label).toBe("未纳入此扫描");
    expect(view(raw, "WM").current).toBe(false);
  });
  it("distinguishes no recorded event from an unverified membership claim", () => {
    const raw = covered("KO", "IN_UNIVERSE_NO_RECORDED_TRIGGER", true);
    expect(view(raw).label).toBe("No recent recorded turn");
    expect(view(raw, "KO", true).label).toBe("近期无转向记录");
    const legacy = prophetFixture(); legacy.rows = []; legacy.counts.matched = 0; legacy.counts.returned = 0;
    expect(view(legacy).label).toBe("Coverage not reported");
  });
  it("refuses a wrong subject or coverage proof detached from this source", () => {
    const wrong = covered("WM", "NOT_IN_UNIVERSE", true);
    wrong.subject_coverage.ticker = "KO";
    expect(decodeProphetObservations(wrong, "WM")).toBeNull();
    const detached = covered();
    detached.universe_coverage.published_proof_sha256 = "0".repeat(64);
    expect(decodeProphetObservations(detached, "KO")).toBeNull();
    const stale = covered(); stale.universe_coverage.source_session = "2026-10-15";
    expect(decodeProphetObservations(stale, "KO")).toBeNull();
  });
  it("preserves actual price/reset/confirmation facts through both decoder passes", () => {
    const raw = covered();
    const timed = { ...raw, rows: raw.rows.map(row => ({ ...row, source_timing: timing() })) };
    const decoded = decodeProphetObservations(timed, "KO");
    expect(decoded?.rows[0].source_timing).toEqual(timing());
    expect(decodeProphetObservations(decoded, "KO")).toEqual(decoded);
    expect(view(timed).label).toBe("Early evidence — review");
    expect(view(timed).current).toBe(true);
    expect(decoded?.authority.buy).toBe(false);
    expect(decoded?.rows[0].authority.entry_open).toBe(false);
  });
  it.each(["2026-10-15", null])("does not borrow the document clock for row asof %s", asof => {
    const raw = covered();
    const timed = { ...raw, rows: raw.rows.map(row => ({ ...row, source_timing: timing(asof) })) };
    expect(view(timed).label).toBe("Recorded evidence");
    expect(view(timed).current).toBe(false);
  });
  it.each([NaN, Infinity, true, "93.90"])("refuses malformed price %s", close => {
    const raw = covered();
    const timed = { ...raw, rows: raw.rows.map(row => ({ ...row, source_timing: { ...timing(), close } })) };
    expect(decodeProphetObservations(timed, "KO")).toBeNull();
  });
  it("refuses future row clocks and reset dates without changing the real observation", () => {
    for (const patch of [{ asof: "2026-10-19" }, { reset_low_date: "2026-10-19" }]) {
      const raw = covered();
      const timed = { ...raw, rows: raw.rows.map(row => ({ ...row, source_timing: { ...timing(), ...patch } })) };
      expect(decodeProphetObservations(timed, "KO")).toBeNull();
    }
  });
});


describe("committed native producer → backend query → Terminal decoder", () => {
  it("retains the real KO observation and all-false authority", () => {
    const data = decodeProphetObservations(nativeSource.responses.KO, "KO");
    expect(data).not.toBeNull();
    expect(data?.counts.matched).toBe(1);
    expect(data?.rows[0].source_timing?.close).toBe(93.9);
    expect(data?.rows[0].source_timing?.asof).toBe("2026-10-16");
    expect(data?.rows[0].source_timing?.slow_tier_above_200dma).toBe(true);
    expect(data?.authority.buy).toBe(false);
    expect(decodeProphetObservations(data, "KO")).toEqual(data);
  });
  it("keeps WM outside the actual frozen v1 partition with no invented event", () => {
    const data = decodeProphetObservations(nativeSource.responses.WM, "WM");
    expect(data).not.toBeNull();
    expect(data?.subject_coverage?.state).toBe("NOT_IN_UNIVERSE");
    expect(data?.rows).toEqual([]);
    expect(data?.counts.matched).toBe(0);
    expect(view(nativeSource.responses.WM, "WM").label).toBe("Not monitored by this scan");
  });
});


it.each(["constructor", "__proto__"])("refuses inherited object keys as trigger IDs: %s", id => {
  const raw = prophetFixture();
  const trigger = { fired: true, evaluated: true, last_date: "2026-10-16", days_since: 0 };
  const malformed = { ...raw, rows: raw.rows.map(row => ({ ...row, triggers_fired: [id], source_evidence: {
    ...row.source_evidence, triggers: { [id]: trigger },
  } })) };
  expect(decodeProphetObservations(malformed, "KO")).toBeNull();
});
