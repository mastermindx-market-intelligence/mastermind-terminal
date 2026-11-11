// E06 — the study-instance identity contract. These tests PIN the contract dependents (E07 study
// templates, the chart integration) build on: id grammar, allocation, legacy mapping, sibling
// isolation, retirement, unknown-field preservation, merge and the persisted round trip.
import { describe, expect, it } from "vitest";
import { IND_ORDER, withDefaults } from "../indicators";
import { applyLayoutConfig, captureLayoutConfig, normalizeLayoutConfig, type LayoutWorkspace } from "../layoutConfig";
import {
  MAX_INSTANCES_PER_TYPE,
  MULTI_INSTANCE_TYPES,
  STUDY_ID_MAX_LENGTH,
  STUDY_INSTANCE_SEPARATOR,
  addStudyInstance,
  allocateStudyId,
  compareStudyIds,
  defaultStudyPane,
  isAdditionalStudyId,
  isPrimaryStudyId,
  isSupportedStudyId,
  mergeStudyState,
  nextStudyId,
  parseStudyId,
  patchStudyParams,
  pruneRetiredStudies,
  readStudyStack,
  removeStudyInstance,
  setStudyHidden,
  studyDisplayIndex,
  studyInstanceKey,
  studyParamsWithDefaults,
  studyStateFromInstances,
  studyTypeOf,
  supportsMultipleInstances,
  validateStudyParams,
  type StudyState,
} from "../studyInstances";
import { captureWorkspace, workspaceToLayout } from "../workspaceMigrate";
import { CHART_FIELD_VALIDATORS, INVALID, validateEnvelope } from "../workspaceLayout";

/** Deterministic clock + entropy: each call advances, so allocation is reproducible. */
function fixedSource(start = 1_791_676_800_000, randoms: number[] = [0.11, 0.42, 0.73, 0.05, 0.96]) {
  let t = start;
  let i = 0;
  return {
    now: () => (t += 1000),
    random: () => randoms[i++ % randoms.length],
  };
}

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object") {
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(v);
  }
  return v;
};

const BASE_WS: LayoutWorkspace = {
  panes: ["SPY"], paneTfs: ["D"], split: 1, activePane: 0, sync: true, chartType: "candles",
  inds: [], indParams: {}, hidden: [], compare: [], compareCfg: {}, lockedVLine: null,
};

const RSI_A: Record<string, unknown> = { ...withDefaults("rsi", {}), length: 14 };
const RSI_B: Record<string, unknown> = { ...withDefaults("rsi", {}), length: 21, col: "#ff8800" };

describe("id grammar", () => {
  it("a primary id is the type key itself", () => {
    expect(parseStudyId("rsi")).toEqual({ id: "rsi", type: "rsi", primary: true, token: null });
    expect(isPrimaryStudyId("rsi")).toBe(true);
    expect(isAdditionalStudyId("rsi")).toBe(false);
    expect(studyTypeOf("ema")).toBe("ema");
  });

  it("an additional id is `${type}__${token}` and its type is DERIVED from the id", () => {
    expect(parseStudyId("rsi__lzx4k2a9q1f")).toEqual({ id: "rsi__lzx4k2a9q1f", type: "rsi", primary: false, token: "lzx4k2a9q1f" });
    expect(studyTypeOf("rsi__abcd")).toBe("rsi");
    expect(isAdditionalStudyId("macd__abcd")).toBe(true);
    // the `_lab` key (leading underscore) still parses unambiguously by the LAST separator
    expect(parseStudyId("_lab__abcd")?.type).toBe("_lab");
  });

  it("everything else is NOT a built-in instance (passthrough) — never reinterpreted", () => {
    for (const id of [
      "", "rsi__", "rsi__abc", "rsi__ABCD", "rsi__ab-cd", "rsi___abcd", "nope__abcd", "rsi#abcd", "rsi-abcd", "rsi:abcd",
      "structure", "suite:structure/bos", "suite-pane:x", "pine:abc123", "cmp:SPY", "_oracle", "__proto__", "constructor",
      "rsi__" + "a".repeat(17), "x".repeat(40),
    ]) {
      expect(parseStudyId(id), id).toBeNull();
      expect(studyTypeOf(id), id).toBeNull();
    }
    expect(parseStudyId(14 as unknown)).toBeNull();
    expect(parseStudyId(null)).toBeNull();
  });

  it("every built-in type's longest additional id fits the workspace_layout.v1 indicator-id grammar", () => {
    for (const type of IND_ORDER) {
      const id = `${type}${STUDY_INSTANCE_SEPARATOR}${"z9".repeat(8)}`; // 16-char token = the grammar max
      expect(id.length).toBeLessThanOrEqual(STUDY_ID_MAX_LENGTH);
      expect(parseStudyId(id)?.type).toBe(type);
      expect(CHART_FIELD_VALIDATORS.inds([type, id])).not.toBe(INVALID);
      expect(CHART_FIELD_VALIDATORS.hidden([id])).not.toBe(INVALID);
      expect(CHART_FIELD_VALIDATORS.indParams({ [id]: { length: 3 } })).not.toBe(INVALID);
    }
  });

  it("FALSIFIER: the separators the envelope grammar refuses are refused at save — `__` is not arbitrary", () => {
    for (const bad of ["rsi#abcd1", "rsi-abcd1", "rsi:abcd1"]) {
      expect(CHART_FIELD_VALIDATORS.inds(["rsi", bad])).toBe(INVALID);
      const captured = captureWorkspace({ layout: { ...BASE_WS, inds: ["rsi", bad], indParams: { rsi: RSI_A, [bad]: RSI_B } }, brainIncluded: false });
      expect(captured.dropped).toEqual(expect.arrayContaining(["inds", "indParams"]));
    }
  });

  it("supported multiplicity is a capability list; defaults place by registry kind", () => {
    expect(MULTI_INSTANCE_TYPES).toContain("rsi");
    expect(supportsMultipleInstances("rsi")).toBe(true);
    expect(supportsMultipleInstances("macd")).toBe(false);
    expect(supportsMultipleInstances("nope")).toBe(false);
    expect(isSupportedStudyId("rsi__abcd")).toBe(true);
    expect(isSupportedStudyId("macd")).toBe(true);
    expect(isSupportedStudyId("macd__abcd")).toBe(false);
    expect(defaultStudyPane("rsi")).toBe("own");
    expect(defaultStudyPane("ema")).toBe("price");
  });
});

describe("allocation", () => {
  it("allocated ids are unique, grammar-valid, time-ordered and never the primary", () => {
    const src = fixedSource();
    const taken = ["rsi"];
    const minted: string[] = [];
    for (let i = 0; i < MAX_INSTANCES_PER_TYPE - 1; i++) {
      const id = allocateStudyId("rsi", taken, src)!;
      expect(id).not.toBeNull();
      expect(isAdditionalStudyId(id)).toBe(true);
      expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/);
      expect(taken).not.toContain(id);
      taken.push(id);
      minted.push(id);
    }
    expect([...minted].sort(compareStudyIds)).toEqual(minted); // creation order == canonical order
    expect(new Set(minted).size).toBe(minted.length);
  });

  it("a colliding draw retries; an exhausted draw yields null rather than a duplicate", () => {
    const now = () => 1_791_676_800_000;
    const first = allocateStudyId("rsi", ["rsi"], { now, random: () => 0 })!;
    const rnd = [0, 0, 0.5];
    let i = 0;
    const second = allocateStudyId("rsi", ["rsi", first], { now, random: () => rnd[i++] })!;
    expect(second).not.toBe(first);
    expect(allocateStudyId("rsi", ["rsi", first], { now, random: () => 0 })).toBeNull();
  });

  it("refuses single-instance types and the per-type cap", () => {
    expect(allocateStudyId("macd", ["macd"])).toBeNull();
    expect(allocateStudyId("rsi", ["rsi", "rsi__aaaa", "rsi__bbbb", "rsi__cccc"])).toBeNull();
    expect(nextStudyId("rsi", ["rsi", "rsi__aaaa", "rsi__bbbb", "rsi__cccc"])).toBeNull();
  });

  it("nextStudyId hands out the PRIMARY first, so single-instance users stay byte-identical to pre-E06", () => {
    expect(nextStudyId("rsi", [])).toBe("rsi");
    expect(nextStudyId("macd", ["rsi"])).toBe("macd");
    expect(nextStudyId("macd", ["macd"])).toBeNull();
    expect(isAdditionalStudyId(nextStudyId("rsi", ["rsi"], fixedSource())!)).toBe(true);
    // the primary slot frees up again when only an additional instance remains
    expect(nextStudyId("rsi", ["rsi__aaaa"])).toBe("rsi");
  });
});

describe("legacy mapping (AC-E06-04)", () => {
  const LEGACY: StudyState = deepFreeze({
    inds: ["macd", "structure", "rsi", "suite:structure/bos", "ema", "pine:abc123"],
    indParams: { ema: { len1: 9 }, rsi: { length: 9 }, macd: { fast: 8 }, stochrsi: { k: 3 } },
    hidden: ["macd", "cmp:SPY"],
  });

  it("a v1/v2 triple maps 1:1 onto primaries — no extra study, no rewrite, passthrough kept in order", () => {
    const stack = readStudyStack(LEGACY);
    expect(stack.instances.map((i) => i.id)).toEqual(["ema", "rsi", "macd"]);
    expect(stack.instances.every((i) => i.primary && i.id === i.type)).toBe(true);
    expect(stack.instances.find((i) => i.id === "rsi")!.params).toEqual({ length: 9 });
    expect(stack.instances.find((i) => i.id === "macd")!.hidden).toBe(true);
    expect(stack.passthrough).toEqual(["structure", "suite:structure/bos", "pine:abc123"]);
    expect(stack.unsupported).toEqual([]);
    // the built-in count is exactly the legacy built-in count
    expect(stack.instances.length).toBe(LEGACY.inds.filter((k) => IND_ORDER.includes(k as never)).length);
  });

  it("instance order is a function of membership, not input order", () => {
    const shuffled = readStudyStack({ ...LEGACY, inds: [...LEGACY.inds].reverse() });
    expect(shuffled.instances.map((i) => i.id)).toEqual(["ema", "rsi", "macd"]);
  });

  it("a legacy layout load through applyLayoutConfig is unchanged (prune is the identity on legacy state)", () => {
    const current: LayoutWorkspace = { ...BASE_WS, indParams: { rsi: { length: 30 }, ema: { len1: 50 } }, hidden: ["cmp:QQQ"] };
    const layout = normalizeLayoutConfig({ schemaVersion: 2, panes: ["SPY"], inds: ["rsi", "macd"], indParams: { rsi: { length: 9 } }, hidden: ["macd"] });
    const applied = applyLayoutConfig(layout, current);
    expect(applied.inds).toEqual(["rsi", "macd"]);
    expect(applied.indParams).toEqual({ rsi: { length: 9 }, ema: { len1: 50 } });
    expect(applied.hidden).toEqual(["macd"]);
    const unclaimed = applyLayoutConfig(normalizeLayoutConfig({ schemaVersion: 1, panes: ["SPY"] }), current);
    expect(unclaimed.indParams).toBe(current.indParams);
    expect(unclaimed.hidden).toBe(current.hidden);
  });

  it("hostile and future-shaped input never throws and never corrupts", () => {
    const junk = readStudyStack({ inds: [1, null, "rsi", "rsi", "", "rsi__abcd"] as never, indParams: null as never, hidden: undefined as never });
    expect(junk.instances.map((i) => i.id)).toEqual(["rsi", "rsi__abcd"]);
    expect(junk.instances[0].params).toEqual({});
    const future = normalizeLayoutConfig({ schemaVersion: 9, inds: ["rsi", "rsi__abcd"], studies: [{ id: "x" }], indParams: { rsi__abcd: { length: 5 } } });
    const applied = applyLayoutConfig(future, BASE_WS);
    expect(readStudyStack(applied).instances.map((i) => [i.id, i.params.length])).toEqual([["rsi", undefined], ["rsi__abcd", 5]]);
    expect(Object.keys(applied)).not.toContain("studies");
  });
});

describe("unsupported / future instance ids", () => {
  it("an additional id of a single-instance type is preserved, never rendered and never aliased onto the primary", () => {
    const state = deepFreeze<StudyState>({ inds: ["macd", "macd__abcd1"], indParams: { macd: { fast: 8 }, macd__abcd1: { fast: 3 } }, hidden: [] });
    const stack = readStudyStack(state);
    expect(stack.instances.map((i) => i.id)).toEqual(["macd"]);
    expect(stack.instances[0].params).toEqual({ fast: 8 });
    expect(stack.unsupported).toEqual([{ id: "macd__abcd1", type: "macd", reason: "unsupported_multiplicity" }]);
    // reading is a pure view: the record survives for the build that can render it
    expect(pruneRetiredStudies(state)).toBe(state);
  });

  it("instances over the per-type cap are reported in canonical order (primary and oldest win)", () => {
    const ids = ["rsi__eeee", "rsi__aaaa", "rsi", "rsi__dddd", "rsi__bbbb"];
    const stack = readStudyStack({ inds: ids, indParams: {}, hidden: [] });
    expect(stack.instances.map((i) => i.id)).toEqual(["rsi", "rsi__aaaa", "rsi__bbbb", "rsi__dddd"]);
    expect(stack.unsupported).toEqual([{ id: "rsi__eeee", type: "rsi", reason: "over_cap" }]);
  });
});

describe("params: type-only validation, unknown fields preserved", () => {
  it("drops wrong-typed known fields so defaults backfill; keeps unknown and reserved keys verbatim; never clamps", () => {
    const raw = JSON.parse('{"length":"14","width":1.2,"obLevel":null,"showLevels":"yes","col":7,"_vis":{"1D":false},"_pane":"price","futureKnob":[1,2],"__proto__":{"polluted":true}}');
    const v = validateStudyParams("rsi", raw);
    expect(v).toEqual({ width: 1.2, _vis: { "1D": false }, _pane: "price", futureKnob: [1, 2] });
    expect(Object.prototype.hasOwnProperty.call(v, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const full = studyParamsWithDefaults("rsi__abcd", raw);
    expect(full.length).toBe(withDefaults("rsi", {}).length);
    expect(full.width).toBe(1.2);
    expect(full.futureKnob).toEqual([1, 2]);
    expect(validateStudyParams("rsi", { length: Number.NaN, obLevel: 500 })).toEqual({ obLevel: 500 });
    expect(validateStudyParams("rsi", "nope")).toEqual({});
    expect(validateStudyParams("rsi", [1])).toEqual({});
  });

  it("the compute key is per-instance and order-insensitive in params", () => {
    const a = studyInstanceKey({ id: "rsi", params: { length: 14, col: "#fff" } });
    expect(studyInstanceKey({ id: "rsi", params: { col: "#fff", length: 14 } })).toBe(a);
    expect(studyInstanceKey({ id: "rsi__abcd", params: { length: 14, col: "#fff" } })).not.toBe(a);
    expect(studyInstanceKey({ id: "rsi", params: { length: 15, col: "#fff" } })).not.toBe(a);
  });
});

describe("sibling isolation (AC-E06-02 / AC-E06-03)", () => {
  const TWO: StudyState = deepFreeze({ inds: ["rsi", "rsi__abcd1", "ema"], indParams: { rsi: RSI_A, rsi__abcd1: RSI_B, ema: { len1: 9 } }, hidden: [] });

  it("editing one instance changes only that instance", () => {
    const next = patchStudyParams(TWO, "rsi__abcd1", { length: 30, bogus: undefined });
    expect(next.indParams.rsi).toBe(TWO.indParams.rsi);
    expect(next.indParams.ema).toBe(TWO.indParams.ema);
    expect(next.indParams.rsi__abcd1.length).toBe(30);
    expect(next.indParams.rsi__abcd1.col).toBe("#ff8800");
    expect(patchStudyParams(TWO, "pine:abc", { x: 1 })).toBe(TWO);
  });

  it("hiding one instance hides only that instance", () => {
    const next = setStudyHidden(TWO, "rsi__abcd1", true);
    const stack = readStudyStack(next);
    expect(stack.instances.filter((i) => i.hidden).map((i) => i.id)).toEqual(["rsi__abcd1"]);
    expect(setStudyHidden(next, "rsi__abcd1", true)).toBe(next);
    expect(setStudyHidden(next, "rsi__abcd1", false).hidden).toEqual([]);
  });

  it("removing the additional instance retires its params; removing the primary never promotes the sibling", () => {
    const withoutB = removeStudyInstance(setStudyHidden(TWO, "rsi__abcd1", true), "rsi__abcd1");
    expect(withoutB.inds).toEqual(["rsi", "ema"]);
    expect(withoutB.indParams.rsi__abcd1).toBeUndefined();
    expect(withoutB.indParams.rsi).toBe(TWO.indParams.rsi);
    expect(withoutB.hidden).toEqual([]);

    const withoutA = removeStudyInstance(TWO, "rsi");
    expect(withoutA.inds).toEqual(["rsi__abcd1", "ema"]);
    expect(withoutA.indParams.rsi).toBe(TWO.indParams.rsi); // primary params stay device-wide (pre-E06)
    const left = readStudyStack(withoutA).instances.filter((i) => i.type === "rsi");
    expect(left.map((i) => [i.id, i.primary, i.params.length])).toEqual([["rsi__abcd1", false, 21]]);
    expect(removeStudyInstance(TWO, "structure")).toBe(TWO);
  });

  it("every identity surface is the id: siblings never share a key, and the display index is not an identity", () => {
    const stack = readStudyStack(TWO);
    const keys = stack.instances.map((i) => studyInstanceKey(i));
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(stack.instances.map((i) => i.id)).size).toBe(stack.instances.length);
    expect(studyDisplayIndex("rsi", TWO.inds)).toBe(1);
    expect(studyDisplayIndex("rsi__abcd1", TWO.inds)).toBe(2);
    expect(studyDisplayIndex("rsi__abcd1", ["rsi__abcd1"])).toBe(1);
    expect(studyDisplayIndex("structure", TWO.inds)).toBe(0);
  });
});

describe("add / remove lifecycle (AC-E06-05)", () => {
  it("additional instances are seeded from defaults (+ given params); the primary keeps device params", () => {
    const base: StudyState = { inds: [], indParams: { rsi: { length: 9 } }, hidden: ["rsi"] };
    const first = addStudyInstance(base, "rsi")!;
    expect(first.id).toBe("rsi");
    expect(first.state.indParams.rsi).toEqual({ length: 9 });
    expect(first.state.hidden).toEqual([]);
    const second = addStudyInstance(first.state, "rsi", { ...fixedSource(), params: { length: 21 } })!;
    expect(isAdditionalStudyId(second.id)).toBe(true);
    expect(second.state.indParams[second.id]).toEqual(withDefaults("rsi", { length: 21 }));
    expect(second.state.indParams.rsi).toEqual({ length: 9 });
    expect(addStudyInstance(second.state, "macd")!.id).toBe("macd");
    const macd = addStudyInstance(second.state, "macd")!.state;
    expect(addStudyInstance(macd, "macd")).toBeNull();
  });

  it("repeated add/remove cycles leave no residue and never reuse an id", () => {
    const start: StudyState = deepFreeze({ inds: ["rsi", "ema"], indParams: { rsi: RSI_A, ema: { len1: 9 } }, hidden: ["cmp:SPY"] });
    const src = fixedSource();
    const seen = new Set<string>();
    let state: StudyState = start;
    for (let cycle = 0; cycle < 12; cycle++) {
      const added = addStudyInstance(state, "rsi", src)!;
      expect(seen.has(added.id)).toBe(false);
      seen.add(added.id);
      state = setStudyHidden(added.state, added.id, cycle % 2 === 0);
      state = removeStudyInstance(state, added.id);
    }
    expect(state).toEqual(start);
  });

  it("pruneRetiredStudies retires only dead ADDITIONAL records", () => {
    const state: StudyState = { inds: ["rsi"], indParams: { rsi: RSI_A, macd: { fast: 8 }, rsi__dead1: RSI_B, "pine:x": { a: 1 } }, hidden: ["rsi__dead1", "cmp:SPY", "macd"] };
    const pruned = pruneRetiredStudies(state);
    expect(Object.keys(pruned.indParams).sort()).toEqual(["macd", "pine:x", "rsi"]);
    expect(pruned.hidden).toEqual(["cmp:SPY", "macd"]);
    const clean = { inds: ["rsi"], indParams: { rsi: RSI_A }, hidden: [] };
    expect(pruneRetiredStudies(clean)).toBe(clean);
  });

  it("loading a layout without an additional instance retires that instance's device records (and only those)", () => {
    const current: LayoutWorkspace = { ...BASE_WS, inds: ["rsi", "rsi__abcd1"], indParams: { rsi: RSI_A, rsi__abcd1: RSI_B, ema: { len1: 9 } }, hidden: ["rsi__abcd1"] };
    const applied = applyLayoutConfig(normalizeLayoutConfig({ schemaVersion: 2, panes: ["SPY"], inds: ["ema"], indParams: { ema: { len1: 20 } }, hidden: [] }), current);
    expect(applied.indParams).toEqual({ rsi: RSI_A, ema: { len1: 20 } });
    expect(applied.hidden).toEqual([]);
  });
});

describe("merge (template / import consumers)", () => {
  const CURRENT: StudyState = deepFreeze({ inds: ["rsi", "rsi__aaaa1", "macd", "structure"], indParams: { rsi: RSI_A, rsi__aaaa1: RSI_B, macd: { fast: 8 } }, hidden: ["macd"] });

  it("never overwrites an active instance: a colliding multi-instance id is re-minted under the cap", () => {
    const incoming: StudyState = { inds: ["rsi", "ema", "suite:structure/bos"], indParams: { rsi: { length: 50 }, ema: { len1: 20 } }, hidden: ["rsi"] };
    const result = mergeStudyState(CURRENT, incoming, fixedSource());
    const fresh = result.remapped.rsi;
    expect(isAdditionalStudyId(fresh)).toBe(true);
    expect(result.added).toEqual(["ema", fresh]);
    expect(result.state.indParams.rsi).toBe(RSI_A);
    expect(result.state.indParams[fresh]).toEqual({ length: 50 });
    expect(result.state.indParams.ema).toEqual({ len1: 20 });
    expect(result.state.hidden).toEqual(expect.arrayContaining(["macd", fresh]));
    expect(result.state.hidden).not.toContain("rsi");
    expect(result.passthrough).toEqual(["suite:structure/bos"]);
    expect(result.state.inds).toContain("structure");
    expect(result.state.inds).not.toContain("suite:structure/bos");
    expect(result.unsupported).toEqual([]);
  });

  it("reports single-instance collisions, cap overflow and unsupported records instead of dropping or aliasing them", () => {
    const incoming: StudyState = {
      inds: ["macd", "rsi", "rsi__bbbb1", "rsi__cccc1", "vwap__abcd1"],
      indParams: { macd: { fast: 3 }, rsi: { length: 2 }, rsi__bbbb1: { length: 3 }, rsi__cccc1: { length: 4 } },
      hidden: [],
    };
    const result = mergeStudyState(CURRENT, incoming, fixedSource());
    expect(result.state.indParams.macd).toEqual({ fast: 8 });
    const reasons = Object.fromEntries(result.unsupported.map((u) => [u.id, u.reason]));
    expect(reasons.macd).toBe("collision");
    expect(reasons.vwap__abcd1).toBe("unsupported_multiplicity");
    // current holds 2 RSI; cap 4 admits exactly 2 more, in incoming canonical order
    const rsiAfter = result.state.inds.filter((id) => studyTypeOf(id) === "rsi");
    expect(rsiAfter.length).toBe(MAX_INSTANCES_PER_TYPE);
    expect(reasons.rsi__cccc1).toBe("over_cap");
    expect(result.added.length + result.unsupported.length).toBe(incoming.inds.length);
  });

  it("a replace-style payload round-trips through studyStateFromInstances", () => {
    const stack = readStudyStack(CURRENT);
    const rebuilt = studyStateFromInstances(stack.instances);
    expect(rebuilt.inds).toEqual(["rsi", "rsi__aaaa1", "macd"]);
    expect(rebuilt.hidden).toEqual(["macd"]);
    expect(readStudyStack(rebuilt).instances).toEqual(stack.instances);
  });
});

describe("persisted round trip through the frozen workspace_layout.v1 envelope", () => {
  it("two independently configured RSIs save, validate and reload as two distinct instances", () => {
    const id2 = allocateStudyId("rsi", ["rsi"], fixedSource())!;
    const live: LayoutWorkspace = {
      ...BASE_WS,
      inds: ["ema", id2, "rsi"],
      indParams: { rsi: RSI_A, [id2]: RSI_B, ema: withDefaults("ema", {}) },
      hidden: [id2],
    };
    const captured = captureWorkspace({ layout: live, brainIncluded: false });
    expect(captured.dropped).toEqual([]);
    expect(validateEnvelope(captured.envelope).ok).toBe(true);
    expect(validateEnvelope(JSON.parse(JSON.stringify(captured.envelope)), true).ok).toBe(true);

    const other: LayoutWorkspace = { ...BASE_WS, inds: ["macd"], indParams: { rsi: { length: 99 }, macd: { fast: 1 } }, hidden: [] };
    const restored = applyLayoutConfig(workspaceToLayout(captured.envelope), other);
    const rsis = readStudyStack(restored).instances.filter((i) => i.type === "rsi");
    expect(rsis.map((i) => [i.id, i.params.length, i.params.col, i.hidden])).toEqual([
      ["rsi", 14, RSI_A.col, false],
      [id2, 21, "#ff8800", true],
    ]);
    // and the save is a fixed point: capture(apply(capture(x))) == capture(x)
    expect(captureLayoutConfig(restored).inds).toEqual(captureLayoutConfig(live).inds);
    expect(captureLayoutConfig(restored).indParams).toEqual(captureLayoutConfig(live).indParams);
  });
});
