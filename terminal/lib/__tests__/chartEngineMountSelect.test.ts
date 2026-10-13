import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F-13 source contract: ChartPanel's create site is opt-in ?engine=mm with an
// lwc fallback. The default path must stay the plain two-arg createEngine call.
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

  it("mm branch: creates mm, impl-guards !lwc, destroys attempt, warns one line, mounts lwc", () => {
    expect(mountSlice).toMatch(/if\s*\(\s*requestedImpl\s*===\s*"mm"\s*\)\s*\{\s*try\s*\{/);
    // The mm attempt then the impl guard immediately after.
    expect(mountSlice).toMatch(
      /engine\s*=\s*createEngine\(\s*el,\s*engineOptions,\s*"mm"\s*\);\s*\n\s*if\s*\(\s*engine\.impl\s*!==\s*"lwc"\s*\)\s*\{/,
    );
    // Inside the impl-guard branch the order is: try/destroy, warn, lwc create.
    const implGuardMatch = mountSlice.match(
      /if\s*\(\s*engine\.impl\s*!==\s*"lwc"\s*\)\s*\{([\s\S]*?)\}\s*\n\s*\}\s*catch\s*\(\s*err\s*\)\s*\{/,
    );
    expect(implGuardMatch, "impl-guard branch not found before catch").toBeTruthy();
    if (implGuardMatch) {
      const body = implGuardMatch[1];
      // Order: destroy+catch → console.warn line → lwc createEngine.
      const destroyIdx = body.search(/try\s*\{\s*engine\.destroy\(\)\s*;\s*\}\s*catch\s*\{\s*\}/);
      const warnIdx = body.search(/console\.warn\(\s*"chart-engine: mm mount fell back to lwc: ChartPanel still needs the raw lwc bridge \(F-13\)"\s*\)/);
      const lwcCreateIdx = body.search(/engine\s*=\s*createEngine\(\s*el,\s*engineOptions\s*\);/);
      expect(destroyIdx).toBeGreaterThanOrEqual(0);
      expect(warnIdx).toBeGreaterThan(destroyIdx);
      expect(lwcCreateIdx).toBeGreaterThan(warnIdx);
    }
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

  it("slice contains exactly four createEngine( call sites and no .unwrap( leak", () => {
    const createEngineCalls = mountSlice.match(/createEngine\s*\(/g) ?? [];
    expect(createEngineCalls.length, "expected 4 createEngine( calls in mount slice").toBe(4);
    // The mount slice has no reason to unwrap() — that comes after the slice.
    expect(mountSlice).not.toMatch(/\.unwrap\s*\(/);
    // No browser storage reads.
    expect(mountSlice).not.toMatch(/localStorage/);
    expect(mountSlice).not.toMatch(/sessionStorage/);
  });

  // P03 ADDITION (assertions may only be added here — the BASE block above pins the
  // UNMODIFIED ChartPanel mount, masterplan A06). This case is the standing
  // falsifier for that pin: it proves the call-site regex is sensitive to a
  // one-line edit of the slice, so the "still matches BASE" claim can fail. When
  // the parent applies P03's PROPOSED_PATCH, the anchors themselves move to
  // resolveMountEngineSelection and this file is re-pinned (see RESULT.md
  // INTEGRATION_NOTES for the exact assertion list that must move).
  it("anchored pin is falsifiable: swapping the one-line selector breaks the F-13 call-site match", () => {
    const edited = mountSlice.replace(
      "const requestedImpl = resolveMountEngineImpl(window.location.search);",
      "const requestedImpl = resolveMountEngineSelection(window.location.search);",
    );
    // The edit must actually apply to the BASE slice, or this falsifier is vacuous.
    expect(edited).not.toBe(mountSlice);
    expect(edited).not.toContain("const requestedImpl = resolveMountEngineImpl(");
    expect(edited).not.toMatch(/resolveMountEngineImpl\(\s*window\.location\.search\s*\)/);
    // …while the real BASE slice does match (this is what A06 pins):
    expect(mountSlice).toMatch(/resolveMountEngineImpl\(\s*window\.location\.search\s*\)/);
  });
});
