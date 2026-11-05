import { describe, expect, it } from "vitest";
import { layoutSources, requireSourceKeys, selectWholeFingerprint } from "./helpers/optionsExposureEvidence";

const a = "a".repeat(64), b = "b".repeat(64), c = "c".repeat(64), d = "d".repeat(64);
const first = { profile: "first", sources: { "Gex.tsx": a, "Levels.tsx": b, "capture.cjs": c } };
const second = { profile: "second", sources: { "Gex.tsx": b, "Levels.tsx": c, "capture.cjs": d } };
const keys = ["Gex.tsx", "Levels.tsx", "capture.cjs"];

describe("whole native source qualification", () => {
  it("selects one complete run while permitting unrelated files in the current tree", () => {
    requireSourceKeys(first.sources, keys);
    expect(selectWholeFingerprint([first, second], { ...first.sources, "unrelated.ts": d })).toBe(first);
    expect(selectWholeFingerprint([first, second], second.sources)).toBe(second);
  });
  it("rejects a mixed source map assembled from two independently valid runs", () => {
    expect(() => selectWholeFingerprint([first, second], {
      "Gex.tsx": a, "Levels.tsx": c, "capture.cjs": c,
    })).toThrow("NO_QUALIFIED_CAPTURE");
  });
  it("rejects a changed current runtime dependency", () => {
    expect(() => selectWholeFingerprint([first, second], { ...first.sources, "Levels.tsx": d }))
      .toThrow("NO_QUALIFIED_CAPTURE");
  });
  it("requires the actual capture harness from the same run", () => {
    expect(() => selectWholeFingerprint([first, second], { ...first.sources, "capture.cjs": d }))
      .toThrow("NO_QUALIFIED_CAPTURE");
  });
  it("refuses ambiguous matching runs instead of choosing a first or newest one", () => {
    expect(() => selectWholeFingerprint([first, { ...first, profile: "duplicate" }], first.sources))
      .toThrow("AMBIGUOUS_CAPTURE");
  });
  it("rejects a missing current dependency and an empty declaration set", () => {
    expect(() => selectWholeFingerprint([first], { "Gex.tsx": a, "Levels.tsx": b }))
      .toThrow("NO_QUALIFIED_CAPTURE");
    expect(() => selectWholeFingerprint([], first.sources)).toThrow("NO_DECLARED_CAPTURE");
  });
  it("requires the reviewed exact source keyset, including empty, missing and extra cases", () => {
    expect(() => requireSourceKeys({}, keys)).toThrow("SOURCE_KEY_SET");
    expect(() => requireSourceKeys({ "Gex.tsx": a, "Levels.tsx": b }, keys)).toThrow("SOURCE_KEY_SET");
    expect(() => requireSourceKeys({ ...first.sources, "extra.ts": d }, keys)).toThrow("SOURCE_KEY_SET");
  });
  it("refuses malformed recorded digests", () => {
    expect(() => requireSourceKeys({ ...first.sources, "Gex.tsx": "a".repeat(63) }, keys))
      .toThrow("SOURCE_DIGEST");
  });
  it("keeps each profile's deliberately different native layout closure explicit", () => {
    expect(layoutSources("gex", "exposure")).toHaveLength(12);
    expect(layoutSources("gex", "combined")).toHaveLength(12);
    expect(layoutSources("eod", "exposure")).toHaveLength(13);
    expect(layoutSources("eod", "combined")).toHaveLength(15);
    expect(layoutSources("eod", "combined")).toContain("terminal/components/flowdesk/ChainHeat.module.css");
    expect(layoutSources("eod", "combined")).toContain("terminal/components/gexdesk/ExposureWorkspace.module.css");
  });
});
