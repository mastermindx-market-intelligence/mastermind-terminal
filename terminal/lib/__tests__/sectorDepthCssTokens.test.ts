import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Lane 7 structural light-mode readiness: Terminal ships dark-only today
 * (frozen product constraint), so "light + dark" for these surfaces means the
 * CSS contract — every colour in the retained-depth CSS modules comes from a
 * semantic token (var(--…)), never a literal. If a light token set ever lands,
 * these modules need zero edits. Chart series colours (categorical palettes in
 * TS, the YEAR_PALETTE house pattern) are out of this file's scope.
 */
const cssDir = path.join(__dirname, "..", "..", "components", "sector-intelligence", "depth");

const COLOR_LITERAL = /#(?:[0-9a-fA-F]{3,8})\b|\brgba?\(|\bhsla?\(|\b(?:white|black|red|blue|green|gray|grey|orange|yellow|purple|pink)\b(?!-)/;

describe("depth CSS modules are token-only", () => {
  it("finds the depth CSS modules", () => {
    const files = readdirSync(cssDir).filter((f) => f.endsWith(".module.css"));
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it("uses no colour literals (every colour is a semantic token)", () => {
    const files = readdirSync(cssDir).filter((f) => f.endsWith(".module.css"));
    const offenders: string[] = [];
    for (const file of files) {
      const css = readFileSync(path.join(cssDir, file), "utf8");
      for (const [idx, line] of css.split("\n").entries()) {
        const noVars = line.replace(/var\(--[a-z0-9-]+\)/gi, "");
        if (COLOR_LITERAL.test(noVars)) offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares focus-visible outlines and reduced-motion respect where interactive", () => {
    const files = readdirSync(cssDir).filter((f) => f.endsWith(".module.css"));
    const all = files.map((f) => readFileSync(path.join(cssDir, f), "utf8")).join("\n");
    expect(all).toMatch(/:focus-visible/);
    expect(all).toMatch(/prefers-reduced-motion/);
  });
});
