import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ENGINE_PROBE_URL_PARAM,
  ENGINE_REFUSAL_PROBE_OPTIONS,
  isRefusalProbeRequested,
} from "../chart-engine/select";
import { normalizeEngineOptions } from "../chart-engine/options";
import { CANVAS_CAPABILITIES } from "../chart-engine/canvas";

// F-13 source contract: ChartPanel's create site is opt-in ?engine=mm with an
// lwc fallback. The default path must stay the plain two-arg createEngine call.
// M04 (574ef4d7) retired the forced `engine.impl !== "lwc"` fallback: ChartPanel
// now drives the engine only through the ChartEngine contract, so ?engine=mm
// MOUNTS mm and only a construction throw (refused option group) falls back.
//
// Anchored slice: from `const requestedImpl = resolveMountEngineImpl(` to the
// next `engineRef.current = engine;`. Both anchors must exist; assertions below
// run against THIS slice, not against the full 10k-line file, so changing an
// unrelated comment cannot accidentally satisfy them.

const chartPanelSrc = readFileSync(
  path.resolve(__dirname, "../../components/ChartPanel.tsx"),
  "utf8",
);

const mountStartIdx = chartPanelSrc.indexOf("const requestedImpl = resolveMountEngineImpl(");
const mountEndIdx = chartPanelSrc.indexOf("engineRef.current = engine;", mountStartIdx);
if (mountStartIdx === -1 || mountEndIdx === -1) {
  throw new Error(
    "chartEngineMountSelect.test.ts: anchors missing — chart-engine mount block was edited outside the F-13 contract",
  );
}
// Anchor slice ends AT the engineRef.current line; KEEP that line included so
// the structural checks below can also use it as a terminus. Add the line's
// length plus the trailing newline so the next sibling line is reachable.
const mountEnd = mountEndIdx + "engineRef.current = engine;".length + 1;
const mountSlice = chartPanelSrc.slice(mountStartIdx, mountEnd);

describe("ChartPanel mount engine selector (F-13)", () => {
  it("routes the create site through resolveMountEngineImpl(window.location.search)", () => {
    expect(chartPanelSrc).toMatch(
      /import\s*\{[^}]*\bresolveMountEngineImpl\b[^}]*\}\s*from\s*["']@\/lib\/chart-engine\/select["']/,
    );
    expect(chartPanelSrc).toMatch(/resolveMountEngineImpl\(\s*window\.location\.search\s*\)/);
  });

  it("mount block (sliced) starts at resolveMountEngineImpl(...) and ends at engineRef.current = engine", () => {
    expect(mountStartIdx).toBeGreaterThanOrEqual(0);
    expect(mountEndIdx).toBeGreaterThan(mountStartIdx);
    // Slice must contain the F-13 boundary.
    expect(mountSlice).toContain("const requestedImpl = resolveMountEngineImpl(");
    expect(mountSlice).toContain("engineRef.current = engine;");
  });

  it("mm branch: creates mm inside try with NO impl guard; only a construction throw falls back", () => {
    // The mm attempt is the whole try body: create mm, then straight into catch (err).
    expect(mountSlice).toMatch(
      /if\s*\(\s*requestedImpl\s*===\s*"mm"\s*\)\s*\{\s*try\s*\{\s*engine\s*=\s*createEngine\(\s*el,\s*engineOptions,\s*"mm"\s*\);\s*\}\s*catch\s*\(\s*err\s*\)\s*\{/,
    );
    // The forced fallback (impl guard + "still needs the raw lwc bridge" warn) is gone
    // from the mount block AND from the whole file, so a successfully built mm stays mounted.
    expect(mountSlice).not.toMatch(/engine\.impl\s*!==?\s*["']lwc["']/);
    expect(mountSlice).not.toMatch(/["']lwc["']\s*!==?\s*engine\.impl/);
    expect(chartPanelSrc).not.toMatch(/engine\.impl\s*!==?\s*["']lwc["']/);
    expect(chartPanelSrc).not.toContain("ChartPanel still needs the raw lwc bridge");
    // Exactly one engine.destroy site in the slice: the catch branch's optional-chained one.
    expect(mountSlice.match(/engine\??\.destroy\s*\(/g) ?? []).toHaveLength(1);
  });

  it("mm catch branch: ?.destroy, template-literal warn, lwc createEngine (in order)", () => {
    // Locate the catch (err) { ... } block; it sits between the impl-guard's
    // closing brace and the } else { branch.
    const catchMatch = mountSlice.match(
      /\}\s*catch\s*\(\s*err\s*\)\s*\{([\s\S]*?)\}\s*\n\s*\}\s*else\s*\{/,
    );
    expect(catchMatch, "catch (err) branch not found before else").toBeTruthy();
    if (catchMatch) {
      const body = catchMatch[1];
      const destroyIdx = body.search(/try\s*\{\s*engine\?\.destroy\(\)\s*;\s*\}\s*catch\s*\{\s*\}/);
      const warnIdx = body.search(/console\.warn\(\s*`chart-engine: mm mount fell back to lwc: \$\{[^}]+\}`\s*\)/);
      const lwcCreateIdx = body.search(/engine\s*=\s*createEngine\(\s*el,\s*engineOptions\s*\);/);
      expect(destroyIdx).toBeGreaterThanOrEqual(0);
      expect(warnIdx).toBeGreaterThan(destroyIdx);
      expect(lwcCreateIdx).toBeGreaterThan(warnIdx);
    }
  });

  it('else branch: bare lwc createEngine(el, engineOptions)', () => {
    expect(mountSlice).toMatch(/\}\s*else\s*\{\s*engine\s*=\s*createEngine\(\s*el,\s*engineOptions\s*\);\s*\}/);
  });

  it("slice contains exactly three createEngine( call sites and no .unwrap( leak", () => {
    // mm attempt, catch-branch lwc fallback, default else-branch lwc.
    const createEngineCalls = mountSlice.match(/createEngine\s*\(/g) ?? [];
    expect(createEngineCalls.length, "expected 3 createEngine( calls in mount slice").toBe(3);
    // The mount slice has no reason to unwrap() — that comes after the slice.
    expect(mountSlice).not.toMatch(/\.unwrap\s*\(/);
    // No browser storage reads.
    expect(mountSlice).not.toMatch(/localStorage/);
    expect(mountSlice).not.toMatch(/sessionStorage/);
  });
});

// P01-A03 live probe (production acceptance "forced refusal → lwc fallback"): the
// probe lives in the engineOptions literal ABOVE the F-13 slice, so the mount block's
// structure (three createEngine( sites, catch branch) is unchanged and the refusal
// travels the real production fallback path.
const optionsStartIdx = chartPanelSrc.indexOf("const engineOptions = {");
const optionsSlice = chartPanelSrc.slice(optionsStartIdx, mountStartIdx);

describe("ChartPanel forced-refusal probe (P01-A03)", () => {
  it("isRefusalProbeRequested: only ?engine=mm + engineProbe=refuse", () => {
    expect(ENGINE_PROBE_URL_PARAM).toBe("engineProbe");
    expect(isRefusalProbeRequested("?engine=mm&engineProbe=refuse")).toBe(true);
    expect(isRefusalProbeRequested("engine=MM&engineProbe=%20Refuse%20")).toBe(true);
    expect(isRefusalProbeRequested("?symbol=NVDA&engine=mm&engineProbe=refuse")).toBe(true);
    expect(isRefusalProbeRequested("?engine=mm")).toBe(false);
    expect(isRefusalProbeRequested("?engineProbe=refuse")).toBe(false);
    expect(isRefusalProbeRequested("?engine=lwc&engineProbe=refuse")).toBe(false);
    expect(isRefusalProbeRequested("?engine=bogus&engineProbe=refuse")).toBe(false);
    expect(isRefusalProbeRequested("?engine=mm&engineProbe=yes")).toBe(false);
    expect(isRefusalProbeRequested("")).toBe(false);
    expect(isRefusalProbeRequested(null)).toBe(false);
    expect(isRefusalProbeRequested(undefined)).toBe(false);
  });

  it("the probe option group is one the mm renderer refuses (normalizer contract)", () => {
    const result = normalizeEngineOptions({ ...ENGINE_REFUSAL_PROBE_OPTIONS }, CANVAS_CAPABILITIES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unsupported).toEqual(["trackingMode"]);
    expect(result.reason).toBe("unsupported option group: trackingMode");
    // Negative: the same capabilities accept the groups ChartPanel always sends.
    const clean = normalizeEngineOptions({ width: 1, height: 1, layout: {}, grid: {} }, CANVAS_CAPABILITIES);
    expect(clean.ok).toBe(true);
  });

  it("ChartPanel spreads the probe into engineOptions only via isRefusalProbeRequested(window.location.search)", () => {
    expect(optionsStartIdx).toBeGreaterThan(0);
    expect(optionsStartIdx).toBeLessThan(mountStartIdx);
    expect(chartPanelSrc).toMatch(
      /import\s*\{[^}]*\bENGINE_REFUSAL_PROBE_OPTIONS\b[^}]*\bisRefusalProbeRequested\b[^}]*\}\s*from\s*["']@\/lib\/chart-engine\/select["']/,
    );
    expect(optionsSlice).toMatch(
      /\.\.\.\(\s*isRefusalProbeRequested\(\s*window\.location\.search\s*\)\s*\?\s*ENGINE_REFUSAL_PROBE_OPTIONS\s*:\s*\{\}\s*\)/,
    );
    // Exactly one probe site, no hand-written trackingMode, and the F-13 slice stays probe-free.
    expect((chartPanelSrc.match(/isRefusalProbeRequested\(/g) ?? []).length).toBe(1);
    expect(chartPanelSrc).not.toMatch(/trackingMode\s*:/);
    expect(mountSlice).not.toMatch(/isRefusalProbeRequested|ENGINE_REFUSAL_PROBE_OPTIONS|engineProbe/);
  });
});
