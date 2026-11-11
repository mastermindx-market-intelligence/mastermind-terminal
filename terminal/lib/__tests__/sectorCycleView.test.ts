import { describe, expect, it } from "vitest";
import {
  CYCLE_VIEW_FIELDS,
  CYCLE_VIEW_PAGE,
  captureCycleView,
  lastValuesOffset,
  planCycleViewApply,
  verifyCycleViewApplied,
  type CycleViewSnapshot,
  type CycleViewSource,
} from "../sectorCycleView";

const publicationId = "cycp1-" + "ab".repeat(32);
const readySource = (over: Partial<CycleViewSource> = {}): CycleViewSource => ({
  state: "ready",
  subjectId: "xle",
  family: "sectors",
  asOf: "2026-10-30",
  publicationVerified: true,
  publicationId,
  valuesOpen: true,
  sourcesOpen: false,
  valuesOffset: 0,
  range: [1980.5, 2026.75],
  ...over,
});
const capture = (over: Partial<CycleViewSource> = {}) =>
  captureCycleView(readySource(over)) as CycleViewSnapshot;
const limits = (over: Partial<{ historyReady: boolean; lastOffset: number; chartAvailable: boolean }> = {}) => ({
  historyReady: true,
  lastOffset: 100,
  chartAvailable: true,
  ...over,
});
const applied = (view: CycleViewSnapshot, actual: CycleViewSnapshot | null) =>
  verifyCycleViewApplied(view, actual, view);

describe("capture", () => {
  it("captures exactly the nine donor fields from a ready verified view", () => {
    const view = capture();
    expect(Object.keys(view).sort()).toEqual([...CYCLE_VIEW_FIELDS].sort());
    expect(view).toMatchObject({
      schema: "sector_dossier.view.v1",
      publicationId,
      id: "xle",
      family: "sectors",
      asOf: "2026-10-30",
      range: [1980.5, 2026.75],
      valuesOpen: true,
      sourcesOpen: false,
      valuesOffset: 0,
    });
  });
  it("refuses to capture loading, denied, unverified or ungated views", () => {
    for (const over of [
      { state: "loading" as const },
      { state: "denied" as const },
      { state: "unavailable" as const },
      { publicationVerified: false },
      { publicationId: null },
      { publicationId: "not-a-real-id" },
      { subjectId: null },
      { asOf: null },
    ])
      expect(captureCycleView(readySource(over))).toBeNull();
    // A stale view is still real evidence and still capturable.
    expect(captureCycleView(readySource({ state: "stale" }))).not.toBeNull();
  });
});

describe("apply: exact restore", () => {
  it("plans and verifies a byte-identical restore as applied", () => {
    const before = capture();
    const plan = planCycleViewApply({ ...before }, before, limits());
    expect(plan.status).toBe("apply");
    if (plan.status !== "apply") return;
    // The controller re-renders and re-captures the same view.
    expect(applied(plan.view, { ...before, range: [...(before.range as [number, number])] })).toEqual({
      status: "applied",
      reason: null,
    });
  });
  it("accepts a float-tolerant range restore (1e-7 like the donor)", () => {
    const before = capture({ range: [1990, 2026.75] });
    const plan = planCycleViewApply({ ...before, range: [1990, 2026.75] }, before, limits());
    expect(plan.status).toBe("apply");
    if (plan.status !== "apply") return;
    expect(
      applied(plan.view, { ...before, range: [1990 + 5e-8, 2026.75 - 5e-8] }),
    ).toEqual({ status: "applied", reason: null });
  });
});

describe("apply: rejected restores leave the controller untouched", () => {
  it("view_unavailable when there is no stable capture to diff against", () => {
    expect(
      planCycleViewApply(capture(), null, limits()),
    ).toEqual({ status: "rejected", reason: "view_unavailable" });
  });
  it("invalid_view for shape violations: extra field, missing field, bad types, bad offsets", () => {
    const before = capture();
    const bad = [
      { ...before, extra: 1 },
      { ...(before as unknown as Record<string, unknown>), schema: undefined },
      { ...before, valuesOpen: "yes" },
      { ...before, valuesOffset: 37 },
      { ...before, valuesOffset: 1_000_050 },
      { ...before, valuesOffset: -50 },
      { ...before, range: [10, 10] },
      { ...before, range: [10] },
      { ...before, range: ["1990", 2026] },
      { ...before, schema: "sector_dossier.view.v2" },
      null,
      "sector_dossier.view.v1",
    ];
    for (const raw of bad)
      expect(planCycleViewApply(raw, before, limits())).toEqual({
        status: "rejected",
        reason: "invalid_view",
      });
  });
  it("source_changed when identity fields moved: publication, subject, family or day", () => {
    const before = capture();
    for (const over of [
      { id: "xlk" },
      { family: "baskets" },
      { asOf: "2026-10-29" },
      { publicationId: "cycp1-" + "cd".repeat(32) },
    ])
      expect(planCycleViewApply({ ...before, ...over }, before, limits())).toEqual({
        status: "rejected",
        reason: "source_changed",
      });
  });
  it("values_unavailable for an offset past the last page or opening a missing table", () => {
    const before = capture({ valuesOffset: 0 });
    expect(
      planCycleViewApply({ ...before, valuesOffset: 150 }, before, limits({ lastOffset: 100 })),
    ).toEqual({ status: "rejected", reason: "values_unavailable" });
    expect(
      planCycleViewApply(
        { ...before, valuesOpen: true, valuesOffset: 0 },
        before,
        limits({ historyReady: false, lastOffset: 0 }),
      ),
    ).toEqual({ status: "rejected", reason: "values_unavailable" });
  });
  it("chart_unavailable when a range restore is requested without a chart", () => {
    const before = capture();
    expect(
      planCycleViewApply({ ...before }, before, limits({ chartAvailable: false })),
    ).toEqual({ status: "rejected", reason: "chart_unavailable" });
    // A null range (table-only view) still applies without a chart.
    expect(
      planCycleViewApply({ ...before, range: null }, before, limits({ chartAvailable: false })).status,
    ).toBe("apply");
  });
});

describe("apply: partial restores report what actually happened", () => {
  it("view_unavailable when the re-render left nothing capturable", () => {
    const before = capture();
    const plan = planCycleViewApply({ ...before }, before, limits());
    if (plan.status !== "apply") throw new Error("plan failed");
    expect(applied(plan.view, null)).toEqual({
      status: "partial",
      reason: "view_unavailable",
    });
  });
  it("source_changed when the subject moved under the restore", () => {
    const before = capture();
    const plan = planCycleViewApply({ ...before }, before, limits());
    if (plan.status !== "apply") throw new Error("plan failed");
    expect(applied(plan.view, capture({ subjectId: "xlk" }))).toEqual({
      status: "partial",
      reason: "source_changed",
    });
  });
  it("view_not_restored when any restorable field came back different", () => {
    const before = capture();
    const plan = planCycleViewApply({ ...before }, before, limits());
    if (plan.status !== "apply") throw new Error("plan failed");
    expect(applied(plan.view, capture({ valuesOpen: false }))).toEqual({
      status: "partial",
      reason: "view_not_restored",
    });
    expect(applied(plan.view, capture({ sourcesOpen: true }))).toEqual({
      status: "partial",
      reason: "view_not_restored",
    });
    expect(applied(plan.view, capture({ valuesOffset: 50 }))).toEqual({
      status: "partial",
      reason: "view_not_restored",
    });
    expect(applied(plan.view, capture({ range: [1999, 2026] }))).toEqual({
      status: "partial",
      reason: "view_not_restored",
    });
  });
});

describe("pagination contract", () => {
  it("pages fifty rows and computes the last legal offset", () => {
    expect(CYCLE_VIEW_PAGE).toBe(50);
    expect(lastValuesOffset(0)).toBe(0);
    expect(lastValuesOffset(1)).toBe(0);
    expect(lastValuesOffset(50)).toBe(0);
    expect(lastValuesOffset(51)).toBe(50);
    expect(lastValuesOffset(252)).toBe(250);
  });
});
