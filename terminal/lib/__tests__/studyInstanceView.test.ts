// E06 — the read projections every chart surface (renderer, legend, settings, object tree, data
// table) shares. A surface that addressed a study by its TYPE would alias two instances; these
// tests pin that every projection is keyed by the instance id and that a lone instance renders
// exactly as before E06.
import { describe, expect, it } from "vitest";
import { IND_DEFS, withDefaults } from "../indicators";
import { MAX_INSTANCES_PER_TYPE, addStudyInstance, readStudyStack } from "../studyInstances";
import {
  expandStudyOrder,
  isRenderableStudyInstance,
  renderableStudyIds,
  studyInstanceMeta,
  studyParamSummary,
  withStudyInstanceParams,
} from "../studyInstanceView";

const A = "rsi__aaaa1";
const B = "rsi__bbbb2";
const C = "rsi__cccc3";
const D = "rsi__dddd4";
const E = "rsi__eeee5";

describe("renderableStudyIds", () => {
  it("returns the primary first, then additional ids in canonical order, deduplicated", () => {
    expect(renderableStudyIds("rsi", [B, "macd", "rsi", A, B])).toEqual(["rsi", A, B]);
  });

  it("caps at MAX_INSTANCES_PER_TYPE and ignores unsupported / malformed ids", () => {
    const ids = ["rsi", A, B, C, D, E, "macd__aaaa1", "rsi__AB", "rsi__", "suite:x"];
    const out = renderableStudyIds("rsi", ids);
    expect(out).toHaveLength(MAX_INSTANCES_PER_TYPE);
    expect(out).toEqual(["rsi", A, B, C]);
    expect(renderableStudyIds("macd", ids)).toEqual([]);
  });

  it("agrees with readStudyStack on which instances are drawn", () => {
    const inds = [D, "rsi", "macd", B, "macd__zzzz9", A, C, E];
    const stack = readStudyStack({ inds, indParams: {}, hidden: [] });
    const fromStack = stack.instances.filter((i) => i.type === "rsi").map((i) => i.id);
    expect(renderableStudyIds("rsi", inds)).toEqual(fromStack);
  });

  it("an additional instance is renderable without its primary", () => {
    expect(renderableStudyIds("rsi", [B])).toEqual([B]);
    expect(isRenderableStudyInstance(B, [B])).toBe(true);
    expect(isRenderableStudyInstance(B, ["rsi"])).toBe(false);
    expect(isRenderableStudyInstance("suite:x", ["suite:x"])).toBe(false);
  });
});

describe("expandStudyOrder", () => {
  it("expands a multi-instance type in place and leaves single-instance keys as-is", () => {
    expect(expandStudyOrder(["vol", "rsi", "macd"], ["macd", B, "rsi", A])).toEqual(["vol", "rsi", A, B, "macd"]);
  });

  it("with no instances of a type the slot collapses (callers filter by presence)", () => {
    expect(expandStudyOrder(["rsi", "macd"], ["macd"])).toEqual(["macd"]);
  });
});

describe("studyInstanceMeta", () => {
  it("a lone instance keeps the registry label and tag (byte-identical to pre-E06)", () => {
    const meta = studyInstanceMeta("rsi", ["rsi", "macd"], { length: 21 });
    expect(meta).toMatchObject({ id: "rsi", type: "rsi", primary: true, index: 1, siblings: 1 });
    expect(meta?.label).toBe(IND_DEFS.rsi.label);
    expect(meta?.tag).toBe(IND_DEFS.rsi.tag);
    expect(studyInstanceMeta(B, [B])?.label).toBe(IND_DEFS.rsi.label);
  });

  it("siblings get unique labels and tags carrying position and their own first input", () => {
    const active = ["rsi", B];
    const p = studyInstanceMeta("rsi", active, { length: 14 });
    const s = studyInstanceMeta(B, active, { length: 7 });
    expect(p?.label).toBe(`${IND_DEFS.rsi.label} 1 (14)`);
    expect(s?.label).toBe(`${IND_DEFS.rsi.label} 2 (7)`);
    expect(p?.tag).toBe(`${IND_DEFS.rsi.tag} 1 (14)`);
    expect(s?.tag).toBe(`${IND_DEFS.rsi.tag} 2 (7)`);
    expect(s?.primary).toBe(false);
    expect(s?.kind).toBe("pane");
  });

  it("labels stay unique even when two instances share the same params", () => {
    const active = ["rsi", A, B];
    const labels = active.map((id) => studyInstanceMeta(id, active, { length: 14 })?.label);
    const tags = active.map((id) => studyInstanceMeta(id, active, { length: 14 })?.tag);
    expect(new Set(labels).size).toBe(3);
    expect(new Set(tags).size).toBe(3);
  });

  it("missing params fall back to registry defaults in the summary", () => {
    const def = withDefaults("rsi", {}).length;
    expect(studyInstanceMeta(B, ["rsi", B])?.label).toBe(`${IND_DEFS.rsi.label} 2 (${def})`);
  });

  it("is null for passthrough, over-cap, unsupported or inactive ids", () => {
    const active = ["rsi", A, B, C, D];
    expect(studyInstanceMeta(D, active)).toBeNull();
    expect(studyInstanceMeta("macd__aaaa1", ["macd__aaaa1"])).toBeNull();
    expect(studyInstanceMeta("suite:x", ["suite:x"])).toBeNull();
    expect(studyInstanceMeta(B, ["rsi"])).toBeNull();
  });
});

describe("studyParamSummary", () => {
  it("reads the first numeric input of the instance's own params", () => {
    expect(studyParamSummary(B, { length: 9 })).toBe("9");
    expect(studyParamSummary("rsi", { length: 30 })).toBe("30");
  });

  it("an invalid value is replaced by the validated default, never shown raw", () => {
    const def = String(withDefaults("rsi", {}).length);
    expect(studyParamSummary(B, { length: "x" })).toBe(def);
    expect(studyParamSummary("suite:x", { length: 9 })).toBe("");
  });
});

describe("withStudyInstanceParams", () => {
  it("carries each active additional instance's own params, validated and defaults-merged", () => {
    const base = { rsi: withDefaults("rsi", { length: 14 }) } as Record<string, unknown>;
    const out = withStudyInstanceParams(base, ["rsi", B], { rsi: { length: 99 }, [B]: { length: 7 } });
    expect(out.rsi).toBe(base.rsi);
    expect(out[B]).toEqual(withDefaults("rsi", { length: 7 }));
    expect(base[B]).toBeUndefined();
  });

  it("does not carry inactive additional ids (retired records) or non-object payloads", () => {
    const out = withStudyInstanceParams({}, ["rsi", B], { [A]: { length: 5 }, [B]: "junk" });
    expect(out).toEqual({});
  });

  it("preserves an unsupported (future) instance verbatim and never reinterprets it", () => {
    const raw = { length: 5, futureField: { x: 1 } };
    const out = withStudyInstanceParams({}, ["macd__aaaa1"], { "macd__aaaa1": raw });
    expect(out["macd__aaaa1"]).toEqual(raw);
    expect(out["macd__aaaa1"]).not.toBe(raw);
  });

  it("tolerates a missing or malformed store", () => {
    expect(withStudyInstanceParams({ a: 1 }, [B], null)).toEqual({ a: 1 });
    expect(withStudyInstanceParams({ a: 1 }, [B], [1, 2])).toEqual({ a: 1 });
  });
});

describe("sibling independence through the projections", () => {
  it("editing one instance's params changes only its own label", () => {
    const added = addStudyInstance({ inds: ["rsi"], indParams: {}, hidden: [] }, "rsi", { now: () => 1_700_000_000_000, random: () => 0.5 });
    expect(added).not.toBeNull();
    const { state, id } = added!;
    const before = studyInstanceMeta("rsi", state.inds, state.indParams.rsi)?.label;
    const edited = { ...state.indParams, [id]: withDefaults("rsi", { length: 7 }) };
    expect(studyInstanceMeta(id, state.inds, edited[id])?.label).toBe(`${IND_DEFS.rsi.label} 2 (7)`);
    expect(studyInstanceMeta("rsi", state.inds, edited.rsi)?.label).toBe(before);
  });
});
