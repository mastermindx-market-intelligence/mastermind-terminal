// E07 — the study-template ownership contract. A template may change ONLY the studies it owns
// (supported built-in instances, native suites, the oracle overlay). Every other chart entry — and
// every param/eye record that belongs to one — must survive capture and both apply modes verbatim.
import { describe, expect, it } from "vitest";
import { withDefaults } from "../indicators";
import { suiteDefaults } from "../suites/meta";
import { studyParamsWithDefaults, type StudyState } from "../studyInstances";
import { normalizeStudyTemplateBody, normalizeStudyTemplateRecord } from "../studyTemplateSchema";
import {
  diffStudyStates,
  planStudyTemplateApply,
  studyStateFingerprint,
  studyTemplateEntryLabel,
  templateFromState,
  type StudyTemplatePlan,
} from "../studyTemplates";

const AMBIENT_TREND = { "te.on": false, "fb.on": false, "vb.on": false, "cp.on": true, "dash.on": false };

/** Deterministic id source for merge remaps. */
function source() {
  let t = 1_791_676_800_000;
  let r = 0.1;
  return { now: () => (t += 1000), random: () => (r = (r + 0.37) % 1) };
}

/** A chart carrying every kind of entry a template must NOT own. */
function chart(): StudyState {
  return {
    inds: ["ema", "macd", "macd__zz99", "experimental_x", "trend", "rsi", "rsi__e06seed01"],
    indParams: {
      ema: { p1: 21, p2: 55 },
      macd: { fast: 8 },
      macd__zz99: { fast: 3, fromNewerBuild: true },
      experimental_x: { opaque: [1, 2, 3] },
      trend: { ...AMBIENT_TREND },
      rsi: { length: 14 },
      rsi__e06seed01: { length: 7 },
      bb: { length: 30 },
      "cmp:AAPL": { color: "#fff" },
    },
    hidden: ["macd__zz99", "pine:abc", "cmp:AAPL", "rsi__e06seed01"],
  };
}

/** What the planner must leave alone: every record not owned by a carried chart/template study. */
function untouched(before: StudyState, plan: StudyTemplatePlan, keys: string[]) {
  for (const key of keys) {
    expect(plan.next.indParams[key], `params of ${key}`).toEqual(before.indParams[key]);
    expect(plan.next.inds.includes(key), `presence of ${key}`).toBe(before.inds.includes(key));
    expect(plan.next.hidden.includes(key), `eye of ${key}`).toBe(before.hidden.includes(key));
  }
}

describe("templateFromState (capture)", () => {
  it("carries supported studies with full params and leaves every other entry out, explained", () => {
    const state: StudyState = {
      ...chart(),
      inds: [...chart().inds, "structure", "_oracle", "cmp:AAPL"],
      indParams: { ...chart().indParams, structure: { "ms.on": false } },
      hidden: [...chart().hidden, "suite:structure/ob", "_oracle"],
    };
    const { body, excluded } = templateFromState(state);
    expect(body.indicators).toEqual(["ema", "macd", "trend", "rsi", "rsi__e06seed01", "structure", "_oracle"]);
    expect(body.indParams.ema).toEqual(studyParamsWithDefaults("ema", { p1: 21, p2: 55 }));
    expect(body.indParams.rsi__e06seed01.length).toBe(7);
    expect(body.indParams.structure).toEqual({ ...suiteDefaults("structure"), "ms.on": false });
    expect(body.hidden.sort()).toEqual(["_oracle", "rsi__e06seed01", "suite:structure/ob"]);
    expect(Object.keys(body.indParams)).not.toContain("bb");
    expect(Object.keys(body.indParams)).not.toContain("cmp:AAPL");
    expect(excluded).toEqual([
      { id: "macd__zz99", reason: "unsupported_multiplicity" },
      { id: "experimental_x", reason: "unknown_study" },
      { id: "cmp:AAPL", reason: "not_portable" },
    ]);
    // What a capture produces is exactly what the server accepts in strict mode.
    expect(normalizeStudyTemplateBody(body, { strict: true }).body).toEqual(body);
  });
});

describe("planStudyTemplateApply — replace", () => {
  const template = {
    indicators: ["bb", "rsi", "rsi__tplseed1", "structure"],
    indParams: { bb: { length: 10 }, rsi: { length: 21 }, rsi__tplseed1: { length: 5 }, structure: { "ms.on": true } },
    hidden: ["rsi__tplseed1", "suite:structure/ob"],
  };

  it("replaces only owned studies and preserves every excluded record verbatim (falsifier)", () => {
    const before = chart();
    const plan = planStudyTemplateApply(before, template, "replace", source());
    // Kept: unsupported records, unknown keys, the ambient candle carrier, compare/Pine eye entries.
    untouched(before, plan, ["macd__zz99", "experimental_x", "trend", "cmp:AAPL"]);
    expect(plan.next.hidden).toEqual(expect.arrayContaining(["pine:abc", "cmp:AAPL", "macd__zz99"]));
    expect(plan.next.inds).toEqual(["macd__zz99", "experimental_x", "trend", "bb", "rsi", "rsi__tplseed1", "structure"]);
    // Removed primaries keep their device preference; a removed additional instance retires.
    expect(plan.next.indParams.ema).toEqual({ p1: 21, p2: 55 });
    expect(plan.next.indParams.macd).toEqual({ fast: 8 });
    expect(plan.next.indParams).not.toHaveProperty("rsi__e06seed01");
    expect(plan.next.hidden).not.toContain("rsi__e06seed01");
    // Applied exactly as the template says.
    expect(plan.next.indParams.bb).toEqual(withDefaults("bb", { length: 10 }));
    expect(plan.next.indParams.rsi.length).toBe(21);
    expect(plan.next.indParams.rsi__tplseed1.length).toBe(5);
    expect(plan.next.indParams.structure).toEqual({ ...suiteDefaults("structure"), "ms.on": true });
    expect(plan.next.hidden).toEqual(expect.arrayContaining(["rsi__tplseed1", "suite:structure/ob"]));
    expect(plan.added).toEqual(["bb", "rsi__tplseed1", "structure"]);
    expect(plan.removed).toEqual(["ema", "macd", "rsi__e06seed01"]);
    expect(plan.changed).toEqual([{ id: "rsi", fields: ["length"], otherFields: 0, visibility: false }]);
    expect(plan.unchanged).toEqual(["trend"]);
  });

  it("previews exactly the state it applies, and re-applying is a no-op", () => {
    const before = chart();
    const plan = planStudyTemplateApply(before, template, "replace", source());
    expect(diffStudyStates(before, plan.next)).toEqual({
      added: plan.added, removed: plan.removed, changed: plan.changed, unchanged: plan.unchanged,
    });
    expect(plan.baseFingerprint).toBe(studyStateFingerprint(before));
    expect(plan.nextFingerprint).toBe(studyStateFingerprint(plan.next));
    const again = planStudyTemplateApply(plan.next, template, "replace", source());
    expect(again.noop).toBe(true);
    expect(again.next).toEqual(plan.next);
  });

  it("clears stale eye entries of a template study that was not on the chart", () => {
    const before: StudyState = { inds: ["ema"], indParams: {}, hidden: ["bb", "suite:structure/ms"] };
    const plan = planStudyTemplateApply(before, template, "replace");
    expect(plan.next.hidden).not.toContain("bb");
    expect(plan.next.hidden).not.toContain("suite:structure/ms");
  });

  it("never applies entries a template cannot own, even from a hostile record", () => {
    const hostile = {
      indicators: ["rsi", "cmp:TSLA", "pine:evil", "symbol", "macd__x9x9"],
      indParams: { rsi: { length: 2 }, "cmp:TSLA": { color: "#000" }, symbol: { value: "TSLA" }, macd__x9x9: { fast: 1 } },
      hidden: ["pine:evil", "cmp:TSLA"],
    };
    const before = chart();
    const plan = planStudyTemplateApply(before, hostile, "replace");
    expect(plan.next.inds).not.toEqual(expect.arrayContaining(["cmp:TSLA"]));
    expect(plan.next.inds).not.toContain("pine:evil");
    expect(plan.next.inds).not.toContain("symbol");
    expect(plan.next.inds).not.toContain("macd__x9x9");
    expect(plan.next.indParams).not.toHaveProperty("symbol");
    expect(plan.next.indParams).not.toHaveProperty("cmp:TSLA");
    expect(plan.next.hidden).not.toContain("pine:evil");
    expect(plan.skipped).toEqual(expect.arrayContaining([
      { id: "macd__x9x9", reason: "unsupported_multiplicity" },
      { id: "cmp:TSLA", reason: "not_portable" },
      { id: "pine:evil", reason: "not_portable" },
      { id: "symbol", reason: "unknown_study" },
    ]));
  });

  it("drops the ambient candle carrier only when the template brings its own trend suite", () => {
    const before = chart();
    const withTrend = { indicators: ["trend"], indParams: { trend: { "te.on": true } }, hidden: [] };
    const plan = planStudyTemplateApply(before, withTrend, "replace");
    expect(plan.next.indParams.trend).toEqual({ ...suiteDefaults("trend"), "te.on": true });
    expect(plan.changed.map((c) => c.id)).toEqual(["trend"]);
  });

  it("fills only the remaining instance slots next to a preserved over-cap record", () => {
    const before: StudyState = {
      inds: ["rsi", "rsi__aaaa0001", "rsi__aaaa0002", "rsi__aaaa0003", "rsi__aaaa0004"],
      indParams: {},
      hidden: [],
    };
    const tpl = { indicators: ["rsi", "rsi__bbbb0001", "rsi__bbbb0002", "rsi__bbbb0003"], indParams: {}, hidden: [] };
    const plan = planStudyTemplateApply(before, tpl, "replace");
    expect(plan.next.inds).toEqual(["rsi__aaaa0004", "rsi", "rsi__bbbb0001", "rsi__bbbb0002"]);
    expect(plan.skipped).toEqual([{ id: "rsi__bbbb0003", reason: "over_cap" }]);
    // The previously over-cap record now draws; the preview says so instead of hiding it.
    expect(plan.added).toContain("rsi__aaaa0004");
  });
});

describe("planStudyTemplateApply — merge (add to chart)", () => {
  it("adds a second instance under a fresh id and reports single-instance collisions", () => {
    const before = chart();
    const tpl = {
      indicators: ["rsi", "macd", "bb", "trend", "structure"],
      indParams: { rsi: { length: 9 }, macd: { fast: 2 }, bb: { length: 11 }, trend: { "te.on": true }, structure: {} },
      hidden: ["rsi"],
    };
    const plan = planStudyTemplateApply(before, tpl, "merge", source());
    const fresh = plan.remapped.rsi;
    expect(fresh).toMatch(/^rsi__[a-z0-9]{4,16}$/);
    expect(plan.next.indParams[fresh].length).toBe(9);
    expect(plan.next.hidden).toContain(fresh);
    // The chart's own studies are not touched in add mode.
    untouched(before, plan, ["ema", "macd", "macd__zz99", "experimental_x", "trend", "rsi", "rsi__e06seed01", "cmp:AAPL"]);
    expect(plan.next.inds.slice(0, before.inds.length)).toEqual(before.inds);
    expect(plan.added).toEqual([fresh, "bb", "structure"]);
    expect(plan.removed).toEqual([]);
    expect(plan.skipped).toEqual(expect.arrayContaining([
      { id: "macd", reason: "collision" },
      { id: "trend", reason: "collision" },
    ]));
    expect(diffStudyStates(before, plan.next).added).toEqual(plan.added);
  });

  it("reports over-cap instances instead of silently dropping them", () => {
    const before: StudyState = { inds: ["rsi", "rsi__aaaa0001", "rsi__aaaa0002", "rsi__aaaa0003"], indParams: {}, hidden: [] };
    const plan = planStudyTemplateApply(before, { indicators: ["rsi"], indParams: {}, hidden: [] }, "merge", source());
    expect(plan.noop).toBe(true);
    expect(plan.skipped).toEqual([{ id: "rsi", reason: "over_cap" }]);
  });
});

describe("guest charts", () => {
  it("applies only what the anonymous limit keeps and restores the records it drops", () => {
    const before: StudyState = { inds: ["ema", "trend"], indParams: { trend: { ...AMBIENT_TREND }, vol: { upCol: "#123456" } }, hidden: ["vol"] };
    const tpl = {
      indicators: ["rsi", "bb", "vol", "macd"],
      indParams: { rsi: { length: 3 }, bb: { length: 4 }, vol: { upCol: "#abcdef" }, macd: { fast: 5 } },
      hidden: [],
    };
    const plan = planStudyTemplateApply(before, tpl, "replace", { guestLimit: 3 });
    // The candle-only carrier is exempt from the count, exactly like the shell's clamp.
    expect(plan.next.inds).toEqual(["trend", "rsi", "bb", "vol"]);
    expect(plan.skipped).toEqual([{ id: "macd", reason: "guest_limit" }]);
    expect(plan.next.indParams).not.toHaveProperty("macd");
    // Replace against a 5-entry template with one more study.
    const five = { ...tpl, indicators: ["rsi", "bb", "macd", "vol"] };
    const clamped = planStudyTemplateApply(before, five, "replace", { guestLimit: 3 });
    expect(clamped.skipped).toEqual([{ id: "vol", reason: "guest_limit" }]);
    expect(clamped.next.indParams.vol).toEqual({ upCol: "#123456" });
    expect(clamped.next.hidden).toContain("vol");
  });
});

describe("legacy and newer records", () => {
  it("applies a v1 device record whose params map held the whole chart", () => {
    const legacy = normalizeStudyTemplateRecord({
      id: "ct_legacy01", name: "Old", indicators: ["ema", "rsi"],
      indParams: { ema: { p1: 5 }, rsi: { length: 6 }, macd: { fast: 1 }, "cmp:AAPL": { color: "#000" } },
      createdAt: "2026-06-01T00:00:00.000Z",
    }, { scope: "device" });
    expect(legacy).not.toBeNull();
    const before = chart();
    const plan = planStudyTemplateApply(before, legacy!.record, "replace");
    expect(plan.next.indParams.macd).toEqual(before.indParams.macd);
    expect(plan.next.indParams["cmp:AAPL"]).toEqual(before.indParams["cmp:AAPL"]);
    expect(plan.next.indParams.ema.p1).toBe(5);
  });

  it("applies a newer record's known studies and explains the rest", () => {
    const newer = normalizeStudyTemplateRecord({
      v: 9, id: "f".repeat(32), name: "Future", indicators: ["rsi", "quantum_osc", "suitex"],
      indParams: { rsi: { length: 8, futureKnob: 3 } }, revision: 2,
    }, { scope: "account" });
    const plan = planStudyTemplateApply(chart(), newer!.record, "merge", source());
    expect(plan.skipped).toEqual(expect.arrayContaining([
      { id: "quantum_osc", reason: "unknown_study" },
      { id: "suitex", reason: "unknown_study" },
    ]));
    // Unknown fields a newer build added are kept with the instance (E06 validate rule).
    expect(plan.next.indParams[plan.remapped.rsi].futureKnob).toBe(3);
  });
});

describe("fingerprints, tiers and labels", () => {
  it("fingerprints ignore eye order but see every param change", () => {
    const a = chart();
    const b = { ...a, hidden: [...a.hidden].reverse() };
    expect(studyStateFingerprint(a)).toBe(studyStateFingerprint(b));
    const c = { ...a, indParams: { ...a.indParams, rsi: { length: 15 } } };
    expect(studyStateFingerprint(a)).not.toBe(studyStateFingerprint(c));
  });

  it("lists enabled premium modules the plan does not include", () => {
    const tpl = { indicators: ["trend"], indParams: { trend: { "dash.on": true } }, hidden: [] };
    const free = planStudyTemplateApply({ inds: [], indParams: {}, hidden: [] }, tpl, "replace", { userTier: "free" });
    expect(free.lockedModules).toContain("suite:trend/dash");
    const pro = planStudyTemplateApply({ inds: [], indParams: {}, hidden: [] }, tpl, "replace", { userTier: "pro" });
    expect(pro.lockedModules).toEqual([]);
  });

  it("labels entries in plain words and never returns a raw key", () => {
    expect(studyTemplateEntryLabel("rsi")).toBe("RSI");
    expect(studyTemplateEntryLabel("rsi__e06seed01", ["rsi", "rsi__e06seed01"], { length: 7 })).toBe("RSI (7)");
    expect(studyTemplateEntryLabel("_oracle")).toBe("Golden Oracle Confluence");
    expect(studyTemplateEntryLabel("quantum_osc")).toBeNull();
  });
});
