import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// F-13 source contract: ChartPanel's create site is opt-in ?engine=mm with an
// lwc fallback. The default path must stay the plain two-arg createEngine call.

const src = readFileSync(
  path.resolve(__dirname, "../../components/ChartPanel.tsx"),
  "utf8",
);

describe("ChartPanel mount engine selector (F-13)", () => {
  it("routes the create site through resolveMountEngineImpl(window.location.search)", () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bresolveMountEngineImpl\b[^}]*\}\s*from\s*["']@\/lib\/chart-engine\/select["']/,
    );
    expect(src).toMatch(/resolveMountEngineImpl\(\s*window\.location\.search\s*\)/);
  });

  it("the lwc branch is the plain createEngine call (impl absent)", () => {
    expect(src).toMatch(/createEngine\(\s*el,\s*engineOptions\s*\)/);
    expect(src).toMatch(/createEngine\(\s*el,\s*engineOptions,\s*"mm"\s*\)/);
  });

  it("mm failure destroys the attempt, warns one line, and mounts lwc", () => {
    expect(src).toMatch(/engine\.destroy\(\)/);
    expect(src).toMatch(/console\.warn\(/);
    expect(src).toMatch(/mm mount fell back to lwc/);
    expect(src).toMatch(/requestedImpl === "mm"/);
  });
});
