import { describe, expect, it } from "vitest";
import { layoutSources, projectR4CaptureHarness, requireR4ChartIdentity, requireSourceKeys, selectWholeFingerprint } from "./helpers/optionsExposureEvidence";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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


describe("the recorded r4 fixture-server configuration transition", () => {
  const path = "terminal/playwright.config.ts";
  const captured = "bb09d98f2bf2647a1975dac07a0e85ab673473986145a1db0d30f22d38e5c076";
  const successor = "de74d9150283eb9dd5243b57c4ee597171d50f328be749d6c43ba8287a6f4525";
  const recorded = Object.freeze({ "Gex.tsx": a, [path]: captured });
  it("preserves the actual recorded configuration and source map", () => {
    expect(projectR4CaptureHarness(recorded, recorded)).toEqual(recorded);
  });
  it("admits only the protected fixture default without rewriting historical inputs", () => {
    const current = { ...recorded, [path]: successor };
    const sources = projectR4CaptureHarness(recorded, current);
    expect(selectWholeFingerprint([{ sources }], current).sources).toEqual(current);
    expect(recorded[path]).toBe(captured);
  });
  it("rejects a third current configuration", () => {
    expect(() => projectR4CaptureHarness(recorded, { ...recorded, [path]: c }))
      .toThrow("CAPTURE_HARNESS_CURRENT_SOURCE");
  });
  it("rejects a changed or missing recorded configuration", () => {
    expect(() => projectR4CaptureHarness({ ...recorded, [path]: successor }, recorded))
      .toThrow("CAPTURE_HARNESS_RECORDED_SOURCE");
    expect(() => projectR4CaptureHarness({ "Gex.tsx": a }, recorded))
      .toThrow("CAPTURE_HARNESS_RECORDED_SOURCE");
  });
  it("does not accept a successor at another path or a missing current key", () => {
    expect(() => projectR4CaptureHarness(recorded, { "Gex.tsx": a, "other.config.ts": successor }))
      .toThrow("CAPTURE_HARNESS_CURRENT_SOURCE");
  });
  it("still rejects changed runtime inputs after the exact harness transition", () => {
    const current = { ...recorded, [path]: successor, "Gex.tsx": b };
    const sources = projectR4CaptureHarness(recorded, current);
    expect(() => selectWholeFingerprint([{ sources }], current)).toThrow("NO_QUALIFIED_CAPTURE");
  });
});

describe("the separately qualified r4 Chart branch", () => {
  const original = "52dcb7e81d556e2239454dae822458236430737f55877bb5bd3b21465aa2e349";
  const peer = "099b71567187d5509182d9cbee9be3d44b584bf1202748df8a6f92a48e0a5c11";
  const successor = "de3e781dedac67c2c0aadeb1142ed2f6d3d3e2075063329e55d9cf88444121e7";
  it("keeps both historical excluded identities without requiring future proof", () => {
    expect(() => requireR4ChartIdentity("/missing-chart-proof", original, peer, original)).not.toThrow();
    expect(() => requireR4ChartIdentity("/missing-chart-proof", original, peer, peer)).not.toThrow();
  });
  it("rejects a changed historical identity before considering a successor", () => {
    expect(() => requireR4ChartIdentity("/missing-chart-proof", a, peer, successor))
      .toThrow("JOINT_CHART_RECORDED_IDENTITY");
  });
  it("rejects an unqualified current Chart instead of treating its exclusion as permission to drift", () => {
    expect(() => requireR4ChartIdentity("/missing-chart-proof", original, peer, d))
      .toThrow("JOINT_CHART_SUCCESSOR_IDENTITY");
  });
  it("requires pinned actual browser proof even for the recognized framing successor", () => {
    const repo = mkdtempSync(join(tmpdir(), "exposure-chart-proof-"));
    try {
      expect(() => requireR4ChartIdentity(repo, original, peer, successor)).toThrow(/ENOENT/);
      const dir = join(repo, "terminal/docs/verification/exposure-workspace-20261103/chart-framing-20261105");
      mkdirSync(dir, {recursive:true});
      writeFileSync(join(dir, "qualification.json"), "{}\n");
      expect(() => requireR4ChartIdentity(repo, original, peer, successor))
        .toThrow("CHART_FRAMING_QUALIFICATION_DIGEST");
    } finally {
      rmSync(repo, {recursive:true,force:true});
    }
  });
});
