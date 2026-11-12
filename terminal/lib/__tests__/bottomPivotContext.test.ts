import { describe, expect, it } from "vitest";
import fixture from "./fixtures/bottom-pivot/context.json";
import { parseBottomPivotContext, PIVOT_FIELDS, type BottomPivotView, type PivotField } from "../bottomPivotContext";

const NOW = Date.parse("2026-11-05T22:00:00Z");
const fresh = () => structuredClone(fixture);
const context = (raw = fresh()) => raw.rows[0].pivot_context;
const field = (raw: ReturnType<typeof fresh>, name: PivotField) => context(raw).evidence.find(row => row.field === name)!;
const read = (raw: unknown, now = NOW, symbol = "AAPL") => parseBottomPivotContext(raw, symbol, now);
function evidence(view: BottomPivotView) {
  expect(view.kind).toBe("evidence");
  if (view.kind !== "evidence") throw new Error("expected evidence");
  return view;
}

describe("Macro daily pivot contract, presentation only", () => {
  it("consumes the actual Python-composer fixture, without mutating it", () => {
    const raw = fresh(), before = JSON.stringify(raw);
    const view = evidence(read(raw));
    expect(view.quality).toBe("available");
    expect(view.observed).toBe(13);
    expect(view.mode).toBe("current_snapshot");
    expect(JSON.stringify(raw)).toBe(before);
    expect(view).not.toHaveProperty("probability");
    expect(view).not.toHaveProperty("score");
  });
  it("keeps false and zero as observations, not missing or negative authority", () => {
    const raw = fresh(); field(raw, "coiled_fire").value = false; field(raw, "knife_score").value = 0;
    const view = evidence(read(raw));
    expect(view.fields.find(row => row.field === "coiled_fire")).toMatchObject({ state: "observed", value: false });
    expect(view.fields.find(row => row.field === "knife_score")).toMatchObject({ state: "observed", value: 0 });
  });
  it.each([null, {}, { rows: [] }, { is_display_only: false, rows: fixture.rows }])("refuses malformed outer payload %j", raw => {
    expect(read(raw).kind).toBe("unavailable");
  });
  it("matches the requested identity exactly and refuses duplicate source rows", () => {
    expect(read(fresh(), NOW, "MSFT")).toEqual({ kind: "unavailable", reason: "not_covered" });
    const raw = fresh(); raw.rows.push(structuredClone(raw.rows[0]));
    expect(read(raw)).toEqual({ kind: "unavailable", reason: "duplicate" });
  });
  it.each([
    ["schema", "future.v2"], ["symbol", "MSFT"], ["scope", "market"], ["cadence", "intraday"],
    ["is_display_only", false], ["action_authority", "buy"], ["probability", 0.9], ["evidence_mode", "backfilled"],
    ["evidence_mode", ["current_snapshot"]], ["evidence_mode", ["as_issued"]],
  ])("refuses a changed %s contract", (key, value) => {
    const raw = fresh(); Object.assign(context(raw), { [key]: value });
    expect(read(raw)).toEqual({ kind: "unavailable", reason: "contract" });
  });
  it.each([NaN, Infinity, 9e20])("refuses invalid inspection clocks %s", now => {
    expect(read(fresh(), now)).toEqual({ kind: "unavailable", reason: "clock" });
  });
  it.each(["2026-11-05T23:00:00Z", "2026-11-05T16:30:00", "2026-02-30T10:00:00Z", "2026-11-04T24:00:00Z", "0000-01-01T12:00:00Z"])('refuses future, naive or impossible decision "%s"', decision => {
    const raw = fresh(); context(raw).decision_at = decision;
    expect(read(raw)).toEqual({ kind: "unavailable", reason: "clock" });
  });
  it("uses NY calendar days, including the exact seven-day boundary", () => {
    expect(evidence(read(fresh(), Date.parse("2026-11-13T04:59:59Z"))).observed).toBe(13);
    expect(evidence(read(fresh(), Date.parse("2026-11-13T05:00:00Z"))).observed).toBe(0);
  });
  it("a fresh outer envelope cannot refresh stale underlying observations", () => {
    const raw = fresh(); raw.as_of = "2026-11-13";
    const view = evidence(read(raw, Date.parse("2026-11-13T15:00:00Z")));
    expect(view.quality).toBe("unavailable");
    expect(view.fields.every(row => row.state === "stale" && row.value === null)).toBe(true);
  });
  it("preserves historical as-issued observations without calling them current", () => {
    const raw = fresh(); context(raw).evidence_mode = "as_issued";
    for (const row of context(raw).evidence) row.available_at = "2026-11-05T16:00:00-05:00";
    const view = evidence(read(raw, Date.parse("2027-01-01T20:00:00Z")));
    expect(view.mode).toBe("as_issued"); expect(view.observed).toBe(13);
  });
  it("distinguishes unknown first-seen times from usable as-issued receipts", () => {
    const raw = fresh(); Object.assign(field(raw, "coiled_fire"), { available_at: null });
    expect(evidence(read(raw)).firstSeenUnknown).toBe(true);
    context(raw).evidence_mode = "as_issued";
    expect(evidence(read(raw)).fields.find(row => row.field === "coiled_fire")?.state).toBe("not_known");
  });
  it.each(["stale", "future", "conflict", "invalid", "not_known", "missing"])("never promotes producer-rejected %s evidence", state => {
    const raw = fresh(); Object.assign(field(raw, "coiled_fire"), { state, value: true });
    expect(evidence(read(raw)).fields.find(row => row.field === "coiled_fire")).toMatchObject({ state, value: null });
  });
  it.each([
    ["above200", 1], ["knife_score", 1.1], ["knife_score", NaN], ["knife_score", true],
    ["trigger_age_ticks", -1], ["hold_days_basing", 1.2], ["trigger_tier", "ARMED"],
    ["dist_21d_low_pct", -0.1], ["sponsorship_state", "unknown"], ["hold_state", ""],
  ] as [PivotField, unknown][])("rejects invalid %s value %j", (name, value) => {
    const raw = fresh(); Object.assign(field(raw, name), { value });
    expect(evidence(read(raw)).fields.find(row => row.field === name)).toMatchObject({ state: "invalid", value: null });
  });
  it.each([
    [{ as_of: "2026-11-06" }, "future"],
    [{ available_at: "2026-11-05T22:00:00Z" }, "future"],
    [{ available_at: "2026-11-04T22:00:00Z" }, "invalid"],
    [{ as_of: "2026-02-30" }, "invalid"],
    [{ source: "" }, "invalid"],
  ])("checks original source identity and clock %j", (override, state) => {
    const raw = fresh(); Object.assign(field(raw, "coiled_fire"), override);
    expect(evidence(read(raw)).fields.find(row => row.field === "coiled_fire")).toMatchObject({ state, value: null });
  });
  it("exposes a duplicate field as conflict and ignores unknown vocabulary", () => {
    const raw = fresh(); context(raw).evidence.push(structuredClone(field(raw, "coiled_fire")));
    context(raw).evidence.push({ ...field(raw, "above200"), field: "ARMED", value: true });
    const view = evidence(read(raw));
    expect(view.fields.map(row => row.field)).toEqual([...PIVOT_FIELDS]);
    expect(view.fields.find(row => row.field === "coiled_fire")?.state).toBe("conflict");
    expect(view.quality).toBe("partial");
  });
});
