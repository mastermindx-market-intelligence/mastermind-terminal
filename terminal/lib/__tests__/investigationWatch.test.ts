import { describe, expect, it } from "vitest";
import { armingNote, buildWatchCondition, WATCH_KINDS_OFFERED, watchState, watchesFor, type OwnerAlertRow } from "../investigationWatch";

const link = { investigation_id: "00000000-0000-4000-8000-000000000001", revision: 3 };
const row = (over: Partial<OwnerAlertRow>): OwnerAlertRow => ({
  id: "alert-1", symbol: "NVDA", active: true, created_at: "2026-10-21T14:00:00Z",
  condition: { type: "price", op: "above", value: 230, evidence: link, ...over.condition },
  ...over,
});

describe("investigation watch builder", () => {
  it("builds the owner's price condition for a price touch and links it to the investigation revision", () => {
    const built = buildWatchCondition(link, "NVDA", "price_touch", { op: "above", value: 230 });
    expect(built).toMatchObject({ ok: true, symbol: "NVDA", condition: { type: "price", op: "above", value: 230, evidence: link } });
    if (!built.ok) throw new Error("price touch refused");
    expect(built.plain.en).toBe("Last price above 230.00 · evaluated every 5 minutes against the latest hub quote · fires once, then disarms");
    expect(built.plain.zh).toContain("最新价高于 230.00");
    expect(built.plain.zh).toContain("触发一次后自动解除");
    expect(buildWatchCondition(link, "NVDA", "price_touch", { op: "above", value: 0 })).toMatchObject({ refused: true, reason: "invalid_threshold" });
    expect(buildWatchCondition(link, "NVDA", "price_touch", { op: "above" })).toMatchObject({ refused: true, reason: "invalid_threshold" });
    expect(buildWatchCondition(link, "NVDA", "price_touch", { op: "sideways" as never, value: 230 })).toMatchObject({ refused: true, reason: "invalid_threshold" });
    expect(buildWatchCondition(link, "", "price_touch", { op: "above", value: 230 })).toMatchObject({ refused: true, reason: "invalid_symbol" });
  });

  it("builds the owner's wall-touch condition for price proximity and refuses a strike-level proximity", () => {
    const built = buildWatchCondition(link, "SPY", "price_proximity", { band_pct: 0.25 });
    expect(built).toMatchObject({ ok: true, condition: { type: "opt_wall_touch", root: "SPY", wall: "call", within_pct: 0.25, evidence: link } });
    expect(buildWatchCondition(link, "SPY", "price_proximity", { band_pct: 0.25, wall: "put" }))
      .toMatchObject({ ok: true, condition: { type: "opt_wall_touch", wall: "put" } });
    expect(buildWatchCondition(link, "SPY", "price_proximity", { band_pct: 0.25, strike: 230 }))
      .toMatchObject({ refused: true, reason: "strike_level_not_expressible" });
    expect(buildWatchCondition(link, "NOT_A_ROOT", "price_proximity", { band_pct: 0.25 })).toMatchObject({ refused: true, reason: "invalid_symbol" });
    expect(buildWatchCondition(link, "SPY", "price_proximity", {})).toMatchObject({ refused: true, reason: "invalid_threshold" });
  });

  it("refuses exposure change, rotation transition and event time with the no-evaluator reason", () => {
    for (const kind of ["exposure_change", "rotation_transition", "event_time"] as const) {
      expect(buildWatchCondition(link, "NVDA", kind, { op: "above", value: 230 })).toEqual({
        refused: true, kind, reason: "no_evaluator",
        plain: {
          en: "No evaluator for this watch kind exists in the alerts owner, so it cannot be armed here.",
          zh: "提醒系统没有此类监测的评估器，无法在此创建。",
        },
      });
    }
    expect(WATCH_KINDS_OFFERED).toEqual(["price_touch", "price_proximity"]);
  });

  it("keeps the evidence link outside the evaluator's inputs", () => {
    const built = buildWatchCondition(link, "NVDA", "price_touch", { op: "above", value: 230 });
    if (!built.ok) throw new Error("refused");
    // The owner's price evaluator reads only op and value; the condition carries exactly these
    // four keys and nothing else, so the evaluator can never see the link.
    expect(Object.keys(built.condition).sort()).toEqual(["evidence", "op", "type", "value"]);
    const wall = buildWatchCondition(link, "SPY", "price_proximity", { band_pct: 0.25 });
    if (!wall.ok) throw new Error("refused");
    expect(Object.keys(wall.condition).sort()).toEqual(["evidence", "root", "type", "wall", "within_pct"]);
    // A different revision names a different link, so the owner's condition fingerprint (which
    // hashes every non-transient key) changes and a correction mints a new fire id.
    const other = buildWatchCondition({ ...link, revision: 4 }, "NVDA", "price_touch", { op: "above", value: 230 });
    if (!other.ok) throw new Error("refused");
    expect(JSON.stringify(other.condition)).not.toBe(JSON.stringify(built.condition));
    expect(other.condition.evidence).toEqual({ investigation_id: link.investigation_id, revision: 4 });
  });

  it("projects an armed, a fired-and-disarmed and a re-armed watch from the owner's row", () => {
    const armed = row({});
    expect(watchState(armed)).toEqual({ state: "armed", since: "2026-10-21T14:00:00Z" });
    const fired = row({ active: false, condition: { type: "price", op: "above", value: 230, evidence: link, triggered: { at: "2026-10-21T15:40:03Z", value: 230.12, note: "price 230.12 above 230 (hub)" } } });
    expect(watchState(fired)).toEqual({ state: "fired", at: "2026-10-21T15:40:03Z", value: 230.12, note: "price 230.12 above 230 (hub)", disarmed: true });
    // Re-arming is the owner's PATCH: the triggered stamp is stripped and active flips back on.
    const rearmed = row({ condition: { type: "price", op: "above", value: 230, evidence: link } });
    expect(watchState(rearmed)).toMatchObject({ state: "armed" });
    expect(watchState(row({ active: false }))).toEqual({ state: "unknown" });
    expect(watchState({ id: "" })).toEqual({ state: "unknown" });
    expect(watchState(undefined as never)).toEqual({ state: "unknown" });
  });

  it("says that arming beyond the threshold fires on the next evaluation and says when no quote is loaded", () => {
    expect(armingNote(230, "above", { value: 231.4, asOf: "2026-10-21T16:30:04Z" }, "en"))
      .toBe("The current quote 231.40 is already above 230.00, so this watch fires on the next evaluation.");
    expect(armingNote(230, "below", { value: 229.9, asOf: "x" }, "zh"))
      .toBe("当前报价 229.90 已低于 230.00，此监测将在下一次评估时触发。");
    expect(armingNote(230, "above", null, "en"))
      .toBe("current quote not loaded here; if the price is already beyond the threshold the watch fires on the next evaluation");
    expect(armingNote(230, "above", null, "zh")).toContain("此处未加载当前报价");
    expect(armingNote(230, "above", { value: 228, asOf: "x" }, "en")).toBe("");
  });

  it("finds only the watches linked to this investigation", () => {
    const rows = [
      row({}),
      row({ id: "alert-2", condition: { type: "price", op: "below", value: 200, evidence: { investigation_id: "00000000-0000-4000-8000-000000000001", revision: 1 } } }),
      row({ id: "alert-3", condition: { type: "price", op: "above", value: 300 } }),
      row({ id: "alert-4", condition: { type: "opt_wall_touch", root: "NVDA", wall: "call", within_pct: 0.25, evidence: { investigation_id: "00000000-0000-4000-8000-000000000009", revision: 2 } } }),
    ];
    expect(watchesFor(rows, link.investigation_id).map(r => r.id)).toEqual(["alert-1", "alert-2"]);
    expect(watchesFor([], link.investigation_id)).toEqual([]);
  });
});
